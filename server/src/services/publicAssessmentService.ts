import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { configService } from './configService.js';
import { dispatchAssessmentScore } from '../jobs/dispatch.js';
import { maxScoreFor } from './questionBankService.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import {
  CONFIG_KEYS,
  type PublicAssessment,
  type PublicQuestion,
  type McqOption,
  type SubmitAssessmentAnswerInput,
  type RecordViolationInput,
  type ProctorSnapshotInput,
  type ViolationEntry,
  type ViolationResult,
} from '@agnohire/shared';

async function findByToken(token: string) {
  const a = await prisma.assessmentAssignment.findUnique({
    where: { accessToken: token },
    select: {
      id: true, status: true, startedAt: true, assessmentId: true,
      candidateId: true, // plain FK; candidate name resolved separately
      assessment: { select: { title: true, description: true, durationMin: true } },
    },
  });
  if (!a) throw new NotFoundError('Assessment link is invalid');
  return a;
}

function publicOptions(options: unknown): { text: string }[] | null {
  if (!Array.isArray(options)) return null;
  return (options as McqOption[]).map((o) => ({ text: o.text }));
}

export async function getPublicAssessment(token: string): Promise<PublicAssessment> {
  const a = await findByToken(token);
  if (['CANCELLED', 'EXPIRED'].includes(a.status)) {
    throw new BadRequestError('This assessment is no longer available');
  }

  const [candidate, aqs, answers] = await Promise.all([
    prisma.candidate.findUnique({ where: { id: a.candidateId }, select: { fullName: true, sectorId: true } }),
    prisma.assessmentQuestion.findMany({
      where: { assessmentId: a.assessmentId },
      orderBy: { orderIndex: 'asc' },
      select: { questionId: true, orderIndex: true },
    }),
    prisma.assessmentAnswer.findMany({
      where: { assignmentId: a.id },
      select: { questionId: true, answerText: true, answerCode: true, selectedOption: true, language: true },
    }),
  ]);

  // Anti-cheat config — reuses the interview proctoring settings (per scope).
  const sectorId = candidate?.sectorId ?? null;
  const [maxWarnings, proctoring, cameraReq, micReq, snapInterval, screenShare] = await Promise.all([
    configService.getNumber(CONFIG_KEYS.INTERVIEW_MAX_WARNINGS, 5, sectorId),
    configService.getBool(CONFIG_KEYS.INTERVIEW_PROCTORING_ENABLED, true, sectorId),
    configService.getBool(CONFIG_KEYS.INTERVIEW_CAMERA_REQUIRED, true, sectorId),
    configService.getBool(CONFIG_KEYS.INTERVIEW_MIC_REQUIRED, true, sectorId),
    configService.getNumber(CONFIG_KEYS.INTERVIEW_SNAPSHOT_INTERVAL_SEC, 15, sectorId),
    configService.getBool(CONFIG_KEYS.INTERVIEW_SCREEN_SHARE_ENABLED, false, sectorId),
  ]);

  const qs = await prisma.question.findMany({
    where: { id: { in: aqs.map((q) => q.questionId) } },
    select: { id: true, text: true, type: true, difficulty: true, options: true },
  });
  const byId = new Map(qs.map((q) => [q.id, q]));

  const questions: PublicQuestion[] = aqs
    .map((aq) => {
      const q = byId.get(aq.questionId);
      if (!q) return null;
      return {
        id: q.id,
        text: q.text,
        type: q.type as PublicQuestion['type'],
        difficulty: q.difficulty as PublicQuestion['difficulty'],
        options: publicOptions(q.options),
        maxScore: maxScoreFor(q.difficulty),
        orderIndex: aq.orderIndex,
      };
    })
    .filter((q): q is PublicQuestion => q !== null);

  return {
    id: a.id,
    status: a.status as PublicAssessment['status'],
    title: a.assessment?.title ?? 'Assessment',
    description: a.assessment?.description ?? null,
    candidateName: candidate?.fullName ?? 'Candidate',
    durationMin: a.assessment?.durationMin ?? null,
    startedAt: a.startedAt?.toISOString() ?? null,
    questions,
    antiCheat: {
      maxWarnings,
      proctoringEnabled: proctoring,
      cameraRequired: proctoring && cameraReq,
      micRequired: proctoring && micReq,
      snapshotIntervalSec: snapInterval,
      screenShareRequired: screenShare,
    },
    savedAnswers: answers,
  };
}

