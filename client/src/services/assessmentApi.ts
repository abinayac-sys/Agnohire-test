import { api, unwrap } from './api.js';
import type {
  AssessmentListItem,
  AssessmentDetail,
  AssessmentFilters,
  CreateAssessmentInput,
  UpdateAssessmentInput,
  AssignAssessmentInput,
  AssignmentListItem,
  AssignmentDetail,
  AssignmentFilters,
  PublicAssessment,
  SubmitAssessmentAnswerInput,
  SendAssessmentResultInput,
  BulkSendAssessmentResultInput,
  AssessmentEmailResult,
  RecordViolationInput,
  ProctorSnapshotInput,
  ViolationResult,
  ViolationType,
  Paginated,
  ApiResponse,
} from '@agnohire/shared';

type R<T> = Promise<T>;

// ─── TEMPLATES (staff) ──────────────────────────────────────────────────────

export async function fetchAssessments(
  filters: Partial<AssessmentFilters> = {},
): R<Paginated<AssessmentListItem>> {
  const res = await api.get<ApiResponse<Paginated<AssessmentListItem>>>('/assessments', { params: filters });
  return unwrap(res.data);
}

export async function fetchAssessment(id: string): R<{ assessment: AssessmentDetail }> {
  const res = await api.get<ApiResponse<{ assessment: AssessmentDetail }>>(`/assessments/${id}`);
  return unwrap(res.data);
}

export async function createAssessment(data: CreateAssessmentInput): R<{ assessment: AssessmentDetail }> {
  const res = await api.post<ApiResponse<{ assessment: AssessmentDetail }>>('/assessments', data);
  return unwrap(res.data);
}

export async function updateAssessment(id: string, data: UpdateAssessmentInput): R<{ assessment: AssessmentDetail }> {
  const res = await api.patch<ApiResponse<{ assessment: AssessmentDetail }>>(`/assessments/${id}`, data);
  return unwrap(res.data);
}

export async function deleteAssessment(id: string): R<{ deleted: boolean }> {
  const res = await api.delete<ApiResponse<{ deleted: boolean }>>(`/assessments/${id}`);
  return unwrap(res.data);
}

export async function assignAssessment(
  id: string,
  data: AssignAssessmentInput,
): R<{ assigned: number; skipped: number; invited: number }> {
  const res = await api.post<ApiResponse<{ assigned: number; skipped: number; invited: number }>>(`/assessments/${id}/assign`, data);
  return unwrap(res.data);
}

// ─── ASSIGNMENTS (staff) ────────────────────────────────────────────────────

export async function fetchAssignments(
  filters: Partial<AssignmentFilters> = {},
): R<Paginated<AssignmentListItem>> {
  const res = await api.get<ApiResponse<Paginated<AssignmentListItem>>>('/assessments/assignments', { params: filters });
  return unwrap(res.data);
}

export async function fetchAssignment(id: string): R<{ assignment: AssignmentDetail }> {
  const res = await api.get<ApiResponse<{ assignment: AssignmentDetail }>>(`/assessments/assignments/${id}`);
  return unwrap(res.data);
}

export async function cancelAssignment(id: string): R<{ cancelled: boolean }> {
  const res = await api.post<ApiResponse<{ cancelled: boolean }>>(`/assessments/assignments/${id}/cancel`);
  return unwrap(res.data);
}

export async function sendAssessmentResultEmail(
  id: string,
  data: SendAssessmentResultInput = {},
): R<{ result: AssessmentEmailResult }> {
  const res = await api.post<ApiResponse<{ result: AssessmentEmailResult }>>(`/assessments/assignments/${id}/send-result`, data);
  return unwrap(res.data);
}

export async function bulkSendAssessmentResultEmail(
  data: BulkSendAssessmentResultInput,
): R<{ sent: number; skipped: number; failed: number; errors: string[] }> {
  const res = await api.post<ApiResponse<{ sent: number; skipped: number; failed: number; errors: string[] }>>('/assessments/assignments/bulk-send-result', data);
  return unwrap(res.data);
}

/** Fetches an assessment proctoring snapshot as an object URL (authenticated blob). */
export async function fetchAssignmentProctorShot(assignmentId: string, shotId: string): R<string> {
  const res = await api.get(`/assessments/assignments/${assignmentId}/snapshots/${shotId}`, { responseType: 'blob' });
  return URL.createObjectURL(res.data as Blob);
}

/** Fetch the assessment audio recording (an /api/files/<id>/download URL) as a blob URL. */
export async function fetchAssignmentRecording(recordingUrl: string): R<string> {
  const path = recordingUrl.replace(/^\/api/, '');
  const res = await api.get(path, { responseType: 'blob' });
  return URL.createObjectURL(res.data as Blob);
}

// ─── PUBLIC (token, no auth) ────────────────────────────────────────────────

export async function getPublicAssessment(token: string): R<{ assessment: PublicAssessment }> {
  const res = await api.get<ApiResponse<{ assessment: PublicAssessment }>>(`/assessment/${token}`);
  return unwrap(res.data);
}

export async function recordPublicAssessmentViolation(
  token: string,
  type: ViolationType,
  detail?: string,
): R<ViolationResult> {
  const payload: RecordViolationInput = { type, ...(detail ? { detail } : {}) };
  const res = await api.post<ApiResponse<ViolationResult>>(`/assessment/${token}/violation`, payload);
  return unwrap(res.data);
}

export async function savePublicAssessmentSnapshot(
  token: string,
  data: ProctorSnapshotInput,
): R<{ saved: boolean }> {
  const res = await api.post<ApiResponse<{ saved: boolean }>>(`/assessment/${token}/snapshot`, data);
  return unwrap(res.data);
}

export async function savePublicAssessmentRecording(token: string, audio: string): R<{ saved: boolean }> {
  const res = await api.post<ApiResponse<{ saved: boolean }>>(`/assessment/${token}/recording`, { audio });
  return unwrap(res.data);
}

export async function startPublicAssessment(token: string): R<{ startedAt: string; durationMin: number | null }> {
  const res = await api.post<ApiResponse<{ startedAt: string; durationMin: number | null }>>(`/assessment/${token}/start`);
  return unwrap(res.data);
}

export async function savePublicAnswer(token: string, data: SubmitAssessmentAnswerInput): R<{ saved: boolean }> {
  const res = await api.post<ApiResponse<{ saved: boolean }>>(`/assessment/${token}/answer`, data);
  return unwrap(res.data);
}

export async function submitPublicAssessment(token: string): R<{ submitted: boolean }> {
  const res = await api.post<ApiResponse<{ submitted: boolean }>>(`/assessment/${token}/submit`);
  return unwrap(res.data);
}
