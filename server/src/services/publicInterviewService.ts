import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { configService } from './configService.js';
import { dispatchInterviewScore } from '../jobs/dispatch.js';
import { maxScoreFor } from './questionBankService.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import {
  CONFIG_KEYS,
  type PublicInterview,
  type PublicQuestion,
  type McqOption,
  type SubmitAnswerInput,
  type RecordViolationInput,
  type ProctorSnapshotInput,
  type ViolationEntry,
  type ViolationResult,
} from '@agnohire/shared';

async function findByToken(token: string) {
  const iv = await prisma.interview.findFirst({
    where: { accessToken: token },
    select: {
      id: true, status: true, startedAt: true, duration: true,
      candidateId: true, jobRequisitionId: true, roundNumber: true,
      violations: true, tenantId: true,
      candidate: { select: { fullName: true, email: true, sectorId: true } },
    },
  });
  if (!iv) throw new NotFoundError('Interview link is invalid');
  return iv;
}

function publicOptions(options: unknown): { text: string }[] | null {
  if (!Array.isArray(options)) return null;
  return (options as McqOption[]).map((o) => ({ text: o.text }));
}

/** Strips hidden test cases before anything reaches the candidate. */
function publicTestCases(testCases: unknown): { input: string; expectedOutput: string }[] | null {
  if (!Array.isArray(testCases)) return null;
  const visible = (testCases as { input: string; expectedOutput: string; hidden?: boolean }[])
    .filter((tc) => !tc.hidden)
    .map((tc) => ({ input: tc.input, expectedOutput: tc.expectedOutput }));
  return visible.length ? visible : null;
}

export async function getPublicInterview(token: string): Promise<PublicInterview> {
  const iv = await findByToken(token);

  if (iv.status === 'IN_PROGRESS' && iv.startedAt && iv.duration) {
    const deadline = iv.startedAt.getTime() + iv.duration * 60_000;
    if (Date.now() > deadline) {
      try {
        await submitInterview(token);
      } catch (err) {
        logger.warn('Failed to auto-submit overdue interview in getPublicInterview', { token, err: (err as Error).message });
      }
      return getPublicInterview(token);
    }
  }

  if (['CANCELLED', 'EXPIRED'].includes(iv.status)) {
    throw new BadRequestError('This interview is no longer available');
  }

  const sectorId = iv.candidate.sectorId ?? null;
  const [maxWarnings, proctoring, cameraReq, micReq, snapInterval, screenShare, similarityThreshold, rows, answers, biometricReport] =
    await Promise.all([
      configService.getNumber(CONFIG_KEYS.INTERVIEW_MAX_WARNINGS, 5, sectorId),
      configService.getBool(CONFIG_KEYS.INTERVIEW_PROCTORING_ENABLED, true, sectorId),
      configService.getBool(CONFIG_KEYS.INTERVIEW_CAMERA_REQUIRED, true, sectorId),
      configService.getBool(CONFIG_KEYS.INTERVIEW_MIC_REQUIRED, true, sectorId),
      configService.getNumber(CONFIG_KEYS.INTERVIEW_SNAPSHOT_INTERVAL_SEC, 15, sectorId),
      configService.getBool(CONFIG_KEYS.INTERVIEW_SCREEN_SHARE_ENABLED, false, sectorId),
      configService.getNumber(CONFIG_KEYS.BIOMETRIC_SIMILARITY_THRESHOLD, 0.65, sectorId),
      prisma.interviewQuestion.findMany({
        where: { interviewId: iv.id },
        orderBy: { orderIndex: 'asc' },
        select: { orderIndex: true, question: { select: { id: true, text: true, type: true, difficulty: true, options: true, testCases: true } } },
      }),
      prisma.candidateAnswer.findMany({
        where: { interviewId: iv.id },
        select: { questionId: true, answerText: true, answerCode: true, selectedOption: true, language: true },
      }),
      prisma.biometricReport.findUnique({
        where: { interviewId: iv.id },
        select: { faceSignature: true, enrollmentImage: true },
      }),
    ]);

  const questions: PublicQuestion[] = rows.map((r) => ({
    id: r.question.id,
    text: r.question.text,
    type: r.question.type as PublicQuestion['type'],
    difficulty: r.question.difficulty as PublicQuestion['difficulty'],
    options: publicOptions(r.question.options),
    sampleTestCases: publicTestCases(r.question.testCases),
    maxScore: maxScoreFor(r.question.difficulty),
    orderIndex: r.orderIndex,
  }));

  return {
    id: iv.id,
    status: iv.status as PublicInterview['status'],
    candidateName: iv.candidate.fullName,
    candidateEmail: iv.candidate.email,
    candidateId: iv.candidateId,
    durationMin: iv.duration,
    startedAt: iv.startedAt?.toISOString() ?? null,
    questions,
    antiCheat: {
      maxWarnings,
      proctoringEnabled: proctoring,
      cameraRequired: proctoring && cameraReq,
      micRequired: proctoring && micReq,
      snapshotIntervalSec: snapInterval,
      screenShareRequired: screenShare,
      biometricSimilarityThreshold: similarityThreshold,
    },
    savedAnswers: answers,
    biometricEnrollment: biometricReport
      ? {
          faceSignature: biometricReport.faceSignature,
          enrollmentImage: biometricReport.enrollmentImage,
        }
      : null,
  };
}

