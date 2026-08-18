import { api, unwrap } from './api.js';
import type {
  BoardFilters,
  PipelineBoard,
  PipelineCard,
  PipelineNoteItem,
  MoveApplicationInput,
  CreatePipelineNoteInput,
  ApiResponse,
} from '@agnohire/shared';

type R<T> = Promise<T>;

export async function fetchBoard(filters: BoardFilters): R<{ board: PipelineBoard }> {
  const res = await api.get<ApiResponse<{ board: PipelineBoard }>>('/pipeline/board', { params: filters });
  return unwrap(res.data);
}

export async function moveApplication(id: string, data: MoveApplicationInput): R<{ card: PipelineCard }> {
  const res = await api.patch<ApiResponse<{ card: PipelineCard }>>(`/pipeline/applications/${id}/stage`, data);
  return unwrap(res.data);
}

export async function fetchNotes(applicationId: string): R<{ notes: PipelineNoteItem[] }> {
  const res = await api.get<ApiResponse<{ notes: PipelineNoteItem[] }>>(`/pipeline/applications/${applicationId}/notes`);
  return unwrap(res.data);
}

export async function addNote(applicationId: string, data: CreatePipelineNoteInput): R<{ note: PipelineNoteItem }> {
  const res = await api.post<ApiResponse<{ note: PipelineNoteItem }>>(`/pipeline/applications/${applicationId}/notes`, data);
  return unwrap(res.data);
}

export async function deleteNote(applicationId: string, noteId: string): R<{ success: boolean }> {
  const res = await api.delete<ApiResponse<{ success: boolean }>>(`/pipeline/applications/${applicationId}/notes/${noteId}`);
  return unwrap(res.data);
}
