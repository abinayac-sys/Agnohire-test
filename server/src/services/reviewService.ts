import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma, tenantTransaction } from '../config/database.js';
import { logger } from '../config/logger.js';
import { recordAudit } from './auditService.js';
import { configService } from './configService.js';
import { computeMetrics } from './videoIntelligenceService.js';
import { type InterviewContext } from './questionBankService.js';
import { isRecruiterScoped, assignedCandidateWhere } from '../utils/accessScope.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { paginate } from '../utils/response.js';
import {
  ROLES,
  CONFIG_KEYS,
  type ReviewFilters,
  type SetMediaInput,
  type SubmitReviewInput,
  type ReviewListItem,
  type ReviewDetail,
  type VideoIntelligence,
  type IntegrityReport,
  type IntegrityViolation,
  type SentimentBreakdown,
  type TranscriptMetrics,
  type Recommendation,
  type ViolationType,
  type InterviewStatus,
  type InterviewType,
} from '@agnohire/shared';

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/** Non-admins see interviews they ran or for candidates in their sector;
 *  recruiters are limited to their own interviews + allocated candidates. */
function reviewScope(ctx: InterviewContext): Prisma.InterviewWhereInput {
  if (isRecruiterScoped(ctx.role)) {
    return { OR: [{ recruiterId: ctx.userId }, { candidate: assignedCandidateWhere(ctx.userId) }] };
  }
  if (isSuperOrAdmin(ctx.role) || configService.crossSectorVisibilityEnabled()) return {};
  if (ctx.sectorId) return { OR: [{ recruiterId: ctx.userId }, { candidate: { sectorId: ctx.sectorId } }] };
  return { recruiterId: ctx.userId };
}

/** A review-eligible interview: completed and carrying a transcript or recording. */
function reviewableWhere(ctx: InterviewContext): Prisma.InterviewWhereInput {
  // Any completed/evaluated interview is reviewable: proctoring integrity and
  // reviewer recommendations apply even when there's no transcript/recording
  // yet (AI interviews typically have neither). Media-based intelligence simply
  // stays empty until a transcript/recording is attached.
  return {
    deletedAt: null,
    status: { in: ['COMPLETED', 'EVALUATED'] },
    AND: [reviewScope(ctx)],
  };
}

// ─── INTEGRITY (proctoring) ─────────────────────────────────────────────────────

function buildIntegrity(violations: unknown): IntegrityReport {
  const list: IntegrityViolation[] = Array.isArray(violations)
    ? (violations as { type?: string; at?: string }[])
        .filter((v) => v && v.type)
        .map((v) => ({ type: v.type as ViolationType, at: String(v.at ?? '') }))
    : [];
  const counts = new Map<string, number>();
  for (const v of list) counts.set(v.type, (counts.get(v.type) ?? 0) + 1);
  const total = list.length;
  const severity: IntegrityReport['severity'] = total === 0 ? 'clean' : total <= 2 ? 'low' : total <= 5 ? 'medium' : 'high';
  return {
    totalStrikes: total,
    byType: [...counts.entries()].map(([type, count]) => ({ type: type as ViolationType, count })),
    timeline: list,
    severity,
  };
}

// ─── INTELLIGENCE (reconstruct from the stored result) ───────────────────────────

interface StoredKeywordAnalysis {
  keywords?: string[];
  metrics?: TranscriptMetrics;
  aiGenerated?: boolean;
}

function buildIntelligence(
  transcript: string | null,
  duration: number | null,
  result: {
    communicationScore: number | null;
    skillMatchScore: number | null;
    sentimentResult: unknown;
    keywordAnalysis: unknown;
    transcriptSummary: string | null;
    updatedAt: Date;
  } | null,
): VideoIntelligence | null {
  if (!transcript || !transcript.trim()) return null;

  const ka = (result?.keywordAnalysis ?? null) as StoredKeywordAnalysis | null;
  // Metrics: use the persisted analysis if present, else compute on the fly.
  const metrics = ka?.metrics ?? computeMetrics(transcript, duration);
  const keywords = ka?.keywords ?? metrics.topKeywords.map((k) => k.word);
  const sentiment = (result?.sentimentResult ?? null) as SentimentBreakdown | null;
  const analyzed = Boolean(result && (result.keywordAnalysis || result.communicationScore != null));

  return {
    communicationScore: result?.communicationScore ?? null,
    skillMatchScore: result?.skillMatchScore ?? null,
    sentiment,
    keywords,
    metrics,
    transcriptSummary: result?.transcriptSummary ?? null,
    aiGenerated: Boolean(ka?.aiGenerated),
    analyzedAt: analyzed && result ? result.updatedAt.toISOString() : null,
  };
}

