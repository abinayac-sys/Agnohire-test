import { prisma } from '../../../config/database.js';
import { logger } from '../../../config/logger.js';
import { BadRequestError } from '../../../utils/errors.js';
import { getEnabledIntegrationConfig } from '../../../services/integrationService.js';
import { refreshAccessToken } from './microsoftAuthService.js';
import type { CalendarProvider } from '../calendarProvider.js';
import type {
  CalendarEventInput,
  CalendarEventUpdateInput,
  CalendarEventDeleteInput,
  CalendarSyncResult,
  CalendarTestResult,
} from '../types/calendar.types.js';

/**
 * Microsoft Graph (Outlook Calendar + Teams) implementation of
 * CalendarProvider. Credentials come from the legacy Integration row only in
 * this phase (type MICROSOFT_CALENDAR/MICROSOFT/TEAMS), reusing the same
 * getEnabledIntegrationConfig() mechanism Google's legacy path uses — no
 * System Config tier, no new admin UI (the existing IntegrationsPage.tsx CRUD
 * already covers creating a row of the right type).
 */

const INTEGRATION_TYPES = ['MICROSOFT_CALENDAR', 'MICROSOFT', 'TEAMS'];
const GRAPH_API = 'https://graph.microsoft.com/v1.0';

/**
 * Message for the known Microsoft-side reliability issue where POST/PATCH
 * /me/events with isOnlineMeeting:true succeeds (event created) but
 * onlineMeeting.joinUrl comes back null/absent — reported in multiple active
 * Microsoft Q&A threads, sometimes caused by a tenant's Teams admin "Meeting
 * Scheduling > Outlook add-in" policy being disabled, sometimes an
 * unexplained platform regression. Not fixable from this side — surfaced
 * distinctly so the customer knows to check Teams admin settings, not our
 * config.
 */
const TEAMS_LINK_MISSING_MESSAGE =
  "Outlook event created but Teams meeting link was not generated — this usually means the connected Microsoft account's Teams admin policy has Outlook meeting scheduling disabled, or is a temporary Microsoft Graph issue.";

interface MicrosoftConfig {
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  refreshToken?: string;
  /** Target calendar; Graph defaults to /me/events (the primary calendar). */
  calendarId?: string;
}

function hasUsableCreds(c: MicrosoftConfig): boolean {
  return Boolean(c.refreshToken && c.clientId && c.clientSecret && c.tenantId);
}

interface ResolvedMicrosoftCalendar {
  config: MicrosoftConfig;
  integrationId: string;
}

/** Resolves usable Microsoft credentials from the legacy Integration row. Returns null when nothing is configured/usable. */
async function resolveCredentials(sectorId: string | null = null): Promise<ResolvedMicrosoftCalendar | null> {
  const integration = await getEnabledIntegrationConfig(INTEGRATION_TYPES, sectorId);
  if (!integration) return null;
  const config = integration.config as MicrosoftConfig;
  if (!hasUsableCreds(config)) return null;
  return { config, integrationId: integration.id };
}

/** Resolve a usable Graph access token from the stored refresh token. */
async function resolveAccessToken(config: MicrosoftConfig): Promise<{ token: string | null; error?: string }> {
  if (!config.refreshToken || !config.clientId || !config.clientSecret || !config.tenantId) {
    return { token: null, error: 'Microsoft app registration is not fully configured (client id, client secret, tenant id, and refresh token are all required).' };
  }
  return refreshAccessToken(config.refreshToken, {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tenantId: config.tenantId,
  });
}

interface GraphAttendee {
  emailAddress: { address: string; name?: string };
  type: 'required';
}

