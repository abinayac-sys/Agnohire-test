import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { configService } from './configService.js';
import { chatJson } from './aiProviderService.js';
import { CONFIG_KEYS } from '@agnohire/shared';
import type { Prisma } from '@prisma/client';
import type { SentimentBreakdown, TranscriptMetrics } from '@agnohire/shared';

/**
 * Module 8 — analyzes an interview's transcript into communication/sentiment/
 * keyword intelligence. Deterministic metrics are ALWAYS computed; the AI layer
 * (communication score, sentiment, refined keywords, narrative) runs only when
 * an OpenAI key is configured and degrades gracefully otherwise.
 *
 * Processor: must NOT import jobs/dispatch (avoids an import cycle), same rule
 * as interviewScoringService / assessmentScoringService.
 */

const FILLER_WORDS = ['um', 'uh', 'er', 'ah', 'like', 'actually', 'basically', 'literally', 'you know', 'i mean', 'sort of', 'kind of'];
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in', 'on',
  'for', 'with', 'as', 'at', 'by', 'this', 'that', 'these', 'those', 'it', 'its', 'i', 'you', 'he', 'she', 'we',
  'they', 'me', 'my', 'your', 'so', 'do', 'did', 'have', 'has', 'had', 'not', 'no', 'yes', 'if', 'then', 'than',
  'about', 'just', 'can', 'will', 'would', 'should', 'could', 'what', 'how', 'when', 'where', 'who', 'which',
  'um', 'uh', 'like', 'okay', 'ok', 'well', 'right', 'really', 'going', 'get', 'got', 'think', 'know',
]);

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

/** Computes AI-free transcript statistics. Speaker labels (`Candidate:` /
 *  `Interviewer:`) are used for talk-ratio when present. */
export function computeMetrics(transcript: string, durationSec: number | null): TranscriptMetrics {
  const allWords = words(transcript);
  const wordCount = allWords.length;

  let fillerCount = 0;
  for (const f of FILLER_WORDS) {
    const re = new RegExp(`\\b${f.replace(/ /g, '\\s+')}\\b`, 'gi');
    fillerCount += (transcript.match(re) ?? []).length;
  }

  const questionCount = (transcript.match(/\?/g) ?? []).length;

  // Speaker talk-ratio (only when the transcript is speaker-labelled).
  const lines = transcript.split(/\r?\n/);
  let candidateWords = 0;
  let labelledWords = 0;
  let sawLabels = false;
  let current: 'candidate' | 'other' | null = null;
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z .]{0,30}?)\s*:/);
    if (m) {
      sawLabels = true;
      current = /candidate|applicant|interviewee/i.test(m[1]) ? 'candidate' : 'other';
      const after = line.slice(line.indexOf(':') + 1);
      const w = words(after).length;
      labelledWords += w;
      if (current === 'candidate') candidateWords += w;
    } else if (current) {
      const w = words(line).length;
      labelledWords += w;
      if (current === 'candidate') candidateWords += w;
    }
  }
  const candidateTalkRatio = sawLabels && labelledWords > 0 ? round1((candidateWords / labelledWords) * 100) : null;

  // Top keywords (stopword-filtered frequency).
  const freq = new Map<string, number>();
  for (const w of allWords) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const topKeywords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word, count]) => ({ word, count }));

  const minutes = durationSec ? durationSec / 60 : null;
  const wordsPerMinute = minutes && minutes > 0 ? Math.round(wordCount / minutes) : null;

  return {
    wordCount,
    wordsPerMinute,
    fillerCount,
    fillerRatio: wordCount > 0 ? round1((fillerCount / wordCount) * 100) : 0,
    questionCount,
    candidateTalkRatio,
    topKeywords,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface AiAnalysis {
  communicationScore: number | null;
  skillMatchScore: number | null;
  sentiment: SentimentBreakdown | null;
  keywords: string[];
  summary: string | null;
}

async function runAi(transcript: string, sectorId: string | null): Promise<AiAnalysis> {
  const result = await chatJson<{
    communicationScore: number;
    skillMatchScore: number;
    sentiment: { overall: string; score: number; positive: number; neutral: number; negative: number };
    keywords: string[];
    summary: string;
  }>(
    [
      {
        role: 'system',
        content:
          'You are an interview analyst. Analyze the transcript and respond ONLY with JSON: ' +
          '{"communicationScore": 0-100, "skillMatchScore": 0-100, "sentiment": {"overall": string, ' +
          '"score": -1..1, "positive": 0-100, "neutral": 0-100, "negative": 0-100}, "keywords": string[], ' +
          '"summary": string}. communicationScore rates clarity/structure/articulation; skillMatchScore rates ' +
          'depth/relevance of technical content; summary is 2-3 objective sentences for a recruiter.',
      },
      { role: 'user', content: `Transcript:\n"""\n${transcript.slice(0, 12000)}\n"""` },
    ],
    { sectorId, maxTokens: 700, temperature: 0.3 },
  );
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  // Coerce model output to a finite number, or null when it's missing/garbage —
  // never let NaN reach a numeric DB column (Prisma rejects it and the whole
  // analysis would throw). `score` rounds; `pct` is a 0-100 integer.
  const num = (v: unknown, lo: number, hi: number): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? clamp(Math.round(n), lo, hi) : null;
  };
  const pct = (v: unknown): number => num(v, 0, 100) ?? 0;
  return {
    communicationScore: num(result.communicationScore, 0, 100),
    skillMatchScore: num(result.skillMatchScore, 0, 100),
    sentiment: {
      overall: String(result.sentiment?.overall ?? 'neutral').slice(0, 40),
      score: Number.isFinite(Number(result.sentiment?.score))
        ? clamp(Number(result.sentiment?.score), -1, 1)
        : 0,
      positive: pct(result.sentiment?.positive),
      neutral: pct(result.sentiment?.neutral),
      negative: pct(result.sentiment?.negative),
    },
    keywords: Array.isArray(result.keywords) ? result.keywords.slice(0, 15).map((k) => String(k).slice(0, 40)) : [],
    summary: result.summary ? String(result.summary).slice(0, 2000) : null,
  };
}

