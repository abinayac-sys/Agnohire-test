import { ToolRegistry } from '../toolRegistry/index.js';
import { PERMISSIONS } from '@agnohire/shared';

/** All tools here belong to the 'interview' domain (see interview/index.ts).
 * Default is INTERVIEW_SCHEDULE (matches schedule.routes.ts's write
 * permission — nearly everything here schedules/cancels/sends); the one
 * read-only tool (listInterviews) overrides down to INTERVIEW_VIEW.
 *
 * IMPORTANT: this "Interview" the agent schedules/cancels/invites is a
 * human-conducted call (InterviewSchedule: candidate + interviewer panel +
 * meeting link + calendar), backed by scheduleService.ts — NOT the
 * self-serve AI text/coding assessment (Interview.type='AI', questionBankId,
 * backed by interviewService.ts). Every tool below previously called into
 * interviewService.ts, which has no concept of a panel, a meeting link, or
 * availability at all; scheduleInterview in particular called createInterview
 * requiring a questionBankId this tool never even asked for, so any call
 * without a pre-existing matching bank threw NotFoundError. All calls here
 * now go through scheduleService.ts, the same backend the Schedule page uses. */
const rawRegister = ToolRegistry.register.bind(ToolRegistry);
const register = (tool: Omit<Parameters<typeof rawRegister>[0], 'category'>) =>
  rawRegister({ permissions: [PERMISSIONS.INTERVIEW_SCHEDULE], ...tool, category: 'interview' });

/** scheduleService takes a roundNumber, not a name — resolve the workflow
 * round the user named (e.g. "Technical Discussion") to its number. Absent a
 * name, the service itself defaults to the candidate's current round. */
async function resolveRoundNumber(jobId: string, roundName?: string): Promise<{ roundNumber?: number; error?: string }> {
  if (!roundName) return {};
  const { prisma } = await import('../../config/database.js');
  const round = await prisma.interviewWorkflowRound.findFirst({
    where: { jobRequisitionId: jobId, roundName: { equals: roundName, mode: 'insensitive' } },
    select: { roundNumber: true },
  });
  if (!round) return { error: `No workflow round named "${roundName}" was found for this job.` };
  return { roundNumber: round.roundNumber };
}

const isUuid = (val?: string | null) =>
  !!val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

/** This agent is deliberately barred from calling Candidate/Job tools directly
 * (see the InterviewAgent instructions), but the orchestrator's own routing
 * prompt tells the model it can pass a plain name for ID-shaped fields like
 * sectorId/domainId and "the backend resolves it" — the model reasonably
 * generalizes that same pattern to candidateId/jobId/interviewerIds too, even
 * though scheduleService's lookups are strict UUID-only. Resolving names here
 * (deterministic code, not a tool call) closes that gap without having to
 * either loosen the agent-isolation rule or teach every model call site the
 * distinction between fields that auto-resolve and fields that don't. */
async function resolveCandidateId(input: string): Promise<{ id?: string; error?: string }> {
  if (isUuid(input)) return { id: input };
  const { prisma } = await import('../../config/database.js');
  const matches = await prisma.candidate.findMany({
    where: {
      deletedAt: null,
      OR: [{ fullName: { contains: input, mode: 'insensitive' } }, { email: { equals: input, mode: 'insensitive' } }],
    },
    select: { id: true, fullName: true },
    take: 2,
  });
  if (matches.length === 0) return { error: `No candidate named "${input}" was found.` };
  if (matches.length > 1) return { error: `More than one candidate matches "${input}" — please provide the candidate's email or a more specific name.` };
  return { id: matches[0].id };
}

