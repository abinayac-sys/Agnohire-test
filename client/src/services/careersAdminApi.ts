import { api, unwrap } from './api.js';
import type { ApiResponse, CareersAdminJobItem } from '@agnohire/shared';

// ─── STAFF (authenticated) — careers page per-job salary visibility ────────

export async function fetchCareersJobs(): Promise<CareersAdminJobItem[]> {
  const res = await api.get<ApiResponse<{ jobs: CareersAdminJobItem[] }>>('/careers-admin/jobs');
  return unwrap(res.data).jobs;
}

export async function updateJobSalaryVisibility(
  jobId: string,
  showSalaryPublicly: boolean,
): Promise<CareersAdminJobItem> {
  const res = await api.patch<ApiResponse<{ job: CareersAdminJobItem }>>(
    `/careers-admin/jobs/${jobId}/salary-visibility`,
    { showSalaryPublicly },
  );
  return unwrap(res.data).job;
}
