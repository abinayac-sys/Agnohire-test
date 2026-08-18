import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const prisma = new PrismaClient();

async function assignInterviews() {
  const adminUser = await prisma.user.findFirst({
    where: { email: 'admin@agnohire.local' },
  });

  if (!adminUser) {
    console.error('Admin user not found. Cannot assign interviews.');
    return;
  }

  const latestList = await prisma.candidateList.findFirst({
    orderBy: { createdAt: 'desc' },
    include: {
      items: {
        include: {
          candidate: true
        }
      }
    }
  });

  if (!latestList || latestList.items.length === 0) {
    console.log('No recent candidates found from the uploaded list.');
    return;
  }

  let count = 0;
  for (const item of latestList.items) {
    const candidate = item.candidate;
    
    // Create an InterviewSchedule first
    const scheduleDate = new Date();
    scheduleDate.setDate(scheduleDate.getDate() + 2); // Schedule 2 days from now

    const schedule = await prisma.interviewSchedule.create({
      data: {
        candidateId: candidate.id,
        recruiterId: adminUser.id,
        scheduledDate: scheduleDate,
        duration: 60,
        instructions: 'Please be ready 5 minutes early for the AI interview.',
      }
    });

    // Create the Interview
    const interview = await prisma.interview.create({
      data: {
        candidateId: candidate.id,
        recruiterId: adminUser.id,
        scheduleId: schedule.id,
        status: 'SCHEDULED',
        type: 'AI',
      }
    });

    console.log(`Assigned interview to ${candidate.fullName} (Interview ID: ${interview.id})`);
    count++;
  }

  console.log(`\nSuccessfully assigned interviews to ${count} students from the uploaded excel details.`);
}

assignInterviews()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
