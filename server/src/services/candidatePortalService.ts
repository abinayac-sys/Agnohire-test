import { prisma } from '../config/database.js';
import { OFFER_STATUS, type MyInterviewItem, type MyOfferItem, type OfferStatus, type MyApplicationItem } from '@agnohire/shared';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';

/** Resolves the signed-in user to their linked candidate id (links by userId then back-fills by email). Throws Forbidden
 *  when no candidate profile is linked. */
async function resolveCandidateId(user: { sub: string; email: string }): Promise<string> {
  let candidate = await prisma.candidate.findFirst({
    where: { userId: user.sub, deletedAt: null },
    select: { id: true },
  });
  if (!candidate) {
    const byEmail = await prisma.candidate.findFirst({
      where: { email: user.email, deletedAt: null },
      select: { id: true, userId: true },
    });
    if (byEmail) {
      if (!byEmail.userId) {
        await prisma.candidate.update({ where: { id: byEmail.id }, data: { userId: user.sub } });
      }
      candidate = { id: byEmail.id };
    }
  }
  if (!candidate) {
    throw new ForbiddenError('No candidate profile is linked to your account. Please contact our recruitment team.');
  }
  return candidate.id;
}

/** A candidate's own interviews — newest first. */
export async function listMyInterviews(user: { sub: string; email: string }): Promise<MyInterviewItem[]> {
  const candidateId = await resolveCandidateId(user);
  const rows = await prisma.interview.findMany({
    where: { candidateId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      status: true,
      accessToken: true,
      startedAt: true,
      completedAt: true,
      duration: true,
      createdAt: true,
      jobRequisitionId: true,
      roundNumber: true,
      schedule: { select: { scheduledDate: true, meetingLink: true, duration: true } },
      result: {
        select: {
          percentageScore: true,
          decision: true,
          aiDecision: true,
          aiSummary: true,
          aiReasoning: true,
          strengths: true,
          improvements: true,
          failureReason: true,
          recommendedLearning: true,
          feedbackPdfPath: true,
        }
      }
    },
  });
  return rows.map((iv) => ({
    id: iv.id,
    type: iv.type,
    status: iv.status,
    scheduledAt: (iv.schedule?.scheduledDate ?? iv.startedAt ?? null)?.toISOString() ?? null,
    duration: iv.duration ?? iv.schedule?.duration ?? null,
    meetingLink: iv.schedule?.meetingLink ?? null,
    // Only expose the take-link while the interview is still takeable.
    accessToken: iv.status === 'SCHEDULED' || iv.status === 'IN_PROGRESS' ? iv.accessToken : null,
    completedAt: iv.completedAt?.toISOString() ?? null,
    roundNumber: iv.roundNumber,
    jobRequisitionId: iv.jobRequisitionId,
    result: iv.result ? {
      percentageScore: iv.result.percentageScore,
      decision: iv.result.decision,
      aiDecision: iv.result.aiDecision,
      aiSummary: iv.result.aiSummary,
      aiReasoning: iv.result.aiReasoning,
      strengths: iv.result.strengths,
      improvements: iv.result.improvements,
      failureReason: (iv.result as any).failureReason,
      recommendedLearning: (iv.result as any).recommendedLearning,
      hasFeedbackPdf: !!(iv.result as any).feedbackPdfPath,
    } : null,
  }));
}

/** A candidate's own applications and interview progress */
export async function listMyApplications(user: { sub: string; email: string }): Promise<MyApplicationItem[]> {
  const candidateId = await resolveCandidateId(user);
  const rows = await prisma.jobApplication.findMany({
    where: { candidateId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      currentRound: true,
      completedRounds: true,
      workflowStatus: true,
      failedRound: true,
      jobRequisitionId: true,
      job: {
        select: {
          title: true,
          workflowRounds: {
            orderBy: { sequenceOrder: 'asc' },
            select: { id: true, roundNumber: true, roundName: true, roundType: true, isMandatory: true, passPercentage: true },
          },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    jobTitle: r.job?.title || 'Unknown Job',
    jobRequisitionId: r.jobRequisitionId,
    status: r.status,
    currentRound: r.currentRound,
    completedRounds: Array.isArray(r.completedRounds) ? r.completedRounds.length : 0,
    workflowStatus: r.workflowStatus,
    failedRound: r.failedRound,
    workflowRounds: r.job.workflowRounds.map((w) => ({
      id: w.id,
      roundNumber: w.roundNumber,
      roundName: w.roundName,
      roundType: w.roundType,
      isMandatory: w.isMandatory,
      passPercentage: w.passPercentage,
    })),
  }));
}

/** A candidate's own offers — drafts are hidden; newest first. */
export async function listMyOffers(user: { sub: string; email: string }): Promise<MyOfferItem[]> {
  const candidateId = await resolveCandidateId(user);
  const rows = await prisma.offer.findMany({
    where: { candidateId, deletedAt: null, status: { not: OFFER_STATUS.DRAFT } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      salaryOffered: true,
      joiningDate: true,
      validUntil: true,
      offerLetterUrl: true,
      createdAt: true,
      application: { select: { job: { select: { title: true } } } },
    },
  });
  return rows.map((o) => ({
    id: o.id,
    jobTitle: o.application?.job?.title ?? 'Position',
    status: o.status as OfferStatus,
    salaryOffered: o.salaryOffered ? Number(o.salaryOffered) : null,
    joiningDate: o.joiningDate?.toISOString() ?? null,
    validUntil: o.validUntil?.toISOString() ?? null,
    offerLetterUrl: o.offerLetterUrl ?? null,
    sentAt: o.createdAt.toISOString(),
  }));
}

export async function getMyReportPath(interviewId: string, user: { sub: string; email: string }): Promise<{ filePath: string; fileName: string }> {
  const candidateId = await resolveCandidateId(user);
  const iv = await prisma.interview.findFirst({
    where: { id: interviewId, candidateId },
    select: { candidate: { select: { fullName: true } }, result: { select: { feedbackPdfPath: true } } },
  });
  if (!iv) {
    throw new NotFoundError('Report not found');
  }
  const fs = await import('fs');
  const path = await import('path');

  // Always regenerate so the report reflects the current template and
  // interview data, rather than serving a stale cached PDF from disk.
  let filePath: string | null = null;
  try {
    const { generateInterviewReportPDF } = await import('./pdfReportService.js');
    const pdfBuffer = await generateInterviewReportPDF(interviewId);

    const reportsDir = path.join(process.cwd(), 'uploads', 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    const fileName = `report_${interviewId}.pdf`;
    const newFilePath = path.join(reportsDir, fileName);
    fs.writeFileSync(newFilePath, pdfBuffer);

    await prisma.interviewResult.update({
      where: { interviewId },
      data: { feedbackPdfPath: `/uploads/reports/${fileName}` }
    });

    filePath = newFilePath;
  } catch (err) {
    const feedbackPdfPath = (iv.result as any)?.feedbackPdfPath;
    const fallbackPath = feedbackPdfPath ? path.join(process.cwd(), feedbackPdfPath) : null;
    if (fallbackPath && fs.existsSync(fallbackPath)) {
      filePath = fallbackPath;
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    throw new NotFoundError('Report file missing and could not be generated');
  }

  return {
    filePath,
    fileName: `Performance_Report_${iv.candidate.fullName.replace(/\s+/g, '_')}.pdf`,
  };
}
