import { api, unwrap } from './api.js';
import type {
  ScheduleListItem,
  ScheduleDetail,
  ScheduleFilters,
  CreateScheduleInput,
  UpdateScheduleInput,
  AvailabilityResponse,
  Paginated,
  ApiResponse,
} from '@agnohire/shared';

type R<T> = Promise<T>;

export async function fetchSchedules(
  filters: Partial<ScheduleFilters> = {},
): R<Paginated<ScheduleListItem>> {
  const res = await api.get<ApiResponse<Paginated<ScheduleListItem>>>('/schedules', {
    params: filters,
  });
  return unwrap(res.data);
}

export async function fetchSchedule(id: string): R<{ schedule: ScheduleDetail }> {
  const res = await api.get<ApiResponse<{ schedule: ScheduleDetail }>>(`/schedules/${id}`);
  return unwrap(res.data);
}

export interface AvailabilityParams {
  interviewerIds: string[];
  date: string;
  duration: number;
  /** When rescheduling, exclude this interview from conflict checks. */
  excludeInterviewId?: string;
  /** IANA timezone the slots should be computed/shown in. */
  timeZone?: string;
}

export async function fetchAvailability(params: AvailabilityParams): R<AvailabilityResponse> {
  const res = await api.get<ApiResponse<AvailabilityResponse>>('/schedules/availability', {
    params: {
      interviewerIds: params.interviewerIds.join(','),
      date: params.date,
      duration: params.duration,
      ...(params.excludeInterviewId ? { excludeInterviewId: params.excludeInterviewId } : {}),
      ...(params.timeZone ? { timeZone: params.timeZone } : {}),
    },
  });
  return unwrap(res.data);
}

export async function createSchedule(data: CreateScheduleInput): R<{ schedule: ScheduleDetail }> {
  const res = await api.post<ApiResponse<{ schedule: ScheduleDetail }>>('/schedules', data);
  return unwrap(res.data);
}

export async function rescheduleInterview(
  id: string,
  data: UpdateScheduleInput,
): R<{ schedule: ScheduleDetail }> {
  const res = await api.patch<ApiResponse<{ schedule: ScheduleDetail }>>(`/schedules/${id}`, data);
  return unwrap(res.data);
}

export async function cancelSchedule(id: string): R<{ cancelled: boolean }> {
  const res = await api.post<ApiResponse<{ cancelled: boolean }>>(`/schedules/${id}/cancel`);
  return unwrap(res.data);
}

export async function deleteSchedule(id: string): R<{ deleted: boolean }> {
  const res = await api.delete<ApiResponse<{ deleted: boolean }>>(`/schedules/${id}`);
  return unwrap(res.data);
}

export async function syncCalendar(id: string): R<{ message: string }> {
  const res = await api.post<ApiResponse<{ message: string }>>(`/schedules/${id}/sync-calendar`);
  return unwrap(res.data);
}

export async function generateMeet(id: string): R<{ meetingLink: string }> {
  const res = await api.post<ApiResponse<{ meetingLink: string }>>(`/schedules/${id}/generate-meet`);
  return unwrap(res.data);
}

export async function completeSchedule(id: string): R<{ schedule: ScheduleDetail }> {
  const res = await api.post<ApiResponse<{ schedule: ScheduleDetail }>>(`/schedules/${id}/complete`);
  return unwrap(res.data);
}

export interface MailResult {
  sent: boolean;
  skipped?: 'not-configured' | 'already-sent';
  error?: string;
}

export interface ScheduleInviteResult {
  candidate: MailResult;
  interviewersSent: number;
  interviewersTotal: number;
}

export async function sendScheduleInvite(id: string, selectedChannels?: string[]): R<{ result: ScheduleInviteResult }> {
  const res = await api.post<ApiResponse<{ result: ScheduleInviteResult }>>(`/schedules/${id}/send-invite`, { selectedChannels });
  return unwrap(res.data);
}

export interface PassedCandidate {
  id: string;
  fullName: string;
  email: string | null;
}

export async function fetchPassedCandidates(
  jobRequisitionId?: string,
  roundNumber?: number,
): R<{ candidates: PassedCandidate[] }> {
  const res = await api.get<ApiResponse<{ candidates: PassedCandidate[] }>>('/schedules/candidates/passed', {
    params: {
      ...(jobRequisitionId ? { jobRequisitionId } : {}),
      ...(roundNumber !== undefined ? { roundNumber } : {}),
    },
  });
  return unwrap(res.data);
}

export async function fetchCalendarStatus(): R<{ configured: boolean }> {
  const res = await api.get<ApiResponse<{ configured: boolean }>>('/schedules/calendar-status');
  return unwrap(res.data);
}

export async function downloadBulkScheduleReports(
  filters: { ids?: string[]; search?: string; status?: string; decision?: string; jobRequisitionId?: string; from?: string; to?: string; } = {},
): R<void> {
  const res = await api.get('/schedules/export/excel', {
    params: filters.ids?.length
      ? { ids: filters.ids.join(',') }
      : { 
          search: filters.search || undefined, 
          status: filters.status || undefined,
          decision: filters.decision || undefined,
          jobRequisitionId: filters.jobRequisitionId || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
        },
    responseType: 'blob',
  });
  downloadBlob(res, 'Schedules_Report.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function downloadBlob(res: { data: unknown; headers: Record<string, unknown> }, fallbackFilename: string, mimeType: string): void {
  const blob = new Blob([res.data as BlobPart], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  const disposition = res.headers['content-disposition'] as string | undefined;
  let filename = fallbackFilename;
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