async function resolveJobId(input: string): Promise<{ id?: string; error?: string }> {
  if (isUuid(input)) return { id: input };
  const { prisma } = await import('../../config/database.js');
  const matches = await prisma.jobRequisition.findMany({
    where: { deletedAt: null, title: { contains: input, mode: 'insensitive' } },
    select: { id: true, title: true },
    take: 2,
  });
  if (matches.length === 0) return { error: `No job titled "${input}" was found.` };
  if (matches.length > 1) return { error: `More than one job matches "${input}" — please be more specific.` };
  return { id: matches[0].id };
}

/** Every action tool below (send invite, cancel, reschedule, generate link,
 * assign panel, update status) took a raw interviewId — a UUID no human,
 * least of all non-technical staff, will ever have on hand. Resolves a
 * candidate's name/email to their most recent scheduled interview instead, so
 * "send Max Verstappen's invite" works without ever surfacing an ID. */
async function resolveInterviewId(input: string): Promise<{ id?: string; error?: string }> {
  if (isUuid(input)) return { id: input };
  const { prisma } = await import('../../config/database.js');
  const interviews = await prisma.interview.findMany({
    where: {
      deletedAt: null,
      type: { in: ['LIVE', 'PANEL'] },
      scheduleId: { not: null },
      candidate: {
        deletedAt: null,
        OR: [{ fullName: { contains: input, mode: 'insensitive' } }, { email: { equals: input, mode: 'insensitive' } }],
      },
    },
    select: { id: true, status: true, createdAt: true, candidate: { select: { fullName: true } } },
  });
  if (interviews.length === 0) return { error: `No scheduled interview was found for "${input}".` };
  const distinctCandidates = new Set(interviews.map((i) => i.candidate?.fullName));
  if (distinctCandidates.size > 1) return { error: `More than one candidate matches "${input}" — please provide their email instead.` };
  // Prefer their latest still-active (SCHEDULED) interview; fall back to the most recently created otherwise.
  const active = interviews.filter((i) => i.status === 'SCHEDULED');
  const pool = active.length > 0 ? active : interviews;
  pool.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { id: pool[0].id };
}

async function resolveInterviewerIds(inputs: string[]): Promise<{ ids?: string[]; error?: string }> {
  const { prisma } = await import('../../config/database.js');
  const ids: string[] = [];
  for (const input of inputs) {
    if (isUuid(input)) {
      ids.push(input);
      continue;
    }
    const matches = await prisma.user.findMany({
      where: { isActive: true, deletedAt: null, OR: [{ fullName: { contains: input, mode: 'insensitive' } }, { email: { equals: input, mode: 'insensitive' } }] },
      select: { id: true },
      take: 2,
    });
    if (matches.length === 0) return { error: `No interviewer named "${input}" was found.` };
    if (matches.length > 1) return { error: `More than one user matches "${input}" — please provide their email instead.` };
    ids.push(matches[0].id);
  }
  return { ids };
}

