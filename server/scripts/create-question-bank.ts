import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const prisma = new PrismaClient();

async function main() {
  const adminUser = await prisma.user.findFirst({
    where: { email: 'admin@agnohire.local' },
  });

  if (!adminUser) {
    console.error('Admin user not found. Cannot create question bank.');
    return;
  }
  if (!adminUser.tenantId) {
    console.error('Admin user has no tenant. Run npm run db:seed first.');
    return;
  }
  // This script uses a bare PrismaClient, so it gets NONE of the app's tenancy
  // middleware — nothing auto-stamps tenantId here. Every row must carry it
  // explicitly or it is born orphaned and invisible to the app.
  const tenantId = adminUser.tenantId;

  const domain = await prisma.domain.findFirst();

  if (!domain) {
    console.error('No domains found. Run seed script first.');
    return;
  }

  const bank = await prisma.questionBank.create({
    data: {
      name: 'Testing React Question Bank',
      description: 'A question bank for testing React skills',
      domainId: domain.id,
      createdById: adminUser.id,
      isPublic: true,
      sectorId: adminUser.sectorId,
      tenantId,
      questions: {
        create: [
          {
            tenantId,
            text: 'What is the purpose of useEffect in React?',
            type: 'TEXT',
            difficulty: 'EASY',
            rubric: 'Candidate should mention side effects, lifecycle methods, dependency array.',
            tags: ['React', 'Hooks'],
          },
          {
            tenantId,
            text: 'Explain the Virtual DOM in React.',
            type: 'TEXT',
            difficulty: 'MEDIUM',
            rubric: 'Candidate should mention performance, reconciliation, diffing algorithm.',
            tags: ['React', 'Core'],
          },
          {
            tenantId,
            text: 'Which hook is used to manage complex state logic?',
            type: 'MCQ',
            difficulty: 'EASY',
            options: ['useState', 'useEffect', 'useReducer', 'useMemo'],
            rubric: 'useReducer',
            tags: ['React', 'Hooks'],
          }
        ]
      }
    }
  });

  console.log(`Successfully created question bank: ${bank.name} with ID: ${bank.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
