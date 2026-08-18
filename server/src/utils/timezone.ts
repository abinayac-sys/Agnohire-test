/**
 * IANA timezone helpers built on Intl.DateTimeFormat — no external library.
 * Used by the slot engine so working hours are interpreted in the recruiter's
 * selected timezone (DST-aware) rather than always in UTC.
 */

/** (wall-clock-in-tz − UTC) in milliseconds for the given instant. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - instant.getTime();
}

/**
 * Convert a wall-clock time (a calendar date + minute-of-day) in `timeZone` to
 * the corresponding UTC instant. Refines once so DST transition boundaries land
 * on the correct side. Falls back to treating the time as UTC for an invalid tz.
 */
export function zonedWallClockToUtc(dateYmd: string, minutesOfDay: number, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  if (!m) return new Date(NaN);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  try {
    const offset = tzOffsetMs(new Date(guess), timeZone);
    let utc = guess - offset;
    const offset2 = tzOffsetMs(new Date(utc), timeZone);
    if (offset2 !== offset) utc = guess - offset2;
    return new Date(utc);
  } catch {
    // Invalid timezone → treat the wall clock as UTC (legacy behaviour).
    return new Date(guess);
  }
}

/** Local calendar parts of a UTC instant as seen in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): { weekday: number; minutesOfDay: number } {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
    const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      weekday: weekdays[parts.weekday] ?? instant.getUTCDay(),
      minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
    };
  } catch {
    return { weekday: instant.getUTCDay(), minutesOfDay: instant.getUTCHours() * 60 + instant.getUTCMinutes() };
  }
}

/** Day-of-week (0=Sun) for a YYYY-MM-DD calendar date — independent of timezone. */
export function calendarWeekday(dateYmd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  if (!m) return -1;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}
