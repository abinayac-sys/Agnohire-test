import { prisma } from '../config/database.js';
import { runAsPlatform } from '../config/tenantContext.js';
import { logger } from '../config/logger.js';
import { sendMail } from './mailerService.js';
import { broadcastMaintenanceNotice } from '../config/socket.js';
import {
  dispatchMaintenanceReminder,
  dispatchMaintenanceGoLive,
  dispatchMaintenanceComplete,
  cancelMaintenanceJobs,
} from '../jobs/dispatch.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { ROLES, type CreateMaintenanceWindowInput, type MaintenanceWindowDto } from '@agnohire/shared';

/** How long before startAt candidates get their reminder email. */
export const CANDIDATE_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

const STAFF_RECIPIENT_ROLES = [ROLES.ADMIN, ROLES.HR, ROLES.RECRUITER, ROLES.HIRING_MANAGER, ROLES.PANEL_MEMBER, ROLES.TENANT_OWNER];

function toDto(w: {
  id: string;
  title: string;
  message: string;
  startAt: Date;
  endAt: Date;
  status: string;
  createdAt: Date;
}): MaintenanceWindowDto {
  return {
    id: w.id,
    title: w.title,
    message: w.message,
    startAt: w.startAt.toISOString(),
    endAt: w.endAt.toISOString(),
    status: w.status as MaintenanceWindowDto['status'],
    createdAt: w.createdAt.toISOString(),
  };
}

function maintenanceEmailHtml(title: string, message: string, startAt: Date, endAt: Date): string {
  return `<h2>Scheduled maintenance: ${title}</h2><p>${message}</p><p><strong>Start:</strong> ${startAt.toLocaleString()}<br/><strong>End:</strong> ${endAt.toLocaleString()}</p>`;
}

/** Creates the window, emails staff immediately, and schedules the candidate reminder + live-window jobs. */
export async function createMaintenanceWindow(
  input: CreateMaintenanceWindowInput,
  createdById: string,
): Promise<MaintenanceWindowDto> {
  const window = await runAsPlatform(() =>
    prisma.maintenanceWindow.create({
      data: {
        title: input.title,
        message: input.message,
        startAt: input.startAt,
        endAt: input.endAt,
        createdById,
      },
    }),
  );

  void notifyStaff(window.id, window.title, window.message, window.startAt, window.endAt).catch((err) =>
    logger.error('Maintenance staff notification failed', { windowId: window.id, err: (err as Error).message }),
  );

  const reminderAt = new Date(window.startAt.getTime() - CANDIDATE_REMINDER_LEAD_MS);
  await Promise.all([
    dispatchMaintenanceReminder(window.id, reminderAt > new Date() ? reminderAt : new Date()),
    dispatchMaintenanceGoLive(window.id, window.startAt),
    dispatchMaintenanceComplete(window.id, window.endAt),
  ]);

  return toDto(window);
}

/** Emails every non-candidate, non-superadmin staff user about a newly scheduled window. */
async function notifyStaff(windowId: string, title: string, message: string, startAt: Date, endAt: Date): Promise<void> {
  const staff = await runAsPlatform(() =>
    prisma.user.findMany({
      where: { isActive: true, deletedAt: null, role: { name: { in: STAFF_RECIPIENT_ROLES } } },
      select: { email: true },
    }),
  );
  const html = maintenanceEmailHtml(title, message, startAt, endAt);
  await Promise.all(
    staff.map((u) =>
      sendMail({
        to: u.email,
        subject: `Scheduled maintenance: ${title}`,
        html,
        templateId: 'maintenance-notice',
        entityType: 'MaintenanceWindow',
        entityId: windowId,
      }),
    ),
  );
}

/** Emails the candidate-reminder lead time before startAt. Called by the Bull worker. */
export async function sendCandidateReminders(windowId: string): Promise<void> {
  const window = await runAsPlatform(() => prisma.maintenanceWindow.findUnique({ where: { id: windowId } }));
  if (!window || window.status === 'CANCELLED') return;

  const candidates = await runAsPlatform(() =>
    prisma.user.findMany({
      where: { isActive: true, deletedAt: null, role: { name: ROLES.CANDIDATE } },
      select: { email: true },
    }),
  );
  const html = maintenanceEmailHtml(window.title, window.message, window.startAt, window.endAt);
  await Promise.all(
    candidates.map((u) =>
      sendMail({
        to: u.email,
        subject: `Upcoming maintenance: ${window.title}`,
        html,
        templateId: 'maintenance-reminder',
        entityType: 'MaintenanceWindow',
        entityId: windowId,
      }),
    ),
  );
  await runAsPlatform(() => prisma.maintenanceWindow.update({ where: { id: windowId }, data: { status: 'NOTIFIED' } }));
}

/** Flips the window active and broadcasts the live pop-up warning. Called by the Bull worker at startAt. */
export async function activateMaintenanceWindow(windowId: string): Promise<void> {
  const window = await runAsPlatform(() => prisma.maintenanceWindow.findUnique({ where: { id: windowId } }));
  if (!window || window.status === 'CANCELLED') return;
  await runAsPlatform(() => prisma.maintenanceWindow.update({ where: { id: windowId }, data: { status: 'ACTIVE' } }));
  broadcastMaintenanceNotice({
    id: window.id,
    title: window.title,
    message: window.message,
    startAt: window.startAt.toISOString(),
    endAt: window.endAt.toISOString(),
    phase: 'active',
  });
}

/** Flips the window completed. Called by the Bull worker at endAt. */
export async function completeMaintenanceWindow(windowId: string): Promise<void> {
  await runAsPlatform(() =>
    prisma.maintenanceWindow.updateMany({ where: { id: windowId, status: { not: 'CANCELLED' } }, data: { status: 'COMPLETED' } }),
  );
}

export async function listMaintenanceWindows(): Promise<MaintenanceWindowDto[]> {
  const windows = await runAsPlatform(() => prisma.maintenanceWindow.findMany({ orderBy: { startAt: 'desc' } }));
  return windows.map(toDto);
}

export async function cancelMaintenanceWindow(id: string): Promise<void> {
  const window = await runAsPlatform(() => prisma.maintenanceWindow.findUnique({ where: { id } }));
  if (!window) throw new NotFoundError('Maintenance window not found');
  if (window.status === 'COMPLETED' || window.status === 'CANCELLED') {
    throw new BadRequestError('This maintenance window can no longer be cancelled');
  }
  await cancelMaintenanceJobs(id);
  await runAsPlatform(() => prisma.maintenanceWindow.update({ where: { id }, data: { status: 'CANCELLED' } }));
}

/**
 * The currently live window, if any. Used by the auth gate to block
 * non-superadmin access for the duration of the maintenance — SCHEDULED /
 * NOTIFIED windows are informational only and must not block anyone yet.
 */
export async function getActiveMaintenanceWindow(): Promise<MaintenanceWindowDto | null> {
  const window = await runAsPlatform(() =>
    prisma.maintenanceWindow.findFirst({ where: { status: 'ACTIVE' }, orderBy: { startAt: 'desc' } }),
  );
  return window ? toDto(window) : null;
}

/** The currently active or soonest-upcoming window, for client hydration on load. */
export async function getActiveOrUpcomingMaintenance(): Promise<MaintenanceWindowDto | null> {
  const window = await runAsPlatform(() =>
    prisma.maintenanceWindow.findFirst({
      where: { status: { in: ['SCHEDULED', 'NOTIFIED', 'ACTIVE'] }, endAt: { gt: new Date() } },
      orderBy: { startAt: 'asc' },
    }),
  );
  return window ? toDto(window) : null;
}
