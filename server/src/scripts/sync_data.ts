import { prisma } from '../config/database.js';

async function main() {
  console.log('Starting candidates synchronization...');
  
  const applications = await prisma.jobApplication.findMany({
    include: {
      job: {
        include: {
          workflowRounds: {
            orderBy: { sequenceOrder: 'asc' }
          }
        }
      }
    }
  });

  console.log(`Found ${applications.length} applications to check.`);

  let updatedCount = 0;

  for (const app of applications) {
    const status = app.status;
    const configuredRounds = app.job?.workflowRounds || [];

    let targetStage = app.stage;

    // Check mapping rules
    if (status === 'REJECTED' || app.workflowStatus === 'FAILED') {
      targetStage = 'REJECTED';
    } else if (status === 'HIRED' || status === 'ONBOARDING') {
      targetStage = 'HIRED';
    } else if (status === 'OFFER' || status === 'OFFER_SENT') {
      targetStage = 'OFFER';
    } else if (status === 'SUBMITTED_TO_HR') {
      targetStage = 'HR_APPROVAL';
    } else if (status === 'APPLIED') {
      targetStage = 'APPLIED';
    } else {
      // For SCREENING, ASSESSMENT, INTERVIEW, SCHEDULE, check if currentRound matches a round name
      const round = configuredRounds.find(r => r.roundNumber === app.currentRound);
      if (round) {
        targetStage = round.roundName;
      } else {
        // Fallback: match based on status
        if (status === 'SCREENING') targetStage = 'SCREENING';
        else if (status === 'ASSESSMENT') targetStage = 'ASSESSMENT';
        else if (status === 'INTERVIEW') targetStage = 'INTERVIEW';
        else if (status === 'SCHEDULE') targetStage = 'SCHEDULE';
      }
    }

    if (app.stage !== targetStage) {
      console.log(`Updating app ${app.id}: status=${status}, currentRound=${app.currentRound}, stage: ${app.stage} -> ${targetStage}`);
      await prisma.jobApplication.update({
        where: { id: app.id },
        data: { stage: targetStage }
      });
      updatedCount++;
    }
  }

  console.log(`Synchronization complete. Updated ${updatedCount} applications.`);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
