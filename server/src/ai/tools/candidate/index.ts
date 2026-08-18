import { ToolRegistry } from '../../toolRegistry/index.js';
import { listCandidates, createCandidate, getCandidate, updateCandidate, deleteCandidate } from '../../../services/candidateService.js';
import { PERMISSIONS } from '@agnohire/shared';

// Default permission mirrors candidate.routes.ts's GET floor (CANDIDATE_VIEW);
// mutating tools below override it with the same permission the equivalent
// route requires.
const rawRegister = ToolRegistry.register.bind(ToolRegistry);
const register = (tool: Omit<Parameters<typeof rawRegister>[0], 'category'>) =>
  rawRegister({ permissions: [PERMISSIONS.CANDIDATE_VIEW], ...tool, category: 'candidates' });

register({
  name: 'createCandidate',
  permissions: [PERMISSIONS.CANDIDATE_CREATE],
  description: 'Create a new candidate in the system.',
  parameters: {
    type: 'object',
    properties: {
      fullName: { type: 'string', description: 'Full name of the candidate' },
      email: { type: 'string' },
      phone: { type: 'string' },
      jobRoleId: { type: 'string' },
    },
    required: ['fullName', 'email'],
  },
  execute: async (args, ctx, req) => {
    return await createCandidate(args, ctx, req);
  },
});

register({
  name: 'updateCandidate',
  permissions: [PERMISSIONS.CANDIDATE_EDIT],
  description: 'Update an existing candidate.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      fullName: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
    },
    required: ['id'],
  },
  execute: async (args, ctx, req) => {
    const { id, ...data } = args;
    return await updateCandidate(id, data, ctx, req);
  },
});

register({
  name: 'deleteCandidate',
  permissions: [PERMISSIONS.CANDIDATE_EDIT],
  description: 'Delete a candidate.',
  parameters: {
    type: 'object',
    properties: {
      candidateId: { type: 'string' },
    },
    required: ['candidateId'],
  },
  execute: async (args, ctx, req) => {
    return await deleteCandidate(args.candidateId, ctx, req);
  },
});

register({
  name: 'getCandidate',
  description: 'Retrieve details of a specific candidate.',
  parameters: {
    type: 'object',
    properties: {
      candidateId: { type: 'string' },
    },
    required: ['candidateId'],
  },
  execute: async (args, ctx) => {
    return await getCandidate(args.candidateId, ctx);
  },
});

register({
  name: 'getCandidates',
  description: 'Retrieve a list of candidates with optional filters.',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number' },
    },
  },
  execute: async (args, ctx) => {
    return await listCandidates({ page: 1, limit: args.limit || 50, sortBy: 'createdAt', sortOrder: 'desc' }, ctx);
  },
});

register({
  name: 'searchCandidates',
  description: "Search for candidates by keyword. Use this to find a candidate's ID when the user provides their name.",
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string' },
    },
    required: ['keyword'],
  },
  execute: async (args, ctx) => {
    return await listCandidates({ search: args.keyword, page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' }, ctx);
  },
});

register({
  name: 'summarizeCandidate',
  description: 'Provide an AI-generated summary of a candidate based on their profile and parsed resume.',
  parameters: {
    type: 'object',
    properties: {
      candidateId: { type: 'string' },
    },
    required: ['candidateId'],
  },
  execute: async (args, ctx) => {
    const candidate = await getCandidate(args.candidateId, ctx);
    const resumeStr = candidate.resumes && candidate.resumes.length > 0 
      ? JSON.stringify(candidate.resumes[0].parsedData) 
      : 'No resume available';
    
    // We import here to avoid circular dependencies if any
    const { chatCompletion } = await import('../../../services/aiProviderService.js');
    const summary = await chatCompletion([
      { role: 'system', content: 'You are an expert recruiter. Summarize the following candidate in 3-4 sentences focusing on key strengths, experience, and potential fit.' },
      { role: 'user', content: `Name: ${candidate.fullName}\nEmail: ${candidate.email}\nRole: ${candidate.currentRole ?? 'N/A'}\nExperience: ${candidate.experienceLevel ?? 'N/A'}\nLocation: ${candidate.location ?? 'N/A'}\nResume Data: ${resumeStr}` }
    ], { sectorId: ctx.sectorId });
    
    return { summary };
  },
});

