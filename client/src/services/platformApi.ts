import { api, unwrap } from './api.js';
import type {
  ApiResponse,
  PlanAdminDto,
  CreatePlanInput,
  UpdatePlanInput,
  TenantListItem,
  TenantDetail,
  CreateTenantInput,
  CreateTenantResult,
  UpdateTenantInput,
  TenantLoginResult,
  MaintenanceWindowDto,
  CreateMaintenanceWindowInput,
} from '@agnohire/shared';

/** Platform-superadmin console API: Plan catalogue + Tenant admin. */

// ── Plans ─────────────────────────────────────────────────────────────────────
export async function fetchPlans(): Promise<PlanAdminDto[]> {
  return unwrap((await api.get<ApiResponse<PlanAdminDto[]>>('/platform/plans')).data);
}

export async function createPlan(input: CreatePlanInput): Promise<PlanAdminDto> {
  return unwrap((await api.post<ApiResponse<PlanAdminDto>>('/platform/plans', input)).data);
}

export async function updatePlan(id: string, input: UpdatePlanInput): Promise<PlanAdminDto> {
  return unwrap((await api.patch<ApiResponse<PlanAdminDto>>(`/platform/plans/${id}`, input)).data);
}

// ── Tenants ───────────────────────────────────────────────────────────────────
export async function fetchTenants(): Promise<TenantListItem[]> {
  return unwrap((await api.get<ApiResponse<TenantListItem[]>>('/platform/tenants')).data);
}

export async function fetchTenant(id: string): Promise<TenantDetail> {
  return unwrap((await api.get<ApiResponse<TenantDetail>>(`/platform/tenants/${id}`)).data);
}

export async function createTenant(input: CreateTenantInput): Promise<CreateTenantResult> {
  return unwrap((await api.post<ApiResponse<CreateTenantResult>>('/platform/tenants', input)).data);
}

export async function updateTenant(id: string, input: UpdateTenantInput): Promise<TenantDetail> {
  return unwrap((await api.patch<ApiResponse<TenantDetail>>(`/platform/tenants/${id}`, input)).data);
}

/** Reset the tenant owner's password (for a tenant you created). */
export async function resetOwnerPassword(id: string, password: string): Promise<void> {
  await api.post<ApiResponse<unknown>>(`/platform/tenants/${id}/reset-owner-password`, { password });
}