interface GraphEventPayload {
  subject: string;
  body: { contentType: 'text'; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees: GraphAttendee[];
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: 'teamsForBusiness';
}

/**
 * Build the Graph event payload from an interview + its schedule. Same
 * attendee composition as calendarService.ts:buildEvent (candidate +
 * recruiter + every selected interviewer). isOnlineMeeting + teamsForBusiness
 * makes this single POST/PATCH the correct calendar-backed pattern for
 * producing both the Outlook event and the Teams meeting link — never a
 * separate /me/onlineMeetings call, which is for standalone (non-calendar)
 * Teams meetings.
 */
async function buildEvent(interviewId: string, requestMeet = false): Promise<GraphEventPayload | null> {
  const iv = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: {
      type: true,
      recruiterId: true,
      schedule: { select: { scheduledDate: true, duration: true, timezone: true, instructions: true, meetingLink: true } },
      candidate: { select: { fullName: true, email: true } },
      panelMembers: { select: { user: { select: { email: true } } } },
    },
  });
  if (!iv?.schedule) return null;

  const recruiter = await prisma.user.findUnique({
    where: { id: iv.recruiterId },
    select: { email: true },
  });

  const start = iv.schedule.scheduledDate;
  const end = new Date(start.getTime() + (iv.schedule.duration ?? 30) * 60_000);
  const emails = new Set(
    [iv.candidate?.email, recruiter?.email, ...iv.panelMembers.map((p) => p.user.email)].filter(
      (e): e is string => Boolean(e),
    ),
  );
  const attendees: GraphAttendee[] = [...emails].map((address) => ({ emailAddress: { address }, type: 'required' }));

  const payload: GraphEventPayload = {
    subject: `${iv.type} Interview — ${iv.candidate?.fullName ?? 'Candidate'}`,
    body: { contentType: 'text', content: iv.schedule.instructions ?? 'Scheduled via AgnoHire.' },
    start: { dateTime: start.toISOString(), timeZone: iv.schedule.timezone || 'UTC' },
    end: { dateTime: end.toISOString(), timeZone: iv.schedule.timezone || 'UTC' },
    attendees,
  };
  if (requestMeet && !iv.schedule.meetingLink) {
    payload.isOnlineMeeting = true;
    payload.onlineMeetingProvider = 'teamsForBusiness';
  }
  return payload;
}

interface GraphEventResponse {
  id?: string;
  onlineMeeting?: { joinUrl?: string };
}

function extractMeetLink(json: GraphEventResponse): string | null {
  return json.onlineMeeting?.joinUrl ?? null;
}

export class MicrosoftCalendarProvider implements CalendarProvider {
  async isConfigured(sectorId: string | null = null): Promise<boolean> {
    return (await resolveCredentials(sectorId)) !== null;
  }

