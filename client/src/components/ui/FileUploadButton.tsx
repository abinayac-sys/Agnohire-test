import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from './Button.js';
import { uploadFile } from '../../services/fileApi.js';
import { apiErrorMessage } from '../../services/api.js';
import type { AttachmentMeta } from '@agnohire/shared';

const DEFAULT_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.webp';

/**
 * A button that picks a file, uploads it to the generic attachment store, and
 * returns the resulting metadata (id + download URL) via onUploaded.
 */
export function FileUploadButton({
  onUploaded,
  label = 'Upload file',
  accept = DEFAULT_ACCEPT,
  variant = 'outline',
  size = 'sm',
  maxSizeMB,
}: {
  onUploaded: (file: AttachmentMeta) => void;
  label?: string;
  accept?: string;
  variant?: 'outline' | 'primary' | 'ghost';
  size?: 'sm' | 'md' | 'icon';
  maxSizeMB?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) e.target.value = ''; // allow re-picking the same file
    if (!file) return;

    if (maxSizeMB && file.size > maxSizeMB * 1024 * 1024) {
      toast.error(`File size exceeds maximum limit of ${maxSizeMB}MB`);
      return;
    }

    setUploading(true);
    try {
      const meta = await uploadFile(file);
      onUploaded(meta);
      toast.success('File uploaded');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={onPicked} />
      <Button
        type="button"
        variant={variant}
        size={size}
        loading={uploading}
        onClick={() => ref.current?.click()}
      >
        <Upload className="h-4 w-4" /> {label}
      </Button>
    </>
  );
}
