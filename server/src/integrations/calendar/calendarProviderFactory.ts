import { GoogleCalendarProvider } from './google/googleCalendarProvider.js';
import { MicrosoftCalendarProvider } from './microsoft/microsoftCalendarProvider.js';
import type { CalendarProvider } from './calendarProvider.js';

/**
 * Routes to a provider based on the schedule's meetingProvider value —
 * chosen at schedule-creation time (createScheduleSchema), not derived from
 * which integrations are currently enabled. This makes routing deterministic
 * per schedule even if both Google and Microsoft are configured for the same
 * sector at once, and immune to a provider being enabled/disabled after the
 * schedule was created.
 */
export function getCalendarProvider(meetingProvider: string | null | undefined): CalendarProvider | null {
  switch (meetingProvider) {
    case 'GOOGLE_MEET':
      return new GoogleCalendarProvider();
    case 'MS_TEAMS':
      return new MicrosoftCalendarProvider();
    case 'ZOOM':
    case 'CUSTOM':
      // Explicit no-provider case: manual meetingLink only, no API call —
      // matches current behavior (no Zoom/Custom integration exists).
      return null;
    default:
      // Unrecognized/legacy value, including every pre-wiring row's column
      // default — matches current production behavior (Google-only).
      return new GoogleCalendarProvider();
  }
}
