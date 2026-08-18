import { api, unwrap } from './api.js';
import type {
  ApiResponse,
  Paginated,
  GdprFilters,
  GdprRequestItem,
  CreateGdprRequestInput,
  ProcessGdprRequestInput,
  GdprExportBundle,
  ConsentRow,
  SetConsentInput,
  RetentionPolicyItem,
  RetentionPolicyInput,
  ComplianceSummary,
} from '@agnohire/shared';

export async function fetchComplianceSummary(): Promise<ComplianceSummary> {
  return unwrap((await api.get<ApiResponse<ComplianceSummary>>('/gdpr/summary')).data);
}

// ─── REQUESTS ────────────────────────────────────────────────────────────────

export async function fetchGdprRequests(filters: Partial<GdprFilters> = {}): Promise<Paginated<GdprRequestItem>> {
  return unwrap((await api.get<ApiResponse<Paginated<GdprRequestItem>>>('/gdpr/requests', { params: filters })).data);
}

export async function createGdprRequest(data: CreateGdprRequestInput): Promise<GdprRequestItem> {
  return unwrap((await api.post<ApiResponse<{ request: GdprRequestItem }>>('/gdpr/requests', data)).data).request;
}

export async function processGdprRequest(
  id: string,
  data: ProcessGdprRequestInput,
): Promise<{ request: GdprRequestItem; bundle?: GdprExportBundle }> {
  return unwrap((await api.post<ApiResponse<{ request: GdprRequestItem; bundle?: GdprExportBundle }>>(`/gdpr/requests/${id}/process`, data)).data);
}

// ─── CONSENT ─────────────────────────────────────────────────────────────────

export async function fetchConsent(filters: { page?: number; limit?: number } = {}): Promise<Paginated<ConsentRow>> {
  return unwrap((await api.get<ApiResponse<Paginated<ConsentRow>>>('/gdpr/consent', { params: filters })).data);
}

export async function setConsent(data: SetConsentInput): Promise<ConsentRow> {
  return unwrap((await api.post<ApiResponse<{ consent: ConsentRow }>>('/gdpr/consent', data)).data).consent;
}

// ─── RETENTION ───────────────────────────────────────────────────────────────

export async function fetchRetentionPolicies(): Promise<RetentionPolicyItem[]> {
  return unwrap((await api.get<ApiResponse<{ policies: RetentionPolicyItem[] }>>('/gdpr/retention')).data).policies;
}

export async function upsertRetentionPolicy(data: RetentionPolicyInput): Promise<RetentionPolicyItem> {
  return unwrap((await api.post<ApiResponse<{ policy: RetentionPolicyItem }>>('/gdpr/retention', data)).data).policy;
}

export async function deleteRetentionPolicy(id: string): Promise<void> {
  await api.delete(`/gdpr/retention/${id}`);
}

// ─── DIRECT EXPORT ───────────────────────────────────────────────────────────

export async function downloadCandidateExport(candidateId: string): Promise<void> {
  const res = await api.get(`/gdpr/export/${candidateId}`, { responseType: 'blob' });
  const blob = new Blob([res.data as BlobPart], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agnohire-gdpr-export-${candidateId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
