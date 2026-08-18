import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { recordAudit } from './auditService.js';
import { configService } from './configService.js';
import { emitPipelineMove } from '../config/socket.js';
import { NotFoundError } from '../utils/errors.js';
import { isRecruiterScoped, assignedCandidateWhere } from '../utils/accessScope.js';
import {
  ROLES,
  type ApplicationStatus,
  type BoardFilters,
  type MoveApplicationInput,
  type CreatePipelineNoteInput,
  type PipelineBoard,
  type PipelineCard,
  type PipelineNoteItem,
  type FitScoreData,
  isScheduleRound,
} from '@agnohire/shared';
import type { Request } from 'express';

export interface PipelineContext {
  userId: string;
  role: string;
  sectorId?: string | null;
  permissions: string[];
}

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/** Non-admins only see applications to jobs in their own sector; recruiters
 *  are further narrowed to the candidates allocated to them. */
function applicationScope(ctx: PipelineContext): Prisma.JobApplicationWhereInput {
  if (isRecruiterScoped(ctx.role)) return { candidate: assignedCandidateWhere(ctx.userId) };
  if (isSuperOrAdmin(ctx.role) || configService.crossSectorVisibilityEnabled()) return {};
  if (ctx.sectorId) return { job: { sectorId: ctx.sectorId } };
  return {};
}

/**
 * Whether a user may view a job's live pipeline (used to authorize websocket
 * room subscriptions). Mirrors the REST sector scoping so the realtime channel
 * can't leak cross-sector activity: admins see all; sector users only their own
 * sector's jobs; a null-sector non-admin is denied (fail closed).
 */
export async function canAccessJobPipeline(
  ctx: { role: string; sectorId?: string | null },
  jobRequisitionId: string,
): Promise<boolean> {
  if (isSuperOrAdmin(ctx.role) || configService.crossSectorVisibilityEnabled()) {
    const job = await prisma.jobRequisition.findFirst({
      where: { id: jobRequisitionId },
      select: { id: true },
    });
    return Boolean(job);
  }
  if (!ctx.sectorId) return true; // Allow tenant-wide access
  const job = await prisma.jobRequisition.findFirst({
    where: { id: jobRequisitionId, sectorId: ctx.sectorId },
    select: { id: true },
  });
  return Boolean(job);
}



const CARD_SELECT = {
  id: true,
  status: true,
  stage: true,
  fitScore: true,
  fitScoreData: true,
  appliedAt: true,
  updatedAt: true,
  currentRound: true,
  workflowStatus: true,
  rejectionReason: true,
  rejectedRound: true,
  jobRequisitionId: true,
  candidate: {
    select: {
      id: true,
      fullName: true,
      email: true,
      currentRole: true,
      avatarUrl: true,
      interviews: {
        where: {
          deletedAt: null,
        },
        select: {
          jobRequisitionId: true,
          roundNumber: true,
          status: true,
          result: {
            select: {
              aiDecision: true,
              decision: true,
              failureReason: true,
            },
          },
        },
      },
    },
  },
  _count: { select: { pipelineNotes: true } },
} satisfies Prisma.JobApplicationSelect;

type RawCard = Prisma.JobApplicationGetPayload<{ select: typeof CARD_SELECT }>;

