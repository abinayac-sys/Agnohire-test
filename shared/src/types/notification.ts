import type { NotificationType } from '../constants/notifications.js';

export interface NotificationItem {
  id: string;
  type: NotificationType | string;
  title: string;
  message: string;
  /** Optional entity the notification points at (for deep-linking). */
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
}

/** Payload broadcast over Socket.IO when a pipeline application is moved. */
export interface PipelineMovedEvent {
  jobRequisitionId: string;
  applicationId: string;
  toStage: string;
  status: string;
}

/** Payload broadcast over Socket.IO whenever an interview's status changes. */
export interface InterviewUpdatedEvent {
  interviewId: string;
  status: string;
}
