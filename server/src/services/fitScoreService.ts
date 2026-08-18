import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { configService } from './configService.js';
import { chatJson } from './aiProviderService.js';
import { CONFIG_KEYS, FIT_RECOMMENDATION } from '@agnohire/shared';
import type { FitScoreData, ParsedResumeData } from '@agnohire/shared';

const SYSTEM_PROMPT =
  'You are a senior technical recruiter performing an unbiased candidate-to-job ' +
  'fit assessment. Judge only on skills, experience, and role relevance. Ignore ' +
  'name, gender, age, and other protected attributes. Respond ONLY with JSON.';

const RECS = Object.values(FIT_RECOMMENDATION);

function clampScore(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function buildPrompt(args: {
  jobTitle: string;
  jobDescription: string;
  jobSkills: string[];
  experienceMin: number | null;
  experienceMax: number | null;
  candidateSkills: string[];
  candidateRole: string | null;
  parsed: ParsedResumeData | null;
}): string {
  const expRange =
    args.experienceMin != null || args.experienceMax != null
      ? `${args.experienceMin ?? 0}–${args.experienceMax ?? '∞'} years`
      : 'unspecified';
  const resumeSummary = args.parsed
    ? [
        args.parsed.summary ? `Summary: ${args.parsed.summary}` : null,
        args.parsed.totalExperienceYears != null
          ? `Total experience: ${args.parsed.totalExperienceYears} years`
          : null,
        args.parsed.experience.length
          ? `Recent roles: ${args.parsed.experience
              .slice(0, 4)
              .map((e) => `${e.title} @ ${e.company}`)
              .join('; ')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n')
    : 'No parsed resume available.';

  return [
    '## JOB',
    `Title: ${args.jobTitle}`,
    `Required experience: ${expRange}`,
    `Required skills: ${args.jobSkills.join(', ') || 'unspecified'}`,
    `Description:\n${args.jobDescription.slice(0, 4000)}`,
    '',
    '## CANDIDATE',
    `Current role: ${args.candidateRole ?? 'unknown'}`,
    `Skills: ${args.candidateSkills.join(', ') || 'unspecified'}`,
    resumeSummary,
    '',
    '## TASK',
    'Score the candidate against the job. Return JSON with this exact shape:',
    '{',
    '  "overall": number (0-100),',
    '  "skillMatch": number (0-100),',
    '  "experienceMatch": number (0-100),',
    '  "matchedSkills": string[],',
    '  "missingSkills": string[],',
    '  "summary": string (2-3 sentences),',
    '  "strengths": string[],',
    '  "concerns": string[],',
    `  "recommendation": one of ${RECS.join(' | ')}`,
    '}',
  ].join('\n');
}

function normalize(raw: Partial<FitScoreData>): FitScoreData {
  const recommendation = RECS.includes(raw.recommendation as never)
    ? (raw.recommendation as FitScoreData['recommendation'])
    : FIT_RECOMMENDATION.WEAK_MATCH;
  return {
    overall: clampScore(raw.overall),
    skillMatch: clampScore(raw.skillMatch),
    experienceMatch: clampScore(raw.experienceMatch),
    matchedSkills: Array.isArray(raw.matchedSkills) ? raw.matchedSkills : [],
    missingSkills: Array.isArray(raw.missingSkills) ? raw.missingSkills : [],
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    strengths: Array.isArray(raw.strengths) ? raw.strengths : [],
    concerns: Array.isArray(raw.concerns) ? raw.concerns : [],
    recommendation,
    scoredAt: new Date().toISOString(),
  };
}

/**
 * Ground-truth skill overlap between the job's required skills and the
 * candidate's actual skills (resume-parsed + profile), computed by exact
 * case-insensitive match — not left to the model's self-reported numbers,
 * which tend to look confident even when nothing actually overlaps.
 *
 * `skillsConfigured: false` means the job has no required skills tagged at
 * all — there is nothing to verify a match against, so the caller must NOT
 * treat that as a free 100% skill match (that previously let a candidate
 * with zero verifiable skills score as a "strong match" purely because the
 * job requisition itself was missing its skills list).
 */
function computeSkillOverlap(
  jobSkills: string[],
  candidateSkills: string[],
): { matchedSkills: string[]; missingSkills: string[]; skillMatch: number; skillsConfigured: boolean } {
  if (jobSkills.length === 0) {
    return { matchedSkills: [], missingSkills: [], skillMatch: 0, skillsConfigured: false };
  }
  // Strip surrounding/stray punctuation (typos like a trailing apostrophe or
  // period from manual entry) and collapse whitespace, so trivial formatting
  // noise doesn't cost a candidate a match on a skill they actually have.
  // Interior letters/digits/spaces are preserved, so distinct skills (e.g.
  // "Statistics" vs "Statistical Analysis") still don't collide.
  const norm = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N} ]+/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  const candidateSet = new Set(candidateSkills.map(norm));
  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];
  for (const skill of jobSkills) {
    if (candidateSet.has(norm(skill))) matchedSkills.push(skill);
    else missingSkills.push(skill);
  }
  const skillMatch = Math.round((matchedSkills.length / jobSkills.length) * 100);
  return { matchedSkills, missingSkills, skillMatch, skillsConfigured: true };
}

function recommendationForScore(overall: number): FitScoreData['recommendation'] {
  if (overall >= 75) return FIT_RECOMMENDATION.STRONG_MATCH;
  if (overall >= 50) return FIT_RECOMMENDATION.MATCH;
  if (overall >= 25) return FIT_RECOMMENDATION.WEAK_MATCH;
  return FIT_RECOMMENDATION.NO_MATCH;
}

/**
 * Computes an AI fit-score for a job application and persists it. Used by both
 * the Bull processor and the inline fallback. Throws on failure for retry.
 */
export async function scoreApplication(applicationId: string): Promise<FitScoreData> {
  const application = await prisma.jobApplication.findFirst({
    where: { id: applicationId },
    select: {
      candidateId: true,
      candidate: {
        select: {
          skills: true,
          currentRole: true,
          sectorId: true,
          resumes: {
            where: { isPrimary: true, deletedAt: null },
            select: { parsedData: true },
            take: 1,
          },
        },
      },
      job: {
        select: {
          title: true,
          description: true,
          skills: true,
          experienceMin: true,
          experienceMax: true,
        },
      },
    },
  });
  if (!application) {
    throw new Error(`Application not found: ${applicationId}`);
  }

  // Optional per-feature model override; empty falls back to the global
  // OPENAI_MODEL so fit scoring follows whatever provider is configured.
  const model = await configService.getString(
    CONFIG_KEYS.FIT_SCORE_MODEL,
    '',
    application.candidate.sectorId ?? null,
  );

  const parsed = (application.candidate.resumes[0]?.parsedData ?? null) as ParsedResumeData | null;

  // Ground-truth candidate skills — resume-parsed skills plus whatever's on
  // the profile directly (deduped, case-insensitive downstream).
  const candidateSkills = [...new Set([...(parsed?.skills ?? []), ...application.candidate.skills])];

  const persist = async (fit: FitScoreData): Promise<FitScoreData> => {
    await prisma.jobApplication.update({
      where: { id: applicationId },
      data: { fitScore: fit.overall, fitScoreData: fit as object },
    });
    // Keep the candidate-level fit score (shown on Candidates / Talent Search)
    // in step: it holds the best score across the candidate's applications.
    const best = await prisma.jobApplication.aggregate({
      where: { candidateId: application.candidateId },
      _max: { fitScore: true },
    });
    await prisma.candidate.update({
      where: { id: application.candidateId },
      data: { fitScore: best._max.fitScore ?? fit.overall },
    });
    return fit;
  };

  // A fit score is a claim about how well the candidate's actual skills
  // match the job. With no resume and no listed skills, there's nothing to
  // compare against — the model has no hedge toward a low/uncertain score
  // for a near-empty prompt, it confidently returns a high one anyway. A
  // bare `currentRole` (e.g. a job title typed into the profile) is not
  // skill evidence either, so it doesn't count on its own. Persist a real
  // zero instead of a hallucinated number, and instead of just returning an
  // unpersisted object — otherwise a stale high score from before this
  // candidate had a resume never gets corrected on re-score.
  const hasSkillData = candidateSkills.length > 0 || Boolean(parsed);
  if (!hasSkillData) {
    logger.info('Skipped fit score — no resume or skills to score against', { applicationId });
    return persist(
      normalize({
        overall: 0,
        skillMatch: 0,
        experienceMatch: 0,
        summary: 'Not scored — no resume or skills on file yet.',
        recommendation: FIT_RECOMMENDATION.NO_MATCH,
      }),
    );
  }

  const raw = await chatJson<Partial<FitScoreData>>(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildPrompt({
          jobTitle: application.job.title,
          jobDescription: application.job.description,
          jobSkills: application.job.skills,
          experienceMin: application.job.experienceMin,
          experienceMax: application.job.experienceMax,
          candidateSkills,
          candidateRole: application.candidate.currentRole,
          parsed,
        }),
      },
    ],
    {
      ...(model ? { model } : {}),
      maxTokens: 1200,
      temperature: 0.2,
      sectorId: application.candidate.sectorId ?? null,
    },
  );

  const fit = normalize(raw);

  // Same problem as skill match: with truly nothing on file, the model has
  // no basis to judge experience, yet it doesn't consistently report that as
  // "unknown" — it guesses, and guesses differently call to call (e.g. 70%
  // one time, 0% the next, for the exact same empty profile). Ground it:
  // only trust the model's experienceMatch when there's SOME real signal to
  // reason from. A resume being on file counts as real signal even if it has
  // no explicit years/work-history section — a sparse fresher resume with no
  // work history is itself evidence (of a likely fresher), and the model can
  // correctly score that as a strong match against a job that wants
  // freshers. Only force a zero when there is genuinely no resume and no
  // profile role at all.
  const hasExperienceEvidence = Boolean(parsed) || Boolean(application.candidate.currentRole);
  if (!hasExperienceEvidence) {
    fit.experienceMatch = 0;
    fit.concerns = [...fit.concerns, 'No resume or experience history on file to verify experience'];
  }

  // Don't trust the model's self-reported skill match — compare the job's
  // required skills against the candidate's actual skills directly, and let
  // that (not the model's optimism) gate the overall score. If the job lists
  // required skills and the candidate matches none of them, the score cannot
  // read as a strong fit no matter what the model inferred from title/summary.
  const overlap = computeSkillOverlap(application.job.skills, candidateSkills);
  fit.matchedSkills = overlap.matchedSkills;
  fit.missingSkills = overlap.missingSkills;
  fit.skillMatch = overlap.skillMatch;
  if (overlap.skillsConfigured) {
    fit.overall = clampScore(overlap.skillMatch * 0.6 + fit.experienceMatch * 0.4);
  } else {
    // Job has no required skills tagged — there's nothing to verify a skill
    // match against, so don't reward that as a free 100%. Fall back to
    // experience match alone, and say so plainly rather than implying a
    // skill fit that was never actually checked.
    fit.overall = clampScore(fit.experienceMatch);
    fit.concerns = [...fit.concerns, 'Job has no required skills configured — score reflects experience match only'];
  }
  fit.recommendation = recommendationForScore(fit.overall);

  const persisted = await persist(fit);
  logger.info('Application fit scored', { applicationId, overall: persisted.overall });
  return persisted;
}
