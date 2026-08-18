import { api, unwrap } from './api.js';
import type { MyInterviewItem, MyOfferItem, MyApplicationItem, ApiResponse } from '@agnohire/shared';

export async function fetchMyInterviews(): Promise<MyInterviewItem[]> {
  const res = await api.get<ApiResponse<{ interviews: MyInterviewItem[] }>>('/me/interviews');
  return unwrap(res.data).interviews;
}

export async function fetchMyApplications(): Promise<MyApplicationItem[]> {
  const res = await api.get<ApiResponse<{ applications: MyApplicationItem[] }>>('/me/applications');
  return unwrap(res.data).applications;
}

export async function fetchMyOffers(): Promise<MyOfferItem[]> {
  const res = await api.get<ApiResponse<{ offers: MyOfferItem[] }>>('/me/offers');
  return unwrap(res.data).offers;
}