export async function startInterview(token: string): Promise<{ startedAt: string; durationMin: number | null }> {
  const iv = await findByToken(token);
  
  if (iv.jobRequisitionId && iv.roundNumber) {
    const application = await prisma.jobApplication.findFirst({
      where: { candidateId: iv.candidateId, jobRequisitionId: iv.jobRequisitionId },
    });
    if (application) {
      if (application.workflowStatus === 'REJECTED') {
        throw new BadRequestError('Candidate did not qualify for the next interview round.');
      }
      if (iv.roundNumber > application.currentRound) {
        throw new BadRequestError(`You must complete Round ${application.currentRound} before proceeding to Round ${iv.roundNumber}.`);
      }
    }
  }

  if (iv.status === 'SCHEDULED') {
    // SaaS metering: a candidate counts as "interviewed" at the SCHEDULED →
    // IN_PROGRESS transition, once per candidate per billing period. Blocks
    // with a typed 402 when the tenant's plan quota is exhausted.
    const tenantId = iv.tenantId;
    if (tenantId) {
      const { assertWithinLimit, meterInterviewedCandidate } = await import('./entitlementService.js');
      await assertWithinLimit(tenantId, 'INTERVIEWED_CANDIDATES', 1);
      const updated = await prisma.interview.update({
        where: { id: iv.id },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
        select: { startedAt: true, duration: true },
      });
      await meterInterviewedCandidate(tenantId, iv.candidateId, iv.id);
      const { emitInterviewUpdate } = await import('../config/socket.js');
      emitInterviewUpdate(tenantId, iv.id, 'IN_PROGRESS');
      return { startedAt: updated.startedAt!.toISOString(), durationMin: updated.duration };
    }
    const updated = await prisma.interview.update({
      where: { id: iv.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
      select: { startedAt: true, duration: true },
    });
    const { emitInterviewUpdate } = await import('../config/socket.js');
    emitInterviewUpdate(iv.tenantId, iv.id, 'IN_PROGRESS');
    return { startedAt: updated.startedAt!.toISOString(), durationMin: updated.duration };
  }
  if (iv.status === 'IN_PROGRESS') {
    // If nothing has been answered yet, treat this as the real start. A staff
    // "open preview" or an abandoned tab would otherwise burn the whole timer
    // and instantly auto-submit the candidate's session as expired.
    const answered = await prisma.candidateAnswer.count({ where: { interviewId: iv.id } });
    if (answered === 0) {
      const updated = await prisma.interview.update({
        where: { id: iv.id },
        data: { startedAt: new Date() },
        select: { startedAt: true, duration: true },
      });
      return { startedAt: updated.startedAt!.toISOString(), durationMin: updated.duration };
    }
    return { startedAt: iv.startedAt!.toISOString(), durationMin: iv.duration };
  }
  throw new BadRequestError('This interview cannot be started');
}

export async function saveAnswer(token: string, data: SubmitAnswerInput): Promise<void> {
  const iv = await findByToken(token);
  if (iv.status !== 'IN_PROGRESS') throw new BadRequestError('Interview is not in progress');

  const belongs = await prisma.interviewQuestion.findFirst({
    where: { interviewId: iv.id, questionId: data.questionId },
    select: { id: true },
  });
  if (!belongs) {
    logger.error('saveAnswer failed: Question does not belong to interview', { interviewId: iv.id, questionId: data.questionId });
    throw new BadRequestError('Question does not belong to this interview');
  }

  const payload = {
    answerText: data.answerText ?? null,
    answerCode: data.answerCode ?? null,
    selectedOption: data.selectedOption ?? null,
    language: data.language ?? null,
    timeTaken: data.timeTaken ?? null,
  };
  // Upsert on the (interviewId, questionId) unique key — concurrent autosaves
  // (blur + navigation firing together) can't create duplicate rows.
  try {
    await prisma.candidateAnswer.upsert({
      where: {
        interviewId_questionId: { interviewId: iv.id, questionId: data.questionId },
      },
      update: payload,
      create: { interviewId: iv.id, questionId: data.questionId, ...payload },
    });
  } catch (err) {
    logger.error('saveAnswer failed: Database upsert error', { interviewId: iv.id, questionId: data.questionId, err: (err as Error).message });
    throw err;
  }
}

async function requireCodeQuestion(interviewId: string, questionId: string) {
  const belongs = await prisma.interviewQuestion.findFirst({
    where: { interviewId, questionId },
    select: {
      question: { select: { type: true, testCases: true } },
    },
  });
  if (!belongs) throw new BadRequestError('Question does not belong to this interview');
  if (belongs.question.type !== 'CODE') throw new BadRequestError('Question is not a coding question');
  return belongs.question;
}

/** Backs the candidate's "Run Code" button — arbitrary stdin, single execution, no grading. */
export async function executeCandidateCode(
  token: string,
  questionId: string,
  language: string,
  code: string,
  stdin: string,
) {
  const iv = await findByToken(token);
  if (iv.status !== 'IN_PROGRESS') throw new BadRequestError('Interview is not in progress');
  await requireCodeQuestion(iv.id, questionId);

  const { executeCode } = await import('./codeExecutionService.js');
  return executeCode(language as any, code, stdin);
}

/** Runs the candidate's code against every visible (non-hidden) test case for feedback before submit. */
export async function runSampleTests(
  token: string,
  questionId: string,
  language: string,
  code: string,
) {
  const iv = await findByToken(token);
  if (iv.status !== 'IN_PROGRESS') throw new BadRequestError('Interview is not in progress');
  const question = await requireCodeQuestion(iv.id, questionId);

  const testCases = publicTestCases(question.testCases) ?? [];
  const { runOnPiston } = await import('./pistonService.js');
  const results = [];
  for (const tc of testCases) {
    const result = await runOnPiston(language as any, code, tc.input);
    results.push({
      input: tc.input,
      expectedOutput: tc.expectedOutput,
      actualOutput: result.stdout,
      stderr: result.stderr,
      passed: !result.error && result.stdout.trim() === tc.expectedOutput.trim(),
    });
  }
  return results;
}

export async function recordViolation(
  token: string,
  data: RecordViolationInput,
): Promise<ViolationResult> {
  const iv = await prisma.interview.findFirst({
    where: { accessToken: token },
    select: { id: true, status: true, violations: true, candidate: { select: { sectorId: true } } },
  });
  if (!iv) throw new NotFoundError('Interview link is invalid');

  const sectorId = iv.candidate.sectorId ?? null;
  const maxWarnings = await configService.getNumber(CONFIG_KEYS.INTERVIEW_MAX_WARNINGS, 5, sectorId);

  if (iv.status !== 'IN_PROGRESS') {
    return { warnings: 0, maxWarnings, terminated: false, autoSubmitted: false };
  }

  // Every violation counts toward a single shared warning budget, regardless of
  // type. The candidate gets `maxWarnings` warnings; the next one ends it.
  const log: ViolationEntry[] = Array.isArray(iv.violations)
    ? (iv.violations as unknown as ViolationEntry[])
    : [];
  log.push({ type: data.type, at: new Date().toISOString(), ...(data.detail ? { detail: data.detail } : {}) });

  const warnings = log.length;
  const terminated = warnings > maxWarnings;

  await prisma.interview.update({
    where: { id: iv.id },
    data: {
      violations: log as unknown as object,
      ...(terminated ? { terminatedReason: `Ended automatically after ${warnings} integrity violations` } : {}),
    },
  });

  if (terminated) {
    await submitInterview(token);
    return { warnings, maxWarnings, terminated: true, autoSubmitted: true };
  }
  return { warnings, maxWarnings, terminated: false, autoSubmitted: false };
}

const MAX_SHOTS_PER_INTERVIEW = 240; // ~1hr at a 15s cadence — a hard safety cap

/** Store a webcam proctoring snapshot (data URL) captured during the interview. */
export async function saveSnapshot(token: string, data: ProctorSnapshotInput): Promise<{ saved: boolean }> {
  const iv = await prisma.interview.findFirst({
    where: { accessToken: token },
    select: { id: true, status: true, terminatedReason: true, _count: { select: { proctorShots: true } } },
  });
  if (!iv) throw new NotFoundError('Interview link is invalid');
  // Accept shots while live, plus the final TERMINATION shot that lands just
  // after an auto-termination has already flipped the status to COMPLETED.
  const acceptable =
    iv.status === 'IN_PROGRESS' || (iv.terminatedReason != null && data.reason === 'TERMINATION');
  if (!acceptable) return { saved: false };
  if (iv._count.proctorShots >= MAX_SHOTS_PER_INTERVIEW) return { saved: false };

  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(data.image);
  if (!match) throw new BadRequestError('Invalid image payload');
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.byteLength === 0 || buffer.byteLength > 2_500_000) {
    throw new BadRequestError('Snapshot size out of range');
  }

  await prisma.proctorShot.create({
    data: { interviewId: iv.id, reason: data.reason, mimeType, imageData: buffer },
  });
  return { saved: true };
}

