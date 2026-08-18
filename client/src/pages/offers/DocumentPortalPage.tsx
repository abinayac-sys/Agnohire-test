import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  FileText,
  AlertTriangle,
  Clock,
  Loader2,
  CheckCircle,
  XCircle,
  Upload,
  User,
  Briefcase,
  FileCheck,
  Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button.js';
import * as offerApi from '../../services/offerApi.js';
import { apiErrorMessage } from '../../services/api.js';

interface DocumentRequirement {
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
}

export function DocumentPortalPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const requestedDocsParam = searchParams.get('docs');

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [portalInfo, setPortalInfo] = useState<{
    offerId: string;
    candidateName: string;
    jobTitle: string;
    validUntil: string | null;
    status: string;
    documents: DocumentRequirement[];
  } | null>(null);

  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  async function loadPortal() {
    try {
      const data = await offerApi.getPublicDocuments(token);
      if (requestedDocsParam) {
        const allowedIds = requestedDocsParam.split(',');
        data.documents = data.documents.filter(d => {
          // Optional documents (required: false) should always be available for upload
          if (!d.required) {
            return true;
          }
          // If a mandatory/required document is PENDING or REJECTED, only show it if its ID is in the requested list
          if (d.status === 'PENDING' || d.status === 'REJECTED') {
            return allowedIds.includes(d.id);
          }
          // Always show UPLOADED, VERIFIED docs
          return true;
        });
      }
      setPortalInfo(data);
    } catch (e) {
      setErrorMsg(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPortal();
  }, [token]);

  function getAcceptExtensions(typeStr: string) {
    const typeUpper = typeStr.toUpperCase();
    if (typeUpper === 'IMAGE') {
      return '.jpg,.jpeg,.png';
    }
    if (typeUpper === 'PDF/DOCX') {
      return '.pdf,.docx';
    }
    if (typeUpper === 'PDF/IMAGE') {
      return '.pdf,.jpg,.jpeg,.png';
    }
    return '';
  }

  function formatAllowedTypesDisplay(typeStr: string): string {
    const upper = typeStr.toUpperCase();
    if (upper === 'IMAGE') return 'JPG, JPEG, PNG';
    if (upper === 'PDF/IMAGE') return 'PDF, JPG, JPEG, PNG';
    if (upper === 'PDF/DOCX') return 'PDF, DOCX';
    return typeStr;
  }

  function handleUploadClick(docId: string) {
    setSelectedDocId(docId);
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // Reset input to allow choosing the same file again
    if (!file || !selectedDocId || !portalInfo) return;

    const doc = portalInfo.documents.find((d) => d.id === selectedDocId);
    if (!doc) return;

    // Size validation check
    const maxSizeMB = doc.maxSizeInt || 5;
    const isSizeExceeded = file.size > maxSizeMB * 1024 * 1024;

    // Type validation check
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    const typeUpper = doc.type.toUpperCase();
    let isTypeAccepted = false;
    let customErrorMsg = 'Unsupported file format';

    if (typeUpper === 'IMAGE') {
      const allowedExts = ['.jpg', '.jpeg', '.png'];
      isTypeAccepted = allowedExts.includes(fileExtension);
      customErrorMsg = 'Only JPG, JPEG and PNG files are allowed';
    } else if (typeUpper === 'PDF/DOCX') {
      const allowedExts = ['.pdf', '.docx'];
      isTypeAccepted = allowedExts.includes(fileExtension);
      customErrorMsg = 'Only PDF and DOCX files are allowed';
    } else if (typeUpper === 'PDF/IMAGE') {
      const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png'];
      isTypeAccepted = allowedExts.includes(fileExtension);
      customErrorMsg = 'Only PDF, JPG, JPEG and PNG files are allowed';
    }

    if (!isTypeAccepted && isSizeExceeded) {
      toast.error(`${customErrorMsg} and file size is exceed.`);
      return;
    } else if (!isTypeAccepted) {
      toast.error(`${customErrorMsg}.`);
      return;
    } else if (isSizeExceeded) {
      toast.error(`File size exceeds ${maxSizeMB} MB.`);
      return;
    }

    setUploadingId(selectedDocId);
    try {
      // 1. Upload to attachment store
      const meta = await offerApi.uploadPublicFile(token, file, selectedDocId);

      // 2. Link file to the document requirement
      await offerApi.uploadPublicDocument(token, selectedDocId, {
        fileUrl: meta.url,
      });

      toast.success(`${doc.name} uploaded successfully!`);
      await loadPortal();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to upload document'));
    } finally {
      setUploadingId(null);
      setSelectedDocId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="flex flex-col items-center gap-3 text-text-secondary">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="text-sm font-medium">Loading document portal…</p>
        </div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-xl text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h1 className="font-heading text-xl font-bold text-text-primary">Unable to Load Portal</h1>
          <p className="text-sm text-text-secondary">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (!portalInfo) return null;

  const totalRequired = portalInfo.documents.filter(d => d.required).length;
  const uploadedRequired = portalInfo.documents.filter(d => d.required && (d.status === 'VERIFIED' || d.status === 'UPLOADED')).length;
  const hasPendingMandatory = portalInfo.documents.some(d => d.required && d.status !== 'VERIFIED' && d.status !== 'UPLOADED');
  const isFinished = !hasPendingMandatory;

  const mandatoryDocs = portalInfo.documents.filter(d => d.required);
  const additionalDocs = portalInfo.documents.filter(d => !d.required);

  function renderDocCard(doc: any) {
    const isUploaded = doc.status === 'UPLOADED';
    const isVerified = doc.status === 'VERIFIED';
    const isRejected = doc.status === 'REJECTED';

    return (
      <div
        key={doc.id}
        className={`rounded-xl border p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-all ${isVerified
          ? 'border-success/20 bg-success/5'
          : isRejected
            ? 'border-danger/20 bg-danger/5'
            : isUploaded
              ? 'border-warning/20 bg-warning/5'
              : 'border-border bg-surface hover:border-accent/40'
          }`}
      >
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-text-primary">{doc.name}</span>
            {doc.required ? (
              <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger uppercase">
                Mandatory
              </span>
            ) : (
              <span className="rounded-full bg-text-secondary/10 px-2 py-0.5 text-[10px] font-bold text-text-secondary uppercase">
                Optional
              </span>
            )}

            {/* Status Badges */}
            {isVerified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-bold text-success">
                <Check className="h-3 w-3" /> Verified
              </span>
            )}
            {isRejected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2.5 py-0.5 text-[10px] font-bold text-danger">
                <XCircle className="h-3 w-3" /> Action Required
              </span>
            )}
            {isUploaded && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-[10px] font-bold text-warning">
                <Clock className="h-3 w-3" /> Under Review
              </span>
            )}
            {!isVerified && !isRejected && !isUploaded && (
              <span className="inline-flex items-center gap-1 rounded-full bg-text-secondary/15 px-2.5 py-0.5 text-[10px] font-bold text-text-secondary">
                Pending Upload
              </span>
            )}
          </div>

          {doc.description && (
            <p className="text-xs text-text-secondary leading-relaxed max-w-xl">
              {doc.description}
            </p>
          )}

          <div className="text-[11px] text-text-secondary flex items-center gap-4 flex-wrap">
            <span><strong>Allowed Formats:</strong> {formatAllowedTypesDisplay(doc.type)}</span>
            <span><strong>Max Size:</strong> {doc.maxSizeInt || 5} MB</span>
          </div>

          {isRejected && doc.rejectionReason && (
            <div className="mt-2 text-xs text-danger font-medium rounded-lg bg-danger/5 border border-danger/10 p-3 max-w-xl">
              <strong>Rejection Reason:</strong> {doc.rejectionReason}
            </div>
          )}
        </div>

        <div className="self-end md:self-center">
          {isVerified || isUploaded ? (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-success/20 text-success">
              <CheckCircle className="h-5 w-5" />
            </div>
          ) : (
            <Button
              size="sm"
              variant={isRejected ? 'primary' : 'outline'}
              className="gap-1.5"
              loading={uploadingId === doc.id}
              onClick={() => handleUploadClick(doc.id)}
            >
              <Upload className="h-3.5 w-3.5" />
              {isRejected ? 'Upload Correct copy' : 'Upload File'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-hover py-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-8">

        {/* Header card */}
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-8 text-white">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-white/10 p-2">
                <FileText className="h-6 w-6 text-white" />
              </div>
              <h1 className="font-heading text-2xl font-bold">Candidate Onboarding Portal</h1>
            </div>
            <p className="mt-2 text-white/80 text-sm">
              Please upload all required joining documents. HR will verify each document to initiate your final onboarding.
            </p>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-border bg-surface-raised">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-accent/10 p-2 text-accent">
                <User className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-semibold text-text-secondary uppercase">Candidate</div>
                <div className="text-sm font-semibold text-text-primary">{portalInfo.candidateName}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-accent/10 p-2 text-accent">
                <Briefcase className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-semibold text-text-secondary uppercase">Job Title</div>
                <div className="text-sm font-semibold text-text-primary">{portalInfo.jobTitle}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={selectedDocId ? getAcceptExtensions(portalInfo.documents.find(d => d.id === selectedDocId)?.type || '') : ''}
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Document list card */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
            <div>
              <h2 className="font-heading text-lg font-bold text-text-primary">Required Joining Documents</h2>
              <p className="text-xs text-text-secondary mt-1">
                Mandatory documents must be verified to complete onboarding.
              </p>
            </div>
            <div className="flex items-center gap-2 self-start rounded-full bg-accent/5 border border-accent/10 px-3 py-1 text-xs font-semibold text-accent">
              <FileCheck className="h-4 w-4" />
              Mandatory Uploaded: {uploadedRequired} / {totalRequired}
            </div>
          </div>

          {hasPendingMandatory && (
            <div className="rounded-xl bg-danger/5 border border-danger/15 p-4 text-center">
              <h3 className="font-semibold text-sm text-danger flex items-center justify-center gap-1.5">
                <AlertTriangle className="h-5 w-5 animate-pulse" /> Missing Mandatory Documents
              </h3>
              <p className="text-xs text-text-secondary mt-1 max-w-md mx-auto">
                Please upload all mandatory documents (marked as Mandatory) before your submission can be processed.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {mandatoryDocs.map(renderDocCard)}
          </div>

          {additionalDocs.length > 0 && (
            <div className="space-y-6 pt-6 border-t border-border mt-6">
              <div>
                <h2 className="font-heading text-lg font-bold text-text-primary">Optional Onboarding Documents</h2>
                <p className="text-xs text-text-secondary mt-1">
                  You can optionally upload these documents to help speed up your onboarding process.
                </p>
              </div>
              <div className="space-y-4">
                {additionalDocs.map(renderDocCard)}
              </div>
            </div>
          )}

          {isFinished && (
            <div className="rounded-xl bg-success/5 border border-success/20 p-4 text-center">
              <h3 className="font-semibold text-sm text-success flex items-center justify-center gap-1.5">
                <CheckCircle className="h-5 w-5" /> All Mandatory Documents Submitted!
              </h3>
              <p className="text-xs text-text-secondary mt-1 max-w-md mx-auto">
                Thank you. We have received your documents. HR is currently reviewing them. We will send you an email once verification is complete.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
