/**
 * Schedule times are computed and stored in UTC (the slot engine uses UTC
 * working hours). These helpers render an ISO instant in UTC wall-clock so the
 * UI matches the "UTC" labels — `date-fns format()` would use the browser's
 * local timezone and silently shift the displayed time.
 */

/** "09:00" (UTC). */
export function formatUtcTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** "08 Jun 2026, 09:00" (UTC). */
export function formatUtcDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** "09:00" rendered in the given IANA timezone (falls back to UTC). */
export function formatTimeInZone(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      timeZone: timeZone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return formatUtcTime(iso);
  }
}

/** "08 Jun 2026, 09:00" rendered in the given IANA timezone (falls back to UTC). */
export function formatDateTimeInZone(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: timeZone || 'UTC',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return formatUtcDateTime(iso);
  }
}

/** "Mon 08 Jun 2026, 09:00" (UTC). */
export function formatUtcFull(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
