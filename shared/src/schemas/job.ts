import { z } from 'zod';

const jobBase = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  sectorId: z.string().uuid('Please select a sector'),
  domainId: z.string().uuid('Please select a domain'),
  workMode: z.enum(['ONSITE', 'REMOTE', 'HYBRID']).optional(),
  location: z.string().max(200).optional().or(z.literal('')),
  experienceMin: z.coerce.number().int().min(0).max(50).optional().nullable(),
  experienceMax: z.coerce.number().int().min(0).max(50).optional().nullable(),
  budgetMin: z.coerce.number().min(0).optional().nullable(),
  budgetMax: z.coerce.number().min(0).optional().nullable(),
  headcount: z.coerce.number().int().min(1, 'Headcount must be at least 1').default(1),
  skills: z.array(z.string().min(1)).default([]),
  deadline: z.string().datetime({ offset: true }).optional().nullable(),
  templateId: z.string().uuid().optional().nullable(),
  aiGeneratedJd: z.boolean().optional().default(false),
  workflowRounds: z.array(
    z.object({
      roundName: z.string().min(1, 'Round name is required'),
      roundType: z.string().min(1, 'Round type is required'),
      passPercentage: z.coerce.number().min(0).max(100).optional().nullable(),
      isMandatory: z.boolean().optional(),
      autoProgression: z.boolean().optional(),
    })
  ).optional().default([]),
});

export const createJobSchema = jobBase
  .refine(
    (d) =>
      d.experienceMin == null ||
      d.experienceMax == null ||
      d.experienceMax >= d.experienceMin,
    { message: 'Max experience must be ≥ min', path: ['experienceMax'] },
  )
  .refine(
    (d) =>
      d.budgetMin == null || d.budgetMax == null || d.budgetMax > d.budgetMin,
    { message: 'Max budget must be > min', path: ['budgetMax'] },
  );

export type CreateJobInput = z.infer<typeof createJobSchema>;

export const updateJobSchema = jobBase.partial();
export type UpdateJobInput = z.infer<typeof updateJobSchema>;

export const jobFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  search: z.string().optional(),
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'CLOSED', 'REJECTED']).optional(),
  domainId: z.string().uuid().optional(),
  sectorId: z.string().uuid().optional(),
  workMode: z.enum(['ONSITE', 'REMOTE', 'HYBRID']).optional(),
  sortBy: z.enum(['createdAt', 'deadline', 'title', 'headcount']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type JobFilters = z.infer<typeof jobFiltersSchema>;

export const submitJobSchema = z.object({
  approverId: z.string().uuid('Please select an approver'),
});

export const approveJobSchema = z.object({
  comments: z.string().max(500).optional(),
});

export const rejectJobSchema = z.object({
  comments: z.string().min(1, 'Rejection reason is required').max(500),
});

export const generateJdSchema = z.object({
  title: z.string().min(3, 'Job title is required'),
  domain: z.string().min(1, 'Domain is required'),
  skills: z.array(z.string()).default([]),
  experienceMin: z.coerce.number().optional().nullable(),
  experienceMax: z.coerce.number().optional().nullable(),
  budgetMin: z.coerce.number().optional().nullable(),
  budgetMax: z.coerce.number().optional().nullable(),
  workMode: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  workflowRounds: z.array(
    z.object({
      roundName: z.string(),
      roundType: z.string(),
    })
  ).optional().nullable(),
  additionalContext: z.string().max(2000).optional().nullable(),
});

export type GenerateJdInput = z.infer<typeof generateJdSchema>;

export const createJobTemplateSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(1000),
  sectorId: z.string().uuid('Sector is required'),
  domainId: z.string().uuid().optional().nullable(),
  description: z.string().max(2000).optional(),
  skills: z.array(z.string()).default([]),
  experienceMin: z.coerce.number().int().min(0).optional(),
  experienceMax: z.coerce.number().int().min(0).optional(),
  workMode: z.enum(['ONSITE', 'REMOTE', 'HYBRID']).optional(),
  workflowRounds: z.array(
    z.object({
      roundName: z.string().min(1, 'Round name is required'),
      roundType: z.string().min(1, 'Round type is required'),
      passPercentage: z.coerce.number().min(0).max(100).optional().nullable(),
      isMandatory: z.boolean().optional(),
      autoProgression: z.boolean().optional(),
    })
  ).optional().default([]),
});

export type CreateJobTemplateInput = z.infer<typeof createJobTemplateSchema>;

export const updateJobTemplateSchema = createJobTemplateSchema.partial();
export type UpdateJobTemplateInput = z.infer<typeof updateJobTemplateSchema>;

export const generateCompleteRequisitionSchema = z.object({
  jobTitle: z.string().min(1),
  department: z.string().optional(),
  experience: z.string().optional(),
  location: z.string().optional(),
  employmentType: z.string().optional(),
  industry: z.string().optional(),
});
export type GenerateCompleteRequisitionInput = z.infer<typeof generateCompleteRequisitionSchema>;

export const completeRequisitionOutputSchema = z.object({
  jobDescription: z.string(),
  responsibilities: z.array(z.string()),
  requiredSkills: z.array(z.string()),
  preferredSkills: z.array(z.string()),
  qualifications: z.array(z.string()),
  salaryRecommendation: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    recommended: z.number().optional(),
    confidence: z.number().optional(),
    basedOn: z.string().optional(),
  }).optional(),
  interviewWorkflow: z.array(z.object({
    roundName: z.string(),
    roundType: z.string(),
  })),
  assessmentRecommendation: z.object({
    type: z.string(),
    difficulty: z.string(),
    duration: z.string(),
    passingScore: z.number(),
    topics: z.array(z.string()),
  }).optional(),
  hiringTimeline: z.object({
    applicationCollection: z.string(),
    screening: z.string(),
    assessment: z.string(),
    interview: z.string(),
    offer: z.string(),
    estimatedTimeToFill: z.string(),
  }).optional(),
  recruitmentStrategy: z.array(z.string()).optional(),
  executiveSummary: z.string().optional(),
});

export const jobCopilotMessageSchema = z.object({
  context: z.record(z.any()), // current form values
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })),
});
export type JobCopilotInput = z.infer<typeof jobCopilotMessageSchema>;

export const jobCopilotOutputSchema = z.object({
  intent: z.string(),
  extractedFields: z.record(z.any()),
  missingFields: z.array(z.string()),
  generatedContent: z.string().optional(),
  updatedForm: z.record(z.any()).optional(), // specific fields to update in the UI
});

export const reviewRequisitionSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  sectorId: z.string().optional(),
  domainId: z.string().optional(),
  experienceMin: z.number().optional(),
  experienceMax: z.number().optional(),
  skills: z.array(z.string()).optional(),
  location: z.string().optional(),
  workMode: z.string().optional(),
  headcount: z.number().optional(),
});
export type ReviewRequisitionInput = z.infer<typeof reviewRequisitionSchema>;

export const reviewRequisitionOutputSchema = z.object({
  qualityScore: z.number().min(0).max(100),
  missingInformation: z.array(z.string()),
  biasCheck: z.string().nullable(),
  complianceCheck: z.string().nullable(),
  readabilityScore: z.string(),
  duplicateWarning: z.string().nullable(),
  suggestions: z.array(z.string())
});
export type ReviewRequisitionOutput = z.infer<typeof reviewRequisitionOutputSchema>;
