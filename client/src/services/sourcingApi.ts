import { api, unwrap } from './api.js';
import type {
  ReferralItem,
  ReferralFilters,
  CreateReferralInput,
  UpdateReferralInput,
  SourcingChannelItem,
  CreateSourcingChannelInput,
  UpdateSourcingChannelInput,
  ChannelFilters,
  CandidateListItem,
  CandidateUploadList,
  CuratedListMember,
  Paginated,
  ApiResponse,
} from '@agnohire/shared';

type R<T> = Promise<T>;

// ─── TALENT SEARCH ────────────────────────────────────────────────────────────

export interface TalentSearchParams {
  page?: number;
  limit?: number;
  q?: string;
  skillsAll?: string[];
  skillsAny?: string[];
  experienceLevel?: string;
  source?: string;
  sectorId?: string;
  domainId?: string;
  hasResume?: boolean;
  unassignedOnly?: boolean;
  minFitScore?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  jobRequisitionId?: string;
}

export async function searchCandidates(
  params: TalentSearchParams = {},
): R<Paginated<CandidateListItem>> {
  const query: Record<string, unknown> = { ...params };
  if (params.skillsAll?.length) query.skillsAll = params.skillsAll.join(',');
  else delete query.skillsAll;
  if (params.skillsAny?.length) query.skillsAny = params.skillsAny.join(',');
  else delete query.skillsAny;
  const res = await api.get<ApiResponse<Paginated<CandidateListItem>>>('/candidates/search', {
    params: query,
  });
  return unwrap(res.data);
}

// ─── REFERRALS ────────────────────────────────────────────────────────────────

export async function fetchReferrals(
  filters: Partial<ReferralFilters> = {},
): R<Paginated<ReferralItem>> {
  const res = await api.get<ApiResponse<Paginated<ReferralItem>>>('/sourcing/referrals', {
    params: filters,
  });
  return unwrap(res.data);
}

export async function createReferral(data: CreateReferralInput): R<{ referral: ReferralItem }> {
  const res = await api.post<ApiResponse<{ referral: ReferralItem }>>('/sourcing/referrals', data);
  return unwrap(res.data);
}

export async function updateReferral(
  id: string,
  data: UpdateReferralInput,
): R<{ referral: ReferralItem }> {
  const res = await api.patch<ApiResponse<{ referral: ReferralItem }>>(
    `/sourcing/referrals/${id}`,
    data,
  );
  return unwrap(res.data);
}

export async function deleteReferral(id: string): R<{ deleted: boolean }> {
  const res = await api.delete<ApiResponse<{ deleted: boolean }>>(`/sourcing/referrals/${id}`);
  return unwrap(res.data);
}

// ─── CHANNELS ─────────────────────────────────────────────────────────────────

export async function fetchChannels(
  filters: Partial<ChannelFilters> = {},
): R<{ channels: SourcingChannelItem[] }> {
  const res = await api.get<ApiResponse<{ channels: SourcingChannelItem[] }>>('/sourcing/channels', {
    params: filters,
  });
  return unwrap(res.data);
}

export async function createChannel(
  data: CreateSourcingChannelInput,
): R<{ channel: SourcingChannelItem }> {
  const res = await api.post<ApiResponse<{ channel: SourcingChannelItem }>>(
    '/sourcing/channels',
    data,
  );
  return unwrap(res.data);
}

export async function updateChannel(
  id: string,
  data: UpdateSourcingChannelInput,
): R<{ channel: SourcingChannelItem }> {
  const res = await api.patch<ApiResponse<{ channel: SourcingChannelItem }>>(
    `/sourcing/channels/${id}`,
    data,
  );
  return unwrap(res.data);
}

export async function syncChannel(id: string): R<{ message: string }> {
  const res = await api.post<ApiResponse<{ message: string }>>(`/sourcing/channels/${id}/sync`);
  return unwrap(res.data);
}

export async function deleteChannel(id: string): R<{ deleted: boolean }> {
  const res = await api.delete<ApiResponse<{ deleted: boolean }>>(`/sourcing/channels/${id}`);
  return unwrap(res.data);
}

// ─── CURATED LISTS ────────────────────────────────────────────────────────

export async function fetchLists(): R<Paginated<CandidateUploadList>> {
  const res = await api.get<ApiResponse<Paginated<CandidateUploadList>>>('/candidates/lists', {
    params: { limit: 100 },
  });
  return unwrap(res.data);
}

export async function createCuratedList(name: string): R<{ list: CandidateUploadList }> {
  const res = await api.post<ApiResponse<{ list: CandidateUploadList }>>('/candidates/lists/curated', {
    name,
  });
  return unwrap(res.data);
}

export async function deleteList(listId: string): R<{ deleted: boolean }> {
  // cascade=true: for a BULK_IMPORT-sourced list, the server also removes the
  // candidates it imported (a curated list's members are never touched — the
  // server only cascades when the list's own source is BULK_IMPORT).
  const res = await api.delete<ApiResponse<{ deleted: boolean }>>(`/candidates/lists/${listId}?cascade=true`);
  return unwrap(res.data);
}

export async function fetchListMembers(listId: string): R<{ members: CuratedListMember[] }> {
  const res = await api.get<ApiResponse<{ members: CuratedListMember[] }>>(
    `/candidates/lists/${listId}/members`,
  );
  return unwrap(res.data);
}

export async function addListItems(
  listId: string,
  candidateIds: string[],
): R<{ list: CandidateUploadList }> {
  const res = await api.post<ApiResponse<{ list: CandidateUploadList }>>(
    `/candidates/lists/${listId}/items`,
    { candidateIds },
  );
  return unwrap(res.data);
}

export async function removeListItems(
  listId: string,
  candidateIds: string[],
): R<{ list: CandidateUploadList }> {
  const res = await api.delete<ApiResponse<{ list: CandidateUploadList }>>(
    `/candidates/lists/${listId}/items`,
    { data: { candidateIds } },
  );
  return unwrap(res.data);
}

export async function assignList(
  listId: string,
  recruiterId: string,
): R<{ assigned: number }> {
  const res = await api.post<ApiResponse<{ assigned: number }>>(
    `/candidates/lists/${listId}/assign`,
    { recruiterId },
  );
  return unwrap(res.data);
}

export async function assignJobToList(
  listId: string,
  jobRequisitionId: string,
): R<{ applied: number; skipped: number }> {
  const res = await api.post<ApiResponse<{ applied: number; skipped: number }>>(
    `/candidates/lists/${listId}/assign-job`,
    { jobRequisitionId },
  );
  return unwrap(res.data);
}
