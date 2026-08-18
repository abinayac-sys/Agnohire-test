/**
 * IANA timezone validation, shared between server (write-path validation)
 * and client (cosmetic pre-check before hitting the API). The server is the
 * authority — this only prevents obviously-bad values from reaching the DB.
 *
 * Deliberately NOT `Intl.supportedValuesOf('timeZone')`-based: that list is
 * only as complete as the runtime's bundled ICU data, and a small-icu Node
 * build enumerates legacy aliases (e.g. "Asia/Calcutta") instead of the
 * canonical names browsers report (e.g. "Asia/Kolkata") — even "UTC" itself
 * can be absent from the enumeration. Constructing an Intl.DateTimeFormat
 * with the zone is the portable check: it succeeds for any zone/alias the
 * runtime's ICU data actually recognizes, canonical or not.
 */
export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
