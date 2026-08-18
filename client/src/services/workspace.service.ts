import { api, unwrap } from './api.js';
import type { ApiResponse, AuthUser, MembershipTree } from '@agnohire/shared';

/** The org->workspace tree the signed-in user can switch into. */
export async function fetchMemberships(): Promise<MembershipTree> {
  const res = await api.get<ApiResponse<MembershipTree>>('/auth/memberships');
  return unwrap(res.data);
}

export interface SwitchWorkspaceResult {
  accessToken: string;
  user: AuthUser;
}

/** Re-validates membership server-side and returns a token pair scoped to the new workspace. */
export async function switchWorkspace(workspaceId: string): Promise<SwitchWorkspaceResult> {
  const res = await api.post<ApiResponse<SwitchWorkspaceResult>>('/auth/switch-workspace', { workspaceId });
  return unwrap(res.data);
}