export async function setTenantStatus(id: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<void> {
  await api.patch<ApiResponse<unknown>>(`/platform/tenants/${id}/status`, { status });
}

/** Grant/revoke the public careers-page (website embed) feature for this tenant. */
export async function setTenantCareersFeature(id: string, enabled: boolean): Promise<void> {
  await api.patch<ApiResponse<unknown>>(`/platform/tenants/${id}/careers-feature`, { enabled });
}

export async function deleteTenant(id: string): Promise<void> {
  await api.delete<ApiResponse<unknown>>(`/platform/tenants/${id}`);
}

/** Approve a pending self-serve tenant (activates it + starts the trial). */
export async function approveTenant(id: string, notes?: string): Promise<TenantDetail> {
  return unwrap((await api.post<ApiResponse<TenantDetail>>(`/platform/tenants/${id}/approve`, { notes })).data);
}

/** Reject a pending self-serve tenant (stays inert; owner can't sign in). */
export async function rejectTenant(id: string, notes?: string): Promise<void> {
  await api.post<ApiResponse<unknown>>(`/platform/tenants/${id}/reject`, { notes });
}

/** Impersonate a tenant you created — returns a fresh owner session. */
export async function loginToTenant(id: string): Promise<TenantLoginResult> {
  return unwrap((await api.post<ApiResponse<TenantLoginResult>>(`/platform/tenants/${id}/login`, {})).data);
}

// ── Maintenance windows ───────────────────────────────────────────────────────
export async function fetchMaintenanceWindows(): Promise<MaintenanceWindowDto[]> {
  return unwrap((await api.get<ApiResponse<MaintenanceWindowDto[]>>('/platform/maintenance')).data);
}

export async function createMaintenanceWindow(input: CreateMaintenanceWindowInput): Promise<MaintenanceWindowDto> {
  return unwrap((await api.post<ApiResponse<MaintenanceWindowDto>>('/platform/maintenance', input)).data);
}

export async function cancelMaintenanceWindow(id: string): Promise<void> {
  await api.delete<ApiResponse<unknown>>(`/platform/maintenance/${id}`);
}

// ── AI usage monitor ────────────────────────────────────────────────────────
export interface UsageSummary {
  totalCalls: number;
  successfulCalls: number;
  successRate: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: number;
  billableCostUsd: number;
  unpricedCalls: number;
}
export interface UsageTrendPoint { date: string; totalTokens: number; costUsd: number; calls: number }
export interface UsageByTenant {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  totalTokens: number;
  totalCostUsd: number;
  billableCostUsd: number;
  calls: number;
  usesPlatformKey: boolean;
}
export interface UsageByFeature { feature: string; totalTokens: number; totalCostUsd: number; calls: number }
export interface UsageByModel { provider: string; model: string; totalTokens: number; totalCostUsd: number; calls: number; failedCalls: number }
export interface TenantAiUsage {
  summary: UsageSummary;
  byFeature: UsageByFeature[];
  usesPlatformKey: boolean;
  currentMonthBillableCostUsd: number;
}

export async function fetchAiUsageSummary(days = 30): Promise<UsageSummary> {
  return unwrap((await api.get<ApiResponse<UsageSummary>>(`/platform/ai-usage/summary?days=${days}`)).data);
}
export async function fetchAiUsageTrend(days = 30): Promise<UsageTrendPoint[]> {
  return unwrap((await api.get<ApiResponse<UsageTrendPoint[]>>(`/platform/ai-usage/trend?days=${days}`)).data);
}
export async function fetchAiUsageByTenant(days = 30): Promise<UsageByTenant[]> {
  return unwrap((await api.get<ApiResponse<UsageByTenant[]>>(`/platform/ai-usage/by-tenant?days=${days}`)).data);
}
export async function fetchAiUsageByFeature(days = 30): Promise<UsageByFeature[]> {
  return unwrap((await api.get<ApiResponse<UsageByFeature[]>>(`/platform/ai-usage/by-feature?days=${days}`)).data);
}
export async function fetchAiUsageByModel(days = 30): Promise<UsageByModel[]> {
  return unwrap((await api.get<ApiResponse<UsageByModel[]>>(`/platform/ai-usage/by-model?days=${days}`)).data);
}
export async function fetchTenantAiUsage(id: string, days = 30): Promise<TenantAiUsage> {
  return unwrap((await api.get<ApiResponse<TenantAiUsage>>(`/platform/ai-usage/tenants/${id}?days=${days}`)).data);
}

/** Downloads a fallback-filename PDF blob response and triggers a browser save. */
function downloadPdfBlob(res: { data: BlobPart; headers: any }, fallbackName: string): void {
  const blob = new Blob([res.data], { type: 'application/pdf' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  const disposition = res.headers['content-disposition'];
  let filename = fallbackName;
  if (disposition && disposition.indexOf('attachment') !== -1) {
    const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
    if (matches != null && matches[1]) filename = matches[1].replace(/['"]/g, '');
  }

  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function exportAiUsagePdf(days = 30): Promise<void> {
  const res = await api.get(`/platform/ai-usage/export/pdf?days=${days}`, { responseType: 'blob' });
  downloadPdfBlob(res, 'AI_Token_Usage_Report.pdf');
}

// ── Candidate storage monitor ───────────────────────────────────────────────
export interface TenantStorageBreakdown {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  resumeBytes: number;
  attachmentBytes: number;
  proctorShotBytes: number;
  assessmentProctorShotBytes: number;
  biometricBytes: number;
  totalBytes: number;
  candidateCount: number;
}
export interface PlatformStorageSummary {
  totalBytes: number;
  resumeBytes: number;
  attachmentBytes: number;
  proctorShotBytes: number;
  assessmentProctorShotBytes: number;
  biometricBytes: number;
  candidateCount: number;
  tenantCount: number;
  unattributedBytes: number;
}

export async function fetchStorageSummary(): Promise<PlatformStorageSummary> {
  return unwrap((await api.get<ApiResponse<PlatformStorageSummary>>('/platform/storage/summary')).data);
}
export async function fetchStorageByTenant(): Promise<TenantStorageBreakdown[]> {
  return unwrap((await api.get<ApiResponse<TenantStorageBreakdown[]>>('/platform/storage/by-tenant')).data);
}
export async function fetchTenantStorageUsage(id: string): Promise<TenantStorageBreakdown | null> {
  return unwrap((await api.get<ApiResponse<TenantStorageBreakdown | null>>(`/platform/storage/tenants/${id}`)).data);
}

export async function exportStorageUsagePdf(): Promise<void> {
  const res = await api.get('/platform/storage/export/pdf', { responseType: 'blob' });
  downloadPdfBlob(res, 'Candidate_Storage_Report.pdf');
}
