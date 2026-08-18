import type { InterviewStatus, InterviewType, PanelMemberStatus } from '../constants/enums.js';

export interface InterviewerRef {
  id: string;
  fullName: string;
  email: string;
  status: PanelMemberStatus;
}

export interface ScheduleListItem {
  /** Interview id (the schedule is 1:1 with its interview). */
  id: string;
  scheduleId: string;
  status: InterviewStatus;
  type: InterviewType;
  scheduledDate: string;
  duration: number;
  timezone: string;
  meetingLink: string | null;
  reminderSent: boolean;
  candidate: { id: string; fullName: string; email: string };
  interviewers: InterviewerRef[];
  createdAt: string;
  finalDecision: string | null;
  jobRequisition?: { id: string; title: string } | null;
}

export interface ScheduleDetail extends ScheduleListItem {
  instructions: string | null;
  calendarEventId: string | null;
  recruiter: { id: string; fullName: string } | null;
}

export interface AvailabilitySlot {
  /** ISO start/end of the slot. */
  start: string;
  end: string;
  available: boolean;
}

export interface AvailabilityResponse {
  date: string;
  duration: number;
  /** Whether the requested date is a configured working day. */
  workingDay: boolean;
  slots: AvailabilitySlot[];
}
