import { prisma, tenantTransaction } from '../config/database.js';
import { logger } from '../config/logger.js';
import { extractResumeTextWithOcr } from '../utils/ocr.js';
import { chatJson } from './aiProviderService.js';
import type { ParsedResumeData } from '@agnohire/shared';
import { runWithTenant } from '../config/tenantContext.js';

const SYSTEM_PROMPT =
  'You are an expert technical recruiter and resume parser. Extract structured ' +
  'information from the resume text. Respond ONLY with a JSON object matching the ' +
  'requested schema. Use null for unknown scalar fields and empty arrays when none apply.';

function buildPrompt(text: string): string {
  // Guard against very long resumes blowing the context window.
  const clipped = text.slice(0, 12_000);
  return [
    'Parse the following resume into JSON with this exact shape:',
    '{',
    '  "fullName": string|null,',
    '  "email": string|null,',
    '  "phone": string|null,',
    '  "location": string|null,',
    '  "currentRole": string|null,',
    '  "totalExperienceYears": number|null,',
    '  "summary": string|null,',
    '  "skills": string[],',
    '  "education": [{ "degree": string, "institution": string, "year": string|null }],',
    '  "experience": [{ "title": string, "company": string, "duration": string|null, "description": string|null }],',
    '  "certifications": string[]',
    '}',
    '',
    'Resume text:',
    '"""',
    clipped,
    '"""',
  ].join('\n');
}

function normalize(raw: Partial<ParsedResumeData>): ParsedResumeData {
  return {
    fullName: raw.fullName ?? null,
    email: raw.email ?? null,
    phone: raw.phone ?? null,
    location: raw.location ?? null,
    currentRole: raw.currentRole ?? null,
    totalExperienceYears: raw.totalExperienceYears ?? null,
    summary: raw.summary ?? null,
    skills: Array.isArray(raw.skills) ? raw.skills.filter(Boolean) : [],
    education: Array.isArray(raw.education)
      ? raw.education.map((e) => ({
          degree: e.degree ?? '',
          institution: e.institution ?? '',
          year: e.year ?? null,
        }))
      : [],
    experience: Array.isArray(raw.experience)
      ? raw.experience.map((e) => ({
          title: e.title ?? '',
          company: e.company ?? '',
          duration: e.duration ?? null,
          description: e.description ?? null,
        }))
      : [],
    certifications: Array.isArray(raw.certifications) ? raw.certifications.filter(Boolean) : [],
  };
}

/**
 * Parses a stored resume: extracts text, calls the AI parser, and persists the
 * structured result on the Resume row. Idempotent and safe to retry — used by
 * both the Bull processor and the inline fallback. Throws on failure so the
 * queue can retry; the caller records the FAILED status.
 */
export async function parseResume(resumeId: string): Promise<void> {
  const resume = await prisma.resume.findFirst({ where: { id: resumeId } });
  if (!resume) {
    logger.warn('parseResume: resume not found', { resumeId });
    return;
  }
  if (!resume.fileData) {
    await prisma.resume.update({
      where: { id: resumeId },
      data: { parseStatus: 'FAILED', parseError: 'No file data stored for this resume.' },
    });
    return;
  }

  await prisma.resume.update({
    where: { id: resumeId },
    data: { parseStatus: 'PROCESSING', parseError: null },
  });

  const parseFn = async () => {
    try {
      const text = await extractResumeTextWithOcr(Buffer.from(resume.fileData!), resume.mimeType);
      if (!text.trim()) {
        throw new Error('No readable text could be extracted from this file (even with OCR).');
      }

      const parsedRaw = await chatJson<Partial<ParsedResumeData>>(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildPrompt(text) },
        ],
        { maxTokens: 2000, temperature: 0.1 },
      );
      const parsed = normalize(parsedRaw);

      await tenantTransaction(async (tx) => {
        await tx.resume.update({
          where: { id: resumeId },
          data: {
            parsedData: parsed as object,
            parseStatus: 'COMPLETED',
            parseError: null,
            parsedAt: new Date(),
          },
        });

        // Enrich the candidate's skills from the resume if they have none yet.
        const candidate = await tx.candidate.findFirst({
          where: { id: resume.candidateId },
          select: { skills: true },
        });
        if (candidate && candidate.skills.length === 0 && parsed.skills.length > 0) {
          await tx.candidate.update({
            where: { id: resume.candidateId },
            data: { skills: parsed.skills.slice(0, 50) },
          });
        }
      });

      logger.info('Resume parsed', { resumeId, skills: parsed.skills.length });
    } catch (err) {
      const message = (err as Error).message ?? 'Resume parsing failed';
      await prisma.resume.update({
        where: { id: resumeId },
        data: { parseStatus: 'FAILED', parseError: message.slice(0, 500) },
      });
      throw err;
    }
  };

  if (resume.tenantId) {
    await runWithTenant(resume.tenantId, parseFn);
  } else {
    await parseFn();
  }
}