function toCard(
  a: RawCard,
  stages: string[],
  configuredRounds: { roundNumber: number; roundName: string }[],
): PipelineCard {
  const fit = (a.fitScoreData ?? null) as FitScoreData | null;
  
  let stage = a.stage ?? 'APPLIED';
  if (a.status === 'REJECTED' || a.workflowStatus === 'FAILED') {
    stage = 'REJECTED';
  } else if (a.status === 'HIRED' || a.status === 'ONBOARDING') {
    stage = 'HIRED';
  } else if (a.status === 'OFFER' || a.status === 'OFFER_SENT') {
    stage = 'OFFER';
  } else if (a.status === 'SUBMITTED_TO_HR') {
    stage = 'HR_APPROVAL';
  } else if (a.status === 'APPLIED') {
    stage = 'APPLIED';
  } else if (a.stage !== 'SOURCED') {
    const round = configuredRounds.find((r) => r.roundNumber === a.currentRound);
    if (round) {
      stage = round.roundName;
    }
  }

  // Ensure it falls into one of the dynamically built columns
  if (!stages.includes(stage)) {
    stage = stages.includes('APPLIED') ? 'APPLIED' : (stages[0] || 'APPLIED');
  }

  // Extract automated AI failure details if candidate failed an interview round
  const jobInterviews = (a.candidate.interviews || []).filter(
    (iv) => iv.jobRequisitionId === a.jobRequisitionId
  );
  const failedIv = jobInterviews
    .filter((iv) => iv.result?.aiDecision === 'FAIL' || iv.result?.decision === 'FAIL')
    .sort((x, y) => (y.roundNumber || 0) - (x.roundNumber || 0))[0];

  const aiRejectionReason = failedIv?.result?.failureReason ?? null;
  const roundMatch = failedIv ? configuredRounds.find((r) => r.roundNumber === failedIv.roundNumber) : null;
  const aiRejectedRound = roundMatch ? roundMatch.roundName : (failedIv ? `Round ${failedIv.roundNumber}` : null);

  return {
    id: a.id,
    stage,
    status: a.status as ApplicationStatus,
    fitScore: a.fitScore,
    fitRecommendation: fit?.recommendation ?? null,
    appliedAt: a.appliedAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    noteCount: a._count.pipelineNotes,
    candidate: {
      id: a.candidate.id,
      fullName: a.candidate.fullName,
      email: a.candidate.email,
      currentRole: a.candidate.currentRole,
      avatarUrl: a.candidate.avatarUrl,
    },
    rejectionReason: a.rejectionReason,
    rejectedRound: a.rejectedRound,
    aiRejectionReason,
    aiRejectedRound,
  };
}

// ─── BOARD ─────────────────────────────────────────────────────────────────

export async function getBoard(filters: BoardFilters, ctx: PipelineContext): Promise<PipelineBoard> {
  const { jobRequisitionId, search } = filters;

  const seesAll = isSuperOrAdmin(ctx.role) || configService.crossSectorVisibilityEnabled();
  const job = await prisma.jobRequisition.findFirst({
    where: { id: jobRequisitionId, ...(seesAll ? {} : ctx.sectorId ? { sectorId: ctx.sectorId } : {}) },
    select: { id: true, title: true, workflowRounds: { orderBy: { sequenceOrder: 'asc' as const } } },
  });
  if (!job) throw new NotFoundError('Job not found');

  const configuredRounds = job.workflowRounds || [];
  const customRoundNames = configuredRounds.map((r) => r.roundName);
  const stages = ['SOURCED', 'APPLIED', ...customRoundNames, 'HR_APPROVAL', 'OFFER', 'HIRED', 'REJECTED'];

  const where: Prisma.JobApplicationWhereInput = {
    AND: [
      { jobRequisitionId },
      applicationScope(ctx),
      {
        candidate: {
          deletedAt: null,
          ...(search && {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }),
        },
      },
    ],
  };

  const apps = await prisma.jobApplication.findMany({
    where,
    select: CARD_SELECT,
    orderBy: [{ fitScore: { sort: 'desc', nulls: 'last' } }, { appliedAt: 'desc' }],
  });

  const cards = apps.map((a) => toCard(a, stages, configuredRounds));
  const byStage = new Map<string, PipelineCard[]>();
  for (const stage of stages) byStage.set(stage, []);
  for (const card of cards) {
    if (byStage.has(card.stage)) {
      byStage.get(card.stage)!.push(card);
    }
  }

  return {
    job: { id: job.id, title: job.title },
    stages,
    total: cards.length,
    columns: stages.map((stage) => ({
      stage,
      count: byStage.get(stage)!.length,
      cards: byStage.get(stage)!,
    })),
  };
}

// ─── MOVE ──────────────────────────────────────────────────────────────────

