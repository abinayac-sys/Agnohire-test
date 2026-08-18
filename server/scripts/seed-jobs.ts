import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const prisma = new PrismaClient();

async function seedJobs() {
  const adminUser = await prisma.user.findFirst({
    where: { email: 'admin@agnohire.local' },
    select: { id: true, tenantId: true },
  });

  if (!adminUser) {
    console.error('Admin user not found. Please run seed script first.');
    return;
  }
  if (!adminUser.tenantId) {
    console.error('Admin user has no tenant. Run npm run db:seed first.');
    return;
  }
  const tenantId = adminUser.tenantId;

  const sector = await prisma.sector.findFirst({
    where: { name: 'Default' }
  });

  if (!sector) {
    console.error('Sector not found.');
    return;
  }

  const domain = await prisma.domain.findFirst({
    where: { name: 'Engineering', sectorId: sector.id }
  });

  if (!domain) {
    console.error('Domain not found.');
    return;
  }

  const dummyJobs = [
    {
      title: 'Senior Software Engineer',
      description: 'We are looking for a Senior Software Engineer to join our core engineering team.',
      sectorId: sector.id,
      domainId: domain.id,
      createdById: adminUser.id,
      status: 'OPEN',
      workMode: 'REMOTE',
      location: 'San Francisco, CA',
      experienceMin: 5,
      experienceMax: 8,
      budgetMin: 120000,
      budgetMax: 160000,
      headcount: 2,
      skills: ['Node.js', 'React', 'TypeScript', 'PostgreSQL'],
    },
    {
      title: 'Product Manager',
      description: 'Seeking an experienced Product Manager to drive our product vision.',
      sectorId: sector.id,
      domainId: domain.id,
      createdById: adminUser.id,
      status: 'OPEN',
      workMode: 'HYBRID',
      location: 'New York, NY',
      experienceMin: 3,
      experienceMax: 6,
      budgetMin: 100000,
      budgetMax: 140000,
      headcount: 1,
      skills: ['Product Strategy', 'Agile', 'Jira', 'Data Analysis'],
    },
    {
      title: 'Frontend Developer',
      description: 'Join our frontend team to build beautiful and responsive user interfaces.',
      sectorId: sector.id,
      domainId: domain.id,
      createdById: adminUser.id,
      status: 'OPEN',
      workMode: 'REMOTE',
      location: 'Austin, TX',
      experienceMin: 2,
      experienceMax: 4,
      budgetMin: 80000,
      budgetMax: 110000,
      headcount: 3,
      skills: ['React', 'CSS', 'HTML', 'JavaScript'],
    },
    {
      title: 'Data Scientist',
      description: 'Looking for a Data Scientist to help us analyze and interpret complex data.',
      sectorId: sector.id,
      domainId: domain.id,
      createdById: adminUser.id,
      status: 'DRAFT',
      workMode: 'ONSITE',
      location: 'Seattle, WA',
      experienceMin: 4,
      experienceMax: 7,
      budgetMin: 130000,
      budgetMax: 170000,
      headcount: 1,
      skills: ['Python', 'Machine Learning', 'SQL', 'Data Visualization'],
    }
  ];

  for (const job of dummyJobs) {
    await prisma.jobRequisition.create({
      data: {
        ...job,
        tenantId,
        // An OPEN job is an approved one — carry the provenance a real approval sets.
        ...(job.status === 'OPEN'
          ? { approvedById: adminUser.id, approvedAt: new Date() }
          : {}),
      },
    });
  }

  console.log(`Successfully created ${dummyJobs.length} jobs.`);
}

seedJobs()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