register({
  name: 'scheduleInterview',
  entity: 'interview',
  description: 'Schedule a live interview call for a candidate with at least one interviewer/panel member. A meeting link (Google Meet or Microsoft Teams) is generated automatically unless one is provided.',
  parameters: {
    type: 'object',
    properties: {
      candidateId: { type: 'string', description: "The candidate's name, email, or ID — the backend resolves a name/email to the right candidate automatically." },
      jobId: { type: 'string', description: "The job's title or ID — the backend resolves a title to the right job automatically." },
      interviewerIds: { type: 'array', items: { type: 'string' }, description: 'Name(s), email(s), or ID(s) of at least one interviewer to invite — names/emails are resolved automatically.' },
      roundName: { type: 'string', description: 'Workflow round for this job, e.g. "Technical Discussion". Defaults to the candidate\'s current round if omitted.' },
      scheduledDate: { type: 'string', description: 'ISO date-time with a timezone offset, e.g. 2026-06-10T09:00:00.000Z' },
      duration: { type: 'number', description: 'Minutes. Defaults to 60.' },
      timezone: { type: 'string', description: 'IANA timezone. Defaults to UTC.' },
      type: { type: 'string', enum: ['LIVE', 'PANEL'], description: 'Defaults to LIVE.' },
      instructions: { type: 'string' },
      meetingProvider: {
        type: 'string',
        enum: ['GOOGLE_MEET', 'MS_TEAMS'],
        description: 'Which video provider to auto-generate the meeting link from. Defaults to GOOGLE_MEET. Use MS_TEAMS when the user asks for a Teams link/meeting — requires Microsoft Calendar to be configured and connected in Admin Console → Integrations.',
      },
      meetingLink: { type: 'string', description: 'Leave blank to auto-generate a link from meetingProvider.' },
    },
    required: ['candidateId', 'jobId', 'interviewerIds', 'scheduledDate'],
  },
  execute: async (args, ctx, req) => {
    const candidateResolved = await resolveCandidateId(args.candidateId);
    if (candidateResolved.error) return { success: false, error: candidateResolved.error };
    const jobResolved = await resolveJobId(args.jobId);
    if (jobResolved.error) return { success: false, error: jobResolved.error };
    const interviewersResolved = await resolveInterviewerIds(args.interviewerIds);
    if (interviewersResolved.error) return { success: false, error: interviewersResolved.error };

    const { prisma } = await import('../../config/database.js');
    // Ensure workflow rounds exist for the job
    const roundCount = await prisma.interviewWorkflowRound.count({
      where: { jobRequisitionId: jobResolved.id! },
    });
    if (roundCount === 0) {
      await prisma.interviewWorkflowRound.create({
        data: {
          jobRequisitionId: jobResolved.id!,
          roundNumber: 1,
          sequenceOrder: 1,
          roundName: 'Interview Round 1',
          roundType: 'HR Interview',
        },
      });
    }

    // Ensure candidate is mapped to the job requisition
    let app = await prisma.jobApplication.findFirst({
      where: { candidateId: candidateResolved.id!, jobRequisitionId: jobResolved.id! },
    });
    if (!app) {
      const { createApplication } = await import('../../services/candidateService.js');
      try {
        await createApplication({ candidateId: candidateResolved.id!, jobRequisitionId: jobResolved.id! }, ctx as any, req);
      } catch {}
    }

    const { roundNumber, error } = await resolveRoundNumber(jobResolved.id!, args.roundName);
    if (error) return { success: false, error };
    const { createSchedule } = await import('../../services/scheduleService.js');
    const schedule = await createSchedule(
      {
        candidateId: candidateResolved.id!,
        jobRequisitionId: jobResolved.id!,
        interviewerIds: interviewersResolved.ids!,
        scheduledDate: args.scheduledDate,
        duration: args.duration ?? 60,
        timezone: args.timezone || 'UTC',
        type: args.type || 'LIVE',
        instructions: args.instructions || '',
        meetingProvider: args.meetingProvider || 'GOOGLE_MEET',
        meetingLink: args.meetingLink || '',
        roundNumber,
      } as any,
      ctx as any,
      req,
    );
    return { success: true, data: schedule };
  },
});

