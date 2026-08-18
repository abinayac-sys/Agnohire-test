import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const prisma = new PrismaClient();

async function checkCandidates() {
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

  if (latestList) {
    console.log(`Found candidate list: ${latestList.name} with ${latestList.items.length} candidates`);
    for (const item of latestList.items) {
      console.log(`- Candidate: ${item.candidate.fullName} (${item.candidate.email})`);
    }
  } else {
    console.log('No candidate lists found.');
  }

  const allCandidates = await prisma.candidate.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('\nLatest Candidates:');
  allCandidates.forEach(c => {
    console.log(`- ${c.fullName} (${c.email})`);
  });
}

checkCandidates()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
