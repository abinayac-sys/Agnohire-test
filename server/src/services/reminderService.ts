import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { sendMail } from './mailerService.js';
import { interviewReminderEmail } from './emailTemplates.js';

/**
 * Interview reminder processor (Bull `reminder` queue + inline fallback).
 *
 * Graceful by design: actual email delivery needs SMTP, which lives in DB
 * config and is administered in Module 14. Until then a fired reminder marks
 * `reminderSent` and logs — wiring a mailer later is a drop-in here.
 *
 * Processor module: must NOT import jobs/dispatch (keeps the queue cycle-free).
 */
export async function sendScheduleReminder(scheduleId: string): Promise<void> {
  const schedule = await prisma.interviewSchedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      scheduledDate: true,
      reminderSent: true,
      candidateId: true,
      interview: { select: { id: true, status: true } },
    },
  });

  if (!schedule) {
    logger.debug('Reminder skipped — schedule no longer exists', { scheduleId });
    return;
  }
  if (schedule.reminderSent) return;
  if (!schedule.interview || ['CANCELLED', 'EXPIRED', 'COMPLETED'].includes(schedule.interview.status)) {
    logger.debug('Reminder skipped — interview not active', {
      scheduleId,
      status: schedule.interview?.status ?? 'none',
    });
    return;
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: schedule.candidateId },
    select: { fullName: true, email: true },
  });

  await prisma.interviewSchedule.update({
    where: { id: scheduleId },
    data: { reminderSent: true },
  });

  // Deliver via configured SMTP. Mailer degrades gracefully (logs + no-op) when
  // SMTP isn't set, so this never blocks the reminder from being marked sent.
  if (candidate?.email) {
    const { subject, html } = await interviewReminderEmail({
      candidateName: candidate.fullName ?? 'there',
      scheduledDate: schedule.scheduledDate,
    });
    const result = await sendMail({ to: candidate.email, subject, html });
    logger.info('Interview reminder fired', {
      scheduleId,
      interviewId: schedule.interview.id,
      candidate: candidate.email,
      emailSent: result.sent,
    });
  }
}
