import { api, unwrap } from './api.js';
import type {
  InterviewListItem,
  InterviewDetail,
  InterviewFilters,
  CreateInterviewInput,
  InterviewDecisionInput,
  PublicInterview,
  SubmitAnswerInput,
  RecordViolationInput,
  ViolationType,
  ViolationResult,
  ProctorSnapshotInput,
  ResultCandidateItem,
  BulkEmailResult,
  Paginated,
  ApiResponse,
} from '@agnohire/shared';

type R<T> = Promise<T>;

// ─── STAFF (authenticated) ──────────────────────────────────────────────────

export async function fetchInterviews(
  filters: Partial<InterviewFilters> = {},
): R<Paginated<InterviewListItem>> {
  const res = await api.get<ApiResponse<Paginated<InterviewListItem>>>('/interviews', {
    params: filters,
  });
  return unwrap(res.data);
}

export async function fetchInterview(id: string): R<{ interview: InterviewDetail }> {
  const res = await api.get<ApiResponse<{ interview: InterviewDetail }>>(`/interviews/${id}`);
  return unwrap(res.data);
}

export async function createInterview(
  data: CreateInterviewInput,
): R<{ interview: InterviewDetail }> {
  const res = await api.post<ApiResponse<{ interview: InterviewDetail }>>('/interviews', data);
  return unwrap(res.data);
}

export async function cancelInterview(id: string): R<{ cancelled: boolean }> {
  const res = await api.post<ApiResponse<{ cancelled: boolean }>>(`/interviews/${id}/cancel`);
  return unwrap(res.data);
}

export async function deleteInterview(id: string): R<{ deleted: boolean }> {
  const res = await api.delete<ApiResponse<{ deleted: boolean }>>(`/interviews/${id}`);
  return unwrap(res.data);
}

export async function decideInterview(
  id: string,
  data: InterviewDecisionInput,
): R<{ interview: InterviewDetail }> {
  const res = await api.post<ApiResponse<{ interview: InterviewDetail }>>(
    `/interviews/${id}/decision`,
    data,
  );
  return unwrap(res.data);
}

export async function submitDecision(
  id: string,
  data: any, // using any here to avoid importing SubmitDecisionInput if it's not exported
): R<{ interview: InterviewDetail }> {
  const res = await api.post<ApiResponse<{ interview: InterviewDetail }>>(
    `/interviews/${id}/submit-decision`,
    data,
  );
  return unwrap(res.data);
}

export interface SendMailResult {
  sent: boolean;
  skipped?: string;
  error?: string;
}

export async function sendInterviewInvite(id: string, selectedChannels?: string[]): R<{ result: SendMailResult }> {
  const res = await api.post<ApiResponse<{ result: SendMailResult }>>(`/interviews/${id}/send-invite`, { selectedChannels });
  return unwrap(res.data);
}

export async function sendInterviewResult(id: string): R<{ result: SendMailResult }> {
  const res = await api.post<ApiResponse<{ result: SendMailResult }>>(`/interviews/${id}/send-result`);
  return unwrap(res.data);
}

export async function fetchResultCandidates(
  outcome?: 'PASS' | 'FAIL',
  source: 'AI' | 'SCHEDULED' = 'AI',
): R<{ items: ResultCandidateItem[] }> {
  const res = await api.get<ApiResponse<{ items: ResultCandidateItem[] }>>('/interviews/results/candidates', {
    params: { ...(outcome ? { outcome } : {}), source },
  });
  return unwrap(res.data);
}

export async function sendBulkResults(interviewIds: string[], force = false): R<{ result: BulkEmailResult }> {
  const res = await api.post<ApiResponse<{ result: BulkEmailResult }>>('/interviews/results/send-bulk', {
    interviewIds,
    force,
  });
  return unwrap(res.data);
}

export async function sendBulkInvites(interviewIds: string[], selectedChannels?: string[]): R<{ result: BulkEmailResult }> {
  const res = await api.post<ApiResponse<{ result: BulkEmailResult }>>('/interviews/invites/send-bulk', {
    interviewIds,
    selectedChannels,
  });
  return unwrap(res.data);
}

/** Downloads a single candidate's detailed interview report as a PDF. */
export async function downloadInterviewReport(id: string, candidateName: string): R<void> {
  const res = await api.get(`/interviews/${id}/report`, { responseType: 'blob' });
  downloadBlob(res, `${candidateName.trim().replace(/\s+/g, '_')}_Interview_Report.pdf`, 'application/pdf');
}

