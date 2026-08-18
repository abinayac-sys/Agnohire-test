import { prisma } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';
import { paginate } from '../utils/response.js';
import type { HrApprovalInput } from '@agnohire/shared';
import { recordAudit } from './auditService.js';
import { configService } from './configService.js';
import type { Request } from 'express';
import { generateAndSendTentativeOffer } from './offerService.js'; // We will implement this
import type { InterviewContext } from './questionBankService.js';
import { isSuperOrAdmin, isRecruiterScoped, assignedCandidateWhere } from '../utils/accessScope.js';

export async function getApprovalQueue(page: number, limit: number, from: string | undefined, to: string | undefined, ctx: InterviewContext) {
  const scoped = ctx.sectorId && !configService.crossSectorVisibilityEnabled();
  const where: any = {
    hrStatus: { in: ['PENDING', 'REASSESS'] },
    decision: { in: ['PASS', 'HOLD'] },
    ...((from || to) ? { decidedAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(`${to}T23:59:59.999Z`) }) } } : {}),
    interview: {
      deletedAt: null,
      status: { in: ['COMPLETED', 'EVALUATED'] },
      candidate: {
        deletedAt: null,
        ...(isRecruiterScoped(ctx.role) ? assignedCandidateWhere(ctx.userId) : {}),
      },
      jobRequisition: { deletedAt: null, ...(scoped ? { sectorId: ctx.sectorId ?? undefined } : {}) },
    },
  };

  const allRows = await prisma.interviewResult.findMany({
    where,
    include: {
      interview: {
        include: {
          candidate: { select: { id: true, fullName: true, email: true, currentRole: true } },
          jobRequisition: { select: { id: true, title: true } },
          feedbacks: { include: { reviewer: { select: { fullName: true } } } },
          questions: { include: { question: true } },
          answers: true,
        }
      }
    },
    orderBy: { decidedAt: 'desc' }
  });

  // Filter to ensure candidate passed final round for THIS job
  const apps = await prisma.jobApplication.findMany({
    where: {
      workflowStatus: 'SELECTED',
      candidateId: { in: allRows.map(r => r.interview.candidateId) },
    },
    select: { candidateId: true, jobRequisitionId: true }
  });

  const appSet = new Set(apps.map(a => `${a.candidateId}-${a.jobRequisitionId}`));

  // Filter out any rows where the candidate has already been processed (APPROVED, REJECTED) for that job requisition
  const processedResults = await prisma.interviewResult.findMany({
    where: {
      hrStatus: { in: ['APPROVED', 'REJECTED'] },
      interview: {
        candidateId: { in: allRows.map(r => r.interview.candidateId) },
      }
    },
    select: {
      interview: {
        select: { candidateId: true, jobRequisitionId: true }
      }
    }
  });

  const processedSet = new Set(processedResults.map(pr => `${pr.interview.candidateId}-${pr.interview.jobRequisitionId}`));

  // Also, make sure it's the FINAL interview round we are showing, not previous ones
  // For simplicity, any result for a SELECTED application should be shown. We assume previous rounds were passed.
  const filteredRows = allRows.filter(r =>
    appSet.has(`${r.interview.candidateId}-${r.interview.jobRequisitionId}`) &&
    !processedSet.has(`${r.interview.candidateId}-${r.interview.jobRequisitionId}`)
  );

  // Deduplicate and show only the final round interview result for each candidate + job requisition combination.
  const deduplicatedMap = new Map<string, typeof allRows[0]>();

  for (const row of filteredRows) {
    const key = `${row.interview.candidateId}-${row.interview.jobRequisitionId}`;
    const existing = deduplicatedMap.get(key);

    if (!existing) {
      deduplicatedMap.set(key, row);
      continue;
    }

    // Determine if the current row is a better/final representation than the existing one
    const existingRound = existing.interview.roundNumber ?? 0;
    const currentRound = row.interview.roundNumber ?? 0;

    if (currentRound > existingRound) {
      deduplicatedMap.set(key, row);
    } else if (currentRound === existingRound) {
      // If round numbers are the same, prefer a passing decision over a failing/other decision
      const existingIsPass = ['PASS', 'STRONG_HIRE', 'HIRE'].includes(existing.decision ?? '');
      const currentIsPass = ['PASS', 'STRONG_HIRE', 'HIRE'].includes(row.decision ?? '');

      if (currentIsPass && !existingIsPass) {
        deduplicatedMap.set(key, row);
      } else if (existingIsPass === currentIsPass) {
        // If decisions are equivalent, prefer the latest one
        const existingTime = existing.decidedAt ? new Date(existing.decidedAt).getTime() : new Date(existing.createdAt).getTime();
        const currentTime = row.decidedAt ? new Date(row.decidedAt).getTime() : new Date(row.createdAt).getTime();
        if (currentTime > existingTime) {
          deduplicatedMap.set(key, row);
        }
      }
    }
  }

  const deduplicatedRows = Array.from(deduplicatedMap.values());

  const total = deduplicatedRows.length;
  const paginatedRows = deduplicatedRows.slice((page - 1) * limit, page * limit);

  return paginate(paginatedRows, total, page, limit);
}