// ─── LIST ────────────────────────────────────────────────────────────────────

const LIST_SELECT = {
  id: true, status: true, type: true, createdAt: true, completedAt: true,
  transcript: true, recordingUrl: true, violations: true, roundNumber: true,
  candidate: { select: { id: true, fullName: true, email: true } },
  result: { select: { communicationScore: true, recommendation: true, reviewedAt: true, decision: true, aiDecision: true, failureReason: true, recommendedLearning: true, feedbackPdfPath: true, percentageScore: true } },
} satisfies Prisma.InterviewSelect;

type RawList = Prisma.InterviewGetPayload<{ select: typeof LIST_SELECT }>;

function toListItem(iv: RawList): ReviewListItem {
  const violationCount = Array.isArray(iv.violations) ? (iv.violations as unknown[]).length : 0;
  return {
    id: iv.id,
    status: iv.status as InterviewStatus,
    type: iv.type as InterviewType,
    createdAt: iv.createdAt.toISOString(),
    completedAt: iv.completedAt?.toISOString() ?? null,
    candidate: iv.candidate,
    hasTranscript: Boolean(iv.transcript && iv.transcript.trim()),
    hasRecording: Boolean(iv.recordingUrl),
    communicationScore: iv.result?.communicationScore ?? null,
    percentageScore: iv.result?.percentageScore ?? null,
    recommendation: (iv.result?.recommendation ?? null) as Recommendation | null,
    decision: iv.result?.decision ?? iv.result?.aiDecision ?? null,
    failureReason: (iv.result as any)?.failureReason ?? null,
    recommendedLearning: (iv.result as any)?.recommendedLearning ?? null,
    feedbackPdfPath: (iv.result as any)?.feedbackPdfPath ?? null,
    reviewedAt: iv.result?.reviewedAt?.toISOString() ?? null,
    roundNumber: iv.roundNumber ?? null,
    violationCount,
  };
}

