import { prisma } from '../config/database.js';
import { NOTIFICATION_TYPE, isScheduleRound } from '@agnohire/shared';
import { notify } from './notificationService.js';

export function getEffectivePassThreshold(roundPassPercentage?: number | null): number {
  return roundPassPercentage != null ? roundPassPercentage : 60;
}

export async function processWorkflowProgression(
  interviewId: string,
  decision: string,
  percentageScore: number | null
) {
  // 1. Find the interview, application, and workflow round
  const interview = await prisma.interview.findFirst({
    where: { id: interviewId },
    select: {
      candidateId: true,
      jobRequisitionId: true,
      recruiterId: true,
      roundNumber: true,
    },
  });

  if (!interview || !interview.jobRequisitionId) return;

  const application = await prisma.jobApplication.findFirst({
    where: {
      candidateId: interview.candidateId,
      jobRequisitionId: interview.jobRequisitionId,
    },
    select: { id: true, currentRound: true, completedRounds: true, workflowStatus: true },
  });

  if (!application || application.workflowStatus !== 'IN_PROGRESS') return;

  const currentRound = interview.roundNumber ?? application.currentRound;

  // Find the current workflow round definition
  const round = await prisma.interviewWorkflowRound.findFirst({
    where: {
      jobRequisitionId: interview.jobRequisitionId,
      roundNumber: currentRound,
    },
  });

  if (!round) return;

  // Evaluate Decision
  let isPass = decision === 'PASS' || decision === 'STRONG_HIRE' || decision === 'HIRE';
  let isHold = decision === 'HOLD';
  let isFail = decision === 'FAIL' || decision === 'REJECT';

  const effectiveThreshold = getEffectivePassThreshold(round.passPercentage);
  if (percentageScore != null) {
    isPass = percentageScore >= effectiveThreshold;
    if (!isPass) isFail = true;
  }

  if (isHold) {
    // HOLD: Do not progress, keep as IN_PROGRESS
    await notify({
      recipientId: interview.recruiterId,
      type: NOTIFICATION_TYPE.GENERIC,
      title: 'Candidate On Hold',
      message: `Candidate is on hold for Round ${currentRound}. Awaiting final decision.`,
      entityType: 'Application',
      entityId: application.id,
    });
    return;
  }

  if (isPass) {
    // PASS
    let completedRounds: number[] = [];
    if (application.completedRounds && Array.isArray(application.completedRounds)) {
      completedRounds = application.completedRounds as number[];
    }
    if (!completedRounds.includes(currentRound)) {
      completedRounds.push(currentRound);
    }

    const rounds = await prisma.interviewWorkflowRound.findMany({
      where: { jobRequisitionId: interview.jobRequisitionId },
      orderBy: { sequenceOrder: 'asc' },
    });

    const currentRoundIdx = rounds.findIndex(r => r.roundNumber === currentRound);
    const hasNextRound = currentRoundIdx !== -1 && currentRoundIdx < rounds.length - 1;

    if (!hasNextRound) {
      // Completed all rounds
      await prisma.jobApplication.update({
        where: { id: application.id },
        data: {
          completedRounds,
          workflowStatus: 'SELECTED',
          status: 'SUBMITTED_TO_HR', // Triggers HR Approval workflow
          stage: 'HR_APPROVAL',
        },
      });

      await notify({
        recipientId: interview.recruiterId,
        type: NOTIFICATION_TYPE.GENERIC,
        title: 'Candidate Selected for HR Review',
        message: `Candidate has passed all workflow rounds and is submitted to HR for approval.`,
        entityType: 'Application',
        entityId: application.id,
      });
    } else {
      // Progress to next round
      const nextRoundDef = rounds[currentRoundIdx + 1];
      const nextRoundName = nextRoundDef.roundName;
      const nextRoundNumber = nextRoundDef.roundNumber;
      const nextStatus = getStatusForRound(nextRoundDef);

      await prisma.jobApplication.update({
        where: { id: application.id },
        data: {
          currentRound: nextRoundNumber,
          completedRounds,
          stage: nextRoundName,
          status: nextStatus,
        },
      });

      await notify({
        recipientId: interview.recruiterId,
        type: NOTIFICATION_TYPE.GENERIC,
        title: 'Candidate Progressed',
        message: `Candidate passed Round ${currentRound} and has moved to Round ${nextRoundNumber} (${nextRoundName}).`,
        entityType: 'Application',
        entityId: application.id,
      });
    }

  } else if (isFail) {
    // FAIL
    if (round.isMandatory) {
      await prisma.jobApplication.update({
        where: { id: application.id },
        data: {
          failedRound: currentRound,
          workflowStatus: 'FAILED',
          status: 'REJECTED',
          stage: 'REJECTED',
        },
      });

      await notify({
        recipientId: interview.recruiterId,
        type: NOTIFICATION_TYPE.GENERIC,
        title: 'Candidate Rejected',
        message: `Candidate failed mandatory Round ${currentRound} and was rejected.`,
        entityType: 'Application',
        entityId: application.id,
      });
    }
  }
}

