import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { BadRequestError } from '../utils/errors.js';
import { configService } from './configService.js';
import { getEnabledIntegrationConfig } from './integrationService.js';
import { CONFIG_KEYS } from '@agnohire/shared';

/**
 * Google Calendar integration. Activates once OAuth credentials are configured.
 * Two configuration sources, checked in order:
 *   1. System Config (Admin Console → System Configuration → Integrations) — the
 *      `integrations.google_*` keys, managed exactly like the AI provider.
 *   2. An enabled `GOOGLE_CALENDAR` Integration row (legacy path), kept for
 *      backward compatibility.
 * The config stores either a long-lived `accessToken`, or a `refreshToken` plus
 * `clientId`/`clientSecret` which we exchange for an access token. With no
 * credentials the calls degrade gracefully — scheduling still succeeds and
 * `calendarEventId` stays null.
 */

const CALENDAR_TYPES = ['GOOGLE_CALENDAR', 'GOOGLE', 'CALENDAR'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

interface GoogleConfig {
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  /** Target calendar; defaults to the authenticated user's primary calendar. */
  calendarId?: string;
}

/** Whether a credential set is usable (a token, or a full refresh-token triplet). */
function hasUsableCreds(c: GoogleConfig): boolean {
  return Boolean(c.accessToken || (c.refreshToken && c.clientId && c.clientSecret));
}

/**
 * The active calendar configuration plus the metadata callers need: whether
 * Google Meet auto-linking is on, and the Integration row id (if the credentials
 * came from the legacy Integration table) so we can stamp its `lastSyncAt`.
 */
interface ResolvedCalendar {
  config: GoogleConfig;
  meetEnabled: boolean;
  integrationId: string | null;
}

/**
 * Resolve usable calendar credentials, preferring System Config over the legacy
 * Integration row. Returns null when nothing is configured/usable.
 */
async function resolveCalendar(sectorId: string | null = null): Promise<ResolvedCalendar | null> {
  // 1) System Config keys (the canonical, UI-managed source).
  const enabled = await configService.getBool(CONFIG_KEYS.GOOGLE_CALENDAR_ENABLED, false, sectorId);
  if (enabled) {
    const config: GoogleConfig = {
      clientId: (await configService.getString(CONFIG_KEYS.GOOGLE_CLIENT_ID, '', sectorId)) || undefined,
      clientSecret: (await configService.getString(CONFIG_KEYS.GOOGLE_CLIENT_SECRET, '', sectorId)) || undefined,
      refreshToken: (await configService.getString(CONFIG_KEYS.GOOGLE_REFRESH_TOKEN, '', sectorId)) || undefined,
      accessToken: (await configService.getString(CONFIG_KEYS.GOOGLE_ACCESS_TOKEN, '', sectorId)) || undefined,
      calendarId: (await configService.getString(CONFIG_KEYS.GOOGLE_CALENDAR_ID, 'primary', sectorId)) || 'primary',
    };
    if (hasUsableCreds(config)) {
      const meetEnabled = await configService.getBool(CONFIG_KEYS.GOOGLE_MEET_ENABLED, true, sectorId);
      return { config, meetEnabled, integrationId: null };
    }
  }

  // 2) Legacy Integration row.
  const integration = await getEnabledIntegrationConfig(CALENDAR_TYPES, sectorId);
  if (integration) {
    const config = integration.config as GoogleConfig;
    if (hasUsableCreds(config)) {
      const meetEnabled = await configService.getBool(CONFIG_KEYS.GOOGLE_MEET_ENABLED, true, sectorId);
      return { config, meetEnabled, integrationId: integration.id };
    }
  }

  return null;
}

export async function isCalendarConfigured(sectorId: string | null = null): Promise<boolean> {
  return (await resolveCalendar(sectorId)) !== null;
}

/**
 * Exchange the stored refresh token for an access token, capturing the precise
 * error Google returns (e.g. `invalid_client`, `invalid_grant`) so the UI can
 * tell the admin exactly what's wrong instead of failing silently.
 */
async function exchangeAccessToken(config: GoogleConfig): Promise<{ token: string | null; error?: string }> {
  if (config.refreshToken && config.clientId && config.clientSecret) {
    try {
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      });
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) {
        // Google returns { error, error_description } on a failed grant.
        const j = (await res.json().catch(() => null)) as { error?: string; error_description?: string } | null;
        const detail = j?.error_description || j?.error || `HTTP ${res.status}`;
        logger.error('Google token exchange failed', { status: res.status, detail });
        return { token: config.accessToken ?? null, error: `Google rejected the credentials: ${detail}` };
      }
      const json = (await res.json()) as { access_token?: string };
      return { token: json.access_token ?? config.accessToken ?? null };
    } catch (err) {
      const message = (err as Error).message;
      logger.error('Google token exchange threw', { err: message });
      return { token: config.accessToken ?? null, error: `Token request failed: ${message}` };
    }
  }
  // No refresh-token triplet — fall back to a long-lived access token if present.
  return {
    token: config.accessToken ?? null,
    error: config.accessToken ? undefined : 'No refresh token (with client ID/secret) or access token is configured.',
  };
}

