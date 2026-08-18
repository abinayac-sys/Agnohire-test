import type { JobStatus, WorkMode } from '../constants/enums.js';

export interface ApprovalWorkflowItem {
  id: string;
  approverId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  comments: string | null;
  actionedAt: string | null;
  createdAt: string;
}

export interface JobListItem {
  id: string;
  title: string;
  status: JobStatus;
  workMode: WorkMode | null;
  location: string | null;
  headcount: number;
  filled: number;
  deadline: string | null;
  aiGeneratedJd: boolean;
  createdAt: string;
  updatedAt: string;
  domain: { id: string; name: string };
  sector: { id: string; name: string };
  createdBy: { id: string; fullName: string };
  approvedBy: { id: string; fullName: string } | null;
  _count: { applications: number };
}

export interface JobDetail extends JobListItem {
  description: string;
  experienceMin: number | null;
  experienceMax: number | null;
  budgetMin: string | null;
  budgetMax: string | null;
  skills: string[];
  approvedAt: string | null;
  closedAt: string | null;
  templateId: string | null;
  approvalWorkflows: ApprovalWorkflowItem[];
  workflowRounds: {
    id: string;
    roundName: string;
    roundType: string;
    passPercentage: number | null;
    isMandatory: boolean;
    autoProgression: boolean;
    orderIndex: number;
  }[];
}

export interface JobTemplate {
  id: string;
  name: string;
  domainId: string | null;
  sectorId: string | null;
  description: string | null;
  skills: string[];
  experienceMin: number | null;
  experienceMax: number | null;
  workMode: WorkMode | null;
  location: string | null;
  headcount: number | null;
  workflowRounds:
    | {
        roundName: string;
        roundType: string;
        passPercentage: number | null;
        isMandatory: boolean;
        autoProgression: boolean;
      }[]
    | null;
  createdAt: string;
}

export interface JobApprover {
  id: string;
  fullName: string;
  email: string;
  role: string;
  roleDisplayName: string;
}
