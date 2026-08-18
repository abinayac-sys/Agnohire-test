import { api, unwrap } from './api.js';
import type {
  ApiResponse,
  Paginated,
  PublicJobListItem,
  PublicJobDetail,
  PublicCareersTenant,
} from '@agnohire/shared';

// ─── PUBLIC (no auth — tenant resolved by slug) ─────────────────────────────

export async function fetchPublicJobs(
  tenantSlug: string,
  params: { page?: number; search?: string; location?: string } = {},
): Promise<{ jobs: Paginated<PublicJobListItem>; tenant: PublicCareersTenant }> {
  const res = await api.get<ApiResponse<{ jobs: Paginated<PublicJobListItem>; tenant: PublicCareersTenant }>>(
    `/public/careers/${tenantSlug}/jobs`,
    { params },
  );
  return unwrap(res.data);
}

export async function fetchPublicJob(
  tenantSlug: string,
  jobId: string,
): Promise<{ job: PublicJobDetail; tenant: PublicCareersTenant }> {
  const res = await api.get<ApiResponse<{ job: PublicJobDetail; tenant: PublicCareersTenant }>>(
    `/public/careers/${tenantSlug}/jobs/${jobId}`,
  );
  return unwrap(res.data);
}

export interface PublicApplyForm {
  fullName: string;
  email: string;
  phone?: string;
  coverNote?: string;
  resume: File;
}

export async function submitPublicApplication(
  tenantSlug: string,
  jobId: string,
  data: PublicApplyForm,
): Promise<{ success: boolean; message: string }> {
  const formData = new FormData();
  formData.append('fullName', data.fullName);
  formData.append('email', data.email);
  if (data.phone) formData.append('phone', data.phone);
  if (data.coverNote) formData.append('coverNote', data.coverNote);
  formData.append('resume', data.resume);

  const res = await api.post<ApiResponse<{ success: boolean; message: string }>>(
    `/public/careers/${tenantSlug}/jobs/${jobId}/apply`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return unwrap(res.data);
}
