import { api, unwrap } from './api.js';
import type { ApiResponse, AttachmentMeta } from '@agnohire/shared';

/**
 * Uploads a file to the generic attachment store and returns its metadata
 * (including a download URL). Used by offer documents, offer letters, and
 * onboarding BGV reports so files are stored in the DB instead of pasted links.
 */
export async function uploadFile(file: File, token?: string): Promise<AttachmentMeta> {
  const form = new FormData();
  form.append('file', file);
  const url = token ? `/files?offerToken=${encodeURIComponent(token)}` : '/files';
  const res = await api.post<ApiResponse<{ attachment: AttachmentMeta }>>(url, form);
  return unwrap(res.data).attachment;
}
