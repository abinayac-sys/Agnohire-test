import { api, unwrap } from './api.js';
import type {
  JobListItem,
  JobDetail,
  JobTemplate,
  JobApprover,
  JobFilters,
  CreateJobInput,
  UpdateJobInput,
  GenerateJdInput,
  CreateJobTemplateInput,
  UpdateJobTemplateInput,
  Paginated,
  ApiResponse,
} from '@agnohire/shared';

type R<T> = Promise<T>;

// ─── JOBS ──────────────────────────────────────────────────────────────────

export async function fetchJobs(
  filters: Partial<JobFilters> = {},
): R<Paginated<JobListItem>> {
  const res = await api.get<ApiResponse<Paginated<JobListItem>>>('/jobs', { params: filters });
  return unwrap(res.data);
}

export async function fetchJob(id: string): R<{ job: JobDetail }> {
  const res = await api.get<ApiResponse<{ job: JobDetail }>>(`/jobs/${id}`);
  return unwrap(res.data);
}

export async function createJob(data: CreateJobInput): R<{ job: JobDetail }> {
  const res = await api.post<ApiResponse<{ job: JobDetail }>>('/jobs', data);
  return unwrap(res.data);
}

export async function updateJob(
  id: string,
  data: UpdateJobInput,
): R<{ job: JobDetail }> {
  const res = await api.patch<ApiResponse<{ job: JobDetail }>>(`/jobs/${id}`, data);
  return unwrap(res.data);
}

export async function deleteJob(id: string): R<void> {
  await api.delete(`/jobs/${id}`);
}

export async function submitJob(
  id: string,
  approverId: string,
): R<void> {
  await api.post(`/jobs/${id}/submit`, { approverId });
}

export async function approveJob(
  id: string,
  comments?: string,
): R<void> {
  await api.post(`/jobs/${id}/approve`, { comments });
}

export async function rejectJob(id: string, comments: string): R<void> {
  await api.post(`/jobs/${id}/reject`, { comments });
}

export async function closeJob(id: string): R<void> {
  await api.post(`/jobs/${id}/close`);
}

export async function reopenJob(id: string): R<void> {
  await api.post(`/jobs/${id}/reopen`);
}

export async function generateJd(data: GenerateJdInput): R<{ jd: string }> {
  const res = await api.post<ApiResponse<{ jd: string }>>('/jobs/generate-jd', data);
  return unwrap(res.data);
}

export async function generateCompleteRequisition(data: any): R<any> {
  const res = await api.post<ApiResponse<any>>('/jobs/ai/generate-complete', data);
  return unwrap(res.data);
}

export async function chatWithCopilot(data: any): R<any> {
  const res = await api.post<ApiResponse<any>>('/jobs/ai/copilot', data);
  return unwrap(res.data);
}

export async function reviewRequisition(data: any): R<any> {
  const res = await api.post<ApiResponse<any>>('/jobs/ai/review', data);
  return unwrap(res.data);
}

export interface JobStats {
  total: number;
  open: number;
  pending: number;
  closed: number;
}

export async function fetchJobStats(): R<{ stats: JobStats }> {
  const res = await api.get<ApiResponse<{ stats: JobStats }>>('/jobs/stats');
  return unwrap(res.data);
}

export async function fetchApprovers(): R<{ approvers: JobApprover[] }> {
  const res = await api.get<ApiResponse<{ approvers: JobApprover[] }>>('/jobs/approvers');
  return unwrap(res.data);
}

// ─── TEMPLATES ────────────────────────────────────────────────────────────

export async function fetchTemplates(opts: {
  domainId?: string;
  page?: number;
  limit?: number;
} = {}): R<Paginated<JobTemplate>> {
  const res = await api.get<ApiResponse<Paginated<JobTemplate>>>('/jobs/templates', {
    params: opts,
  });
  return unwrap(res.data);
}

export async function createTemplate(
  data: CreateJobTemplateInput,
): R<{ template: JobTemplate }> {
  const res = await api.post<ApiResponse<{ template: JobTemplate }>>('/jobs/templates', data);
  return unwrap(res.data);
}

export async function updateTemplate(
  id: string,
  data: UpdateJobTemplateInput,
): R<{ template: JobTemplate }> {
  const res = await api.patch<ApiResponse<{ template: JobTemplate }>>(`/jobs/templates/${id}`, data);
  return unwrap(res.data);
}

export async function deleteTemplate(id: string): R<void> {
  await api.delete(`/jobs/templates/${id}`);
}

export async function downloadJobPdf(id: string): Promise<void> {
  const res = await api.get(`/jobs/${id}/pdf`, { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const link = document.createElement('a');
  link.href = url;
  
  const contentDisposition = res.headers['content-disposition'];
  let fileName = `Job_${id}.pdf`;
  if (contentDisposition) {
    const fileNameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
    if (fileNameMatch && fileNameMatch.length === 2) {
      fileName = fileNameMatch[1];
    }
  }
  
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
