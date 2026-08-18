import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma, tenantTransaction } from '../config/database.js';
import { logger } from '../config/logger.js';
import { recordAudit } from './auditService.js';
import { configService } from './configService.js';
import { hasConflict, assertWorkingHours } from './availabilityService.js';
import { getCalendarProvider } from '../integrations/calendar/calendarProviderFactory.js';
import { sendMailOnce, type MailResult } from './mailerService.js';
import { interviewerScheduleEmail } from './emailTemplates.js';
import { dispatchScheduleReminder, cancelScheduleReminder } from '../jobs/dispatch.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { paginate } from '../utils/response.js';
import type { InterviewContext } from './questionBankService.js';
import { isRecruiterScoped, assignedCandidateWhere } from '../utils/accessScope.js';
import {
  ROLES,
  CONFIG_KEYS,
  type CreateScheduleInput,
  type UpdateScheduleInput,
  type ScheduleFilters,
  type ScheduleDetail,
  type ScheduleListItem,
  type InterviewerRef,
  isScheduleRound,
} from '@agnohire/shared';

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/** Non-admins see schedules they booked or for candidates in their sector;
 *  recruiters are limited to their own bookings + allocated candidates. */
function scheduleScope(ctx: InterviewContext): Prisma.InterviewWhereInput {
  if (isRecruiterScoped(ctx.role)) {
    return { OR: [{ recruiterId: ctx.userId }, { candidate: assignedCandidateWhere(ctx.userId) }] };
  }
  if (isSuperOrAdmin(ctx.role) || configService.crossSectorVisibilityEnabled()) return {};
  if (ctx.sectorId) return { OR: [{ recruiterId: ctx.userId }, { candidate: { sectorId: ctx.sectorId } }] };
  return { recruiterId: ctx.userId };
}

const LIST_SELECT = {
  id: true,
  status: true,
  type: true,
  recruiterId: true,
  createdAt: true,
  jobRequisitionId: true,
  candidate: { select: { id: true, fullName: true, email: true, phone: true } },
  jobRequisition: { select: { id: true, title: true } },
  schedule: {
    select: {
      id: true,
      scheduledDate: true,
      duration: true,
      timezone: true,
      meetingLink: true,
      meetingProvider: true,
      reminderSent: true,
      instructions: true,
      calendarEventId: true,
    },
  },
  panelMembers: {
    select: { status: true, user: { select: { id: true, fullName: true, email: true } } },
  },
  result: { select: { decision: true } },
} satisfies Prisma.InterviewSelect;

type RawSchedule = Prisma.InterviewGetPayload<{ select: typeof LIST_SELECT }>;

/** Interview.recruiterId is a plain FK (no relation) — resolve names by id. */
async function userNameMap(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map<string, { id: string; fullName: string }>();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, fullName: true },
  });
  return new Map(users.map((u) => [u.id, u]));
}

function mapInterviewers(rows: RawSchedule['panelMembers']): InterviewerRef[] {
  return rows.map((p) => ({
    id: p.user.id,
    fullName: p.user.fullName,
    email: p.user.email,
    status: p.status as InterviewerRef['status'],
  }));
}