/** Resolve a usable OAuth access token from the stored credentials. */
async function resolveAccessToken(config: GoogleConfig): Promise<string | null> {
  return (await exchangeAccessToken(config)).token;
}

interface CalendarEventPayload {
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees: { email: string }[];
  conferenceData?: { createRequest: { requestId: string; conferenceSolutionKey: { type: string } } };
}

/**
 * Build the Google Calendar event payload from an interview + its schedule.
 * Attendees = candidate + recruiter + every selected interviewer (so all get a
 * calendar invite). When the schedule has no meeting link yet, a Google Meet
 * conference is requested so Google mints one on insert.
 */
async function buildEvent(interviewId: string, requestMeet = false): Promise<CalendarEventPayload | null> {
  const iv = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: {
      type: true,
      recruiterId: true,
      schedule: { select: { scheduledDate: true, duration: true, timezone: true, instructions: true, meetingLink: true, meetingProvider: true } },
      candidate: { select: { fullName: true, email: true } },
      panelMembers: { select: { user: { select: { email: true } } } },
    },
  });
  if (!iv?.schedule) return null;

  // Interview has no recruiter relation — resolve the email from the user row.
  const recruiter = await prisma.user.findUnique({
    where: { id: iv.recruiterId },
    select: { email: true },
  });

  const start = iv.schedule.scheduledDate;
  const end = new Date(start.getTime() + (iv.schedule.duration ?? 30) * 60_000);
  // Candidate + recruiter + interviewers, de-duplicated.
  const emails = new Set(
    [iv.candidate?.email, recruiter?.email, ...iv.panelMembers.map((p) => p.user.email)].filter(
      (e): e is string => Boolean(e),
    ),
  );
  const attendees = [...emails].map((email) => ({ email }));

  const payload: CalendarEventPayload = {
    summary: `${iv.type} Interview — ${iv.candidate?.fullName ?? 'Candidate'}`,
    description: iv.schedule.instructions ?? 'Scheduled via AgnoHire.',
    location: iv.schedule.meetingLink ?? undefined,
    start: { dateTime: start.toISOString(), timeZone: iv.schedule.timezone || 'UTC' },
    end: { dateTime: end.toISOString(), timeZone: iv.schedule.timezone || 'UTC' },
    attendees,
  };
  // Ask Google to create a Meet link when none was set manually.
  if (requestMeet && !iv.schedule.meetingLink) {
    payload.conferenceData = {
      createRequest: { requestId: `agnohire-${interviewId}-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    };
  }
  return payload;
}

/** Extract the Meet link from a Google Calendar event response. */
function extractMeetLink(json: { hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } }): string | null {
  if (json.hangoutLink) return json.hangoutLink;
  const video = json.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
  return video?.uri ?? null;
}

/**
 * Creates a Google Calendar event for the interview. Returns the event id when
 * connected and the insert succeeds, else null (caller keeps the manual meeting
 * link). Never throws — scheduling must succeed even when calendar sync fails.
 */
export interface CalendarSyncResult {
  eventId: string;
  /** A Google Meet link minted by the Calendar API, if one was generated. */
  meetLink: string | null;
}

export async function createCalendarEvent(args: {
  interviewId: string;
  sectorId?: string | null;
}): Promise<CalendarSyncResult | null> {
  const resolved = await resolveCalendar(args.sectorId ?? null);
  if (!resolved) {
    logger.debug('Calendar not connected — skipping event creation', { interviewId: args.interviewId });
    return null;
  }
  const { config, meetEnabled, integrationId } = resolved;
  const token = await resolveAccessToken(config);
  if (!token) {
    logger.warn('Calendar enabled but no usable credential', { interviewId: args.interviewId });
    return null;
  }

  try {
    const event = await buildEvent(args.interviewId, meetEnabled);
    if (!event) return null;
    const calendarId = encodeURIComponent(config.calendarId || 'primary');
    // conferenceDataVersion=1 is required for Google to honour the Meet request.
    const res = await fetch(`${CALENDAR_API}/calendars/${calendarId}/events?sendUpdates=all&conferenceDataVersion=1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      logger.error('Google Calendar insert failed', { status: res.status, interviewId: args.interviewId });
      return null;
    }
    const json = (await res.json()) as { id?: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } };
    if (integrationId) await prisma.integration.update({ where: { id: integrationId }, data: { lastSyncAt: new Date() } });
    logger.info('Created Google Calendar event', { interviewId: args.interviewId, eventId: json.id });
    if (!json.id) return null;
    return { eventId: json.id, meetLink: extractMeetLink(json) };
  } catch (err) {
    logger.error('Calendar event creation threw', { err: (err as Error).message, interviewId: args.interviewId });
    return null;
  }
}

