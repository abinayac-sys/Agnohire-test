import { api, unwrap } from './api.js';
import type {
  AnalyticsFilters,
  AnalyticsDashboard,
  AnalyticsInsights,
  AnalyticsSnapshotItem,
  ExportReportInput,
  SnapshotFilters,
  Paginated,
  ApiResponse,
} from '@agnohire/shared';

type R<T> = Promise<T>;

export async function fetchDashboard(filters: Partial<AnalyticsFilters> = {}): R<{ dashboard: AnalyticsDashboard }> {
  const res = await api.get<ApiResponse<{ dashboard: AnalyticsDashboard }>>('/analytics/dashboard', { params: filters });
  return unwrap(res.data);
}

export async function fetchInsights(filters: Partial<AnalyticsFilters> = {}): R<{ insights: AnalyticsInsights }> {
  const res = await api.get<ApiResponse<{ insights: AnalyticsInsights }>>('/analytics/insights', { params: filters });
  return unwrap(res.data);
}

export async function fetchSnapshots(filters: Partial<SnapshotFilters> = {}): R<Paginated<AnalyticsSnapshotItem>> {
  const res = await api.get<ApiResponse<Paginated<AnalyticsSnapshotItem>>>('/analytics/snapshots', { params: filters });
  return unwrap(res.data);
}

export async function saveSnapshot(filters: Partial<AnalyticsFilters> = {}): R<{ snapshot: AnalyticsSnapshotItem }> {
  const res = await api.post<ApiResponse<{ snapshot: AnalyticsSnapshotItem }>>('/analytics/snapshots', filters);
  return unwrap(res.data);
}

export async function deleteSnapshot(id: string): R<{ deleted: boolean }> {
  const res = await api.delete<ApiResponse<{ deleted: boolean }>>(`/analytics/snapshots/${id}`);
  return unwrap(res.data);
}

/** Downloads a saved snapshot as a PDF (AgnoHire's default report template) and triggers a browser save. */
export async function downloadSnapshotPdf(id: string, period: string): Promise<void> {
  const res = await api.get(`/analytics/snapshots/${id}/pdf`, { responseType: 'blob' });
  const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
  const disposition = (res.headers['content-disposition'] as string | undefined) ?? '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? `agnohire-analytics-snapshot-${period.replace(/[^a-zA-Z0-9-]+/g, '_')}.pdf`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Downloads an Excel report and triggers a browser save. */
export async function downloadReport(input: Partial<ExportReportInput> = {}): Promise<void> {
  const res = await api.get('/analytics/export', { params: input, responseType: 'blob' });
  const blob = new Blob([res.data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const disposition = (res.headers['content-disposition'] as string | undefined) ?? '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? `agnohire-${input.report ?? 'overview'}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