export async function startAssessment(token: string): Promise<{ startedAt: string; durationMin: number | null }> {
  const a = await findByToken(token);
  if (a.status === 'PENDING') {
    const updated = await prisma.assessmentAssignment.update({
      where: { id: a.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
      select: { startedAt: true },
    });
    return { startedAt: updated.startedAt!.toISOString(), durationMin: a.assessment?.durationMin ?? null };
  }
  if (a.status === 'IN_PROGRESS') {
    return { startedAt: a.startedAt!.toISOString(), durationMin: a.assessment?.durationMin ?? null };
  }
  throw new BadRequestError('This assessment cannot be started');
}

export async function saveAnswer(token: string, data: SubmitAssessmentAnswerInput): Promise<void> {
  const a = await findByToken(token);
  if (a.status !== 'IN_PROGRESS') throw new BadRequestError('Assessment is not in progress');

  const belongs = await prisma.assessmentQuestion.findFirst({
    where: { assessmentId: a.assessmentId, questionId: data.questionId },
    select: { id: true },
  });
  if (!belongs) throw new BadRequestError('Question does not belong to this assessment');

  const payload = {
    answerText: data.answerText ?? null,
    answerCode: data.answerCode ?? null,
    selectedOption: data.selectedOption ?? null,
    language: data.language ?? null,
  };
  // Upsert on the (assignmentId, questionId) unique key — concurrent autosaves
  // (a blur firing alongside the MCQ change autosave, or rapid type-then-navigate)
  // would otherwise both miss the find and both create, hitting the unique
  // constraint with a P2002 500 and dropping the answer. Mirrors publicInterviewService.
  await prisma.assessmentAnswer.upsert({
    where: { assignmentId_questionId: { assignmentId: a.id, questionId: data.questionId } },
    update: payload,
    create: { assignmentId: a.id, questionId: data.questionId, ...payload },
  });
}

export async function submitAssessment(token: string): Promise<{ submitted: boolean }> {
  const a = await findByToken(token);
  if (['SUBMITTED', 'EVALUATING', 'EVALUATED'].includes(a.status)) return { submitted: true };
  if (!['IN_PROGRESS', 'PENDING'].includes(a.status)) {
    throw new BadRequestError('This assessment cannot be submitted');
  }
  await prisma.assessmentAssignment.update({
    where: { id: a.id },
    data: { status: 'SUBMITTED', submittedAt: new Date() },
  });
  await dispatchAssessmentScore(a.id);
  logger.info('Assessment submitted', { assignmentId: a.id });
  return { submitted: true };
}

// ─── PROCTORING (mirrors publicInterviewService) ──────────────────────────────

export async function recordViolation(
  token: string,
  data: RecordViolationInput,
): Promise<ViolationResult> {
  const a = await prisma.assessmentAssignment.findUnique({
    where: { accessToken: token },
    select: { id: true, status: true, violations: true, candidateId: true },
  });
  if (!a) throw new NotFoundError('Assessment link is invalid');

  const candidate = await prisma.candidate.findUnique({ where: { id: a.candidateId }, select: { sectorId: true } });
  const sectorId = candidate?.sectorId ?? null;
  const maxWarnings = await configService.getNumber(CONFIG_KEYS.INTERVIEW_MAX_WARNINGS, 5, sectorId);

  if (a.status !== 'IN_PROGRESS') {
    return { warnings: 0, maxWarnings, terminated: false, autoSubmitted: false };
  }

  // Every violation counts toward a single shared warning budget, regardless of
  // type. The candidate gets `maxWarnings` warnings; the next one ends it.
  const log: ViolationEntry[] = Array.isArray(a.violations) ? (a.violations as unknown as ViolationEntry[]) : [];
  log.push({ type: data.type, at: new Date().toISOString(), ...(data.detail ? { detail: data.detail } : {}) });

  const warnings = log.length;
  const terminated = warnings > maxWarnings;

  await prisma.assessmentAssignment.update({
    where: { id: a.id },
    data: {
      violations: log as unknown as object,
      ...(terminated ? { terminatedReason: `Ended automatically after ${warnings} integrity violations` } : {}),
    },
  });

  if (terminated) {
    await submitAssessment(token);
    return { warnings, maxWarnings, terminated: true, autoSubmitted: true };
  }
  return { warnings, maxWarnings, terminated: false, autoSubmitted: false };
}

const MAX_SHOTS_PER_ASSESSMENT = 240; // ~1hr at a 15s cadence — a hard safety cap

/** Store a webcam proctoring snapshot (data URL) captured during the assessment. */
export async function saveSnapshot(token: string, data: ProctorSnapshotInput): Promise<{ saved: boolean }> {
  const a = await prisma.assessmentAssignment.findUnique({
    where: { accessToken: token },
    select: { id: true, status: true, terminatedReason: true, _count: { select: { proctorShots: true } } },
  });
  if (!a) throw new NotFoundError('Assessment link is invalid');
  const acceptable =
    a.status === 'IN_PROGRESS' || (a.terminatedReason != null && data.reason === 'TERMINATION');
  if (!acceptable) return { saved: false };
  if (a._count.proctorShots >= MAX_SHOTS_PER_ASSESSMENT) return { saved: false };

  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(data.image);
  if (!match) throw new BadRequestError('Invalid image payload');
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.byteLength === 0 || buffer.byteLength > 2_500_000) {
    throw new BadRequestError('Snapshot size out of range');
  }

  await prisma.assessmentProctorShot.create({
    data: { assignmentId: a.id, reason: data.reason, mimeType, imageData: buffer },
  });
  return { saved: true };
}