export async function listReviews(filters: ReviewFilters, ctx: InterviewContext) {
  const { page, limit, search, type, pendingOnly, sortBy, sortOrder, from, to } = filters;
  // reviewableWhere already owns the top-level AND; layer the extra filters
  // into their own AND chain so nothing collides.
  const and: Prisma.InterviewWhereInput[] = [reviewableWhere(ctx)];
  if (pendingOnly) {
    // Pending = no result row yet OR a result row without a recommendation.
    and.push({ OR: [{ result: { is: null } }, { result: { is: { recommendation: null } } }] });
  }
  if (search) {
    and.push({
      candidate: { is: { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } },
    });
  }
  if (filters.jobRequisitionId) {
    and.push({ jobRequisitionId: filters.jobRequisitionId });
  }
  const where: Prisma.InterviewWhereInput = {
    ...(type && { type }),
    AND: and,
    ...((from || to) ? { createdAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(`${to}T23:59:59.999Z`) }) } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.interview.count({ where }),
    prisma.interview.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [{ [sortBy]: sortOrder }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return paginate(rows.map(toListItem), total, page, limit);
}

// ─── DETAIL ──────────────────────────────────────────────────────────────────

export async function getReview(id: string, ctx: InterviewContext): Promise<ReviewDetail> {
  const iv = await prisma.interview.findFirst({
    where: { id, deletedAt: null, ...reviewScope(ctx) },
    select: {
      ...LIST_SELECT,
      duration: true,
      result: {
        select: {
          communicationScore: true, skillMatchScore: true, sentimentResult: true, keywordAnalysis: true,
          transcriptSummary: true, recommendation: true, reviewerNotes: true, reviewedAt: true,
          percentageScore: true, updatedAt: true,
          technicalScore: true, problemSolvingScore: true, confidenceScore: true, domainKnowledgeScore: true,
          strengths: true, improvements: true, finalScore: true,
          decision: true, aiDecision: true, failureReason: true, recommendedLearning: true, feedbackPdfPath: true
        },
      },
      questions: {
        select: {
          question: {
            select: {
              id: true, text: true, type: true, difficulty: true, options: true
            }
          }
        },
        orderBy: { orderIndex: 'asc' }
      },
      answers: {
        select: {
          id: true, questionId: true, answerText: true, answerCode: true, selectedOption: true,
          isCorrect: true, aiScore: true, maxScore: true, aiEvaluation: true,
          aiStrengths: true, aiImprovements: true, aiReasoning: true, timeTaken: true
        }
      },
      biometricReport: {
        select: {
          id: true, interviewId: true, candidateId: true, enrollmentImage: true,
          enrollmentTimestamp: true, faceSignature: true, verificationStatus: true,
          totalChecks: true, successfulMatches: true, failedMatches: true,
          warningsIssued: true, noFaceEvents: true, multipleFaceEvents: true,
          matchHistory: true, latestImage: true
        }
      }
    },
  });
  if (!iv) throw new NotFoundError('Interview not found');

  const base = toListItem(iv as unknown as RawList);
  return {
    ...base,
    recordingUrl: iv.recordingUrl,
    transcript: iv.transcript,
    duration: iv.duration,
    intelligence: buildIntelligence(iv.transcript, iv.duration, iv.result
      ? {
          communicationScore: iv.result.communicationScore,
          skillMatchScore: iv.result.skillMatchScore,
          sentimentResult: iv.result.sentimentResult,
          keywordAnalysis: iv.result.keywordAnalysis,
          transcriptSummary: iv.result.transcriptSummary,
          updatedAt: iv.result.updatedAt,
        }
      : null),
    integrity: buildIntegrity(iv.violations),
    reviewerNotes: iv.result?.reviewerNotes ?? null,
    recommendation: (iv.result?.recommendation ?? null) as Recommendation | null,
    reviewedAt: iv.result?.reviewedAt?.toISOString() ?? null,
    communicationScore: iv.result?.communicationScore ?? null,
    percentageScore: iv.result?.percentageScore ?? null,
    technicalScore: iv.result?.technicalScore ?? null,
    problemSolvingScore: iv.result?.problemSolvingScore ?? null,
    confidenceScore: iv.result?.confidenceScore ?? null,
    domainKnowledgeScore: iv.result?.domainKnowledgeScore ?? null,
    strengths: iv.result?.strengths ?? null,
    improvements: iv.result?.improvements ?? null,
    failureReason: (iv.result as any)?.failureReason ?? null,
    recommendedLearning: (iv.result as any)?.recommendedLearning ?? null,
    feedbackPdfPath: (iv.result as any)?.feedbackPdfPath ?? null,
    questions: (iv as any).questions?.map((q: any) => q.question) || [],
    answers: (iv as any).answers || [],
    biometricReport: iv.biometricReport ? {
      ...iv.biometricReport,
      enrollmentTimestamp: iv.biometricReport.enrollmentTimestamp.toISOString()
    } : null
  };
}

/** Loads an interview for mutation, scoped, or throws. */
async function findScoped(id: string, ctx: InterviewContext) {
  const iv = await prisma.interview.findFirst({
    where: { id, deletedAt: null, ...reviewScope(ctx) },
    select: { id: true, status: true, transcript: true, recordingUrl: true, result: { select: { id: true } } },
  });
  if (!iv) throw new NotFoundError('Interview not found');
  return iv;
}

// ─── MEDIA (attach recording url / transcript) ───────────────────────────────────

export async function setMedia(id: string, data: SetMediaInput, ctx: InterviewContext, req: Request): Promise<ReviewDetail> {
  const iv = await findScoped(id, ctx);
  if (!['COMPLETED', 'EVALUATED', 'IN_PROGRESS'].includes(iv.status)) {
    throw new BadRequestError('Media can only be attached to a completed interview');
  }
  const transcript = data.transcript && data.transcript.trim() ? data.transcript : undefined;
  await prisma.interview.update({
    where: { id },
    data: {
      ...(data.recordingUrl !== undefined && { recordingUrl: data.recordingUrl || null }),
      ...(transcript !== undefined && { transcript }),
    },
  });
  await recordAudit(req, { action: 'UPDATE', entity: 'Interview', entityId: id, description: 'Attached review media (recording/transcript)' });

  // Re-analyze whenever a transcript was (re)set.
  if (transcript) {
    const { dispatchVideoAnalysis } = await import('../jobs/dispatch.js');
    await dispatchVideoAnalysis(id);
  }
  return getReview(id, ctx);
}

/** Whisper limit is 25 MB; our attachment ceiling is 15 MB, so cap defensively. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const INTERNAL_FILE_RE = /\/api\/files\/([0-9a-fA-F-]{36})\/download/;

/**
 * Resolves a recording URL to raw audio bytes. Internal `/api/files/<id>/download`
 * references read straight from the Attachment store; absolute URLs are fetched
 * over HTTP. Throws a friendly error when the audio can't be retrieved.
 */
async function fetchRecordingAudio(
  recordingUrl: string,
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const internal = recordingUrl.match(INTERNAL_FILE_RE);
  if (internal) {
    const { getAttachmentBytesById } = await import('./attachmentService.js');
    const file = await getAttachmentBytesById(internal[1]);
    if (!file) throw new BadRequestError('The attached recording file could not be found.');
    if (file.buffer.byteLength > MAX_AUDIO_BYTES) {
      throw new BadRequestError('Recording exceeds the 25 MB transcription limit.');
    }
    return file;
  }

  // External URL — fetch the bytes (e.g. an S3/CDN link stored on the interview).
  let response: Response;
  try {
    response = await fetch(recordingUrl);
  } catch {
    throw new BadRequestError('Could not download the recording from its URL.');
  }
  if (!response.ok) {
    throw new BadRequestError(`Could not download the recording (HTTP ${response.status}).`);
  }
  // Reject oversized files before buffering them into memory.
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_AUDIO_BYTES) {
    throw new BadRequestError('Recording exceeds the 25 MB transcription limit.');
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_AUDIO_BYTES) {
    throw new BadRequestError('Recording exceeds the 25 MB transcription limit.');
  }
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'audio/mpeg';
  const fileName = recordingUrl.split('/').pop()?.split('?')[0] || 'recording.mp3';
  return { buffer: Buffer.from(arrayBuffer), fileName, mimeType };
}

