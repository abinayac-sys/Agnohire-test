import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as jobService from '../services/jobService.js';
import type { JobContext } from '../services/jobService.js';

function ctx(req: Request): JobContext {
  return {
    userId: req.user!.sub,
    role: req.user!.role,
    sectorId: req.user!.sectorId,
    permissions: req.user!.permissions,
  };
}

export const getJobStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await jobService.getJobStats(ctx(req));
  return ok(res, { stats });
});

export const listJobs = asyncHandler(async (req: Request, res: Response) => {
  const { jobFiltersSchema } = await import('@agnohire/shared');
  const filters = jobFiltersSchema.parse(req.query);
  const result = await jobService.listJobs(filters, ctx(req));
  return ok(res, result);
});

export const getJob = asyncHandler(async (req: Request, res: Response) => {
  const job = await jobService.getJob(req.params.id, ctx(req));
  return ok(res, { job });
});

export const createJob = asyncHandler(async (req: Request, res: Response) => {
  const { createJobSchema } = await import('@agnohire/shared');
  const data = createJobSchema.parse(req.body);
  const job = await jobService.createJob(data, ctx(req), req);
  return ok(res, { job }, 201);
});

export const updateJob = asyncHandler(async (req: Request, res: Response) => {
  const { updateJobSchema } = await import('@agnohire/shared');
  const data = updateJobSchema.parse(req.body);
  const job = await jobService.updateJob(req.params.id, data, ctx(req), req);
  return ok(res, { job });
});

export const deleteJob = asyncHandler(async (req: Request, res: Response) => {
  await jobService.deleteJob(req.params.id, ctx(req), req);
  return ok(res, { deleted: true });
});

export const submitJob = asyncHandler(async (req: Request, res: Response) => {
  const { submitJobSchema } = await import('@agnohire/shared');
  const { approverId } = submitJobSchema.parse(req.body);
  await jobService.submitJob(req.params.id, approverId, ctx(req), req);
  return ok(res, { submitted: true });
});

export const approveJob = asyncHandler(async (req: Request, res: Response) => {
  const { approveJobSchema } = await import('@agnohire/shared');
  const { comments } = approveJobSchema.parse(req.body);
  await jobService.approveJob(req.params.id, ctx(req), req, comments);
  return ok(res, { approved: true });
});

export const rejectJob = asyncHandler(async (req: Request, res: Response) => {
  const { rejectJobSchema } = await import('@agnohire/shared');
  const { comments } = rejectJobSchema.parse(req.body);
  await jobService.rejectJob(req.params.id, comments, ctx(req), req);
  return ok(res, { rejected: true });
});

export const closeJob = asyncHandler(async (req: Request, res: Response) => {
  await jobService.closeJob(req.params.id, ctx(req), req);
  return ok(res, { closed: true });
});

export const reopenJob = asyncHandler(async (req: Request, res: Response) => {
  await jobService.reopenJob(req.params.id, ctx(req), req);
  return ok(res, { reopened: true });
});

export const generateJd = asyncHandler(async (req: Request, res: Response) => {
  const { generateJdSchema } = await import('@agnohire/shared');
  const data = generateJdSchema.parse(req.body);
  try {
    const jd = await jobService.generateJd(data);
    return ok(res, { jd });
  } catch (err: any) {
    // If OpenAI or AI configuration fails, provide a fallback JD so the user can continue
    const fallbackJd = `# ${data.title}

## Company Overview
We are a progressive, tech-first company empowering our team to excel and innovate.

## About the Role
We are actively looking for a skilled ${data.title} to join our ${data.domain} department.

## Key Responsibilities
- Drive key initiatives in the ${data.domain} domain.
- Collaborate with cross-functional teams to deliver high-quality results.
- Contribute to the continuous improvement of our processes.

## Requirements
- **Experience:** ${data.experienceMin != null ? `${data.experienceMin}+ years` : 'Relevant experience required'}
- **Skills:** ${data.skills && data.skills.length > 0 ? data.skills.join(', ') : 'Relevant industry skills'}
- **Work Mode:** ${data.workMode || 'As specified'}
- **Location:** ${data.location || 'As specified'}

## Equal Opportunity
We are an equal opportunity employer and value diversity at our company.`;

    return ok(res, { jd: fallbackJd });
  }
});