  async createEvent(args: CalendarEventInput): Promise<CalendarSyncResult | null> {
    const resolved = await resolveCredentials(args.sectorId ?? null);
    if (!resolved) {
      logger.debug('Microsoft Calendar not connected — skipping event creation', { interviewId: args.interviewId });
      return null;
    }
    const { token } = await resolveAccessToken(resolved.config);
    if (!token) {
      logger.warn('Microsoft Calendar enabled but no usable credential', { interviewId: args.interviewId });
      return null;
    }

    try {
      const event = await buildEvent(args.interviewId, true);
      if (!event) return null;
      const res = await fetch(`${GRAPH_API}/me/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      if (!res.ok) {
        logger.error('Microsoft Graph event insert failed', { status: res.status, interviewId: args.interviewId });
        return null;
      }
      const json = (await res.json()) as GraphEventResponse;
      await prisma.integration.update({ where: { id: resolved.integrationId }, data: { lastSyncAt: new Date() } });
      if (!json.id) return null;

      const meetLink = extractMeetLink(json);
      if (event.isOnlineMeeting && !meetLink) {
        // Event created successfully, but Microsoft's known Teams-link
        // reliability issue means the join URL didn't come back. Not a
        // generic failure — log distinctly so it's not confused with a
        // credentials/connectivity problem. The event (and its id) is still
        // real and usable; only the Teams link is missing.
        logger.error(TEAMS_LINK_MISSING_MESSAGE, { interviewId: args.interviewId, eventId: json.id });
      } else {
        logger.info('Created Microsoft Calendar event', { interviewId: args.interviewId, eventId: json.id });
      }
      return { eventId: json.id, meetLink };
    } catch (err) {
      logger.error('Microsoft Calendar event creation threw', { err: (err as Error).message, interviewId: args.interviewId });
      return null;
    }
  }

  async updateEvent(args: CalendarEventUpdateInput): Promise<boolean> {
    const resolved = await resolveCredentials(args.sectorId ?? null);
    if (!resolved) return false;
    const { token } = await resolveAccessToken(resolved.config);
    if (!token) return false;

    try {
      const event = await buildEvent(args.interviewId, false);
      if (!event) return false;
      const res = await fetch(`${GRAPH_API}/me/events/${encodeURIComponent(args.eventId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      if (!res.ok) {
        logger.error('Microsoft Calendar update failed', { status: res.status, interviewId: args.interviewId });
        return false;
      }
      await prisma.integration.update({ where: { id: resolved.integrationId }, data: { lastSyncAt: new Date() } });
      logger.info('Updated Microsoft Calendar event', { interviewId: args.interviewId, eventId: args.eventId });
      return true;
    } catch (err) {
      logger.error('Microsoft Calendar event update threw', { err: (err as Error).message, interviewId: args.interviewId });
      return false;
    }
  }

  async deleteEvent(args: CalendarEventDeleteInput): Promise<boolean> {
    const resolved = await resolveCredentials(args.sectorId ?? null);
    if (!resolved) return false;
    const { token } = await resolveAccessToken(resolved.config);
    if (!token) return false;
    try {
      const res = await fetch(`${GRAPH_API}/me/events/${encodeURIComponent(args.eventId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      // 404 = already deleted; treat as success (Graph's analog to Google's 410).
      if (!res.ok && res.status !== 404) {
        logger.error('Microsoft Calendar delete failed', { status: res.status, eventId: args.eventId });
        return false;
      }
      return true;
    } catch (err) {
      logger.error('Microsoft Calendar event delete threw', { err: (err as Error).message, eventId: args.eventId });
      return false;
    }
  }

  async generateMeetLink(interviewId: string, sectorId: string | null = null): Promise<{ meetingLink: string }> {
    const iv = await prisma.interview.findUnique({
      where: { id: interviewId },
      select: { schedule: { select: { id: true, meetingLink: true, calendarEventId: true } } },
    });
    if (!iv?.schedule) throw new BadRequestError('This interview has no schedule to attach a Teams link to.');

    if (iv.schedule.meetingLink) return { meetingLink: iv.schedule.meetingLink };

    const resolved = await resolveCredentials(sectorId);
    if (!resolved) {
      throw new BadRequestError(
        'Microsoft Calendar is not connected. Configure it in Admin Console → System Configuration → Integrations to generate Teams links.',
      );
    }
    const { token, error: tokenError } = await resolveAccessToken(resolved.config);
    if (!token) {
      throw new BadRequestError(
        tokenError || 'Could not authenticate with Microsoft. Re-check the refresh token in the Integration settings.',
      );
    }

    const event = await buildEvent(interviewId, true);
    if (!event) throw new BadRequestError('Could not build the calendar event for this interview.');

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const url = iv.schedule.calendarEventId
      ? `${GRAPH_API}/me/events/${encodeURIComponent(iv.schedule.calendarEventId)}`
      : `${GRAPH_API}/me/events`;
    const method = iv.schedule.calendarEventId ? 'PATCH' : 'POST';

    let json: GraphEventResponse;
    try {
      const res = await fetch(url, { method, headers, body: JSON.stringify(event) });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new BadRequestError(body?.error?.message || `Microsoft Graph request failed (HTTP ${res.status}).`);
      }
      json = (await res.json()) as GraphEventResponse;
    } catch (err) {
      if (err instanceof BadRequestError) throw err;
      throw new BadRequestError(`Could not reach Microsoft Graph: ${(err as Error).message}`);
    }

    const meetLink = extractMeetLink(json);
    if (!meetLink) {
      // Distinct from every other failure branch above: the event WAS
      // created (json.id is real), so this is not a credentials or
      // connectivity problem — it's Microsoft's known Teams-link reliability
      // issue. Different troubleshooting, different message.
      throw new BadRequestError(TEAMS_LINK_MISSING_MESSAGE);
    }

    await prisma.interviewSchedule.update({
      where: { id: iv.schedule.id },
      data: { meetingLink: meetLink, ...(json.id ? { calendarEventId: json.id } : {}) },
    });
    await prisma.integration.update({ where: { id: resolved.integrationId }, data: { lastSyncAt: new Date() } });
    logger.info('Generated Microsoft Teams link', { interviewId });
    return { meetingLink: meetLink };
  }

  async syncPending(sectorId: string | null = null): Promise<{ message: string }> {
    const resolved = await resolveCredentials(sectorId);
    if (!resolved) {
      throw new BadRequestError(
        'Microsoft Calendar is not connected. Configure it in Admin Console → System Configuration → Integrations to enable sync.',
      );
    }
    const { token, error: tokenError } = await resolveAccessToken(resolved.config);
    if (!token) {
      throw new BadRequestError(
        tokenError || 'Could not authenticate with Microsoft. Re-check the refresh token in the Integration settings.',
      );
    }

    const pending = await prisma.interview.findMany({
      where: {
        deletedAt: null,
        status: 'SCHEDULED',
        scheduleId: { not: null },
        // meetingProvider filter mirrors the one added to calendarService.ts's
        // syncToCalendar for the same reason — without it, this would also
        // claim pending GOOGLE_MEET schedules, racing Google's sync for the
        // same rows.
        schedule: { calendarEventId: null, scheduledDate: { gte: new Date() }, meetingProvider: 'MS_TEAMS' },
        ...(sectorId ? { candidate: { sectorId } } : {}),
      },
      select: { id: true, scheduleId: true },
      take: 50,
    });

    let synced = 0;
    for (const iv of pending) {
      const result = await this.createEvent({ interviewId: iv.id, sectorId });
      if (result && iv.scheduleId) {
        await prisma.interviewSchedule.update({
          where: { id: iv.scheduleId },
          data: {
            calendarEventId: result.eventId,
            ...(result.meetLink ? { meetingLink: result.meetLink } : {}),
          },
        });
        synced += 1;
      }
    }

    return {
      message:
        pending.length === 0
          ? 'All upcoming interviews are already on the calendar.'
          : `Synced ${synced} of ${pending.length} upcoming interview(s) to Microsoft Calendar.`,
    };
  }

  async testConnection(sectorId: string | null = null): Promise<CalendarTestResult> {
    const resolved = await resolveCredentials(sectorId);
    if (!resolved) {
      return { configured: false, ok: false, source: null, error: 'No usable Microsoft Calendar credentials are configured.' };
    }
    const { token, error: tokenError } = await resolveAccessToken(resolved.config);
    if (!token) {
      return {
        configured: true,
        ok: false,
        source: 'integration',
        error: tokenError || 'Could not obtain an access token. Check the refresh token in the Integration settings.',
      };
    }
    try {
      const res = await fetch(`${GRAPH_API}/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        return { configured: true, ok: false, source: 'integration', error: body?.error?.message || `Graph API returned ${res.status}.` };
      }
      const json = (await res.json()) as { userPrincipalName?: string; mail?: string };
      return { configured: true, ok: true, source: 'integration', calendar: json.mail || json.userPrincipalName || 'primary' };
    } catch (err) {
      return { configured: true, ok: false, source: 'integration', error: (err as Error).message };
    }
  }
}
