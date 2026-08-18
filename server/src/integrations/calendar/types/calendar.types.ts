/**
 * Provider-neutral calendar types. Mirrors the shapes already used by
 * calendarService.ts so this is a mechanical extraction, not a redesign.
 */

export interface CalendarEventInput {
  interviewId: string;
  sectorId?: string | null;
}

export interface CalendarEventUpdateInput extends CalendarEventInput {
  eventId: string;
}

export interface CalendarEventDeleteInput {
  eventId: string;
  sectorId?: string | null;
}

/** Mirrors calendarService.ts:CalendarSyncResult. */
export interface CalendarSyncResult {
  eventId: string;
  meetLink: string | null;
}

/** Mirrors calendarService.ts:CalendarTestResult. */
export interface CalendarTestResult {
  configured: boolean;
  ok: boolean;
  source: 'system-config' | 'integration' | null;
  calendar?: string;
  error?: string;
}