const MAX_RECORDING_BYTES = 3_300_000; // base64 of this fits under the 5 MB JSON body cap

/**
 * Store the candidate's microphone recording (uploaded once at submit) and run
 * post-hoc voice analysis: a detected second voice appends a MULTIPLE_VOICES
 * violation so it surfaces in the staff evaluation. Best-effort — a failure here
 * must never block submission.
 */
export async function saveRecording(token: string, data: { audio: string }): Promise<{ saved: boolean }> {
  const a = await prisma.assessmentAssignment.findUnique({
    where: { accessToken: token },
    select: { id: true, recordingUrl: true, candidateId: true },
  });
  if (!a) throw new NotFoundError('Assessment link is invalid');
  if (a.recordingUrl) return { saved: true }; // already uploaded — ignore duplicates

  const match = /^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?,(.+)$/i.exec(data.audio);
  if (!match) throw new BadRequestError('Invalid audio payload');
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_RECORDING_BYTES) {
    throw new BadRequestError('Recording size out of range');
  }

  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
  const attachment = await prisma.attachment.create({
    data: { fileName: `assessment-${a.id}.${ext}`, mimeType, fileSize: buffer.byteLength, fileData: buffer },
    select: { id: true, fileName: true },
  });

  await prisma.assessmentAssignment.update({
    where: { id: a.id },
    data: { recordingUrl: `/api/files/${attachment.id}/download` },
  });

  const candidate = await prisma.candidate.findUnique({ where: { id: a.candidateId }, select: { sectorId: true } });
  void analyzeRecording(a.id, buffer, mimeType, candidate?.sectorId ?? null).catch((err) => {
    logger.warn('Assessment voice analysis failed', { assignmentId: a.id, err: (err as Error).message });
  });

  return { saved: true };
}

async function analyzeRecording(
  assignmentId: string,
  buffer: Buffer,
  mimeType: string,
  sectorId: string | null,
): Promise<void> {
  const { analyzeAudioSpeakers } = await import('./aiProviderService.js');
  const format = mimeType.includes('ogg')
    ? 'ogg'
    : mimeType.includes('mp4')
      ? 'mp4'
      : mimeType.includes('mpeg')
        ? 'mp3'
        : mimeType.includes('wav')
          ? 'wav'
          : 'webm';

  const result = await analyzeAudioSpeakers({ base64: buffer.toString('base64'), format }, sectorId);
  if (!result || !result.otherVoiceDetected) return;

  const current = await prisma.assessmentAssignment.findUnique({
    where: { id: assignmentId },
    select: { violations: true },
  });
  const log: ViolationEntry[] = Array.isArray(current?.violations)
    ? (current!.violations as unknown as ViolationEntry[])
    : [];
  log.push({
    type: 'MULTIPLE_VOICES',
    at: new Date().toISOString(),
    detail: result.summary || `Post-assessment audio analysis detected ${result.speakerCount} distinct voices.`,
  });
  await prisma.assessmentAssignment.update({
    where: { id: assignmentId },
    data: { violations: log as unknown as object },
  });
  logger.info('Assessment voice analysis flagged additional speaker', { assignmentId, speakerCount: result.speakerCount });
}
