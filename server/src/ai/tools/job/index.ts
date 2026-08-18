import { ToolRegistry } from '../../toolRegistry/index.js';
import { listJobs, createJob, getJob, updateJob, deleteJob, resolveSectorAndDomain, generateJd } from '../../../services/jobService.js';
import { PERMISSIONS } from '@agnohire/shared';

// Default mirrors job.routes.ts's GET floor (JOB_VIEW); mutations below
// override it with the same permission the equivalent route requires.
const rawRegister = ToolRegistry.register.bind(ToolRegistry);
const register = (tool: Omit<Parameters<typeof rawRegister>[0], 'category'>) =>
  rawRegister({ permissions: [PERMISSIONS.JOB_VIEW], ...tool, category: 'jobs' });

register({
  name: 'createJob',
  permissions: [PERMISSIONS.JOB_CREATE],
  description: 'Create a new job requisition in the recruitment module. You only need to pass title. Sector, domain, skills, description, and rounds are automatically resolved and populated.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Job title, e.g. Java Developer' },
      description: { type: 'string', description: 'Optional job description. Auto-generated if omitted.' },
      sectorName: { type: 'string', description: 'Name of the sector, e.g. IT' },
      sectorId: { type: 'string', description: 'Optional sector UUID or sector name' },
      domainName: { type: 'string', description: 'Name of the domain, e.g. Developer' },
      domainId: { type: 'string', description: 'Optional domain UUID or domain name' },
      workMode: { type: 'string', enum: ['ONSITE', 'REMOTE', 'HYBRID'], description: 'Work mode' },
      location: { type: 'string', description: 'Job location city' },
      experienceMin: { type: 'number', description: 'Minimum years of experience required' },
      experienceMax: { type: 'number', description: 'Maximum years of experience required' },
      budgetMin: { type: 'number', description: 'Minimum salary budget' },
      budgetMax: { type: 'number', description: 'Maximum salary budget' },
      headcount: { type: 'integer', description: 'Number of open positions (default 1)' },
      skills: { type: 'array', items: { type: 'string' }, description: 'List of required skills' },
      workflowRounds: {
        type: 'array',
        description: 'Interview workflow stages',
        items: {
          type: 'object',
          properties: {
            roundName: { type: 'string', description: 'Name of the round, e.g. Aptitude Test' },
            roundType: { type: 'string', description: 'Type of round, e.g. ASSESSMENT or INTERVIEW' },
            passPercentage: { type: 'integer', description: 'Pass threshold percentage' }
          }
        }
      }
    },
    required: ['title'],
  },
  execute: async (args: any, ctx, req) => {
    const sectorInput = args.sectorName || args.sectorId;
    const domainInput = args.domainName || args.domainId;

    const { sectorId, domainId } = await resolveSectorAndDomain(sectorInput, domainInput);

    let skills = Array.isArray(args.skills) && args.skills.length > 0 ? args.skills : [];
    if (skills.length === 0) {
      const lower = (args.title || '').toLowerCase();
      if (lower.includes('java')) {
        skills = ['Java', 'Spring Boot', 'Microservices', 'REST API', 'SQL', 'Maven'];
      } else if (lower.includes('react') || lower.includes('frontend')) {
        skills = ['React', 'TypeScript', 'JavaScript', 'HTML5/CSS3', 'Redux', 'REST API'];
      } else if (lower.includes('python')) {
        skills = ['Python', 'Django', 'FastAPI', 'PostgreSQL', 'Docker', 'REST API'];
      } else if (lower.includes('node') || lower.includes('backend')) {
        skills = ['Node.js', 'TypeScript', 'Express', 'PostgreSQL', 'Redis', 'REST API'];
      } else {
        skills = ['Problem Solving', 'Communication', 'Team Collaboration', 'Software Architecture'];
      }
    }

    let workflowRounds = Array.isArray(args.workflowRounds) && args.workflowRounds.length > 0 ? args.workflowRounds : [];
    if (workflowRounds.length === 0) {
      workflowRounds = [
        { roundName: 'Aptitude Test', roundType: 'ASSESSMENT', passPercentage: 70 },
        { roundName: 'Technical Discussion', roundType: 'INTERVIEW' },
        { roundName: 'Final Discussion', roundType: 'INTERVIEW' }
      ];
    } else {
      workflowRounds = workflowRounds.map((r: any) => {
        const typeStr = (r.roundType || r.type || '').toUpperCase();
        let normalizedType = 'INTERVIEW';
        if (typeStr.includes('APTITUDE') || typeStr.includes('ASSESSMENT') || typeStr.includes('TEST') || typeStr.includes('MCQ')) {
          normalizedType = 'ASSESSMENT';
        }
        return {
          roundName: r.roundName || r.name || 'Interview Round',
          roundType: normalizedType,
          passPercentage: r.passPercentage != null ? Number(r.passPercentage) : (normalizedType === 'ASSESSMENT' ? 70 : null)
        };
      });
    }

    // When the caller didn't supply a description, actually generate one via
    // AI (the same service the standalone `generateJd` tool and the UI's
    // "Generate with AI" button use) rather than stuffing in a canned
    // placeholder paragraph — this job is flagged `aiGeneratedJd: true`
    // below, so it must really be AI-generated content, not a stub.
    let description = args.description;
    if (!description || description.trim().length < 10) {
      description = await generateJd({
        title: args.title,
        domain: domainInput || 'General',
        skills,
        experienceMin: args.experienceMin != null ? Number(args.experienceMin) : undefined,
        experienceMax: args.experienceMax != null ? Number(args.experienceMax) : undefined,
        budgetMin: args.budgetMin != null ? Number(args.budgetMin) : undefined,
        budgetMax: args.budgetMax != null ? Number(args.budgetMax) : undefined,
        workMode: args.workMode,
        location: args.location,
        workflowRounds,
      });
    }

    const payload = {
      title: args.title,
      description,
      sectorId,
      domainId,
      workMode: args.workMode || 'REMOTE',
      location: args.location || '',
      experienceMin: args.experienceMin != null ? Number(args.experienceMin) : null,
      experienceMax: args.experienceMax != null ? Number(args.experienceMax) : null,
      budgetMin: args.budgetMin != null ? Number(args.budgetMin) : null,
      budgetMax: args.budgetMax != null ? Number(args.budgetMax) : null,
      headcount: args.headcount ? Number(args.headcount) : 1,
      skills,
      aiGeneratedJd: true,
      workflowRounds
    };

    return await createJob(payload as any, ctx, req);
  },
});