const MAX_RECORDING_BYTES = 3_300_000; // base64 of this fits under the 5 MB JSON body cap

/**
 * Store the candidate's microphone recording (uploaded once at submit) and run
 * post-hoc voice analysis: if a model hears a second distinct voice, append a
 * MULTIPLE_VOICES entry to the violation log so it surfaces in the admin
 * evaluation. The recording itself is kept as an Attachment for human review.
 *
 * Best-effort throughout — a failure here must never block submission, so the
 * controller calls this without awaiting the analysis result.
 */
export async function saveRecording(
  token: string,
  data: { audio: string },
): Promise<{ saved: boolean }> {
  const iv = await prisma.interview.findFirst({
    where: { accessToken: token },
    select: { id: true, recordingUrl: true, candidate: { select: { sectorId: true } } },
  });
  if (!iv) throw new NotFoundError('Interview link is invalid');
  if (iv.recordingUrl) return { saved: true }; // already uploaded — ignore duplicates

  const match = /^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?,(.+)$/i.exec(data.audio);
  if (!match) throw new BadRequestError('Invalid audio payload');
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_RECORDING_BYTES) {
    throw new BadRequestError('Recording size out of range');
  }

  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
  const attachment = await prisma.attachment.create({
    data: {
      fileName: `interview-${iv.id}.${ext}`,
      mimeType,
      fileSize: buffer.byteLength,
      fileData: buffer,
    },
    select: { id: true, fileName: true },
  });

  await prisma.interview.update({
    where: { id: iv.id },
    data: { recordingUrl: `/api/files/${attachment.id}/download` },
  });

  // Fire-and-forget the analysis so the candidate's submit returns immediately.
  void analyzeRecording(iv.id, buffer, mimeType, attachment.fileName, iv.candidate.sectorId ?? null).catch((err) => {
    logger.warn('Voice analysis failed', { interviewId: iv.id, err: (err as Error).message });
  });

  return { saved: true };
}

