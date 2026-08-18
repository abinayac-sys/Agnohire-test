import {
  isCalendarConfigured,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  generateMeetForInterview,
  syncToCalendar,
  testCalendarConnection,
} from '../../../services/calendarService.js';
import type { CalendarProvider } from '../calendarProvider.js';

/**
 * Adapts calendarService.ts's existing Google Calendar functions to the
 * CalendarProvider interface. No logic is duplicated or modified here —
 * buildEvent(), resolveCalendar(), and the System Config → legacy Integration
 * fallback all stay private to calendarService.ts exactly as before.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  isConfigured = isCalendarConfigured;
  createEvent = createCalendarEvent;
  updateEvent = updateCalendarEvent;
  deleteEvent = deleteCalendarEvent;
  generateMeetLink = generateMeetForInterview;
  syncPending = syncToCalendar;
  testConnection = testCalendarConnection;
}