/**
 * Updates the existing Google Calendar event after a reschedule (new time, date,
 * or interviewers). Re-sends invites to all attendees. No-op (returns false)
 * when calendar isn't connected or there's no stored event id.
 */
export async function updateCalendarEvent(args: {
  interviewId: string;
  eventId: string;
  sectorId?: string | null;
}): Promise<boolean> {
  const resolved = await resolveCalendar(args.sectorId ?? null);
  if (!resolved) return false;
  const token = await resolveAccessToken(resolved.config);
  if (!token) return false;

  try {
    const event = await buildEvent(args.interviewId, false);
    if (!event) return false;
    const calendarId = encodeURIComponent(resolved.config.calendarId || 'primary');
    const res = await fetch(
      `${CALENDAR_API}/calendars/${calendarId}/events/${encodeURIComponent(args.eventId)}?sendUpdates=all`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      },
    );
    if (!res.ok) {
      logger.error('Google Calendar update failed', { status: res.status, interviewId: args.interviewId });
      return false;
    }
    if (resolved.integrationId) await prisma.integration.update({ where: { id: resolved.integrationId }, data: { lastSyncAt: new Date() } });
    logger.info('Updated Google Calendar event', { interviewId: args.interviewId, eventId: args.eventId });
    return true;
  } catch (err) {
    logger.error('Calendar event update threw', { err: (err as Error).message, interviewId: args.interviewId });
    return false;
  }
}