async function analyzeRecording(
  interviewId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  sectorId: string | null,
): Promise<void> {
  const { analyzeAudioSpeakers, transcribeAudio } = await import('./aiProviderService.js');
  const format = mimeType.includes('ogg')
    ? 'ogg'
    : mimeType.includes('mp4')
      ? 'mp4'
      : mimeType.includes('mpeg')
        ? 'mp3'
        : mimeType.includes('wav')
          ? 'wav'
          : 'webm';

  try {
    const transcript = await transcribeAudio({ buffer, fileName, mimeType }, sectorId);
    if (transcript && transcript.trim()) {
      await prisma.interview.update({
        where: { id: interviewId },
        data: { transcript },
      });
      const { dispatchVideoAnalysis } = await import('../jobs/dispatch.js');
      await dispatchVideoAnalysis(interviewId);
    }
  } catch (err) {
    logger.warn('Audio transcription failed', { interviewId, err: (err as Error).message });
  }

  const result = await analyzeAudioSpeakers({ base64: buffer.toString('base64'), format }, sectorId);
  if (!result || !result.otherVoiceDetected) return;

  const current = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: { violations: true },
  });
  const log: ViolationEntry[] = Array.isArray(current?.violations)
    ? (current!.violations as unknown as ViolationEntry[])
    : [];
  log.push({
    type: 'MULTIPLE_VOICES',
    at: new Date().toISOString(),
    detail:
      result.summary ||
      `Post-interview audio analysis detected ${result.speakerCount} distinct voices.`,
  });
  await prisma.interview.update({
    where: { id: interviewId },
    data: { violations: log as unknown as object },
  });
  logger.info('Voice analysis flagged additional speaker', {
    interviewId,
    speakerCount: result.speakerCount,
  });
}

