import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const prisma = new PrismaClient();

function randomDate(start: Date, end: Date) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

async function main() {
  // This script HARD-DELETES data. It builds its own PrismaClient, so it gets
  // none of the app's middleware: no soft-delete (deleteMany is a real DELETE,
  // not a deletedAt stamp) and no tenant scoping (nothing auto-filters or
  // auto-stamps tenantId). Both guards below are load-bearing.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-demo refuses to run with NODE_ENV=production — it hard-deletes data.');
  }
  if (process.env.SEED_DEMO_CONFIRM !== 'yes') {
    throw new Error(
      'seed-demo DESTROYS the demo tenant\'s offers, interviews, candidates and job\n' +
      'requisitions in whatever database DATABASE_URL points at. The deletes are\n' +
      'permanent (no soft-delete middleware on this client).\n' +
      'Re-run with SEED_DEMO_CONFIRM=yes if that is what you want.',
    );
  }

  console.log('Starting comprehensive demo seed...');

  const adminUser = await prisma.user.findFirst({
    where: { email: 'admin@agnohire.local' },
  });

  if (!adminUser) {
    throw new Error('Admin user not found. Please run npm run db:seed first.');
  }
  if (!adminUser.tenantId) {
    throw new Error('Admin user has no tenant. Please run npm run db:seed first.');
  }
  // Every delete and every create below is scoped to this one tenant. Without
  // it, the deleteMany({}) calls wiped every customer's pipeline, not the demo's.
  const tenantId = adminUser.tenantId;

  const sector = await prisma.sector.findFirst({
    where: { name: 'Default' }
  });

  if (!sector) {
    throw new Error('Sector not found.');
  }

  const domains = await prisma.domain.findMany({
    where: { sectorId: sector.id }
  });

  if (!domains.length) {
    throw new Error('No domains found.');
  }

  const engineeringDomain = domains.find(d => d.name === 'Engineering') || domains[0];
  const designDomain = domains.find(d => d.name === 'Design') || domains[0];
  const productDomain = domains.find(d => d.name === 'Product') || domains[0];

  console.log(`Cleaning up existing demo data for tenant ${tenantId}...`);
  // Wipe in reverse dependency order, scoped to the demo tenant. Models that
  // carry no tenantId column of their own are reached through the parent that
  // does (offer / interview / candidate / job), so nothing outside this tenant
  // is ever touched.
  await prisma.onboarding.deleteMany({ where: { offer: { tenantId } } });
  await prisma.offerDocument.deleteMany({ where: { offer: { tenantId } } });
  await prisma.offer.deleteMany({ where: { tenantId } });
  await prisma.pipelineNote.deleteMany({ where: { tenantId } });
  await prisma.candidateAnswer.deleteMany({ where: { interview: { tenantId } } });
  await prisma.interviewFeedback.deleteMany({ where: { interview: { tenantId } } });
  await prisma.panelMember.deleteMany({ where: { interview: { tenantId } } });
  await prisma.interviewResult.deleteMany({ where: { interview: { tenantId } } });
  await prisma.interviewQuestion.deleteMany({ where: { interview: { tenantId } } });
  await prisma.interview.deleteMany({ where: { tenantId } });
  await prisma.interviewSchedule.deleteMany({ where: { tenantId } });
  await prisma.jobApplication.deleteMany({ where: { tenantId } });
  await prisma.resume.deleteMany({ where: { tenantId } });
  await prisma.candidateListItem.deleteMany({ where: { candidate: { tenantId } } });
  await prisma.candidateAssignment.deleteMany({ where: { tenantId } });
  await prisma.candidateList.deleteMany({ where: { tenantId } });
  await prisma.candidate.deleteMany({
    where: { tenantId, email: { not: 'candidate@agnohire.local' } },
  });
  await prisma.approvalWorkflow.deleteMany({ where: { job: { tenantId } } });
  await prisma.jobRequisition.deleteMany({ where: { tenantId } });

  console.log('Creating Job Requisitions...');
  const jobsData = [
    { title: 'Senior Frontend Engineer', domainId: engineeringDomain.id, status: 'OPEN', skills: ['React', 'TypeScript', 'Tailwind'] },
    { title: 'Backend Software Engineer', domainId: engineeringDomain.id, status: 'OPEN', skills: ['Node.js', 'PostgreSQL', 'Docker'] },
    { title: 'Full Stack Developer', domainId: engineeringDomain.id, status: 'OPEN', skills: ['React', 'Node.js', 'Prisma'] },
    { title: 'DevOps Engineer', domainId: engineeringDomain.id, status: 'OPEN', skills: ['AWS', 'Kubernetes', 'CI/CD'] },
    { title: 'UX/UI Designer', domainId: designDomain.id, status: 'OPEN', skills: ['Figma', 'Prototyping', 'User Research'] },
    { title: 'Product Manager', domainId: productDomain.id, status: 'OPEN', skills: ['Agile', 'Jira', 'Roadmapping'] },
    { title: 'Data Scientist', domainId: engineeringDomain.id, status: 'OPEN', skills: ['Python', 'SQL', 'Machine Learning'] },
    { title: 'QA Automation Engineer', domainId: engineeringDomain.id, status: 'DRAFT', skills: ['Selenium', 'Cypress', 'Testing'] },
    { title: 'Engineering Manager', domainId: engineeringDomain.id, status: 'CLOSED', skills: ['Leadership', 'System Design'] },
    { title: 'Marketing Specialist', domainId: productDomain.id, status: 'OPEN', skills: ['SEO', 'Content Strategy'] },
  ];

  const createdJobs = [];
  for (const jd of jobsData) {
    const job = await prisma.jobRequisition.create({
      data: {
        title: jd.title,
        description: `We are looking for a talented ${jd.title} to join our growing team.`,
        sectorId: sector.id,
        domainId: jd.domainId,
        createdById: adminUser.id,
        tenantId,
        status: jd.status,
        workMode: 'HYBRID',
        location: 'San Francisco, CA',
        experienceMin: 3,
        experienceMax: 8,
        budgetMin: 90000,
        budgetMax: 150000,
        headcount: Math.floor(Math.random() * 3) + 1,
        skills: jd.skills,
        createdAt: randomDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), new Date()),
      }
    });
    createdJobs.push(job);
  }

  console.log('Creating Candidates...');
  const firstNames = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
  
  const createdCandidates = [];
  for (let i = 0; i < 20; i++) {
    const first = firstNames[i];
    const last = lastNames[i];
    const cand = await prisma.candidate.create({
      data: {
        fullName: `${first} ${last}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
        phone: `+1555123${i.toString().padStart(4, '0')}`,
        experienceLevel: i % 3 === 0 ? 'Senior' : (i % 2 === 0 ? 'Mid' : 'Junior'),
        skills: ['JavaScript', 'React', 'Node.js', 'Python', 'SQL'].sort(() => 0.5 - Math.random()).slice(0, 3),
        location: 'New York, NY',
        source: ['LinkedIn', 'Job Board', 'Referral', 'Career Site'][i % 4],
        sectorId: sector.id,
        tenantId,
        createdAt: randomDate(new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), new Date()),
      }
    });
    createdCandidates.push(cand);
  }

  console.log('Creating Job Applications and Pipelines...');
  const activeJobs = createdJobs.filter(j => j.status === 'OPEN');
  
  const stages = [
    { stage: 'APPLIED', status: 'APPLIED' },
    { stage: 'SCREENING', status: 'IN_PROGRESS' },
    { stage: 'INTERVIEW', status: 'IN_PROGRESS' },
    { stage: 'OFFER', status: 'OFFER_EXTENDED' },
    { stage: 'HIRED', status: 'HIRED' },
    { stage: 'REJECTED', status: 'REJECTED' },
  ];

  for (let i = 0; i < createdCandidates.length; i++) {
    const candidate = createdCandidates[i];
    const job = activeJobs[i % activeJobs.length];
    const stageInfo = stages[i % stages.length];
    const fitScore = parseFloat((Math.random() * 40 + 60).toFixed(1)); // 60 to 100

    const app = await prisma.jobApplication.create({
      data: {
        candidateId: candidate.id,
        jobRequisitionId: job.id,
        tenantId,
        stage: stageInfo.stage,
        status: stageInfo.status,
        fitScore,
        createdAt: randomDate(job.createdAt, new Date()),
      }
    });

    if (stageInfo.stage === 'INTERVIEW' || stageInfo.stage === 'OFFER' || stageInfo.stage === 'HIRED') {
      const interview = await prisma.interview.create({
        data: {
          candidateId: candidate.id,
          recruiterId: adminUser.id,
          tenantId,
          status: stageInfo.stage === 'INTERVIEW' ? 'SCHEDULED' : 'COMPLETED',
          type: 'PANEL',
          createdAt: randomDate(app.createdAt, new Date()),
        }
      });

      await prisma.panelMember.create({
        data: {
          interviewId: interview.id,
          userId: adminUser.id,
          status: 'ACCEPTED',
        }
      });
      
      if (stageInfo.stage === 'OFFER' || stageInfo.stage === 'HIRED') {
         await prisma.offer.create({
           data: {
             applicationId: app.id,
             candidateId: candidate.id,
             jobId: job.id,
             offeredById: adminUser.id,
             tenantId,
             status: stageInfo.stage === 'HIRED' ? 'ACCEPTED' : 'SENT',
             salaryOffered: 120000,
             validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
           }
         });
      }
    }
  }

  console.log('Demo data successfully seeded!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