/**
 * Transcribes an interview recording with the configured Whisper-compatible
 * provider, persists the transcript, and re-runs the intelligence pipeline.
 */
export async function transcribe(
  id: string,
  ctx: InterviewContext,
  req: Request,
): Promise<ReviewDetail> {
  const iv = await findScoped(id, ctx);
  const sectorId = ctx.sectorId ?? null;
  if (!iv.recordingUrl) {
    throw new BadRequestError('Attach a recording URL before transcribing.');
  }
  const configured = await configService.isConfigured(CONFIG_KEYS.OPENAI_API_KEY, sectorId);
  if (!configured) {
    throw new BadRequestError(
      'Audio transcription is not configured. Add an OpenAI key in Admin Console → System Config → AI, then retry. For now, paste the transcript manually.',
    );
  }

  const audio = await fetchRecordingAudio(iv.recordingUrl);
  const { transcribeAudio } = await import('./aiProviderService.js');
  const transcript = await transcribeAudio(audio, sectorId);
  if (!transcript) {
    throw new BadRequestError('Transcription returned empty text. Paste the transcript manually.');
  }

  await prisma.interview.update({ where: { id }, data: { transcript } });
  await recordAudit(req, {
    action: 'TRANSCRIBE',
    entity: 'Interview',
    entityId: id,
    description: 'Transcribed interview recording with AI',
  });

  // Run the transcript intelligence pipeline on the fresh text.
  const { dispatchVideoAnalysis } = await import('../jobs/dispatch.js');
  await dispatchVideoAnalysis(id);

  return getReview(id, ctx);
}

export async function reanalyze(id: string, ctx: InterviewContext, req: Request): Promise<{ queued: boolean }> {
  const iv = await findScoped(id, ctx);
  if (!iv.transcript || !iv.transcript.trim()) throw new BadRequestError('No transcript to analyze. Attach one first.');
  const { dispatchVideoAnalysis } = await import('../jobs/dispatch.js');
  await dispatchVideoAnalysis(id);
  await recordAudit(req, { action: 'ANALYZE', entity: 'Interview', entityId: id, description: 'Re-ran transcript intelligence' });
  return { queued: true };
}

// ─── SUBMIT REVIEW (reviewer recommendation) ─────────────────────────────────────