register({
  name: 'scheduleInterviewsBulk',
  entity: 'interview',
  description: "Schedule live interviews for MANY candidates in one call, without naming each one — selects candidates by job + round (everyone who passed/is currently at that round), or by an explicit list of names/emails if given. Interview times are auto-staggered back-to-back starting from startDate so the same interviewer(s) don't get double-booked. Use this instead of calling scheduleInterview repeatedly whenever the user says something like 'all candidates who passed round 1', 'everyone shortlisted for X', or names more than a couple of people at once.",
  parameters: {
    type: 'object',
    properties: {
      jobId: { type: 'string', description: "The job's title or ID." },
      roundName: { type: 'string', description: 'Workflow round to filter candidates by, e.g. "Technical Discussion". Omit to include every active (non-rejected) candidate on this job.' },
      candidateNames: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional explicit list of candidate names/emails. Omit this entirely to auto-select every candidate matching jobId + roundName instead.',
      },
      interviewerIds: { type: 'array', items: { type: 'string' }, description: 'Name(s), email(s), or ID(s) of at least one interviewer for every interview in this batch.' },
      startDate: { type: 'string', description: 'ISO date-time with a timezone offset for the FIRST candidate\'s slot — subsequent candidates are scheduled back-to-back after this one.' },
      duration: { type: 'number', description: 'Minutes per interview. Defaults to 30 for bulk scheduling.' },
      gapMinutes: { type: 'number', description: 'Buffer minutes between each candidate\'s slot. Defaults to 0 (back-to-back).' },
      timezone: { type: 'string', description: 'IANA timezone. Defaults to UTC.' },
      type: { type: 'string', enum: ['LIVE', 'PANEL'], description: 'Defaults to LIVE.' },
      instructions: { type: 'string' },
      meetingProvider: {
        type: 'string',
        enum: ['GOOGLE_MEET', 'MS_TEAMS'],
        description: 'Which video provider to auto-generate meeting links from for every interview in this batch. Defaults to GOOGLE_MEET.',
      },
    },
    required: ['jobId', 'interviewerIds', 'startDate'],
  },
  execute: async (args, ctx, req) => {
    const { prisma } = await import('../../config/database.js');
    const jobResolved = await resolveJobId(args.jobId);
    if (jobResolved.error) return { success: false, error: jobResolved.error };
    const interviewersResolved = await resolveInterviewerIds(args.interviewerIds);
    if (interviewersResolved.error) return { success: false, error: interviewersResolved.error };
    const { roundNumber, error: roundError } = await resolveRoundNumber(jobResolved.id!, args.roundName);
    if (roundError) return { success: false, error: roundError };

    let candidates: { id: string; fullName: string }[];
    if (args.candidateNames?.length) {
      candidates = [];
      for (const name of args.candidateNames) {
        const resolved = await resolveCandidateId(name);
        if (resolved.error) return { success: false, error: resolved.error };
        candidates.push({ id: resolved.id!, fullName: name });
      }
    } else {
      const { listPassedCandidates } = await import('../../services/scheduleService.js');
      candidates = await listPassedCandidates(ctx as any, jobResolved.id!, roundNumber);
      if (candidates.length === 0) {
        return { success: false, error: 'No candidates matched this job/round — nobody is currently active at that stage.' };
      }
    }

    const duration = args.duration ?? 30;
    const { configService } = await import('../../services/configService.js');
    const { CONFIG_KEYS } = await import('@agnohire/shared');
    const bufferMin = await configService.getNumber(CONFIG_KEYS.SCHEDULE_BUFFER_MINUTES, 15, ctx?.sectorId ?? null);
    const gap = args.gapMinutes ?? bufferMin;
    const startMs = new Date(args.startDate).getTime();
    const { createSchedule } = await import('../../services/scheduleService.js');

    const results: { candidate: string; success: boolean; scheduledDate?: string; meetingLink?: string; error?: string }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const scheduledDate = new Date(startMs + i * (duration + gap) * 60_000).toISOString();
      try {
        let app = await prisma.jobApplication.findFirst({
          where: { candidateId: c.id, jobRequisitionId: jobResolved.id! },
        });
        if (!app) {
          const { createApplication } = await import('../../services/candidateService.js');
          try {
            await createApplication({ candidateId: c.id, jobRequisitionId: jobResolved.id! }, ctx as any, req);
          } catch {}
        }

        const schedule = await createSchedule(
          {
            candidateId: c.id,
            jobRequisitionId: jobResolved.id!,
            interviewerIds: interviewersResolved.ids!,
            scheduledDate,
            duration,
            timezone: args.timezone || 'UTC',
            type: args.type || 'LIVE',
            instructions: args.instructions || '',
            meetingProvider: args.meetingProvider || 'GOOGLE_MEET',
            meetingLink: '',
            roundNumber,
          } as any,
          ctx as any,
          req,
        );
        results.push({ candidate: c.fullName, success: true, scheduledDate, meetingLink: (schedule as any).meetingLink });
      } catch (err) {
        results.push({ candidate: c.fullName, success: false, error: (err as Error).message });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    return {
      success: succeeded > 0,
      data: { scheduledCount: succeeded, failedCount: results.length - succeeded, results },
    };
  },
});