export const generateCompleteRequisition = asyncHandler(async (req: Request, res: Response) => {
  const { generateCompleteRequisitionSchema } = await import('@agnohire/shared');
  const data = generateCompleteRequisitionSchema.parse(req.body);
  try {
    const result = await jobService.generateCompleteRequisition(data);
    return ok(res, result);
  } catch (err: any) {
    const fallbackResult = {
      jobDescription: `# ${data.jobTitle}\n\n## Company Overview\nWe are a progressive, tech-first company.\n\n## About the Role\nWe are looking for a skilled ${data.jobTitle} to join our ${data.department || 'team'}.\n\n## Requirements\n- Experience: ${data.experience || 'Not specified'}\n- Location: ${data.location || 'Not specified'}\n- Work Mode: ${data.employmentType || 'Not specified'}\n\n## Equal Opportunity\nWe are an equal opportunity employer.`,
      responsibilities: ['Drive key initiatives.', 'Collaborate with teams.', 'Improve processes.'],
      requiredSkills: ['Communication', 'Teamwork', 'Problem Solving', 'Leadership', 'Project Management'],
      preferredSkills: ['Agile', 'Scrum'],
      qualifications: ['Bachelor Degree'],
      salaryRecommendation: { min: 0, max: 0, recommended: 0, confidence: 0, basedOn: 'Fallback data' },
      interviewWorkflow: [
        { roundName: 'Assessment', roundType: 'ASSESSMENT' },
        { roundName: 'Technical Interview', roundType: 'INTERVIEW' },
        { roundName: 'Final Discussion', roundType: 'INTERVIEW' }
      ],
      assessmentRecommendation: { type: 'General', difficulty: 'Medium', duration: '60 mins', passingScore: 70, topics: ['General'] },
      hiringTimeline: { applicationCollection: '1 week', screening: '1 week', assessment: '1 week', interview: '1 week', offer: '1 week', estimatedTimeToFill: '1 month' },
      recruitmentStrategy: ['LinkedIn'],
      executiveSummary: 'Fallback recruitment plan.'
    };
    return ok(res, fallbackResult);
  }
});

export const jobCopilot = asyncHandler(async (req: Request, res: Response) => {
  const { jobCopilotMessageSchema } = await import('@agnohire/shared');
  const data = jobCopilotMessageSchema.parse(req.body);
  const result = await jobService.jobCopilot(data);
  return ok(res, result);
});

export const reviewRequisition = asyncHandler(async (req: Request, res: Response) => {
  const { reviewRequisitionSchema } = await import('@agnohire/shared');
  const data = reviewRequisitionSchema.parse(req.body);
  const result = await jobService.reviewRequisition(data, req.user!.tenantId!);
  return ok(res, result);
});

export const listApprovers = asyncHandler(async (req: Request, res: Response) => {
  const sectorId = req.user!.role === 'SUPERADMIN' || req.user!.role === 'ADMIN'
    ? undefined
    : req.user!.sectorId;
  const approvers = await jobService.listApprovers(sectorId);
  return ok(res, { approvers });
});

// ─── TEMPLATES ───────────────────────────────────────────────────────────────

export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
  const domainId = typeof req.query.domainId === 'string' ? req.query.domainId : undefined;
  const page = Number(req.query.page ?? 1);
  const limit = Math.min(Number(req.query.limit ?? 25), 100);
  const result = await jobService.listTemplates(domainId, page, limit);
  return ok(res, result);
});

export const getTemplate = asyncHandler(async (req: Request, res: Response) => {
  const t = await jobService.getTemplate(req.params.id);
  return ok(res, { template: t });
});

export const createTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { createJobTemplateSchema } = await import('@agnohire/shared');
  const data = createJobTemplateSchema.parse(req.body);
  const t = await jobService.createTemplate(data, req);
  return ok(res, { template: t }, 201);
});

export const updateTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { updateJobTemplateSchema } = await import('@agnohire/shared');
  const data = updateJobTemplateSchema.parse(req.body);
  const t = await jobService.updateTemplate(req.params.id, data, req);
  return ok(res, { template: t });
});

export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
  await jobService.deleteTemplate(req.params.id, req);
  return ok(res, { deleted: true });
});

export const downloadJobPdf = asyncHandler(async (req: Request, res: Response) => {
  const { generateJobRequisitionPDF } = await import('../services/pdfReportService.js');
  
  // Ensure the job exists and user has access
  await jobService.getJob(req.params.id, ctx(req));

  const timezone = req.headers['x-timezone'] as string || 'UTC';
  const { buffer, filename } = await generateJobRequisitionPDF(req.params.id, timezone, ctx(req));

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});