export async function submitReview(id: string, data: SubmitReviewInput, ctx: InterviewContext, req: Request): Promise<ReviewDetail> {
  const iv = await findScoped(id, ctx);
  if (!['COMPLETED', 'EVALUATED'].includes(iv.status)) {
    throw new BadRequestError('Only a completed interview can be reviewed');
  }
  const payload = {
    recommendation: data.recommendation,
    reviewerNotes: data.reviewerNotes || null,
    reviewedById: ctx.userId,
    reviewedAt: new Date(),
    ...(data.finalScore !== undefined && { finalScore: data.finalScore })
  };
  await prisma.interviewResult.upsert({
    where: { interviewId: id },
    update: payload,
    create: { interviewId: id, ...payload },
  });
  await recordAudit(req, {
    action: 'REVIEW',
    entity: 'Interview',
    entityId: id,
    description: `Review recommendation: ${data.recommendation}`,
    newValue: { recommendation: data.recommendation },
  });

  try {
    const delayMinutes = await configService.getNumber(CONFIG_KEYS.INTERVIEW_REPORT_DELAY_MINUTES, 5);
    const { dispatchCandidateReport } = await import('../jobs/dispatch.js');
    await dispatchCandidateReport(id, delayMinutes);
    logger.info(`Scheduled candidate report delivery for interview ${id} in ${delayMinutes} minutes.`);
  } catch (err) {
    logger.error('Failed to schedule candidate report delivery', { err: (err as Error).message });
  }

  return getReview(id, ctx);
}

/**
 * Executes the delayed job to generate the PDF report and email it.
 */
export async function processReportDelivery(interviewId: string): Promise<void> {
  const iv = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: { 
      candidate: { 
        select: { 
          email: true, 
          fullName: true,
          applications: {
            where: { deletedAt: null },
            select: { job: { select: { title: true } } },
            take: 1
          }
        } 
      },
      result: true
    }
  });

  if (!iv?.candidate.email) {
    logger.warn('Skipping candidate report delivery: no email', { interviewId });
    return;
  }

  const { generateInterviewReportPDF } = await import('./pdfReportService.js');
  const pdfBuffer = await generateInterviewReportPDF(interviewId);

  // Save PDF to disk
  const fs = await import('fs/promises');
  const path = await import('path');
  const reportsDir = path.join(process.cwd(), 'uploads', 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const fileName = `report_${interviewId}.pdf`;
  const filePath = path.join(reportsDir, fileName);
  await fs.writeFile(filePath, pdfBuffer);

  const feedbackPdfPath = `/uploads/reports/${fileName}`;
  await prisma.interviewResult.update({
    where: { interviewId },
    data: { feedbackPdfPath, resultEmailedAt: new Date() }
  });

  const { sendMail } = await import('./mailerService.js');
  const { detailedInterviewFeedbackEmail } = await import('./emailTemplates.js');

  const { subject, html } = await detailedInterviewFeedbackEmail({
    candidateName: iv.candidate.fullName,
    jobTitle: iv.candidate.applications[0]?.job?.title,
    interviewRound: iv.roundNumber ? `Round ${iv.roundNumber}` : null,
    overallScore: iv.result?.percentageScore ?? 0,
    decision: iv.result?.decision ?? iv.result?.aiDecision ?? 'Pending',
    strengths: iv.result?.strengths,
    improvements: iv.result?.improvements,
    recommendedLearning: (iv.result as any).recommendedLearning,
  });

  await sendMail({
    to: iv.candidate.email,
    subject,
    html,
    templateId: 'interview-report',
    attachments: [
      {
        filename: 'Performance_Report.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  });

  logger.info('Candidate performance report PDF saved and delivered', { interviewId, email: iv.candidate.email });
}

export async function deleteReview(id: string, ctx: InterviewContext, req: Request): Promise<void> {
  await findScoped(id, ctx);
  
  await tenantTransaction(async (tx) => {
    await tx.proctorShot.deleteMany({ where: { interviewId: id } });
    await tx.candidateAnswer.deleteMany({ where: { interviewId: id } });
    await tx.interviewQuestion.deleteMany({ where: { interviewId: id } });
    await tx.interviewFeedback.deleteMany({ where: { interviewId: id } });
    await tx.panelMember.deleteMany({ where: { interviewId: id } });
    await tx.interview.delete({ where: { id } });
  });

  await recordAudit(req, {
    action: 'DELETE',
    entity: 'Interview',
    entityId: id,
    description: `Deleted review record for interview ${id}`,
  });
}