register({
  name: 'updateInterviewStatus',
  entity: 'interview',
  description: 'Manually complete or cancel a scheduled interview. (SCHEDULED/STARTED are set automatically by time and cannot be set directly.)',
  parameters: {
    type: 'object',
    properties: {
      interviewId: { type: 'string', description: "The interview's ID, or the candidate's name/email — resolves to their most recent scheduled interview automatically." },
      status: { type: 'string', enum: ['SCHEDULED', 'STARTED', 'COMPLETED', 'CANCELLED'] }
    },
    required: ['interviewId', 'status'],
  },
  execute: async (args, ctx, req) => {
    const resolved = await resolveInterviewId(args.interviewId);
    if (resolved.error) return { success: false, error: resolved.error };
    if (args.status === 'CANCELLED') {
      const { cancelSchedule } = await import('../../services/scheduleService.js');
      const result = await cancelSchedule(resolved.id!, ctx as any, req);
      return { success: true, data: result };
    }
    if (args.status === 'COMPLETED') {
      const { completeSchedule } = await import('../../services/scheduleService.js');
      const result = await completeSchedule(resolved.id!, ctx as any, req);
      return { success: true, data: result };
    }
    return {
      success: false,
      error: `Setting status to ${args.status} directly isn't supported — SCHEDULED/STARTED/IN_PROGRESS are derived automatically from the meeting time.`,
    };
  },
});

register({
  name: 'rescheduleInterview',
  entity: 'interview',
  description: 'Reschedule an existing interview to a new date/time, and/or duration.',
  parameters: {
    type: 'object',
    properties: {
      interviewId: { type: 'string', description: "The interview's ID, or the candidate's name/email — resolves to their most recent scheduled interview automatically." },
      newScheduledDate: { type: 'string', description: 'ISO date string' },
      duration: { type: 'number', description: 'Minutes' },
    },
    required: ['interviewId', 'newScheduledDate'],
  },
  execute: async (args, ctx, req) => {
    const resolved = await resolveInterviewId(args.interviewId);
    if (resolved.error) return { success: false, error: resolved.error };
    const { rescheduleInterview } = await import('../../services/scheduleService.js');
    const schedule = await rescheduleInterview(
      resolved.id!,
      { scheduledDate: args.newScheduledDate, ...(args.duration != null && { duration: args.duration }) } as any,
      ctx as any,
      req,
    );
    return { success: true, data: schedule };
  },
});

register({
  name: 'generateMeetingLink',
  entity: 'interview',
  description: 'Generate (or regenerate) a meeting link for an existing scheduled interview, using whichever provider (Google Meet or Microsoft Teams) it was scheduled with.',
  parameters: {
    type: 'object',
    properties: { interviewId: { type: 'string', description: "The interview's ID, or the candidate's name/email — resolves to their most recent scheduled interview automatically." } },
    required: ['interviewId'],
  },
  execute: async (args, ctx) => {
    const resolved = await resolveInterviewId(args.interviewId);
    if (resolved.error) return { success: false, error: resolved.error };
    const { getSchedule } = await import('../../services/scheduleService.js');
    const iv = (await getSchedule(resolved.id!, ctx as any)) as any;
    const { getCalendarProvider } = await import('../../integrations/calendar/calendarProviderFactory.js');
    const provider = getCalendarProvider(iv.meetingProvider);
    if (provider && 'generateMeetLink' in provider && typeof (provider as any).generateMeetLink === 'function') {
      const result = await (provider as any).generateMeetLink(resolved.id!, ctx?.sectorId ?? null);
      return { success: true, data: result };
    }
    const { GoogleCalendarProvider } = await import('../../integrations/calendar/google/googleCalendarProvider.js');
    const result = await new GoogleCalendarProvider().generateMeetLink(resolved.id!, ctx?.sectorId ?? null);
    return { success: true, data: result };
  },
});