export async function moveApplication(
  id: string,
  data: MoveApplicationInput,
  ctx: PipelineContext,
  req: Request,
): Promise<PipelineCard> {
  const existing = await prisma.jobApplication.findFirst({
    where: { id, ...applicationScope(ctx) },
    select: {
      id: true,
      stage: true,
      status: true,
      jobRequisitionId: true,
      completedRounds: true,
      currentRound: true,
      candidate: { select: { fullName: true } },
    },
  });
  if (!existing) throw new NotFoundError('Application not found');

  const job = await prisma.jobRequisition.findFirst({
    where: { id: existing.jobRequisitionId },
    select: { id: true, title: true, workflowRounds: { orderBy: { sequenceOrder: 'asc' as const } } },
  });
  if (!job) throw new NotFoundError('Job not found');

  const configuredRounds = job.workflowRounds || [];
  const customRoundNames = configuredRounds.map((r) => r.roundName);
  const stages = ['SOURCED', 'APPLIED', ...customRoundNames, 'HR_APPROVAL', 'OFFER', 'HIRED', 'REJECTED'];

  const toStage = data.toStage;
  let nextStatus: string = 'APPLIED';
  let nextWorkflowStatus = 'IN_PROGRESS';
  let nextCurrentRound = 1;

  const roundIdx = configuredRounds.findIndex((r) => r.roundName === toStage);
  if (roundIdx !== -1) {
    const round = configuredRounds[roundIdx];
    nextCurrentRound = round.roundNumber;
    const rType = round.roundType.toLowerCase();
    const rName = round.roundName.toLowerCase();
    if (rType.includes('assessment') || rType.includes('test') || rName.includes('assessment') || rName.includes('test')) {
      nextStatus = 'ASSESSMENT';
    } else if (rType.includes('screening') || rName.includes('screening')) {
      nextStatus = 'SCREENING';
    } else if (isScheduleRound(round.roundType, round.roundName)) {
      // HR Interview / Final Discussion / any "schedule" round → Scheduling flow.
      nextStatus = 'SCHEDULE';
    } else if (rType.includes('hr approval') || rName.includes('hr approval')) {
      nextStatus = 'SUBMITTED_TO_HR';
    } else if (rName === 'interview') {
      nextStatus = 'INTERVIEW';
    } else {
      nextStatus = round.roundName;
    }
    nextWorkflowStatus = 'IN_PROGRESS';
  } else if (toStage === 'SOURCED') {
    nextStatus = 'APPLIED';
    nextWorkflowStatus = 'IN_PROGRESS';
  } else if (toStage === 'APPLIED') {
    nextStatus = 'APPLIED';
    nextWorkflowStatus = 'IN_PROGRESS';
    nextCurrentRound = 1;
  } else if (toStage === 'HR_APPROVAL') {
    nextStatus = 'SUBMITTED_TO_HR';
    nextWorkflowStatus = 'SELECTED';
  } else if (toStage === 'OFFER') {
    nextStatus = 'OFFER';
    nextWorkflowStatus = 'SELECTED';
  } else if (toStage === 'HIRED') {
    nextStatus = 'HIRED';
    nextWorkflowStatus = 'SELECTED';
  } else if (toStage === 'REJECTED') {
    nextStatus = 'REJECTED';
    nextWorkflowStatus = 'FAILED';
  } else if (toStage === 'SCREENING') {
    nextStatus = 'SCREENING';
    nextWorkflowStatus = 'IN_PROGRESS';
  } else if (toStage === 'ASSESSMENT') {
    nextStatus = 'ASSESSMENT';
    nextWorkflowStatus = 'IN_PROGRESS';
  } else if (toStage === 'INTERVIEW') {
    nextStatus = 'INTERVIEW';
    nextWorkflowStatus = 'IN_PROGRESS';
  } else if (toStage === 'SCHEDULE') {
    nextStatus = 'SCHEDULE';
    nextWorkflowStatus = 'IN_PROGRESS';
  }

  // When moving forward to a later round, mark all prior rounds as completed
  // so scheduling and workflow checks have accurate state.
  const existingCompleted: number[] = Array.isArray(existing.completedRounds)
    ? (existing.completedRounds as number[])
    : [];
  let nextCompletedRounds = [...existingCompleted];
  if (roundIdx !== -1 && nextCurrentRound > (existing.currentRound ?? 1)) {
    // All rounds before the destination should be marked completed
    for (const r of configuredRounds) {
      if (r.roundNumber < nextCurrentRound && !nextCompletedRounds.includes(r.roundNumber)) {
        nextCompletedRounds.push(r.roundNumber);
      }
    }
  } else if (roundIdx !== -1 && nextCurrentRound < (existing.currentRound ?? 1)) {
    // Moving backward: remove completed rounds that are >= the destination round
    nextCompletedRounds = nextCompletedRounds.filter(n => n < nextCurrentRound);
  }

  const updated = await prisma.jobApplication.update({
    where: { id },
    data: {
      stage: toStage,
      status: nextStatus,
      workflowStatus: nextWorkflowStatus,
      currentRound: nextCurrentRound,
      completedRounds: nextCompletedRounds,
      rejectionReason: toStage === 'REJECTED' ? (data.rejectionReason || null) : null,
      rejectedRound: toStage === 'REJECTED' ? (data.rejectedRound || null) : null,
    },
    select: CARD_SELECT,
  });

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'JobApplication',
    entityId: id,
    description: `Pipeline Manual Override: Moved candidate "${existing.candidate.fullName}" from ${existing.stage ?? '—'} to ${toStage}`,
    oldValue: { stage: existing.stage, status: existing.status },
    newValue: { stage: updated.stage, status: updated.status },
  });

  emitPipelineMove(existing.jobRequisitionId, {
    jobRequisitionId: existing.jobRequisitionId,
    applicationId: id,
    toStage: updated.stage,
    status: updated.status,
  });

  return toCard(updated, stages, configuredRounds);
}