/** Cancels (deletes) the Google Calendar event, notifying attendees. */
export async function deleteCalendarEvent(args: {
  eventId: string;
  sectorId?: string | null;
}): Promise<boolean> {
  const resolved = await resolveCalendar(args.sectorId ?? null);
  if (!resolved) return false;
  const token = await resolveAccessToken(resolved.config);
  if (!token) return false;
  try {
    const calendarId = encodeURIComponent(resolved.config.calendarId || 'primary');
    const res = await fetch(
      `${CALENDAR_API}/calendars/${calendarId}/events/${encodeURIComponent(args.eventId)}?sendUpdates=all`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );
    // 410 = already deleted; treat as success.
    if (!res.ok && res.status !== 410) {
      logger.error('Google Calendar delete failed', { status: res.status, eventId: args.eventId });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('Calendar event delete threw', { err: (err as Error).message, eventId: args.eventId });
    return false;
  }
}

/**
 * On-demand "Generate Meet link" for a single interview. Mints a Google Meet
 * link via the Calendar API (the only way to get one) and stores it on the
 * schedule. Reuses an existing calendar event when present (patching it to add
 * the conference), otherwise creates one. Idempotent: returns the existing link
 * if the schedule already has a meeting link. Throws a BadRequestError with the
 * precise reason (not connected / bad credentials / Meet unavailable) so the UI
 * can tell the user exactly what to fix — never returns a silent failure.
 */
export async function generateMeetForInterview(
  interviewId: string,
  sectorId: string | null = null,
): Promise<{ meetingLink: string }> {
  const iv = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: { schedule: { select: { id: true, meetingLink: true, calendarEventId: true } } },
  });
  if (!iv?.schedule) throw new BadRequestError('This interview has no schedule to attach a Meet link to.');

  // Already has a link — nothing to mint.
  if (iv.schedule.meetingLink) return { meetingLink: iv.schedule.meetingLink };

  const resolved = await resolveCalendar(sectorId);
  if (!resolved) {
    throw new BadRequestError(
      'Google Calendar is not connected. Configure it in Admin Console → System Configuration → Integrations to generate Meet links.',
    );
  }
  const { token, error: tokenError } = await exchangeAccessToken(resolved.config);
  if (!token) {
    throw new BadRequestError(
      tokenError ||
        'Could not authenticate with Google. Re-check the client ID/secret and refresh token in System Configuration → Integrations.',
    );
  }

  // Force the Meet request regardless of the global auto-Meet toggle — this is an
  // explicit user action asking for a link.
  const event = await buildEvent(interviewId, true);
  if (!event) throw new BadRequestError('Could not build the calendar event for this interview.');

  const calendarId = encodeURIComponent(resolved.config.calendarId || 'primary');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  // conferenceDataVersion=1 is required for Google to honour the Meet request.
  const url = iv.schedule.calendarEventId
    ? `${CALENDAR_API}/calendars/${calendarId}/events/${encodeURIComponent(iv.schedule.calendarEventId)}?sendUpdates=all&conferenceDataVersion=1`
    : `${CALENDAR_API}/calendars/${calendarId}/events?sendUpdates=all&conferenceDataVersion=1`;
  const method = iv.schedule.calendarEventId ? 'PATCH' : 'POST';

  let json: { id?: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } };
  try {
    const res = await fetch(url, { method, headers, body: JSON.stringify(event) });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new BadRequestError(body?.error?.message || `Google Calendar request failed (HTTP ${res.status}).`);
    }
    json = (await res.json()) as typeof json;
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    throw new BadRequestError(`Could not reach Google Calendar: ${(err as Error).message}`);
  }

  const meetLink = extractMeetLink(json);
  if (!meetLink) {
    throw new BadRequestError(
      'Google created the event but returned no Meet link. The connected account may not have Google Meet enabled.',
    );
  }

  await prisma.interviewSchedule.update({
    where: { id: iv.schedule.id },
    data: { meetingLink: meetLink, ...(json.id ? { calendarEventId: json.id } : {}) },
  });
  if (resolved.integrationId) {
    await prisma.integration.update({ where: { id: resolved.integrationId }, data: { lastSyncAt: new Date() } });
  }
  logger.info('Generated Google Meet link', { interviewId });
  return { meetingLink: meetLink };
}