register({
  name: 'sendInterviewInvitation',
  entity: 'interview',
  description: "Email the candidate (and any interviewers with an email) the scheduled interview's date, time, and meeting link.",
  parameters: {
    type: 'object',
    properties: { interviewId: { type: 'string', description: "The interview's ID, or the candidate's name/email — resolves to their most recent scheduled interview automatically." } },
    required: ['interviewId'],
  },
  execute: async (args, ctx, req) => {
    const resolved = await resolveInterviewId(args.interviewId);
    if (resolved.error) return { success: false, error: resolved.error };
    const { sendScheduleInvite } = await import('../../services/scheduleService.js');
    const result = await sendScheduleInvite(resolved.id!, ctx as any, req);
    return { success: result.candidate.sent, data: result };
  },
});

register({
  name: 'assignPanel',
  entity: 'interview',
  description: 'Add a recruiter/HR member to an existing interview\'s panel (keeps the existing interviewers and adds this one).',
  parameters: {
    type: 'object',
    properties: {
      interviewId: { type: 'string', description: "The interview's ID, or the candidate's name/email — resolves to their most recent scheduled interview automatically." },
      recruiterId: { type: 'string', description: "The person's name, email, or ID to add to the panel." },
    },
    required: ['interviewId', 'recruiterId'],
  },
  execute: async (args, ctx, req) => {
    const resolved = await resolveInterviewId(args.interviewId);
    if (resolved.error) return { success: false, error: resolved.error };
    const recruiterResolved = await resolveInterviewerIds([args.recruiterId]);
    if (recruiterResolved.error) return { success: false, error: recruiterResolved.error };
    const { getSchedule, rescheduleInterview } = await import('../../services/scheduleService.js');
    const current = await getSchedule(resolved.id!, ctx as any);
    const existingIds = current.interviewers.map((i) => i.id);
    const recruiterId = recruiterResolved.ids![0];
    if (existingIds.includes(recruiterId)) {
      return { success: false, error: 'That person is already on this interview\'s panel.' };
    }
    const schedule = await rescheduleInterview(
      resolved.id!,
      { interviewerIds: [...existingIds, recruiterId] } as any,
      ctx as any,
      req,
    );
    return { success: true, data: schedule };
  },
});

register({
  name: 'listInterviews',
  permissions: [PERMISSIONS.INTERVIEW_VIEW],
  entity: 'interview',
  description: 'List scheduled interviews.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string' }
    },
  },
  execute: async (args, ctx) => {
    const { listSchedules } = await import('../../services/scheduleService.js');
    return await listSchedules(
      { page: 1, limit: 20, status: args.status, sortBy: 'scheduledDate', sortOrder: 'asc' } as any,
      ctx as any,
    );
  },
});

register({
  name: 'cancelInterview',
  entity: 'interview',
  description: 'Cancel a scheduled interview (expires its meeting link and notifies attendees via calendar).',
  parameters: {
    type: 'object',
    properties: { interviewId: { type: 'string', description: "The interview's ID, or the candidate's name/email — resolves to their most recent scheduled interview automatically." } },
    required: ['interviewId'],
  },
  execute: async (args, ctx, req) => {
    const resolved = await resolveInterviewId(args.interviewId);
    if (resolved.error) return { success: false, error: resolved.error };
    const { cancelSchedule } = await import('../../services/scheduleService.js');
    const result = await cancelSchedule(resolved.id!, ctx as any, req);
    return { success: true, data: result };
  },
});
