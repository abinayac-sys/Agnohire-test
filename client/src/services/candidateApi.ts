import { api, unwrap } from './api.js';
import type {
  CandidateListItem,
  CandidateDetail,
  CandidateStats,
  CandidateFilters,
  CreateCandidateInput,
  UpdateCandidateInput,
  ResumeItem,
  ApplicationListItem,
  ApplicationFilters,
  CreateApplicationInput,
  UpdateApplicationInput,
  FitScoreData,
  CandidateUploadList,
  CandidateUploadListDetail,
  CandidateListFilters,
  CandidateAssignmentRef,
  Paginated,
  ApiResponse,
  PreviewCandidateListResponse,
  PreviewCandidate,
} from '@agnohire/shared';

type R<T> = Promise<T>;

// ─── CANDIDATES ──────────────────────────────────────────────────────────────

export async function fetchCandidates(
  filters: Partial<CandidateFilters> = {},
): R<Paginated<CandidateListItem>> {
  const res = await api.get<ApiResponse<Paginated<CandidateListItem>>>('/candidates', {
    params: filters,
  });
  return unwrap(res.data);
}

export async function fetchCandidate(id: string): R<{ candidate: CandidateDetail }> {
  const res = await api.get<ApiResponse<{ candidate: CandidateDetail }>>(`/candidates/${id}`);
  return unwrap(res.data);
}

export async function createCandidate(
  data: CreateCandidateInput,
): R<{ candidate: CandidateListItem }> {
  const res = await api.post<ApiResponse<{ candidate: CandidateListItem }>>('/candidates', data);
  return unwrap(res.data);
}

export async function updateCandidate(
  id: string,
  data: UpdateCandidateInput,
): R<{ candidate: CandidateListItem }> {
  const res = await api.patch<ApiResponse<{ candidate: CandidateListItem }>>(
    `/candidates/${id}`,
    data,
  );
  return unwrap(res.data);
}

export async function deleteCandidate(id: string): R<void> {
  await api.delete(`/candidates/${id}`);
}

export async function fetchCandidateStats(
  filters: { jobRequisitionId?: string } = {}
): R<{ stats: CandidateStats }> {
  const res = await api.get<ApiResponse<{ stats: CandidateStats }>>('/candidates/stats', {
    params: filters,
  });
  return unwrap(res.data);
}

// ─── RESUMES (nested) ─────────────────────────────────────────────────────────────────

export async function uploadResume(
  candidateId: string,
  file: File,
): R<{ resume: ResumeItem }> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<ApiResponse<{ resume: ResumeItem }>>(
    `/candidates/${candidateId}/resumes`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return unwrap(res.data);
}

export function resumeDownloadUrl(candidateId: string, resumeId: string): string {
  return `/api/candidates/${candidateId}/resumes/${resumeId}/download`;
}

/**
 * Fetches a resume file as an authenticated blob and returns an object URL.
 * A plain <a href> can't view it — the download route needs the Bearer token,
 * which only axios attaches.
 */
export async function fetchResumeBlobUrl(candidateId: string, resumeId: string): R<string> {
  const res = await api.get(`/candidates/${candidateId}/resumes/${resumeId}/download`, {
    responseType: 'blob',
  });
  return URL.createObjectURL(res.data as Blob);
}

export async function importResumeFromUrl(
  candidateId: string,
  url: string,
): R<{ resume: ResumeItem }> {
  const res = await api.post<ApiResponse<{ resume: ResumeItem }>>(
    `/candidates/${candidateId}/resumes/from-url`,
    { url },
  );
  return unwrap(res.data);
}

export async function reparseResume(candidateId: string, resumeId: string): R<void> {
  await api.post(`/candidates/${candidateId}/resumes/${resumeId}/reparse`);
}

export async function deleteResume(candidateId: string, resumeId: string): R<void> {
  await api.delete(`/candidates/${candidateId}/resumes/${resumeId}`);
}

// ─── APPLICATIONS ───────────────────────────────────────────────────────────

export async function fetchApplications(
  filters: Partial<ApplicationFilters> = {},
): R<Paginated<ApplicationListItem>> {
  const res = await api.get<ApiResponse<Paginated<ApplicationListItem>>>('/applications', {
    params: filters,
  });
  return unwrap(res.data);
}

export async function createApplication(
  data: CreateApplicationInput,
): R<{ application: ApplicationListItem }> {
  const res = await api.post<ApiResponse<{ application: ApplicationListItem }>>(
    '/applications',
    data,
  );
  return unwrap(res.data);
}

export async function updateApplication(
  id: string,
  data: UpdateApplicationInput,
): R<{ application: ApplicationListItem }> {
  const res = await api.patch<ApiResponse<{ application: ApplicationListItem }>>(
    `/applications/${id}`,
    data,
  );
  return unwrap(res.data);
}

export async function scoreApplication(
  id: string,
  force = false,
): R<{ fit: FitScoreData }> {
  const res = await api.post<ApiResponse<{ fit: FitScoreData }>>(
    `/applications/${id}/score`,
    { force },
  );
  return unwrap(res.data);
}

