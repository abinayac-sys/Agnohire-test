import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../.env' }); // Adjust if .env is elsewhere

const prisma = new PrismaClient();

async function run() {
  try {
    await prisma.candidate.create({
      data: {
        fullName: 'Test Candidate',
        email: 'test' + Date.now() + '@example.com',
        phone: null,
        currentRole: null,
        location: null,
        experienceLevel: null,
        source: 'JOB_BOARD',
        linkedinUrl: null,
        githubUrl: null,
        skills: [],
        sectorId: null,
        jobRequisitionId: null
      },
      select: { id: true }
    });
    console.log("Success");
  } catch (e: any) {
    console.error("Failed:", e.message);
  } finally {
    await prisma.$disconnect();
  }
}
run();
