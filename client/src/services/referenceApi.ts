import { api, unwrap } from './api.js';
import type { ApiResponse } from '@agnohire/shared';

export interface SectorRef {
  id: string;
  name: string;
  type: string;
}

export interface DomainRef {
  id: string;
  name: string;
  sectorId: string | null;
  parentId: string | null;
}

export async function fetchSectors(): Promise<{ sectors: SectorRef[] }> {
  const res = await api.get<ApiResponse<{ sectors: SectorRef[] }>>('/reference/sectors');
  return unwrap(res.data);
}

export async function fetchDomains(
  sectorId?: string,
): Promise<{ domains: DomainRef[] }> {
  const res = await api.get<ApiResponse<{ domains: DomainRef[] }>>('/reference/domains', {
    params: sectorId ? { sectorId } : {},
  });
  return unwrap(res.data);
}

export interface UserRef {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  role: { name: string; displayName: string };
}

export async function fetchUsers(): Promise<{ users: UserRef[] }> {
  const res = await api.get<ApiResponse<{ users: UserRef[] }>>('/reference/users');
  return unwrap(res.data);
}
