import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const plan = await prisma.plan.findUnique({ where: { code: 'FREE' } });
console.log(JSON.stringify(plan, null, 2));
await prisma.$disconnect();
