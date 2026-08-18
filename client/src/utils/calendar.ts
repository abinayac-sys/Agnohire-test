/**
 * Credential-free calendar helpers: a prefilled Google Calendar event URL and
 * a downloadable .ics file. Both work without any OAuth/integration setup, so
 * "add to calendar" always functions; the server-side Google sync (Integrations)
 * remains the automated path once credentials are configured.
 */

export interface CalendarEvent {
  title: string;
  /** ISO start datetime (UTC). */
  start: string;
  durationMin: number;
  description?: string;
  location?: string;
}

function toCalStamp(iso: string): string {
  // 2026-06-12T10:30:00.000Z → 20260612T103000Z
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function endOf(ev: CalendarEvent): string {
  return new Date(new Date(ev.start).getTime() + ev.durationMin * 60_000).toISOString();
}

/** Prefilled "create event" URL — opens Google Calendar with the event ready to save. */
export function googleCalendarUrl(ev: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${toCalStamp(ev.start)}/${toCalStamp(endOf(ev))}`,
    ...(ev.description ? { details: ev.description } : {}),
    ...(ev.location ? { location: ev.location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Build and download an .ics file (works with Outlook, Apple, Google). */
export function downloadIcs(ev: CalendarEvent, fileName = 'interview.ics'): void {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AgnoHire//Interview Scheduler//EN',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@agnohire`,
    `DTSTAMP:${toCalStamp(new Date().toISOString())}`,
    `DTSTART:${toCalStamp(ev.start)}`,
    `DTEND:${toCalStamp(endOf(ev))}`,
    `SUMMARY:${icsEscape(ev.title)}`,
    ...(ev.description ? [`DESCRIPTION:${icsEscape(ev.description)}`] : []),
    ...(ev.location ? [`LOCATION:${icsEscape(ev.location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A valid Google Meet link (recruiter must be signed into Google to create the room). */
const GOOGLE_MEET_NEW = 'https://meet.google.com/new';

/**
 * Opens Google Meet's "new meeting" page in a new tab. Google mints a real,
 * joinable meet.google.com/xxx-xxxx-xxx room under the signed-in account; the
 * recruiter copies that URL back into the meeting-link field. (A credential-free
 * code can't be fabricated — Google rejects unknown meeting codes.)
 */
export function openNewGoogleMeet(): void {
  window.open(GOOGLE_MEET_NEW, '_blank', 'noopener');
}

/** True for a well-formed Google Meet room URL. */
export function isGoogleMeetUrl(url: string): boolean {
  return /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?.*)?$/i.test(url.trim());
}
