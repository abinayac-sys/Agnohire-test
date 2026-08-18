import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const interviews = await prisma.interview.findMany({
    include: {
      candidate: true,
      schedule: true,
      result: true,
    }
  });
  console.log(JSON.stringify(interviews, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
