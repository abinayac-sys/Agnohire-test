import type { ApiResponse } from '@agnohire/shared';
import { api, unwrap } from './api.js';

export interface AIOSResultDto {
  output: string;
  workflowState: any;
  actionsRun: Array<{ tool: string; success: boolean; data?: any; error?: string }>;
  /** Set when a destructive tool call was gated and is awaiting the user's
   * explicit confirmation — round-trip `confirmationToken` back via a second
   * runAICommand() call (with no new instruction) to actually run it. */
  pendingConfirmation?: { toolName: string; preview: unknown; confirmationToken: string };
}

export async function runAICommand(
  instruction: string,
  lastWorkflowState?: any,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  confirmationToken?: string
): Promise<AIOSResultDto> {
  const res = await api.post<ApiResponse<AIOSResultDto>>('/ai/run', { instruction, lastWorkflowState, history, confirmationToken });
  return unwrap(res.data);
}

export interface AiChatHistoryDto {
  id: string;
  title: string;
  messages: Array<{ role: string; content: string }>;
  createdAt: string;
}

export async function saveHistory(messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<AiChatHistoryDto> {
  const res = await api.post<ApiResponse<AiChatHistoryDto>>('/ai/history', { messages });
  return unwrap(res.data);
}

export async function getHistories(): Promise<AiChatHistoryDto[]> {
  const res = await api.get<ApiResponse<AiChatHistoryDto[]>>('/ai/history');
  return unwrap(res.data);
}

export async function getHistory(id: string): Promise<AiChatHistoryDto> {
  const res = await api.get<ApiResponse<AiChatHistoryDto>>(`/ai/history/${id}`);
  return unwrap(res.data);
}

export async function deleteHistory(id: string): Promise<void> {
  await api.delete(`/ai/history/${id}`);
}