/**
 * Explicit "sync to calendar" action from the UI — back-fills calendar events
 * for the sector's scheduled interviews that don't yet have one. 400s with a
 * helpful message until the integration is connected.
 */
export async function syncToCalendar(sectorId: string | null = null): Promise<{ message: string }> {
  const resolved = await resolveCalendar(sectorId);
  if (!resolved) {
    throw new BadRequestError(
      'Google Calendar is not connected. Configure it in Admin Console → System Configuration → Integrations to enable sync.',
    );
  }

  // Verify the credentials actually work before looping — otherwise a 401 from
  // Google would silently report "Synced 0" with no reason. Surface the precise
  // Google error (invalid_client / invalid_grant / expired refresh token) so the
  // admin knows exactly what to fix.
  const { token, error: tokenError } = await exchangeAccessToken(resolved.config);
  if (!token) {
    throw new BadRequestError(
      tokenError ||
        'Could not authenticate with Google. Re-check the client ID/secret and refresh token in System Configuration → Integrations.',
    );
  }

  // Find upcoming scheduled interviews in scope still missing a calendar event.
  const pending = await prisma.interview.findMany({
    where: {
      deletedAt: null,
      status: 'SCHEDULED',
      scheduleId: { not: null },
      // meetingProvider filter added for the multi-provider wiring phase —
      // without it, this Google sync would also claim pending schedules
      // tagged MS_TEAMS, racing MicrosoftCalendarProvider.syncPending()'s
      // identical query for the same rows.
      schedule: { calendarEventId: null, scheduledDate: { gte: new Date() }, meetingProvider: 'GOOGLE_MEET' },
      ...(sectorId ? { candidate: { sectorId } } : {}),
    },
    select: { id: true, scheduleId: true },
    take: 50,
  });

  let synced = 0;
  for (const iv of pending) {
    const result = await createCalendarEvent({ interviewId: iv.id, sectorId });
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
        : `Synced ${synced} of ${pending.length} upcoming interview(s) to Google Calendar.`,
  };
}

/**
 * Verify the configured Google Calendar credentials by exchanging for an access
 * token and reading the target calendar. Mirrors the SMTP "test" action so an
 * admin can confirm the System Config values work without scheduling a real
 * interview. Never throws — returns a structured result for the UI.
 */
export interface CalendarTestResult {
  configured: boolean;
  ok: boolean;
  /** Where the active credentials came from: System Config or the legacy row. */
  source: 'system-config' | 'integration' | null;
  /** Resolved calendar summary on success (e.g. the account's primary calendar). */
  calendar?: string;
  error?: string;
}

export async function testCalendarConnection(sectorId: string | null = null): Promise<CalendarTestResult> {
  const resolved = await resolveCalendar(sectorId);
  if (!resolved) {
    return { configured: false, ok: false, source: null, error: 'No usable Google Calendar credentials are configured.' };
  }
  const source = resolved.integrationId ? 'integration' : 'system-config';
  const { token, error: tokenError } = await exchangeAccessToken(resolved.config);
  if (!token) {
    return {
      configured: true,
      ok: false,
      source,
      error: tokenError || 'Could not obtain an access token. Check the client ID/secret and refresh token.',
    };
  }
  try {
    const calendarId = encodeURIComponent(resolved.config.calendarId || 'primary');
    const res = await fetch(`${CALENDAR_API}/calendars/${calendarId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { configured: true, ok: false, source, error: body?.error?.message || `Calendar API returned ${res.status}.` };
    }
    const json = (await res.json()) as { summary?: string; id?: string };
    return { configured: true, ok: true, source, calendar: json.summary || json.id || resolved.config.calendarId || 'primary' };
  } catch (err) {
    return { configured: true, ok: false, source, error: (err as Error).message };
  }
}
