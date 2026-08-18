import { api, unwrap } from './api.js';
import type {
  ReviewFilters,
  ReviewListItem,
  ReviewDetail,
  SetMediaInput,
  SubmitReviewInput,
  Paginated,
  ApiResponse,
} from '@agnohire/shared';

type R<T> = Promise<T>;

export async function fetchReviews(filters: Partial<ReviewFilters> = {}): R<Paginated<ReviewListItem>> {
  const res = await api.get<ApiResponse<Paginated<ReviewListItem>>>('/reviews', { params: filters });
  return unwrap(res.data);
}

export async function fetchReview(id: string): R<{ review: ReviewDetail }> {
  const res = await api.get<ApiResponse<{ review: ReviewDetail }>>(`/reviews/${id}`);
  return unwrap(res.data);
}

export async function setReviewMedia(id: string, data: SetMediaInput): R<{ review: ReviewDetail }> {
  const res = await api.put<ApiResponse<{ review: ReviewDetail }>>(`/reviews/${id}/media`, data);
  return unwrap(res.data);
}

export async function transcribeReview(
  id: string,
): R<{ transcribed: boolean; review: ReviewDetail }> {
  const res = await api.post<ApiResponse<{ transcribed: boolean; review: ReviewDetail }>>(
    `/reviews/${id}/transcribe`,
  );
  return unwrap(res.data);
}

export async function reanalyzeReview(id: string): R<{ queued: boolean }> {
  const res = await api.post<ApiResponse<{ queued: boolean }>>(`/reviews/${id}/analyze`);
  return unwrap(res.data);
}

export async function submitReview(id: string, data: SubmitReviewInput): R<{ review: ReviewDetail }> {
  const res = await api.post<ApiResponse<{ review: ReviewDetail }>>(`/reviews/${id}/review`, data);
  return unwrap(res.data);
}

export async function deleteReview(id: string): R<{ deleted: boolean }> {
  const res = await api.delete<ApiResponse<{ deleted: boolean }>>(`/reviews/${id}`);
  return unwrap(res.data);
}
