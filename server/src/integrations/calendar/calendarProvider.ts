import type {
  CalendarEventInput,
  CalendarEventUpdateInput,
  CalendarEventDeleteInput,
  CalendarSyncResult,
  CalendarTestResult,
} from './types/calendar.types.js';

/**
 * Provider-neutral calendar integration surface. Google is the only
 * implementation today (see google/googleCalendarProvider.ts); the interface
 * exists so a future provider can be added without touching call sites.
 */
export interface CalendarProvider {
  isConfigured(sectorId?: string | null): Promise<boolean>;
  createEvent(input: CalendarEventInput): Promise<CalendarSyncResult | null>;
  updateEvent(input: CalendarEventUpdateInput): Promise<boolean>;
  deleteEvent(input: CalendarEventDeleteInput): Promise<boolean>;
  generateMeetLink(interviewId: string, sectorId?: string | null): Promise<{ meetingLink: string }>;
  syncPending(sectorId?: string | null): Promise<{ message: string }>;
  testConnection(sectorId?: string | null): Promise<CalendarTestResult>;
}