export async function submitInterview(token: string): Promise<{ submitted: boolean }> {
  const iv = await findByToken(token);
  if (['COMPLETED', 'EVALUATING', 'EVALUATED'].includes(iv.status)) {
    return { submitted: true };
  }
  if (!['IN_PROGRESS', 'SCHEDULED'].includes(iv.status)) {
    throw new BadRequestError('This interview cannot be submitted');
  }
  const updated = await prisma.interview.update({
    where: { id: iv.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
    select: { recruiterId: true, candidate: { select: { fullName: true } } },
  });
  const { emitInterviewUpdate } = await import('../config/socket.js');
  emitInterviewUpdate(iv.tenantId, iv.id, 'COMPLETED');
  await dispatchInterviewScore(iv.id);

  // Tell the recruiter their candidate has finished, so it shows in the bell
  // even if AI scoring is deferred. Best-effort (never blocks submission).
  try {
    const { notify } = await import('./notificationService.js');
    const { NOTIFICATION_TYPE } = await import('@agnohire/shared');
    await notify({
      recipientId: updated.recruiterId,
      type: NOTIFICATION_TYPE.INTERVIEW_COMPLETED,
      title: 'Interview completed',
      message: `${updated.candidate.fullName} has submitted their interview.`,
      entityType: 'Interview',
      entityId: iv.id,
    });
  } catch (err) {
    logger.warn('Submit notification failed', { interviewId: iv.id, err: (err as Error).message });
  }

  logger.info('Public interview submitted', { interviewId: iv.id });
  return { submitted: true };
}

export async function biometricEnroll(token: string, data: { image: string; faceSignature?: any }): Promise<{ enrolled: boolean }> {
  const iv = await findByToken(token);
  await prisma.biometricReport.upsert({
    where: { interviewId: iv.id },
    create: {
      interviewId: iv.id,
      candidateId: iv.candidateId,
      enrollmentImage: data.image,
      faceSignature: data.faceSignature as any,
      verificationStatus: 'VERIFIED',
    },
    update: {
      enrollmentImage: data.image,
      faceSignature: data.faceSignature as any,
      verificationStatus: 'VERIFIED',
    },
  });
  return { enrolled: true };
}

export async function biometricVerify(token: string, data: {
  image: string;
  faceSignature?: any;
  matchScore: number;
  isMatch: boolean;
  noFace: boolean;
  multipleFaces: boolean;
  isLive?: boolean;
  livenessScore?: number;
  numFaces?: number;
}): Promise<{ matchScore: number; isMatch: boolean; status: string; warnings: number; maxWarnings: number; terminated: boolean }> {
  const iv = await prisma.interview.findFirst({
    where: { accessToken: token },
    select: { id: true, status: true, candidateId: true, violations: true, candidate: { select: { sectorId: true } } },
  });
  if (!iv) throw new NotFoundError('Interview link is invalid');

  const sectorId = iv.candidate.sectorId ?? null;
  const maxWarnings = await configService.getNumber(CONFIG_KEYS.INTERVIEW_MAX_WARNINGS, 5, sectorId);

  // Load the biometric report
  const report = await prisma.biometricReport.findUnique({
    where: { interviewId: iv.id },
  });

  if (!report) {
    throw new BadRequestError('Candidate is not enrolled for biometrics');
  }

  // Update counters
  const totalChecks = report.totalChecks + 1;
  let successfulMatches = report.successfulMatches;
  let failedMatches = report.failedMatches;
  let noFaceEvents = report.noFaceEvents;
  let multipleFaceEvents = report.multipleFaceEvents;
  let warningsIssued = report.warningsIssued;

  const isLive = data.isLive ?? true;

  if (data.noFace) {
    noFaceEvents += 1;
  } else if (data.multipleFaces) {
    multipleFaceEvents += 1;
  } else if (!isLive) {
    failedMatches += 1;
    warningsIssued += 1;
  } else if (data.isMatch) {
    successfulMatches += 1;
  } else {
    failedMatches += 1;
    warningsIssued += 1;
  }

  let log: any[] = Array.isArray(iv.violations) ? (iv.violations as any[]) : [];

  if (data.multipleFaces) {
    log.push({
      type: 'MULTIPLE_FACES',
      at: new Date().toISOString(),
      detail: 'Multiple people detected on camera during biometric check',
    });
  } else if (!isLive) {
    log.push({
      type: 'INTEGRITY_VIOLATION',
      at: new Date().toISOString(),
      detail: 'Liveness check failed: spoofing attempt detected',
    });
  } else if (!data.isMatch && !data.noFace) {
    log.push({
      type: 'FACE_MISMATCH',
      at: new Date().toISOString(),
      detail: `Face mismatch: current face does not match the enrolled biometric profile. Similarity Score: ${data.matchScore}%`,
    });
  }

  const warnings = log.length;
  const terminated = warnings > maxWarnings;

  const matchHistory = Array.isArray(report.matchHistory) ? (report.matchHistory as any[]) : [];
  matchHistory.push({
    timestamp: new Date().toISOString(),
    interviewId: iv.id,
    candidateId: iv.candidateId,
    score: data.matchScore,
    isMatch: data.isMatch,
    noFace: data.noFace,
    multipleFaces: data.multipleFaces,
    isLive,
    livenessScore: data.livenessScore ?? (isLive ? 100 : 0),
    numFaces: data.numFaces ?? (data.noFace ? 0 : data.multipleFaces ? 2 : 1),
    livenessStatus: isLive ? 'LIVE' : 'SPOOF',
    verificationResult: data.isMatch ? 'Match' : 'Mismatch',
    warningCount: warnings,
    ...(!data.isMatch && !data.noFace && !data.multipleFaces && isLive ? { image: data.image } : {}),
  });

  // Check consecutive failures
  let consecutiveFailures = 0;
  for (let i = matchHistory.length - 1; i >= 0; i--) {
    const check = matchHistory[i];
    if (!check.isMatch || !check.isLive) {
      consecutiveFailures++;
    } else {
      break;
    }
  }

  let status = 'VERIFIED';
  if (consecutiveFailures >= 3) {
    status = 'FAILED';
  } else if (data.noFace || data.multipleFaces || !data.isMatch || !isLive) {
    status = 'FLAGGED';
  }

  await prisma.interview.update({
    where: { id: iv.id },
    data: {
      violations: log,
      ...(terminated ? { terminatedReason: `Ended automatically after ${warnings} integrity violations` } : {}),
    },
  });

  await prisma.biometricReport.update({
    where: { interviewId: iv.id },
    data: {
      totalChecks,
      successfulMatches,
      failedMatches,
      warningsIssued,
      noFaceEvents,
      multipleFaceEvents,
      verificationStatus: status,
      matchHistory: matchHistory as any,
      latestImage: data.image,
    },
  });

  if (terminated && iv.status === 'IN_PROGRESS') {
    await submitInterview(token);
  }

  return {
    matchScore: data.matchScore,
    isMatch: data.isMatch,
    status,
    warnings,
    maxWarnings,
    terminated,
  };
}