/**
 * Downloads a single Excel file bundling every evaluated candidate's report.
 * Pass explicit `ids` to export only the selected rows; otherwise every
 * evaluated interview matching the current search/status filters is included.
 */
export async function downloadBulkInterviewReports(
  filters: { ids?: string[]; search?: string; status?: string; decision?: string; jobRequisitionId?: string; from?: string; to?: string; } = {},
): R<void> {
  const res = await api.get('/interviews/reports/bulk', {
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
  downloadBlob(res, 'Interview_Reports.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function downloadBlob(res: { data: unknown; headers: Record<string, unknown> }, fallbackFilename: string, mimeType: string): void {
  const blob = new Blob([res.data as any], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  const disposition = res.headers['content-disposition'] as string | undefined;
  let filename = fallbackFilename;
  if (disposition && disposition.includes('filename=')) {
    const match = disposition.match(/filename="(.+?)"/);
    if (match && match[1]) filename = match[1];
  }

  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/** Fetches a proctoring snapshot as an object URL (authenticated blob). */
export async function fetchProctorShot(interviewId: string, shotId: string): R<string> {
  const res = await api.get(`/interviews/${interviewId}/snapshots/${shotId}`, {
    responseType: 'blob',
  });
  return URL.createObjectURL(res.data as Blob);
}

/** Fetch the interview audio recording (an /api/files/<id>/download URL) as an
 *  authenticated blob URL the <audio> element can play. */
export async function fetchRecording(recordingUrl: string): R<string> {
  const path = recordingUrl.replace(/^\/api/, '');
  const res = await api.get(path, { responseType: 'blob' });
  return URL.createObjectURL(res.data as Blob);
}

// ─── PUBLIC (token-based, no auth required) ─────────────────────────────────

export async function getPublicInterview(token: string): R<{ interview: PublicInterview }> {
  const res = await api.get<ApiResponse<{ interview: PublicInterview }>>(`/interview/${token}`);
  return unwrap(res.data);
}

export async function startPublicInterview(
  token: string,
): R<{ startedAt: string; durationMin: number | null }> {
  const res = await api.post<ApiResponse<{ startedAt: string; durationMin: number | null }>>(
    `/interview/${token}/start`,
  );
  return unwrap(res.data);
}

export async function savePublicAnswer(
  token: string,
  data: SubmitAnswerInput,
): R<{ saved: boolean }> {
  const res = await api.post<ApiResponse<{ saved: boolean }>>(
    `/interview/${token}/answer`,
    data,
  );
  return unwrap(res.data);
}

export async function recordPublicViolation(
  token: string,
  type: ViolationType,
  detail?: string,
): R<ViolationResult> {
  const payload: RecordViolationInput = { type, ...(detail ? { detail } : {}) };
  const res = await api.post<ApiResponse<ViolationResult>>(`/interview/${token}/violation`, payload);
  return unwrap(res.data);
}

export async function savePublicSnapshot(
  token: string,
  data: ProctorSnapshotInput,
): R<{ saved: boolean }> {
  const res = await api.post<ApiResponse<{ saved: boolean }>>(
    `/interview/${token}/snapshot`,
    data,
  );
  return unwrap(res.data);
}

export async function savePublicRecording(token: string, audio: string): R<{ saved: boolean }> {
  const res = await api.post<ApiResponse<{ saved: boolean }>>(
    `/interview/${token}/recording`,
    { audio },
  );
  return unwrap(res.data);
}

export async function submitPublicInterview(token: string): R<{ submitted: boolean }> {
  const res = await api.post<ApiResponse<{ submitted: boolean }>>(`/interview/${token}/submit`);
  return unwrap(res.data);
}

export async function biometricEnroll(
  token: string,
  data: { image: string; faceSignature: any },
): R<{ enrolled: boolean }> {
  const res = await api.post<ApiResponse<{ enrolled: boolean }>>(
    `/interview/${token}/biometric/enroll`,
    data,
  );
  return unwrap(res.data);
}

export async function biometricVerify(
  token: string,
  data: {
    image: string;
    faceSignature: any;
    matchScore: number;
    isMatch: boolean;
    noFace: boolean;
    multipleFaces: boolean;
  },
): R<{ matchScore: number; isMatch: boolean; status: string; warnings: number; maxWarnings: number; terminated: boolean }> {
  const res = await api.post<ApiResponse<{ matchScore: number; isMatch: boolean; status: string; warnings: number; maxWarnings: number; terminated: boolean }>>(
    `/interview/${token}/biometric/verify`,
    data,
  );
  return unwrap(res.data);
}