// ─── NOTES ─────────────────────────────────────────────────────────────────

/** Verify the application is in scope before touching its notes. */
async function findScopedApplication(applicationId: string, ctx: PipelineContext) {
  const app = await prisma.jobApplication.findFirst({
    where: { id: applicationId, ...applicationScope(ctx) },
    select: { id: true },
  });
  if (!app) throw new NotFoundError('Application not found');
  return app;
}

async function resolveAuthors(authorIds: string[]): Promise<Map<string, string>> {
  if (authorIds.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(authorIds)] } },
    select: { id: true, fullName: true },
  });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

export async function listNotes(
  applicationId: string,
  ctx: PipelineContext,
): Promise<PipelineNoteItem[]> {
  await findScopedApplication(applicationId, ctx);

  const notes = await prisma.pipelineNote.findMany({
    where: {
      applicationId,
      // Private notes are visible only to their author.
      ...(isSuperOrAdmin(ctx.role) ? {} : { OR: [{ isPrivate: false }, { authorId: ctx.userId }] }),
    },
    orderBy: { createdAt: 'desc' },
  });

  const authors = await resolveAuthors(notes.map((n) => n.authorId));
  return notes.map((n) => ({
    id: n.id,
    content: n.content,
    isPrivate: n.isPrivate,
    createdAt: n.createdAt.toISOString(),
    author: { id: n.authorId, name: authors.get(n.authorId) ?? 'Unknown' },
  }));
}

export async function addNote(
  applicationId: string,
  data: CreatePipelineNoteInput,
  ctx: PipelineContext,
  req: Request,
): Promise<PipelineNoteItem> {
  await findScopedApplication(applicationId, ctx);

  const note = await prisma.pipelineNote.create({
    data: {
      applicationId,
      authorId: ctx.userId,
      content: data.content,
      isPrivate: data.isPrivate,
    },
  });

  await recordAudit(req, {
    action: 'CREATE',
    entity: 'PipelineNote',
    entityId: note.id,
    description: `Added pipeline note to application ${applicationId}`,
  });

  const authors = await resolveAuthors([note.authorId]);
  return {
    id: note.id,
    content: note.content,
    isPrivate: note.isPrivate,
    createdAt: note.createdAt.toISOString(),
    author: { id: note.authorId, name: authors.get(note.authorId) ?? 'Unknown' },
  };
}

export async function deleteNote(
  id: string,
  ctx: PipelineContext,
  req: Request,
): Promise<boolean> {
  const note = await prisma.pipelineNote.findUnique({
    where: { id },
  });
  if (!note) throw new NotFoundError('Note not found');

  if (note.authorId !== ctx.userId && !isSuperOrAdmin(ctx.role)) {
    throw new Error('Unauthorized to delete this note');
  }

  await prisma.pipelineNote.delete({
    where: { id },
  });

  await recordAudit(req, {
    action: 'DELETE',
    entity: 'PipelineNote',
    entityId: id,
    description: `Deleted pipeline note ${id}`,
  });

  return true;
}

