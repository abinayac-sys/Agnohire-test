/** In-app notification type discriminators. */
export const NOTIFICATION_TYPE = {
  PANEL_ASSIGNED: 'PANEL_ASSIGNED',
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  OFFER_DECLINED: 'OFFER_DECLINED',
  PIPELINE_MOVED: 'PIPELINE_MOVED',
  INTERVIEW_COMPLETED: 'INTERVIEW_COMPLETED',
  INTERVIEW_EVALUATED: 'INTERVIEW_EVALUATED',
  REFERRAL_CREATED: 'REFERRAL_CREATED',
  GENERIC: 'GENERIC',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE];

/** Socket.IO event names shared between server and client. */
export const SOCKET_EVENTS = {
  NOTIFICATION_NEW: 'notification:new',
  TENANT_NOTIFICATION_NEW: 'tenant_notification:new',
  PIPELINE_MOVED: 'pipeline:moved',
  PIPELINE_SUBSCRIBE: 'pipeline:subscribe',
  PIPELINE_UNSUBSCRIBE: 'pipeline:unsubscribe',
  THEME_UPDATED: 'theme:updated',
  INTERVIEW_UPDATED: 'interview:updated',
} as const;