register({
  name: 'updateJob',
  permissions: [PERMISSIONS.JOB_EDIT],
  description: 'Update an existing job requisition.',
  parameters: {
    type: 'object',
    properties: {
      jobId: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['jobId'],
  },
  execute: async (args, ctx, req) => {
    const { jobId, ...data } = args;
    return await updateJob(jobId, data, ctx, req);
  },
});

register({
  name: 'deleteJob',
  permissions: [PERMISSIONS.JOB_DELETE],
  description: 'Delete a job requisition.',
  parameters: {
    type: 'object',
    properties: {
      jobId: { type: 'string' },
    },
    required: ['jobId'],
  },
  execute: async (args, ctx, req) => {
    return await deleteJob(args.jobId, ctx, req);
  },
});

register({
  name: 'getJobs',
  description: 'List job requisitions.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async (_args, ctx) => {
    return await listJobs({ page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' }, ctx);
  },
});

register({
  name: 'searchJobs',
  description: 'Search job requisitions by keyword. Use this to find a job ID when the user provides the title.',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string' },
    },
    required: ['keyword'],
  },
  execute: async (args, ctx) => {
    return await listJobs({ search: args.keyword, page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' }, ctx);
  },
});

register({
  name: 'getJob',
  description: 'Get details of a specific job.',
  parameters: {
    type: 'object',
    properties: {
      jobId: { type: 'string' },
    },
    required: ['jobId'],
  },
  execute: async (args, ctx) => {
    return await getJob(args.jobId, ctx);
  },
});