/** Analyze an interview's transcript and persist intelligence onto its result. */
export async function analyzeInterview(interviewId: string): Promise<void> {
  const interview = await prisma.interview.findFirst({
    where: { id: interviewId },
    select: {
      id: true, transcript: true, duration: true,
      candidate: { select: { sectorId: true } },
      result: { select: { id: true } },
    },
  });
  if (!interview) {
    logger.warn('analyzeInterview: not found', { interviewId });
    return;
  }
  if (!interview.transcript || !interview.transcript.trim()) {
    logger.info('analyzeInterview: no transcript, skipping', { interviewId });
    return;
  }

  const sectorId = interview.candidate.sectorId ?? null;
  const metrics = computeMetrics(interview.transcript, interview.duration ?? null);

  let ai: AiAnalysis = { communicationScore: null, skillMatchScore: null, sentiment: null, keywords: [], summary: null };
  const aiAvailable = await configService.isConfigured(CONFIG_KEYS.OPENAI_API_KEY, sectorId);
  if (aiAvailable) {
    try {
      ai = await runAi(interview.transcript, sectorId);
    } catch (err) {
      logger.warn('Video intelligence AI failed; deterministic-only', { interviewId, err: (err as Error).message });
    }
  }

  // Keywords: prefer AI topics, else deterministic top keywords.
  const keywords = ai.keywords.length ? ai.keywords : metrics.topKeywords.map((k) => k.word);
  const keywordAnalysis = { keywords, metrics, aiGenerated: ai.communicationScore != null } as unknown as Prisma.InputJsonValue;

  const data = {
    communicationScore: ai.communicationScore,
    skillMatchScore: ai.skillMatchScore,
    ...(ai.sentiment && { sentimentResult: ai.sentiment as unknown as Prisma.InputJsonValue }),
    keywordAnalysis,
    transcriptSummary: ai.summary,
  };

  await prisma.interviewResult.upsert({
    where: { interviewId },
    update: data,
    create: { interviewId, ...data },
  });

  logger.info('Interview transcript analyzed', { interviewId, ai: ai.communicationScore != null });
}
