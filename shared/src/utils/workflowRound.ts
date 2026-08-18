/**
 * Round types that are conducted live by a person (HR / final discussion) and
 * therefore go through the Scheduling flow rather than an automated AI/online
 * interview — regardless of the round's display name.
 */
const SCHEDULE_ROUND_TYPES = [
  'schedule',
  'hr interview',
  'managerial interview',
  'final discussion',
  'panel interview',
  'client interview'
];

/**
 * True when a workflow round should be treated as a "schedule" round — i.e. it
 * routes to the scheduling page instead of generating an online interview link.
 *
 * A round qualifies if its type is one of the live-conversation round types
 * (HR Interview, Final Discussion, etc.), or if either the type or name explicitly
 * mentions "schedule".
 */
export function isScheduleRound(
  roundType: string | null | undefined,
  _roundName?: string | null | undefined,
): boolean {
  const type = (roundType ?? '').toLowerCase();
  
  if (type.includes('schedule')) return true;
  return SCHEDULE_ROUND_TYPES.some((t) => type.includes(t));
}
