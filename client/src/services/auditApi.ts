import { api, unwrap } from './api.js';
import type {
  ApiResponse,
  Paginated,
  AuditFilters,
  AuditLogItem,
  AuditLogDetail,
  AuditFacets,
} from '@agnohire/shared';

export async function fetchAuditLogs(filters: Partial<AuditFilters> = {}): Promise<Paginated<AuditLogItem>> {
  const res = await api.get<ApiResponse<Paginated<AuditLogItem>>>('/audit', { params: filters });
  return unwrap(res.data);
}

export async function fetchAuditFacets(): Promise<AuditFacets> {
  const res = await api.get<ApiResponse<AuditFacets>>('/audit/facets');
  return unwrap(res.data);
}

export async function fetchAuditLog(id: string): Promise<AuditLogDetail> {
  const res = await api.get<ApiResponse<{ log: AuditLogDetail }>>(`/audit/${id}`);
  return unwrap(res.data).log;
}

export async function downloadAuditExcel(filters: Partial<AuditFilters> = {}): Promise<void> {
  const res = await api.get('/audit/export', { params: filters, responseType: 'blob' });
  const blob = new Blob([res.data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const disp = (res.headers as Record<string, string>)['content-disposition'] ?? '';
  const match = /filename="?([^"]+)"?/.exec(disp);
  const filename = match?.[1] ?? 'agnohire-audit.xlsx';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function deleteAuditLog(id: string): Promise<void> {
  await api.delete(`/audit/${id}`);
}

export async function deleteAuditLogsBulk(ids: string[]): Promise<void> {
  await api.post('/audit/delete-bulk', { ids });
}
