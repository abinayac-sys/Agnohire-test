import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.candidateAnswer.deleteMany();
  console.log('Deleted all candidate answers.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
