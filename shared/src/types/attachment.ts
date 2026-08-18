/** Generic uploaded-file metadata returned by POST /api/files. */
export interface AttachmentMeta {
  id: string;
  /** Download URL: /api/files/:id/download */
  url: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}