/**
 * Referred candidates are pre-vetted by their referrer, so they automatically
 * clear the first interview round. Call this right after an application is
 * created. It only acts when:
 *   - the candidate is a referral (source REFERRAL, or has a Referral row for
 *     this job / a job-less referral), and
 *   - the application is still at round 1 and IN_PROGRESS.
 * Idempotent and a no-op for non-referral candidates or jobs without a workflow.
 */
export async function autoAdvanceReferralFirstRound(applicationId: string): Promise<void> {
  const application = await prisma.jobApplication.findFirst({
    where: { id: applicationId },
    select: {
      id: true,
      candidateId: true,
      jobRequisitionId: true,
      currentRound: true,
      completedRounds: true,
      workflowStatus: true,
    },
  });
  if (!application || !application.jobRequisitionId) return;
  if (application.workflowStatus !== 'IN_PROGRESS' || application.currentRound !== 1) return;

  const completed = Array.isArray(application.completedRounds)
    ? (application.completedRounds as number[])
    : [];
  if (completed.includes(1)) return; // already advanced

  // Gate strictly on referral status — non-referred candidates are untouched.
  const [candidate, referral] = await Promise.all([
    prisma.candidate.findFirst({
      where: { id: application.candidateId },
      select: { source: true },
    }),
    prisma.referral.findFirst({
      where: {
        candidateId: application.candidateId,
        OR: [{ jobId: application.jobRequisitionId }, { jobId: null }],
      },
      select: { id: true },
    }),
  ]);
  const isReferral = candidate?.source === 'REFERRAL' || Boolean(referral);
  if (!isReferral) return;

  const rounds = await prisma.interviewWorkflowRound.findMany({
    where: { jobRequisitionId: application.jobRequisitionId },
    orderBy: { sequenceOrder: 'asc' },
  });
  if (rounds.length === 0) return; // no workflow → nothing to skip

  const firstRound = rounds[0];
  const completedRounds = [...completed, firstRound.roundNumber];

  if (rounds.length === 1) {
    // Referral candidates should behave like normal candidates.
    // Do not auto-progress.
    return;
  }

  const nextRound = rounds[1];
  await prisma.jobApplication.update({
    where: { id: application.id },
    data: {
      currentRound: nextRound.roundNumber,
      completedRounds,
      stage: nextRound.roundName,
      status: getStatusForRound(nextRound),
    },
  });
}

function getStatusForRound(round: { roundType: string; roundName: string; roundNumber: number }): string {
  const rType = round.roundType.toLowerCase();
  const rName = round.roundName.toLowerCase();
  if (rType.includes('assessment') || rType.includes('test') || rName.includes('assessment') || rName.includes('test')) {
    return 'ASSESSMENT';
  } else if (rType.includes('screening') || rName.includes('screening')) {
    return 'SCREENING';
  } else if (isScheduleRound(round.roundType, round.roundName)) {
    // HR Interview / Final Discussion / any "schedule" round → Scheduling flow.
    return 'SCHEDULE';
  } else if (rType.includes('hr approval') || rName.includes('hr approval')) {
    return 'SUBMITTED_TO_HR';
  } else if (rName === 'interview') {
    return 'INTERVIEW';
  } else {
    return round.roundName;
  }
}
