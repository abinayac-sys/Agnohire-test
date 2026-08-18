import { prisma } from './config/database.js';

async function main() {
  const candidates = await prisma.candidate.findMany();
  console.log(JSON.stringify(candidates, null, 2));
}

main().catch(console.error);