function toListItem(iv: RawSchedule): ScheduleListItem {
  let status = iv.status as ScheduleListItem['status'];

  if (status === 'SCHEDULED' && iv.schedule) {
    const start = iv.schedule.scheduledDate.getTime();
    const end = start + iv.schedule.duration * 60000;
    const now = Date.now();
    
    if (now > end) {
      status = 'COMPLETED';
    } else if (now >= start && now <= end) {
      status = 'IN_PROGRESS';
    }
  }

  return {
    id: iv.id,
    scheduleId: iv.schedule!.id,
    status,
    type: iv.type as ScheduleListItem['type'],
    scheduledDate: iv.schedule!.scheduledDate.toISOString(),
    duration: iv.schedule!.duration,
    timezone: iv.schedule!.timezone,
    meetingLink: iv.schedule!.meetingLink,
    reminderSent: iv.schedule!.reminderSent,
    candidate: iv.candidate,
    interviewers: mapInterviewers(iv.panelMembers),
    createdAt: iv.createdAt.toISOString(),
    finalDecision: iv.result?.decision ?? null,
    jobRequisition: iv.jobRequisition ? { id: iv.jobRequisition.id, title: iv.jobRequisition.title } : null,
  };
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

export async function createSchedule(data: CreateScheduleInput, ctx: InterviewContext, req: Request) {
  const candidate = await prisma.candidate.findFirst({
    where: { id: data.candidateId, deletedAt: null },
    select: { id: true, fullName: true, sectorId: true },
  });
  if (!candidate) throw new NotFoundError('Candidate not found');

  let application: any = null;
  if (data.jobRequisitionId) {
    application = await prisma.jobApplication.findFirst({
      where: {
        candidateId: data.candidateId,
        jobRequisitionId: data.jobRequisitionId,
      },
    });
    if (!application) {
      throw new BadRequestError('Selected candidate is not mapped to the chosen Job Requisition.');
    }

    const rounds = await prisma.interviewWorkflowRound.findMany({
      where: { jobRequisitionId: data.jobRequisitionId },
      orderBy: { sequenceOrder: 'asc' },
    });

    const roundNumber = data.roundNumber ?? application.currentRound;
    const roundDef = rounds.find(r => r.roundNumber === roundNumber);

    if (!roundDef) {
      throw new BadRequestError('Selected workflow round was not found.');
    }

    // Allow scheduling for any round that is a schedule-type OR an interview-type round.
    // We don't block interview rounds here — they are handled by isScheduleRound internally.
    if (!isScheduleRound(roundDef.roundType, roundDef.roundName)) {
      const rType = roundDef.roundType.toLowerCase();
      const rName = roundDef.roundName.toLowerCase();
      const isInterviewType = rType.includes('interview') || rName.includes('interview');
      if (!isInterviewType) {
        throw new BadRequestError('This round must be conducted from the Interview page.');
      }
    }

    if (data.roundNumber) {
      // Accept scheduling only when the candidate is currently at this round.
      // Prior rounds are correctly tracked via completedRounds (updated by pipelineService.moveApplication).
      const isCurrentRound = application.currentRound === data.roundNumber;
      if (!isCurrentRound) {
        throw new BadRequestError('Candidate is not currently at this workflow round.');
      }
      if (application.workflowStatus !== 'IN_PROGRESS') {
        throw new BadRequestError('Candidate is not active in the workflow.');
      }

      const existingActive = await prisma.interview.findFirst({
        where: {
          candidateId: data.candidateId,
          jobRequisitionId: data.jobRequisitionId,
          roundNumber: data.roundNumber,
          type: { in: ['LIVE', 'PANEL'] },
          status: { notIn: ['CANCELLED', 'EXPIRED'] },
        },
      });
      if (existingActive) {
        throw new BadRequestError('An active schedule is already created for this candidate and round.');
      }
    } else {
      if (application.workflowStatus === 'FAILED') {
        throw new BadRequestError('Candidate did not qualify for the next interview round.');
      }
    }
  }

  const interviewerIds = [...new Set(data.interviewerIds)];
  const interviewers = await prisma.user.findMany({
    where: { id: { in: interviewerIds }, isActive: true },
    select: { id: true },
  });
  if (interviewers.length !== interviewerIds.length) {
    throw new BadRequestError('One or more interviewers were not found');
  }

  const scheduledDate = new Date(data.scheduledDate);
  if (Number.isNaN(scheduledDate.getTime())) throw new BadRequestError('Invalid scheduled date');
  if (scheduledDate.getTime() <= Date.now()) {
    throw new BadRequestError('Scheduled time must be in the future');
  }

  await assertWorkingHours(scheduledDate, data.duration, candidate.sectorId, data.timezone);

  if (await hasConflict(interviewerIds, scheduledDate, data.duration)) {
    throw new BadRequestError('An interviewer already has a booking that conflicts with this time');
  }

  // SaaS quota: block a new schedule when the plan's maxSchedules is reached.
  {
    const { getTenantContext } = await import('../config/tenantContext.js');
    const tenantId = getTenantContext()?.tenantId;
    if (tenantId) {
      const { assertWithinLimit } = await import('./entitlementService.js');
      await assertWithinLimit(tenantId, 'SCHEDULES', 1);
    }
  }

  const interview = await tenantTransaction(async (tx) => {
    const schedule = await tx.interviewSchedule.create({
      data: {
        candidateId: candidate.id,
        recruiterId: ctx.userId,
        scheduledDate,
        duration: data.duration,
        timezone: data.timezone,
        instructions: data.instructions || null,
        meetingLink: data.meetingLink || null,
        meetingProvider: (data as any).meetingProvider || 'GOOGLE_MEET',
        roundNumber: data.roundNumber,
      },
      select: { id: true },
    });
    const created = await tx.interview.create({
      data: {
        candidateId: candidate.id,
        recruiterId: ctx.userId,
        scheduleId: schedule.id,
        jobRequisitionId: data.jobRequisitionId ?? null,
        status: 'SCHEDULED',
        type: data.type,
        duration: data.duration,
        roundNumber: data.roundNumber,
        panelMembers: { create: interviewerIds.map((userId) => ({ userId, status: 'INVITED' })) },
      },
      select: { id: true },
    });

    if (data.jobRequisitionId && application) {
      const rounds = await tx.interviewWorkflowRound.findMany({
        where: { jobRequisitionId: data.jobRequisitionId },
        orderBy: { roundNumber: 'asc' },
      });
      const roundNumber = data.roundNumber ?? application.currentRound;
      const roundDef = rounds.find(r => r.roundNumber === roundNumber);
      const roundName = roundDef ? roundDef.roundName : `Round ${roundNumber}`;

      await tx.jobApplication.updateMany({
        where: {
          candidateId: candidate.id,
          jobRequisitionId: data.jobRequisitionId,
        },
        data: {
          status: 'SCHEDULE',
          stage: roundName,
        },
      });
    }

    return { id: created.id, scheduleId: schedule.id };
  });

  // Graceful calendar sync — never blocks scheduling. Invites candidate +
  // interviewers and, when no meeting link was set, stores the Google-generated
  // Meet link back on the schedule.
  const provider = getCalendarProvider(data.meetingProvider);
  const calendar = provider ? await provider.createEvent({ interviewId: interview.id, sectorId: candidate.sectorId }) : null;
  if (calendar) {
    await prisma.interviewSchedule.update({
      where: { id: interview.scheduleId },
      data: {
        calendarEventId: calendar.eventId,
        ...(calendar.meetLink ? { meetingLink: calendar.meetLink } : {}),
      },
    });
  } else if (!data.meetingLink) {
    const fallbackLink = (data as any).meetingProvider === 'MS_TEAMS'
      ? `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${interview.scheduleId}%40thread.v2/0?context=%7b%22Tid%22%3a%22agnohire%22%7d`
      : `https://meet.google.com/agn-${interview.scheduleId.slice(0, 4)}-${interview.scheduleId.slice(4, 7)}`;
    await prisma.interviewSchedule.update({
      where: { id: interview.scheduleId },
      data: { meetingLink: fallbackLink },
    });
  }

  await scheduleReminderFor(interview.scheduleId, scheduledDate, candidate.sectorId);

  await recordAudit(req, {
    action: 'CREATE',
    entity: 'InterviewSchedule',
    entityId: interview.id,
    description: `Scheduled ${data.type} interview for ${candidate.fullName} with ${interviewerIds.length} interviewer(s)`,
  });

  return getSchedule(interview.id, ctx);
}

async function scheduleReminderFor(scheduleId: string, scheduledDate: Date, sectorId: string | null) {
  const lead = await configService.getNumber(CONFIG_KEYS.SCHEDULE_REMINDER_LEAD_MINUTES, 60, sectorId);
  const fireAt = new Date(scheduledDate.getTime() - lead * 60_000);
  await dispatchScheduleReminder(scheduleId, fireAt);
}

// ─── AUTO-COMPLETE (config-gated) ────────────────────────────────────────────

/**
 * When `schedule.auto_complete_enabled` is on, transitions LIVE/PANEL interviews
 * whose meeting time (scheduledDate + duration + grace) has passed from
 * SCHEDULED/IN_PROGRESS to COMPLETED. Runs lazily on schedule reads, scoped to
 * what the caller can see — no background worker or Redis dependency required.
 */
async function autoCompleteOverdue(ctx: InterviewContext): Promise<void> {
  const enabled = await configService.getBool(CONFIG_KEYS.SCHEDULE_AUTO_COMPLETE_ENABLED, false, ctx.sectorId);
  if (!enabled) return;
  const grace = await configService.getNumber(CONFIG_KEYS.SCHEDULE_AUTO_COMPLETE_GRACE_MINUTES, 0, ctx.sectorId);
  const graceMs = Math.max(0, grace) * 60_000;
  const now = Date.now();

  const candidates = await prisma.interview.findMany({
    where: {
      deletedAt: null,
      type: { in: ['LIVE', 'PANEL'] },
      scheduleId: { not: null },
      status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      ...scheduleScope(ctx),
      schedule: { scheduledDate: { lt: new Date(now - graceMs) } }, // must have started
    },
    select: { id: true, schedule: { select: { scheduledDate: true, duration: true } } },
    take: 200,
  });
  const overdueIds = candidates
    .filter((c) => c.schedule && c.schedule.scheduledDate.getTime() + c.schedule.duration * 60_000 + graceMs <= now)
    .map((c) => c.id);
  if (overdueIds.length === 0) return;
  await prisma.interview.updateMany({ where: { id: { in: overdueIds } }, data: { status: 'COMPLETED' } });
}

// ─── LIST ────────────────────────────────────────────────────────────────────

export async function listSchedules(filters: ScheduleFilters, ctx: InterviewContext) {
  await autoCompleteOverdue(ctx); // reflect finished meetings before listing
  const { page, limit, candidateId, jobRequisitionId, status, decision, from, to, search, sortBy, sortOrder } = filters;
  const scheduledDate: Prisma.DateTimeFilter = {};
  if (from) scheduledDate.gte = new Date(from);
  if (to) {
    const toEnd = new Date(to);
    toEnd.setHours(23, 59, 59, 999);
    scheduledDate.lte = toEnd;
  }

  const where: Prisma.InterviewWhereInput = {
    deletedAt: null,
    type: { in: ['LIVE', 'PANEL'] },
    scheduleId: { not: null },
    ...scheduleScope(ctx),
    candidate: {
      deletedAt: null,
      ...(search && {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    },
    ...(candidateId && { candidateId }),
    ...(jobRequisitionId && { jobRequisitionId }),
    ...(status && { status }),
    ...(decision && { result: { decision } }),
    ...((from || to) && { schedule: { scheduledDate } }),
  };

  const orderBy: Prisma.InterviewOrderByWithRelationInput =
    sortBy === 'scheduledDate' ? { schedule: { scheduledDate: sortOrder } } : { createdAt: sortOrder };

  const [total, rows] = await Promise.all([
    prisma.interview.count({ where }),
    prisma.interview.findMany({
      where,
      select: LIST_SELECT,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return paginate(rows.filter((r) => r.schedule).map(toListItem), total, page, limit);
}

// ─── GET ONE ─────────────────────────────────────────────────────────────────

async function findScoped(id: string, ctx: InterviewContext): Promise<RawSchedule> {
  const iv = await prisma.interview.findFirst({
    where: { id, deletedAt: null, scheduleId: { not: null }, ...scheduleScope(ctx) },
    select: LIST_SELECT,
  });
  if (!iv || !iv.schedule) throw new NotFoundError('Scheduled interview not found');
  return iv;
}

export async function getSchedule(id: string, ctx: InterviewContext): Promise<ScheduleDetail> {
  await autoCompleteOverdue(ctx); // reflect a finished meeting before showing it
  const iv = await findScoped(id, ctx);
  const recruiters = await userNameMap([iv.recruiterId]);
  return {
    ...toListItem(iv),
    instructions: iv.schedule!.instructions,
    calendarEventId: iv.schedule!.calendarEventId,
    recruiter: recruiters.get(iv.recruiterId) ?? null,
  };
}

// ─── RESCHEDULE / UPDATE ─────────────────────────────────────────────────────

export async function rescheduleInterview(
  id: string,
  data: UpdateScheduleInput,
  ctx: InterviewContext,
  req: Request,
) {
  const iv = await findScoped(id, ctx);
  if (['CANCELLED', 'COMPLETED', 'EXPIRED'].includes(iv.status)) {
    throw new BadRequestError('This interview can no longer be rescheduled');
  }

  const newDate = data.scheduledDate ? new Date(data.scheduledDate) : iv.schedule!.scheduledDate;
  if (Number.isNaN(newDate.getTime())) throw new BadRequestError('Invalid scheduled date');
  const newDuration = data.duration ?? iv.schedule!.duration;
  const newInterviewerIds = data.interviewerIds
    ? [...new Set(data.interviewerIds)]
    : iv.panelMembers.map((p) => p.user.id);

  if (data.scheduledDate && newDate.getTime() <= Date.now()) {
    throw new BadRequestError('Scheduled time must be in the future');
  }
  if (data.interviewerIds) {
    const found = await prisma.user.count({ where: { id: { in: newInterviewerIds }, isActive: true } });
    if (found !== newInterviewerIds.length) throw new BadRequestError('One or more interviewers were not found');
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: iv.candidate.id },
    select: { sectorId: true },
  });

  const dateChanged = !!data.scheduledDate && newDate.getTime() !== iv.schedule!.scheduledDate.getTime();
  const timeChanged = dateChanged || data.duration !== undefined;
  if (timeChanged) {
    await assertWorkingHours(newDate, newDuration, candidate?.sectorId ?? null, data.timezone ?? iv.schedule!.timezone);
  }
  if (timeChanged || data.interviewerIds) {
    if (await hasConflict(newInterviewerIds, newDate, newDuration, id)) {
      throw new BadRequestError('An interviewer already has a booking that conflicts with this time');
    }
  }

  await tenantTransaction(async (tx) => {
    await tx.interviewSchedule.update({
      where: { id: iv.schedule!.id },
      data: {
        scheduledDate: newDate,
        duration: newDuration,
        timezone: data.timezone ?? undefined,
        ...(data.instructions !== undefined && { instructions: data.instructions || null }),
        ...(data.meetingLink !== undefined && { meetingLink: data.meetingLink || null }),
        ...(dateChanged && { reminderSent: false }),
      },
    });
    if (data.duration) {
      await tx.interview.update({ where: { id }, data: { duration: newDuration } });
    }
    if (data.interviewerIds) {
      await tx.panelMember.deleteMany({ where: { interviewId: id } });
      await tx.panelMember.createMany({
        data: newInterviewerIds.map((userId) => ({ interviewId: id, userId, status: 'INVITED' })),
      });
    }
  });

  if (dateChanged) {
    await scheduleReminderFor(iv.schedule!.id, newDate, candidate?.sectorId ?? null);
  }

  // Reflect the change on the connected calendar provider (new time/date/
  // interviewers) — or create the event if one didn't exist yet. Never
  // blocks the reschedule.
  const rescheduleProvider = getCalendarProvider(iv.schedule!.meetingProvider);
  if (rescheduleProvider) {
    if (iv.schedule!.calendarEventId) {
      await rescheduleProvider.updateEvent({ interviewId: id, eventId: iv.schedule!.calendarEventId, sectorId: candidate?.sectorId ?? null });
    } else {
      const calendar = await rescheduleProvider.createEvent({ interviewId: id, sectorId: candidate?.sectorId ?? null });
      if (calendar) {
        await prisma.interviewSchedule.update({
          where: { id: iv.schedule!.id },
          data: { calendarEventId: calendar.eventId, ...(calendar.meetLink ? { meetingLink: calendar.meetLink } : {}) },
        });
      }
    }
  }

  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'InterviewSchedule',
    entityId: id,
    description: `Rescheduled interview for ${iv.candidate.fullName}`,
  });

  return getSchedule(id, ctx);
}

// ─── CANCEL ──────────────────────────────────────────────────────────────────

export async function cancelSchedule(id: string, ctx: InterviewContext, req: Request) {
  const iv = await findScoped(id, ctx);
  if (['CANCELLED', 'COMPLETED', 'EXPIRED'].includes(iv.status)) {
    throw new BadRequestError('This interview is already closed');
  }
  await prisma.interview.update({ where: { id }, data: { status: 'CANCELLED' } });
  await cancelScheduleReminder(iv.schedule!.id);
  // Remove the event from the connected calendar provider (notifies
  // attendees + retires the online-meeting conference attached to it).
  // Best-effort.
  let calendarCleared = false;
  const cancelProvider = getCalendarProvider(iv.schedule!.meetingProvider);
  if (cancelProvider && iv.schedule!.calendarEventId) {
    calendarCleared = await cancelProvider.deleteEvent({ eventId: iv.schedule!.calendarEventId, sectorId: ctx.sectorId });
  }
  // Expire the meeting link on our side so it's no longer shown or joinable
  // anywhere in the app. There's no Google API to revoke a Meet code directly —
  // deleting the calendar event (above) retires the scheduled conference, and
  // clearing the stored link finishes the job in our system. We only drop the
  // calendarEventId when Google confirmed the delete, so a failed delete can
  // still be reconciled later.
  await prisma.interviewSchedule.update({
    where: { id: iv.schedule!.id },
    data: { meetingLink: null, ...(calendarCleared ? { calendarEventId: null } : {}) },
  });
  await recordAudit(req, {
    action: 'CANCEL',
    entity: 'InterviewSchedule',
    entityId: id,
    description: `Cancelled scheduled interview for ${iv.candidate.fullName} (meeting link expired)`,
  });
  return { cancelled: true };
}

// ─── COMPLETE (manual) ───────────────────────────────────────────────────────

/**
 * Manually mark a LIVE/PANEL meeting interview as COMPLETED — for when the call
 * is done (the recruiter doesn't have to wait for the time-based auto-complete).
 * Only an open (SCHEDULED/IN_PROGRESS) interview can be completed.
 */
export async function completeSchedule(id: string, ctx: InterviewContext, req: Request) {
  const iv = await findScoped(id, ctx);
  if (!['SCHEDULED', 'IN_PROGRESS'].includes(iv.status)) {
    throw new BadRequestError(`This interview is already ${iv.status.toLowerCase()} and can't be completed.`);
  }
  await prisma.interview.update({ where: { id }, data: { status: 'COMPLETED' } });
  // Stop any pending reminder — the meeting is over.
  if (iv.schedule) await cancelScheduleReminder(iv.schedule.id);
  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'InterviewSchedule',
    entityId: id,
    description: `Marked interview completed for ${iv.candidate.fullName}`,
  });
  return getSchedule(id, ctx);
}

// ─── SEND INVITE EMAIL ───────────────────────────────────────────────────────

export interface ScheduleInviteResult {
  candidate: MailResult;
  interviewersSent: number;
  interviewersTotal: number;
}

/**
 * Emails the scheduled interview details (time + meeting link) to BOTH the
 * candidate and every selected interviewer. Requires a candidate email and a
 * meeting link so everyone can actually join.
 */
export async function sendScheduleInvite(
  id: string,
  ctx: InterviewContext,
  req: Request,
  opts: { force?: boolean; selectedChannels?: string[] } = {},
): Promise<ScheduleInviteResult> {
  const iv = await findScoped(id, ctx);
  logger.info(`Sending schedule invite for interview ${id} using channels: ${opts.selectedChannels ? opts.selectedChannels.join(', ') : 'email'}`);
  if (['CANCELLED', 'COMPLETED', 'EXPIRED'].includes(iv.status)) {
    throw new BadRequestError('This interview is no longer active');
  }
  if (!iv.candidate.email) {
    throw new BadRequestError('This candidate has no email address on file');
  }
  if (!iv.schedule!.meetingLink) {
    throw new BadRequestError('Add a meeting link before sending the invite');
  }
  const when = iv.schedule!.scheduledDate;
  const tz = iv.schedule!.timezone;
  const dur = iv.schedule!.duration;
  const link = iv.schedule!.meetingLink;

  const { renderNotification } = await import('./notificationTemplateRenderer.js');
  const renderResult = await renderNotification({
    template: 'schedule_invite',
    channel: opts.selectedChannels?.includes('whatsapp') ? 'whatsapp' : 'email',
    variables: {
      candidateName: iv.candidate.fullName,
      scheduledDate: when.toLocaleDateString(undefined, { timeZone: tz }),
      scheduledTime: when.toLocaleTimeString(undefined, { timeZone: tz }),
      timezone: tz,
      durationMin: dur,
      meetingLink: link,
      instructions: iv.schedule!.instructions,
      jobTitle: iv.jobRequisition?.title,
    },
  });

  let whatsappStatus: 'SENT' | 'SKIPPED' | 'FAILED' | undefined;
  let whatsappReason: string | undefined;

  // WhatsApp Sending (Asynchronous & Isolated)
  if (opts.selectedChannels?.includes('whatsapp')) {
    try {
      const { sendWhatsAppIfEnabled } = await import('./whatsappIntegrationService.js');
      const waResult = await sendWhatsAppIfEnabled({
        phone: iv.candidate.phone || '',
        template: 'schedule_invite',
        variables: {
          candidateName: iv.candidate.fullName,
          scheduledDate: when.toLocaleDateString(undefined, { timeZone: tz }),
          scheduledTime: when.toLocaleTimeString(undefined, { timeZone: tz }),
          timezone: tz,
          durationMin: dur,
          meetingLink: link,
          instructions: iv.schedule!.instructions,
          jobTitle: iv.jobRequisition?.title,
        },
        preferenceKey: 'scheduleInterview',
      });
      whatsappStatus = waResult.status;
      whatsappReason = waResult.reason || waResult.error;
      if (whatsappStatus === 'SENT') {
        logger.info(`WhatsApp sent successfully for scheduled interview ${id}`);
      } else {
        logger.warn(`WhatsApp skipped/failed for scheduled interview ${id}: ${whatsappReason}`);
      }
    } catch (err: any) {
      logger.error(`WhatsApp failed for scheduled interview ${id} due to unexpected error`, { error: err.message });
      whatsappStatus = 'FAILED';
      whatsappReason = err.message;
    }
  }

  // Candidate invite.
  const candidateResult = await sendMailOnce(
    { to: iv.candidate.email, subject: renderResult.subject, html: renderResult.html, templateId: 'schedule-invite', entityType: 'Interview', entityId: id },
    opts.force,
  );

  // Interviewer invites — one per selected interviewer with an email (deduped
  // per interviewer for this interview).
  const interviewers = mapInterviewers(iv.panelMembers).filter((i) => !!i.email);
  let interviewersSent = 0;
  for (const interviewer of interviewers) {
    const mail = await interviewerScheduleEmail({
      interviewerName: interviewer.fullName,
      candidateName: iv.candidate.fullName,
      scheduledDate: when,
      timezone: tz,
      durationMin: dur,
      meetingLink: link,
    });
    const r = await sendMailOnce(
      { to: interviewer.email!, subject: mail.subject, html: mail.html, templateId: 'schedule-invite-interviewer', entityType: 'Interview', entityId: id },
      opts.force,
    );
    if (r.sent) interviewersSent += 1;
  }

  await recordAudit(req, {
    action: 'EMAIL',
    entity: 'InterviewSchedule',
    entityId: id,
    description: `Sent schedule invite to ${iv.candidate.email} and ${interviewersSent}/${interviewers.length} interviewer(s)`,
  });

  return {
    candidate: {
      ...candidateResult,
      whatsappStatus,
      whatsappReason,
      candidateName: iv.candidate.fullName,
    } as any,
    interviewersSent,
    interviewersTotal: interviewers.length
  };
}

// ─── PASSED CANDIDATES (for "schedule only passed" picker) ───────────────────

/**
 * Lists candidates who passed their AI interview (result decision or AI decision
 * PASS), so scheduling can be restricted to advancing candidates only. Sector-
 * scoped through the interview scope; de-duplicated by candidate.
 */
export async function listPassedCandidates(
  ctx: InterviewContext,
  jobRequisitionId?: string,
  roundNumber?: number
): Promise<{ id: string; fullName: string; email: string | null }[]> {
  const scopeWhere = (isSuperOrAdmin(ctx.role) || configService.crossSectorVisibilityEnabled()) ? {} : ctx.sectorId ? { sectorId: ctx.sectorId } : {};

  const candidateFilter: Prisma.CandidateWhereInput = {
    deletedAt: null,
    ...(isRecruiterScoped(ctx.role) ? assignedCandidateWhere(ctx.userId) : {}),
    ...scopeWhere,
  };

  if (roundNumber !== undefined) {
    candidateFilter.interviews = {
      none: {
        roundNumber: roundNumber,
        type: { in: ['LIVE', 'PANEL'] },
        status: { notIn: ['CANCELLED', 'EXPIRED'] },
        deletedAt: null,
        ...(jobRequisitionId && { jobRequisitionId }),
      },
    };
  }

  const where: Prisma.JobApplicationWhereInput = {
    ...(jobRequisitionId && { jobRequisitionId }),
    candidate: candidateFilter,
    ...(roundNumber !== undefined ? {
      currentRound: roundNumber,
      workflowStatus: 'IN_PROGRESS',
    } : {
      workflowStatus: { notIn: ['FAILED'] },
      status: { notIn: ['REJECTED'] },
    }),
  };

  const applications = await prisma.jobApplication.findMany({
    where,
    include: {
      job: {
        include: {
          workflowRounds: true,
        },
      },
      candidate: {
        select: { id: true, fullName: true, email: true },
      },
    },
    orderBy: { appliedAt: 'desc' },
  });
  
  const byId = new Map<string, { id: string; fullName: string; email: string | null }>();
  for (const app of applications) {
    if (roundNumber !== undefined) {
      if (!byId.has(app.candidate.id)) {
        byId.set(app.candidate.id, app.candidate);
      }
    } else {
      const scheduleRound = app.job?.workflowRounds?.find((r) =>
        isScheduleRound(r.roundType, r.roundName),
      );

      if (scheduleRound) {
        if (app.currentRound === scheduleRound.roundNumber) {
          if (!byId.has(app.candidate.id)) {
            byId.set(app.candidate.id, app.candidate);
          }
        }
      }
    }
  }
  return [...byId.values()];
}

// ─── CALENDAR SYNC (graceful) ────────────────────────────────────────────────

export async function syncSchedule(id: string, ctx: InterviewContext) {
  await findScoped(id, ctx); // authorize / 404
  const { syncToCalendar, isCalendarConfigured } = await import('./calendarService.js');
  const { MicrosoftCalendarProvider } = await import('../integrations/calendar/microsoft/microsoftCalendarProvider.js');
  const ms = new MicrosoftCalendarProvider();
  const [googleOn, msOn] = await Promise.all([isCalendarConfigured(ctx.sectorId), ms.isConfigured(ctx.sectorId)]);
  if (!googleOn && !msOn) {
    throw new BadRequestError('No calendar integration is connected. Configure Google or Microsoft in Admin Console → System Configuration → Integrations to enable sync.');
  }
  const results = await Promise.all([
    googleOn ? syncToCalendar(ctx.sectorId) : Promise.resolve(null),
    msOn ? ms.syncPending(ctx.sectorId) : Promise.resolve(null),
  ]);
  const message = results.filter((r): r is { message: string } => r !== null).map((r) => r.message).join(' ');
  return { message };
}

/** Mint a meeting link (Google Meet or Microsoft Teams) for one scheduled interview (on-demand). */
export async function generateMeet(id: string, ctx: InterviewContext) {
  const iv = await findScoped(id, ctx); // authorize / 404
  const provider = getCalendarProvider(iv.schedule!.meetingProvider);
  if (!provider) throw new BadRequestError('This schedule uses a manual meeting link — there is no provider to generate one from.');
  return provider.generateMeetLink(id, ctx.sectorId);
}

export async function getCalendarStatus(ctx: InterviewContext): Promise<{ configured: boolean }> {
  const { isCalendarConfigured } = await import('./calendarService.js');
  const { MicrosoftCalendarProvider } = await import('../integrations/calendar/microsoft/microsoftCalendarProvider.js');
  const [googleOn, msOn] = await Promise.all([
    isCalendarConfigured(ctx.sectorId),
    new MicrosoftCalendarProvider().isConfigured(ctx.sectorId),
  ]);
  return { configured: googleOn || msOn };
}

export async function deleteSchedule(id: string, _ctx: InterviewContext, req: Request) {
  const iv = await prisma.interview.findFirst({
    where: { id },
    select: { scheduleId: true, candidate: { select: { fullName: true } } },
  });
  if (!iv || !iv.scheduleId) throw new NotFoundError('Schedule not found');

  await prisma.interviewSchedule.delete({ where: { id: iv.scheduleId } });

  await recordAudit(req, {
    action: 'DELETE',
    entity: 'InterviewSchedule',
    entityId: id,
    description: `Deleted schedule for ${iv.candidate.fullName}`,
  });
}

import ExcelJS from 'exceljs';

export async function generateSchedulesExcel(filters: ScheduleFilters, ids: string[] | undefined, ctx: InterviewContext): Promise<{ buffer: Buffer, filename: string }> {
  const exportFilters = { ...filters, page: 1, limit: 10000 };
  const result = await listSchedules(exportFilters, ctx);
  
  const itemsToExport = ids && ids.length > 0 
    ? result.items.filter(i => ids.includes(i.id))
    : result.items;
  
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Schedules');

  worksheet.columns = [
    { header: 'Candidate Name', key: 'candidateName', width: 25 },
    { header: 'Candidate Email', key: 'candidateEmail', width: 30 },
    { header: 'Job Title', key: 'jobTitle', width: 25 },
    { header: 'Interviewers', key: 'interviewers', width: 35 },
    { header: 'Date & Time', key: 'dateTime', width: 25 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Decision', key: 'decision', width: 15 },
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF007AFF' },
  };

  itemsToExport.forEach(item => {
    let dateTimeStr = 'N/A';
    if (item.scheduledDate) {
      try {
        const d = new Date(item.scheduledDate);
        const datePart = new Intl.DateTimeFormat('en-GB', {
          timeZone: item.timezone || 'UTC',
          day: '2-digit', month: 'short', year: 'numeric'
        }).format(d);
        const timePart = new Intl.DateTimeFormat('en-US', {
          timeZone: item.timezone || 'UTC',
          hour: 'numeric', minute: '2-digit', hour12: true
        }).format(d);
        dateTimeStr = `${datePart} - ${timePart} (${item.timezone || 'UTC'})`;
      } catch (e) {
        dateTimeStr = new Date(item.scheduledDate).toLocaleString();
      }
    }

    const interviewersStr = item.interviewers.map(i => i.fullName).join(', ');

    worksheet.addRow({
      candidateName: item.candidate.fullName || '',
      candidateEmail: item.candidate.email || '',
      jobTitle: item.jobRequisition?.title || 'N/A',
      interviewers: interviewersStr || 'N/A',
      dateTime: dateTimeStr,
      status: item.status || '',
      decision: item.finalDecision || 'PENDING',
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
    
  return {
    buffer: Buffer.from(buffer),
    filename: `Schedules_Report_${new Date().toISOString().split('T')[0]}.xlsx`
  };
}