export async function deleteApplication(id: string): R<{ deleted: boolean }> {
  const res = await api.delete<ApiResponse<{ deleted: boolean }>>(`/applications/${id}`);
  return unwrap(res.data);
}

// ─── BULK UPLOAD (candidate lists) ────────────────────────────────────────────

export async function uploadCandidateList(
  file: File,
  name: string,
  jobRequisitionId?: string | null,
  assignedTo?: string | null,
): R<{ list: CandidateUploadList }> {
  const form = new FormData();
  form.append('file', file);
  form.append('name', name);
  if (jobRequisitionId) {
    form.append('jobRequisitionId', jobRequisitionId);
  }
  if (assignedTo) {
    form.append('assignedTo', assignedTo);
  }
  const res = await api.post<ApiResponse<{ list: CandidateUploadList }>>(
    '/candidates/lists',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return unwrap(res.data);
}

export async function previewCandidateList(
  file: File,
  name: string,
  jobRequisitionId: string,
): R<PreviewCandidateListResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('name', name);
  if (jobRequisitionId) {
    form.append('jobRequisitionId', jobRequisitionId);
  }
  const res = await api.post<ApiResponse<PreviewCandidateListResponse>>(
    '/candidates/lists/preview',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return unwrap(res.data);
}

export async function uploadSmartCandidateList(
  name: string,
  jobRequisitionId: string | null | undefined,
  candidates: PreviewCandidate[],
  assignedTo?: string | null,
): R<{ list: CandidateUploadList }> {
  const res = await api.post<ApiResponse<{ list: CandidateUploadList }>>(
    '/candidates/lists/smart',
    { name, jobRequisitionId, candidates, assignedTo },
  );
  return unwrap(res.data);
}

export async function fetchCandidateLists(
  filters: Partial<CandidateListFilters> = {},
): R<Paginated<CandidateUploadList>> {
  const res = await api.get<ApiResponse<Paginated<CandidateUploadList>>>('/candidates/lists', {
    params: filters,
  });
  return unwrap(res.data);
}

export async function fetchCandidateList(id: string): R<{ list: CandidateUploadListDetail }> {
  const res = await api.get<ApiResponse<{ list: CandidateUploadListDetail }>>(
    `/candidates/lists/${id}`,
  );
  return unwrap(res.data);
}

export async function deleteCandidateList(id: string): R<{ deleted: boolean }> {
  const res = await api.delete<ApiResponse<{ deleted: boolean }>>(`/candidates/lists/${id}?cascade=true`);
  return unwrap(res.data);
}

export async function fetchCandidateListMembers(id: string): R<{ members: CandidateListItem[] }> {
  const res = await api.get<ApiResponse<{ members: CandidateListItem[] }>>(`/candidates/lists/${id}/members`);
  return unwrap(res.data);
}

export async function assignJobToList(id: string, jobRequisitionId: string): R<{ applied: number; skipped: number }> {
  const res = await api.post<ApiResponse<{ applied: number; skipped: number }>>(`/candidates/lists/${id}/assign-job`, { jobRequisitionId });
  return unwrap(res.data);
}

export async function uploadCsvToExistingList(listId: string, file: File): R<{ success: boolean }> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<ApiResponse<{ success: boolean }>>(
    `/candidates/lists/${listId}/upload-csv`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return unwrap(res.data);
}

// ─── ASSIGNMENT ─────────────────────────────────────────────────────────────

export async function assignCandidate(
  id: string,
  recruiterId: string,
): R<{ assignment: CandidateAssignmentRef }> {
  const res = await api.post<ApiResponse<{ assignment: CandidateAssignmentRef }>>(
    `/candidates/${id}/assign`,
    { recruiterId },
  );
  return unwrap(res.data);
}

export async function unassignCandidate(id: string): R<void> {
  await api.delete(`/candidates/${id}/assign`);
}

export async function exportCandidatesCsv(filters: Partial<CandidateFilters>): Promise<void> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined) params.set(k, String(v));
  }
  const res = await api.get('/candidates/export/csv', { params, responseType: 'blob' });
  const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  const disposition = res.headers['content-disposition'];
  let filename = 'Candidates_Export.xlsx';
  if (disposition && disposition.indexOf('attachment') !== -1) {
    const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
    if (matches != null && matches[1]) { 
      filename = matches[1].replace(/['"]/g, '');
    }
  }
  
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function exportCandidatesPdf(filters: Partial<CandidateFilters>): Promise<void> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined) params.set(k, String(v));
  }
  const res = await api.get('/candidates/export/pdf', { params, responseType: 'blob' });
  const blob = new Blob([res.data], { type: 'application/pdf' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  const disposition = res.headers['content-disposition'];
  let filename = 'Candidates.pdf';
  if (disposition && disposition.indexOf('attachment') !== -1) {
    const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
    if (matches != null && matches[1]) { 
      filename = matches[1].replace(/['"]/g, '');
    }
  }
  
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