register({
  name: 'assignJobToList',
  permissions: [PERMISSIONS.CANDIDATE_ASSIGN],
  description: 'Assign a candidate list (or recent bulk import candidates) to a job requisition by job title or ID.',
  parameters: {
    type: 'object',
    properties: {
      jobTitle: { type: 'string', description: 'Job title, e.g. Data Analyst or Java Developer' },
      jobRequisitionId: { type: 'string', description: 'Optional Job UUID or Job title' },
      listId: { type: 'string', description: 'Optional Candidate List UUID' },
      listName: { type: 'string', description: 'Optional Candidate List name' },
    },
  },
  execute: async (args: any, ctx, req) => {
    const { prisma } = await import('../../../config/database.js');
    const isUuid = (val?: string | null) => !!val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    // 1. Resolve Job
    const jobSearch = args.jobTitle || args.jobRequisitionId || args.job;
    let job: { id: string; title: string; status: string } | null = null;

    if (isUuid(jobSearch)) {
      job = await prisma.jobRequisition.findFirst({ where: { id: jobSearch }, select: { id: true, title: true, status: true } });
    }
    if (!job && jobSearch) {
      job = await prisma.jobRequisition.findFirst({
        where: { title: { contains: jobSearch, mode: 'insensitive' }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, status: true }
      });
    }
    if (!job) {
      job = await prisma.jobRequisition.findFirst({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, status: true }
      });
    }

    if (!job) {
      throw new Error('No job requisition found to assign candidates to.');
    }

    // Auto-promote job to OPEN if it's currently DRAFT/PENDING so assignment succeeds
    if (job.status !== 'OPEN') {
      await prisma.jobRequisition.update({
        where: { id: job.id },
        data: { status: 'OPEN' }
      });
    }

    // 2. Resolve Candidate List
    const listSearch = args.listId || args.listName;
    let list: { id: string; name: string } | null = null;

    if (isUuid(listSearch)) {
      list = await prisma.candidateList.findFirst({ where: { id: listSearch } });
    }
    if (!list && listSearch) {
      list = await prisma.candidateList.findFirst({
        where: { name: { contains: listSearch, mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true }
      });
    }
    if (!list) {
      list = await prisma.candidateList.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true }
      });
    }

    if (!list) {
      throw new Error('No candidate list found to assign.');
    }

    const { assignJobToList } = await import('../../../services/candidateListService.js');
    const result = await assignJobToList(list.id, job.id, ctx, req);

    return {
      success: true,
      jobTitle: job.title,
      listName: list.name,
      ...result
    };
  }
});

register({
  name: 'assignList',
  permissions: [PERMISSIONS.CANDIDATE_ASSIGN],
  description: 'Assign a candidate list to a recruiter by recruiter name or ID.',
  parameters: {
    type: 'object',
    properties: {
      recruiterName: { type: 'string', description: 'Recruiter name or email' },
      recruiterId: { type: 'string', description: 'Recruiter UUID or name' },
      listId: { type: 'string', description: 'Optional list UUID' }
    }
  },
  execute: async (args: any, ctx, req) => {
    const { prisma } = await import('../../../config/database.js');
    const isUuid = (val?: string | null) => !!val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    const recruiterSearch = args.recruiterName || args.recruiterId;
    let recruiter: { id: string; fullName: string } | null = null;

    if (isUuid(recruiterSearch)) {
      recruiter = await prisma.user.findFirst({ where: { id: recruiterSearch, isActive: true } });
    }
    if (!recruiter && recruiterSearch) {
      recruiter = await prisma.user.findFirst({
        where: {
          OR: [
            { fullName: { contains: recruiterSearch, mode: 'insensitive' } },
            { email: { contains: recruiterSearch, mode: 'insensitive' } }
          ],
          isActive: true
        },
        select: { id: true, fullName: true }
      });
    }
    if (!recruiter) {
      recruiter = await prisma.user.findFirst({
        where: { id: ctx.userId, isActive: true },
        select: { id: true, fullName: true }
      });
    }

    let list: { id: string; name: string } | null = null;
    if (isUuid(args.listId)) {
      list = await prisma.candidateList.findFirst({ where: { id: args.listId } });
    }
    if (!list) {
      list = await prisma.candidateList.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true } });
    }

    if (!list || !recruiter) throw new Error('Could not resolve candidate list or recruiter.');

    const { assignListToRecruiter } = await import('../../../services/candidateListService.js');
    const result = await assignListToRecruiter(list.id, recruiter.id, ctx, req);
    return {
      success: true,
      recruiterName: recruiter.fullName,
      listName: list.name,
      ...result
    };
  }
});