export async function getProcessedQueue(page: number, limit: number, from: string | undefined, to: string | undefined, ctx: InterviewContext) {
  const scoped = ctx.sectorId && !configService.crossSectorVisibilityEnabled();
  const where: any = {
    hrStatus: { in: ['APPROVED', 'REJECTED'] },
    ...((from || to) ? { hrApprovedAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(`${to}T23:59:59.999Z`) }) } } : {}),
    interview: {
      deletedAt: null,
      status: { in: ['COMPLETED', 'EVALUATED'] },
      candidate: {
        deletedAt: null,
        ...(isRecruiterScoped(ctx.role) ? assignedCandidateWhere(ctx.userId) : {}),
      },
      jobRequisition: { deletedAt: null, ...(scoped ? { sectorId: ctx.sectorId ?? undefined } : {}) },
    },
  };

  const allRows = await prisma.interviewResult.findMany({
    where,
    include: {
      interview: {
        include: {
          candidate: { select: { id: true, fullName: true, email: true, currentRole: true } },
          jobRequisition: { select: { id: true, title: true } },
        }
      }
    },
    orderBy: { hrApprovedAt: 'desc' }
  });

  const appRows = await prisma.jobApplication.findMany({
    where: {
      candidateId: { in: allRows.map(r => r.interview.candidateId) },
    },
    select: { candidateId: true, jobRequisitionId: true, status: true }
  });
  const appMap = new Map(appRows.map(a => [`${a.candidateId}-${a.jobRequisitionId}`, a.status]));

  const hrUserIds = [...new Set(allRows.map(r => r.hrApprovedById).filter(Boolean) as string[])];
  const hrUsers = await prisma.user.findMany({
    where: { id: { in: hrUserIds } },
    select: { id: true, fullName: true }
  });
  const hrUserMap = new Map(hrUsers.map(u => [u.id, u.fullName]));

  const mappedRows = allRows.map(r => ({
    ...r,
    offerStatus: appMap.get(`${r.interview.candidateId}-${r.interview.jobRequisitionId}`) || 'UNKNOWN',
    hrApprovedByName: r.hrApprovedById ? (hrUserMap.get(r.hrApprovedById) || 'Unknown HR') : 'N/A'
  }));

  const total = mappedRows.length;
  const paginatedRows = mappedRows.slice((page - 1) * limit, page * limit);

  return paginate(paginatedRows, total, page, limit);
}

export async function getConsolidatedReport(candidateId: string, ctx: InterviewContext) {
  const candidate = await prisma.candidate.findFirst({
    where: {
      id: candidateId,
      deletedAt: null,
      ...(isRecruiterScoped(ctx.role) ? assignedCandidateWhere(ctx.userId) : {}),
      ...((isSuperOrAdmin(ctx.role) || configService.crossSectorVisibilityEnabled()) ? {} : ctx.sectorId ? { sectorId: ctx.sectorId } : {}),
    },
    include: {
      interviews: {
        include: {
          result: true,
          feedbacks: true,
          questions: { include: { question: true } },
          answers: true,
          schedule: true,
          jobRequisition: { select: { title: true } }
        }
      },
      assignments: true,
      jobRequisition: true,
      resumes: true
    }
  });

  if (!candidate) throw new NotFoundError('Candidate not found');

  return candidate;
}

export async function processHrApproval(
  interviewId: string,
  data: HrApprovalInput,
  userId: string,
  req: Request
) {
  const result = await prisma.interviewResult.findUnique({
    where: { interviewId },
    include: {
      interview: {
        include: {
          candidate: true,
          jobRequisition: true
        }
      }
    }
  });

  if (!result) throw new NotFoundError('Interview result not found');

  const hrStatus = data.action === 'APPROVE' ? 'APPROVED' :
    data.action === 'REJECT' ? 'REJECTED' : 'REASSESS';

  await prisma.interviewResult.update({
    where: { interviewId },
    data: {
      hrStatus,
      hrRemarks: data.remarks ?? null,
      hrApprovedAt: new Date(),
      hrApprovedById: userId,
    }
  });

  const appStatus = data.action === 'APPROVE' ? 'OFFER' :
    data.action === 'REJECT' ? 'REJECTED' : 'ON_HOLD'; // Map reassess to ON_HOLD

  const appStage = data.action === 'APPROVE' ? 'OFFER' :
    data.action === 'REJECT' ? 'REJECTED' : undefined;

  if (result.interview.jobRequisitionId) {
    await prisma.jobApplication.updateMany({
      where: { candidateId: result.interview.candidateId, jobRequisitionId: result.interview.jobRequisitionId },
      data: {
        status: appStatus,
        ...(appStage !== undefined && { stage: appStage }),
        ...(data.action === 'REJECT' ? { workflowStatus: 'FAILED' } : {}),
      }
    });
  }

  await recordAudit(req, {
    action: 'HR_APPROVAL',
    entity: 'Interview',
    entityId: interviewId,
    description: `HR Decision: ${data.action}`,
  });

  if (data.action === 'APPROVE' && result.interview.candidateId && result.interview.jobRequisitionId) {
    // Generate Tentative Offer automatically
    try {
      await generateAndSendTentativeOffer(
        result.interview.candidateId,
        result.interview.jobRequisitionId,
        userId,
        result.recommendedSalary ? Number(result.recommendedSalary) : undefined
      );
    } catch (e) {
      console.error('Failed to generate and send tentative offer:', e);
    }
  }

  return { success: true, hrStatus };
}

export async function deleteHrApproval(interviewId: string, req: Request) {
  const { count } = await prisma.interviewResult.deleteMany({
    where: { interviewId }
  });
  if (count === 0) throw new NotFoundError('Interview result not found');
  await recordAudit(req, {
    action: 'DELETE',
    entity: 'InterviewResult',
    entityId: interviewId,
    description: `Deleted HR approval result for interview ${interviewId}`,
  });
}
