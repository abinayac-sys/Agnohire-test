import { prisma } from './src/config/database.js';

async function main() {
  const result = await prisma.$queryRaw`SELECT * FROM "Candidate" WHERE id = 'ba5b83cf-eb4c-47bc-ad7e-07a5c531d044'`;
  console.log('Raw result:', result);
}

main().catch(console.error).finally(() => prisma.$disconnect());
