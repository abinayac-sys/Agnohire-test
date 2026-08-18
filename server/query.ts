import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  const apps = await prisma.jobApplication.findMany({
    where: {
      candidate: {
        email: 'varsha_int@agnoshin.com'
      }
    }
  });

  console.log('Applications with deletedAt:', apps.map(app => ({
    id: app.id,
    status: app.status,
    stage: app.stage,
    currentRound: app.currentRound,
    workflowStatus: app.workflowStatus,
    deletedAt: app.deletedAt
  })));
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
