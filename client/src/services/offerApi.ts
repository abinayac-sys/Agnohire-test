import { api, unwrap } from './api.js';
import type {
  OfferFilters,
  OfferListItem,
  OfferDetail,
  CreateOfferInput,
  UpdateOfferInput,
  RespondOfferInput,
  AddOfferDocumentInput,
  UpdateOnboardingInput,
  SetChecklistInput,
  ToggleChecklistItemInput,
  Paginated,
  ApiResponse,
} from '@agnohire/shared';

type R<T> = Promise<T>;
type OD = { offer: OfferDetail };

export async function fetchOffers(filters: Partial<OfferFilters> = {}): R<Paginated<OfferListItem>> {
  const res = await api.get<ApiResponse<Paginated<OfferListItem>>>('/offers', { params: filters });
  return unwrap(res.data);
}
export async function fetchOffer(id: string): R<OD> {
  return unwrap((await api.get<ApiResponse<OD>>(`/offers/${id}`)).data);
}
export async function createOffer(data: CreateOfferInput): R<OD> {
  return unwrap((await api.post<ApiResponse<OD>>('/offers', data)).data);
}
export async function updateOffer(id: string, data: UpdateOfferInput): R<OD> {
  return unwrap((await api.patch<ApiResponse<OD>>(`/offers/${id}`, data)).data);
}
export async function deleteOffer(id: string): R<{ deleted: boolean }> {
  return unwrap((await api.delete<ApiResponse<{ deleted: boolean }>>(`/offers/${id}`)).data);
}
export async function sendOffer(id: string): R<OD> {
  return unwrap((await api.post<ApiResponse<OD>>(`/offers/${id}/send`)).data);
}
export async function respondOffer(id: string, data: RespondOfferInput): R<OD> {
  return unwrap((await api.post<ApiResponse<OD>>(`/offers/${id}/respond`, data)).data);
}
export async function addOfferDocument(id: string, data: AddOfferDocumentInput): R<OD> {
  return unwrap((await api.post<ApiResponse<OD>>(`/offers/${id}/documents`, data)).data);
}
export async function removeOfferDocument(id: string, documentId: string): R<OD> {
  return unwrap((await api.delete<ApiResponse<OD>>(`/offers/${id}/documents/${documentId}`)).data);
}
export async function updateOfferDocument(id: string, documentId: string, data: { name: string; fileUrl: string; type: string; maxSizeInt?: number }): R<OD> {
  return unwrap((await api.put<ApiResponse<OD>>(`/offers/${id}/documents/${documentId}`, data)).data);
}
export async function updateOnboarding(id: string, data: UpdateOnboardingInput): R<OD> {
  return unwrap((await api.patch<ApiResponse<OD>>(`/offers/${id}/onboarding`, data)).data);
}
export async function setChecklist(id: string, data: SetChecklistInput): R<OD> {
  return unwrap((await api.put<ApiResponse<OD>>(`/offers/${id}/onboarding/checklist`, data)).data);
}
export async function toggleChecklistItem(id: string, data: ToggleChecklistItemInput): R<OD> {
  return unwrap((await api.patch<ApiResponse<OD>>(`/offers/${id}/onboarding/checklist/item`, data)).data);
}

export async function getPublicOffer(token: string): R<{ candidateName: string; jobTitle: string; validUntil: string | null; alreadyAccepted: boolean; expired: boolean }> {
  return unwrap((await api.get<ApiResponse<{ candidateName: string; jobTitle: string; validUntil: string | null; alreadyAccepted: boolean; expired: boolean }>>(`/offer/accept/${token}`)).data);
}

export async function acceptPublicOffer(token: string): R<{ success: boolean }> {
  return unwrap((await api.post<ApiResponse<{ success: boolean }>>(`/offer/accept/${token}`)).data);
}

export async function getTentativeOffer(token: string): R<{ candidateName: string; jobTitle: string; validUntil: string | null; alreadyAccepted: boolean; expired: boolean }> {
  return unwrap((await api.get<ApiResponse<{ candidateName: string; jobTitle: string; validUntil: string | null; alreadyAccepted: boolean; expired: boolean }>>(`/offer/tentative-accept/${token}`)).data);
}

export async function acceptTentativeOffer(token: string): R<{ success: boolean }> {
  return unwrap((await api.post<ApiResponse<{ success: boolean }>>(`/offer/tentative-accept/${token}`)).data);
}

export async function createDocumentRequirement(id: string, data: { name: string; description: string; required: boolean; type: string; maxSizeInt: number }): R<OD> {
  return unwrap((await api.post<ApiResponse<OD>>(`/offers/${id}/documents/requirements`, data)).data);
}

export async function reorderDocuments(id: string, documentIds: string[]): R<OD> {
  return unwrap((await api.put<ApiResponse<OD>>(`/offers/${id}/documents/reorder`, { documentIds })).data);
}

export async function sendDocumentRequestEmail(id: string, documentIds?: string | string[]): Promise<{ message: string }> {
  return unwrap((await api.post<ApiResponse<{ message: string }>>(`/offers/${id}/documents/send-email`, { documentIds })).data);
}

export async function sendFinalOfferLetter(id: string): R<OD> {
  return unwrap((await api.post<ApiResponse<OD>>(`/offers/${id}/send-final-offer-letter`)).data);
}

export async function fetchOnboardingDocumentsConfig(): R<{ value: string }> {
  return unwrap((await api.get<ApiResponse<{ value: string }>>('/offers/onboarding-documents/config')).data);
}

export async function updateOnboardingDocumentsConfig(value: string): R<{ success: boolean }> {
  return unwrap((await api.put<ApiResponse<{ success: boolean }>>('/offers/onboarding-documents/config', { value })).data);
}

export async function verifyDocument(id: string, documentId: string): R<OD> {
  return unwrap((await api.post<ApiResponse<OD>>(`/offers/${id}/documents/${documentId}/verify`)).data);
}

export async function rejectDocument(id: string, documentId: string, data: { reason: string }): R<OD> {
  return unwrap((await api.post<ApiResponse<OD>>(`/offers/${id}/documents/${documentId}/reject`, data)).data);
}

export async function getPublicDocuments(token: string): R<{
  offerId: string;
  candidateName: string;
  jobTitle: string;
  validUntil: string | null;
  status: string;
  documents: {
    id: string;
    name: string;
    description: string | null;
    required: boolean;
    type: string;
    maxSizeInt: number | null;
    status: string;
    fileUrl: string | null;
    uploadedAt: string | null;
    rejectionReason: string | null;
  }[];
}> {
  return unwrap((await api.get<ApiResponse<{
    offerId: string;
    candidateName: string;
    jobTitle: string;
    validUntil: string | null;
    status: string;
    documents: any[];
  }>>(`/offer/documents/${token}`)).data);
}

export async function uploadPublicFile(token: string, file: File, documentId?: string): R<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  if (documentId) form.append('documentId', documentId);
  const res = await api.post<ApiResponse<{ attachment: { url: string } }>>(`/offer/documents/${token}/file`, form);
  return { url: unwrap(res.data).attachment.url };
}

export async function uploadPublicDocument(token: string, documentId: string, data: { fileUrl: string }): R<{ success: boolean }> {
  return unwrap((await api.post<ApiResponse<{ success: boolean }>>(`/offer/documents/${token}/upload/${documentId}`, data)).data);
}
