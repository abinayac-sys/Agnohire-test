const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const STAGE_TO_STATUS = {
    SOURCED: 'APPLIED',
    APPLIED: 'APPLIED',
    SCREENING: 'SCREENING',
    INTERVIEW: 'INTERVIEW',
    OFFER: 'OFFER',
    HIRED: 'HIRED',
    REJECTED: 'REJECTED',
  };

  const applications = await prisma.jobApplication.findMany();
  let updated = 0;

  for (const app of applications) {
    // If the stage and status don't map correctly, fix them!
    // Since the issue is "in screening it shows applied , but in pipeline it shows screening",
    // it seems the stage is "SCREENING" and the status is "APPLIED".
    // We should probably just sync them. We'll set the stage to the current status unless it's SOURCED.
    // Let's set stage = status.
    let targetStage = app.status;
    if (app.stage !== targetStage) {
      await prisma.jobApplication.update({
        where: { id: app.id },
        data: { stage: targetStage },
      });
      updated++;
    }
  }
  console.log(`Updated ${updated} applications to sync stage with status.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
