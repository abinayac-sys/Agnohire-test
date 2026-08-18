import { prisma } from '../config/database.js';
import { configService } from './configService.js';
import { BadRequestError } from '../utils/errors.js';
import { zonedWallClockToUtc, zonedParts, calendarWeekday } from '../utils/timezone.js';
import { CONFIG_KEYS, type AvailabilityResponse, type AvailabilitySlot } from '@agnohire/shared';

/**
 * Slot engine. Working hours are configured as wall-clock (HH:MM) in DB config
 * and interpreted in the recruiter's selected timezone — so picking
 * Asia/Kolkata offers 09:00–17:00 *IST* slots, not UTC. Open slots are derived
 * from working hours/days minus existing bookings for the given interviewers.
 */

interface BusyInterval {
  start: number;
  end: number;
}

function parseHHMM(value: string, fallbackMinutes: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return fallbackMinutes;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return fallbackMinutes;
  return h * 60 + min;
}

/** Busy intervals (ms epoch) for any of the interviewers on a given UTC day. */
async function busyIntervals(
  interviewerIds: string[],
  dayStart: Date,
  dayEnd: Date,
  excludeInterviewId?: string,
): Promise<BusyInterval[]> {
  const rows = await prisma.interview.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['CANCELLED', 'EXPIRED'] },
      ...(excludeInterviewId ? { id: { not: excludeInterviewId } } : {}),
      panelMembers: { some: { userId: { in: interviewerIds } } },
      schedule: { scheduledDate: { gte: dayStart, lt: dayEnd } },
    },
    select: { schedule: { select: { scheduledDate: true, duration: true } } },
  });
  return rows
    .filter((r) => r.schedule)
    .map((r) => {
      const start = r.schedule!.scheduledDate.getTime();
      return { start, end: start + r.schedule!.duration * 60_000 };
    });
}

export async function computeAvailability(
  interviewerIds: string[],
  date: string,
  duration: number,
  sectorId: string | null = null,
  excludeInterviewId?: string,
  timeZone = 'UTC',
): Promise<AvailabilityResponse> {
  const [startStr, endStr, daysStr, slotMin, bufferMin] = await Promise.all([
    configService.getString(CONFIG_KEYS.SCHEDULE_WORKING_HOURS_START, '09:00', sectorId),
    configService.getString(CONFIG_KEYS.SCHEDULE_WORKING_HOURS_END, '17:00', sectorId),
    configService.getString(CONFIG_KEYS.SCHEDULE_WORKING_DAYS, '1,2,3,4,5', sectorId),
    configService.getNumber(CONFIG_KEYS.SCHEDULE_SLOT_MINUTES, 30, sectorId),
    configService.getNumber(CONFIG_KEYS.SCHEDULE_BUFFER_MINUTES, 15, sectorId),
  ]);

  // The working day is the selected calendar date in the chosen timezone.
  const weekday = calendarWeekday(date);
  const workingDays = new Set(daysStr.split(',').map((d) => Number(d.trim())));
  const workingDay = workingDays.has(weekday);
  if (!workingDay || weekday < 0) {
    return { date, duration, workingDay: false, slots: [] };
  }

  const startMin = parseHHMM(startStr, 540);
  const endMin = parseHHMM(endStr, 1020);
  const bufferMs = bufferMin * 60_000;
  const now = Date.now();

  // The tz-local working window, as UTC instants, bounds the busy-lookup query.
  const dayStart = zonedWallClockToUtc(date, startMin, timeZone);
  const dayEnd = zonedWallClockToUtc(date, endMin, timeZone);
  const busy = await busyIntervals(
    interviewerIds,
    new Date(dayStart.getTime() - 60 * 60_000),
    new Date(dayEnd.getTime() + 60 * 60_000),
    excludeInterviewId,
  );
  const slots: AvailabilitySlot[] = [];

  for (let m = startMin; m + duration <= endMin; m += slotMin) {
    // Each slot's wall-clock start in the chosen tz → its real UTC instant.
    const slotStart = zonedWallClockToUtc(date, m, timeZone).getTime();
    const slotEnd = slotStart + duration * 60_000;
    const conflicts = busy.some(
      (b) => slotStart < b.end + bufferMs && slotEnd + bufferMs > b.start,
    );
    slots.push({
      start: new Date(slotStart).toISOString(),
      end: new Date(slotEnd).toISOString(),
      available: !conflicts && slotStart > now,
    });
  }

  return { date, duration, workingDay: true, slots };
}

/**
 * Reject bookings that fall outside configured working days/hours (UTC). The
 * slot grid only offers valid times, but a direct API call could bypass it —
 * keep create/reschedule consistent with the slot engine.
 */
export async function assertWorkingHours(
  scheduledDate: Date,
  duration: number,
  sectorId: string | null = null,
  timeZone = 'UTC',
): Promise<void> {
  const [startStr, endStr, daysStr] = await Promise.all([
    configService.getString(CONFIG_KEYS.SCHEDULE_WORKING_HOURS_START, '09:00', sectorId),
    configService.getString(CONFIG_KEYS.SCHEDULE_WORKING_HOURS_END, '17:00', sectorId),
    configService.getString(CONFIG_KEYS.SCHEDULE_WORKING_DAYS, '1,2,3,4,5', sectorId),
  ]);
  const workingDays = new Set(daysStr.split(',').map((d) => Number(d.trim())));
  // Interpret the booked instant in the schedule's timezone.
  const { weekday, minutesOfDay } = zonedParts(scheduledDate, timeZone);
  if (!workingDays.has(weekday)) {
    throw new BadRequestError('That date is not a configured working day');
  }
  const startMin = parseHHMM(startStr, 540);
  const endMin = parseHHMM(endStr, 1020);
  if (minutesOfDay < startMin || minutesOfDay + duration > endMin) {
    throw new BadRequestError(
      `That time is outside working hours (${startStr}–${endStr} ${timeZone}) for a ${duration}-minute interview`,
    );
  }
}

/**
 * True if the proposed booking overlaps an existing one for any interviewer
 * (buffer-aware). Used by create/reschedule before committing.
 */
export async function hasConflict(
  interviewerIds: string[],
  scheduledDate: Date,
  duration: number,
  excludeInterviewId?: string,
): Promise<boolean> {
  const bufferMin = await configService.getNumber(CONFIG_KEYS.SCHEDULE_BUFFER_MINUTES, 15);
  const bufferMs = bufferMin * 60_000;
  const start = scheduledDate.getTime();
  const end = start + duration * 60_000;
  // Widen the day window by ±1 day so a booking near midnight is still caught.
  const dayStart = new Date(start - 24 * 60 * 60_000);
  const dayEnd = new Date(end + 24 * 60 * 60_000);
  const busy = await busyIntervals(interviewerIds, dayStart, dayEnd, excludeInterviewId);
  return busy.some((b) => start < b.end + bufferMs && end + bufferMs > b.start);
}