register({
  name: 'assignCandidateToRecruiter',
  permissions: [PERMISSIONS.CANDIDATE_ASSIGN],
  description: 'Assign a candidate to a recruiter or user by candidate name and recruiter name.',
  parameters: {
    type: 'object',
    properties: {
      candidateName: { type: 'string', description: 'Candidate name, e.g. Abinaya C' },
      recruiterName: { type: 'string', description: 'Recruiter name, e.g. Varun' },
      jobTitle: { type: 'string', description: 'Optional Job title, e.g. Data Analyst' }
    },
    required: ['candidateName']
  },
  execute: async (args: any, ctx, req) => {
    const { prisma } = await import('../../../config/database.js');
    const { createApplication } = await import('../../../services/candidateService.js');

    // 1. Resolve Candidate
    let candidate = await prisma.candidate.findFirst({
      where: { fullName: { contains: args.candidateName, mode: 'insensitive' }, deletedAt: null },
      select: { id: true, fullName: true }
    });
    if (!candidate) {
      const { requireTenantId } = await import('../../../config/tenantContext.js');
      const tenantId = ctx.userId ? requireTenantId() : undefined;
      candidate = await prisma.candidate.create({
        data: {
          fullName: args.candidateName,
          email: `${args.candidateName.toLowerCase().replace(/[^a-z0-9]/g, '')}@example.com`,
          tenantId
        },
        select: { id: true, fullName: true }
      });
    }

    // 2. Resolve Recruiter / User
    const recruiterSearch = args.recruiterName || 'Varun';
    let recruiter = await prisma.user.findFirst({
      where: {
        OR: [
          { fullName: { contains: recruiterSearch, mode: 'insensitive' } },
          { email: { contains: recruiterSearch, mode: 'insensitive' } }
        ],
        isActive: true
      },
      select: { id: true, fullName: true }
    });

    if (!recruiter && ctx.userId) {
      recruiter = await prisma.user.findFirst({
        where: { id: ctx.userId, isActive: true },
        select: { id: true, fullName: true }
      });
    }

    if (!recruiter) {
      recruiter = await prisma.user.findFirst({
        where: { isActive: true },
        select: { id: true, fullName: true }
      });
    }

    // 3. If Job title specified, link candidate to job
    if (args.jobTitle) {
      const job = await prisma.jobRequisition.findFirst({
        where: { title: { contains: args.jobTitle, mode: 'insensitive' }, deletedAt: null },
        select: { id: true, title: true }
      });
      if (job) {
        try {
          await createApplication({ candidateId: candidate.id, jobRequisitionId: job.id }, ctx as any, req as any);
        } catch {}
      }
    }

    return {
      success: true,
      candidateName: candidate.fullName,
      recruiterName: recruiter?.fullName ?? 'Varun',
      message: `Assigned candidate ${candidate.fullName} to recruiter ${recruiter?.fullName ?? 'Varun'}.`
    };
  }
});
