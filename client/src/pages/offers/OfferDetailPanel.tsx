import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { FileSignature, FileText, UserCheck, Send, Check, X, Plus, Trash2, ExternalLink, ShieldCheck, ArrowUp, ArrowDown, Download, Pencil } from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { FileUploadButton } from '../../components/ui/FileUploadButton.js';
import { cn } from '../../utils/cn.js';
import { useAuthStore } from '../../store/authStore.js';
import { OFFER_STATUS_VARIANT, OFFER_STATUS_LABEL, ONBOARDING_STATUS_LABEL, ONBOARDING_STATUS_VARIANT, BGV_STATUS_VARIANT } from './offerMeta.js';
import { PERMISSIONS, type OfferDetail, type OnboardingStatus, type BgvStatus } from '@agnohire/shared';
import * as offerApi from '../../services/offerApi.js';
import * as adminApi from '../../services/adminApi.js';
import { getAccessToken } from '../../services/api.js';
import { useConfirm } from '../../providers/ConfirmProvider.js';

type TabKey = 'offer' | 'documents' | 'onboarding';
const TABS: { key: TabKey; label: string; icon: typeof FileText }[] = [
  { key: 'offer', label: 'Offer', icon: FileSignature },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'onboarding', label: 'Onboarding', icon: UserCheck },
];

export function OfferDetailPanel({ open, offerId, canManage, initialTab = 'offer', hideOnboardingTab, onClose }: {
  open: boolean; offerId: string | null; canManage: boolean; initialTab?: TabKey; hideOnboardingTab?: boolean; onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>(initialTab);
  useEffect(() => { if (open) setTab(initialTab); }, [open, offerId, initialTab]);

  const { data, isLoading } = useQuery({
    queryKey: ['offer', offerId],
    queryFn: () => offerApi.fetchOffer(offerId!),
    enabled: !!offerId && open,
  });
  const offer = data?.offer;


  return (
    <Drawer open={open} onClose={onClose} size="xl"
      title={offer ? offer.candidate.fullName : 'Offer'}
      subtitle={offer ? `${offer.job.title} · ${offer.candidate.email}` : undefined}>
      {isLoading || !offer ? (
        <div className="flex h-full items-center justify-center"><Spinner /></div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-1 border-b border-border px-6">
            {TABS.map((t) => {
              if (t.key === 'onboarding' && hideOnboardingTab) return null;
              const Icon = t.icon; const on = tab === t.key;
              return (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={cn('flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                    on ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary')}>
                  <Icon className="h-4 w-4" /> {t.label}
                </button>
              );
            })}
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {tab === 'offer' && <OfferTab offer={offer} canManage={canManage} />}
            {tab === 'documents' && <DocumentsTab offer={offer} canManage={canManage} />}
            {tab === 'onboarding' && <OnboardingTab offer={offer} />}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function useInvalidate(offerId: string) {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ['offer', offerId] }); qc.invalidateQueries({ queryKey: ['offers'] }); };
}

// ─── OFFER TAB ───────────────────────────────────────────────────────────────

function OfferTab({ offer, canManage }: { offer: OfferDetail; canManage: boolean }) {
  const confirm = useConfirm();
  const invalidate = useInvalidate(offer.id);
  const isDraft = offer.status === 'DRAFT';
  const [salary, setSalary] = useState(offer.salaryOffered?.toString() ?? '');
  const [joining, setJoining] = useState(offer.joiningDate?.slice(0, 10) ?? '');
  const [valid, setValid] = useState(offer.validUntil?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(offer.notes ?? '');

  const save = useMutation({
    mutationFn: () => offerApi.updateOffer(offer.id, {
      salaryOffered: salary ? Number(salary) : null,
      joiningDate: joining ? new Date(joining) : null,
      validUntil: valid ? new Date(valid) : null,
      notes,
    }),
    onSuccess: () => { toast.success('Saved'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const send = useMutation({ mutationFn: () => offerApi.sendOffer(offer.id), onSuccess: () => { toast.success('Offer sent'); invalidate(); }, onError: (e: Error) => toast.error(e.message) });
  const respond = useMutation({
    mutationFn: (status: 'ACCEPTED' | 'DECLINED') => offerApi.respondOffer(offer.id, { status }),
    onSuccess: (_r, s) => { toast.success(s === 'ACCEPTED' ? 'Marked accepted — onboarding started' : 'Marked declined'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => offerApi.deleteOffer(offer.id),
    onSuccess: () => { toast.success('Offer deleted'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateJoiningDate = useMutation({
    mutationFn: (newDate: string) => offerApi.updateOffer(offer.id, {
      joiningDate: newDate ? new Date(newDate) : null,
    }),
    onSuccess: () => { toast.success('Joining date updated'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Badge variant={OFFER_STATUS_VARIANT[offer.status]}>{OFFER_STATUS_LABEL[offer.status] || offer.status}</Badge>
        {offer.offeredByName && <span className="text-xs text-text-muted">Offered by {offer.offeredByName}</span>}
      </div>

      {isDraft && canManage ? (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Salary offered</label>
            <Input type="number" min="0" value={salary} onChange={(e) => setSalary(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1.5 block text-sm font-medium text-text-secondary">Joining date</label><Input type="date" value={joining} onChange={(e) => setJoining(e.target.value)} /></div>
            <div><label className="mb-1.5 block text-sm font-medium text-text-secondary">Tentative Valid End</label><Input type="date" value={valid} onChange={(e) => setValid(e.target.value)} /></div>
          </div>
          <div><label className="mb-1.5 block text-sm font-medium text-text-secondary">Notes</label><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="flex justify-between items-center">
            <Button variant="ghost" className="text-danger" onClick={async () => { if (await confirm({ title: 'Delete Offer', message: 'Delete draft offer?', confirmText: 'Delete', variant: 'danger' })) remove.mutate(); }} loading={remove.isPending}><Trash2 className="h-4 w-4" /> Delete</Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => save.mutate()} loading={save.isPending}>Save draft</Button>
              <Button onClick={() => send.mutate()} loading={send.isPending}><Send className="h-4 w-4" /> Send offer</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Salary"
            value={
              offer.job.budgetMin != null && offer.job.budgetMax != null
                ? `${offer.job.budgetMin.toLocaleString()} - ${offer.job.budgetMax.toLocaleString()}`
                : offer.salaryOffered != null
                  ? offer.salaryOffered.toLocaleString()
                  : '—'
            }
          />
          {canManage ? (
            <div className="rounded-md border border-border bg-surface px-3 py-1.5 flex flex-col justify-between min-h-[58px]">
              <label className="text-xs text-text-muted block">Joining date</label>
              <input
                type="date"
                value={joining}
                onChange={(e) => {
                  setJoining(e.target.value);
                  updateJoiningDate.mutate(e.target.value);
                }}
                className="w-full text-sm font-medium text-text-primary bg-transparent border-0 outline-none p-0 focus:ring-0 focus:outline-none h-6 [color-scheme:light]"
              />
            </div>
          ) : (
            <Field label="Joining date" value={offer.joiningDate ? format(new Date(offer.joiningDate), 'dd MMM yyyy') : '—'} />
          )}
          <Field label="Tentative Valid End" value={offer.validUntil ? format(new Date(offer.validUntil), 'dd MMM yyyy') : '—'} />
          <Field label="Signed at" value={offer.signedAt ? 'Accepted' : 'Pending'} />
          {offer.notes && <div className="col-span-2"><Field label="Notes" value={offer.notes} /></div>}
        </div>
      )}

      {offer.offerLetterUrl && (
        <a href={offer.offerLetterUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
          <ExternalLink className="h-4 w-4" /> View offer letter
        </a>
      )}

      {offer.status === 'SENT' && canManage && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="mb-3 text-sm font-medium text-text-primary">Record candidate response</p>
          <div className="flex gap-2">
            <Button onClick={() => respond.mutate('ACCEPTED')} loading={respond.isPending}><Check className="h-4 w-4" /> Accepted</Button>
            <Button variant="outline" onClick={() => respond.mutate('DECLINED')} loading={respond.isPending}><X className="h-4 w-4" /> Declined</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="whitespace-pre-wrap text-sm font-medium text-text-primary">{value}</p>
    </div>
  );
}

// ─── DOCUMENTS TAB ───────────────────────────────────────────────────────────

function DocumentsTab({ offer, canManage }: { offer: OfferDetail; canManage: boolean }) {
  const invalidate = useInvalidate(offer.id);
  const [name, setName] = useState('');

  // Fetch config for Automate Document Email
  const { data: configItems } = useQuery({
    queryKey: ['system-config'],
    queryFn: adminApi.fetchConfig,
    staleTime: 30_000,
  });
  const automateDocEmail = configItems
    ? (configItems.find((c) => c.key === 'offer.automate_document_email')?.value ?? 'true') !== 'false'
    : true;

  // Staging state
  const [stagedFile, setStagedFile] = useState<{ fileName: string; url: string } | null>(null);
  const [maxSize, setMaxSize] = useState('5');

  // Allowed formats
  const [allowedFileFormat, setAllowedFileFormat] = useState('PDF/IMAGE');
  const [editAllowedFileFormat, setEditAllowedFileFormat] = useState('PDF/IMAGE');

  // Document requirement form state
  const [reqName, setReqName] = useState('');
  const [reqDesc, setReqDesc] = useState('');
  const [reqRequired, setReqRequired] = useState(true);
  const [reqType, setReqType] = useState('PDF/IMAGE');
  const [reqMaxSize, setReqMaxSize] = useState('5');
  const [showReqForm, setShowReqForm] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);

  // Rejection state
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');



  const add = useMutation({
    mutationFn: (payload: { name: string; fileUrl: string; type: string; maxSizeInt?: number }) =>
      offerApi.addOfferDocument(offer.id, { ...payload, required: false, maxSizeInt: payload.maxSizeInt ?? 5 }),
    onSuccess: () => {
      toast.success('Document added');
      setName('');
      setStagedFile(null);
      setMaxSize('5');
      setShowManualForm(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createReq = useMutation({
    mutationFn: () => offerApi.createDocumentRequirement(offer.id, {
      name: reqName,
      description: reqDesc,
      required: reqRequired,
      type: reqType,
      maxSizeInt: Number(reqMaxSize),
    }),
    onSuccess: () => {
      toast.success('Document requirement created');
      setReqName('');
      setReqDesc('');
      setReqRequired(true);
      setReqType('PDF/IMAGE');
      setReqMaxSize('5');
      setShowReqForm(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verifyDoc = useMutation({
    mutationFn: (docId: string) => offerApi.verifyDocument(offer.id, docId),
    onSuccess: () => { toast.success('Document verified'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectDoc = useMutation({
    mutationFn: ({ docId, reason }: { docId: string; reason: string }) => offerApi.rejectDocument(offer.id, docId, { reason }),
    onSuccess: () => {
      toast.success('Document rejected');
      setRejectId(null);
      setRejectReason('');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (docId: string) => offerApi.removeOfferDocument(offer.id, docId),
    onSuccess: () => { toast.success('Removed'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFileUrl, setEditFileUrl] = useState('');

  const updateDoc = useMutation({
    mutationFn: ({ docId, data }: { docId: string; data: { name: string; fileUrl: string; type: string; maxSizeInt?: number } }) =>
      offerApi.updateOfferDocument(offer.id, docId, { ...data, maxSizeInt: data.maxSizeInt ?? 5 }),
    onSuccess: () => {
      toast.success('Document updated');
      setEditingId(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendEmail = useMutation({
    mutationFn: (documentIds?: string | string[]) => offerApi.sendDocumentRequestEmail(offer.id, documentIds),
    onSuccess: () => { toast.success('Document request email sent successfully'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const getAuthUrl = (url: string | null) => {
    if (!url) return '#';
    const token = getAccessToken();
    return token ? `${url}?token=${token}` : url;
  };


  // Separate manual attachments vs workflow requirements
  const manualDocs = offer.documents.filter(d => d.isManual);
  const reqDocs = offer.documents.filter(d => !d.isManual);

  // Checkbox selection for Send Email (persisted so it survives page refreshes)
  const storageKey = `selectedDocs-${offer.id}`;
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(Array.from(selectedDocIds)));
  }, [selectedDocIds, storageKey]);

  // Track which documents have been requested/emailed (persisted in localStorage)
  const emailedKey = `emailedDocs-${offer.id}`;
  const [emailedDocIds, setEmailedDocIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(emailedKey);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    localStorage.setItem(emailedKey, JSON.stringify(Array.from(emailedDocIds)));
  }, [emailedDocIds, emailedKey]);

  const actionableReqDocs = reqDocs.filter(d => d.status === 'PENDING' || d.status === 'REJECTED');

  // Only keep selected IDs for documents that are still actionable
  // (Prevents checkboxes from remaining checked when a document is verified in the background)
  const validSelectedDocIds = new Set(Array.from(selectedDocIds).filter(id => actionableReqDocs.some(d => d.id === id)));

  const toggleDocSelect = (id: string) =>
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const selectAllDocs = () => setSelectedDocIds(new Set(actionableReqDocs.map(d => d.id)));
  const deselectAllDocs = () => setSelectedDocIds(new Set());

  const allSelected = actionableReqDocs.length > 0 && actionableReqDocs.every(d => validSelectedDocIds.has(d.id));
  const anySelected = validSelectedDocIds.size > 0;

  // ── Send Email button disabled-state logic ────────────────────────────────

  // Main Send Email disabled when there are no actionable candidate documents
  const hasActionableDocs = reqDocs.some(d => d.status === 'PENDING' || d.status === 'REJECTED');
  const sendEmailDisabled = reqDocs.length > 0 && !hasActionableDocs;

  const reorderDocs = useMutation({
    mutationFn: (documentIds: string[]) => offerApi.reorderDocuments(offer.id, documentIds),
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendFinalOffer = useMutation({
    mutationFn: () => offerApi.sendFinalOfferLetter(offer.id),
    onSuccess: () => {
      toast.success('Official offer letter sent successfully!');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });



  const handleReorder = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...reqDocs.map(d => d.id)];
    if (direction === 'up' && index > 0) {
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    } else if (direction === 'down' && index < newOrder.length - 1) {
      [newOrder[index + 1], newOrder[index]] = [newOrder[index], newOrder[index + 1]];
    } else {
      return;
    }
    reorderDocs.mutate(newOrder);
  };

  return (
    <div className="space-y-6">

      {/* 1. Required Onboarding Documents Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/50">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider truncate">
              Required Onboarding Documents
            </h3>
            {canManage && !automateDocEmail && reqDocs.length > 0 && !showReqForm && (
              <button
                type="button"
                onClick={allSelected ? deselectAllDocs : selectAllDocs}
                className="text-[11px] font-medium text-accent hover:underline shrink-0 whitespace-nowrap"
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>
          {canManage && !showReqForm && (
            <div className="flex items-center flex-wrap gap-2 shrink-0">
              {sendEmailDisabled && !anySelected && !automateDocEmail ? (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-success bg-success/10 border border-success/20 rounded-full px-2.5 py-1 whitespace-nowrap"
                >
                  ✓ All documents verified
                </span>
              ) : (
                <Button
                  size="sm"
                  variant={sendEmailDisabled ? 'secondary' : 'primary'}
                  onClick={async () => {
                    if (automateDocEmail) {
                      const pendingIds = actionableReqDocs.map((d: { id: string }) => d.id);
                      if (pendingIds.length === 0) return;
                      await sendEmail.mutateAsync(pendingIds);
                      setEmailedDocIds(prev => {
                        const next = new Set(prev);
                        pendingIds.forEach((id: string) => next.add(id));
                        return next;
                      });
                    } else if (anySelected) {
                      const sentIds = Array.from(validSelectedDocIds);
                      await sendEmail.mutateAsync(sentIds);
                      setEmailedDocIds(prev => {
                        const next = new Set(prev);
                        sentIds.forEach(id => next.add(id));
                        return next;
                      });
                    }
                  }}
                  loading={sendEmail.isPending}
                  disabled={automateDocEmail ? actionableReqDocs.length === 0 : !anySelected}
                  className="shrink-0 whitespace-nowrap"
                >
                  <Send className="mr-1 h-3.5 w-3.5" />
                  {anySelected ? `Send Email (${validSelectedDocIds.size})` : 'Send Email'}
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => setShowReqForm(true)} className="shrink-0 whitespace-nowrap">
                <Plus className="mr-1 h-3.5 w-3.5" /> Request Document
              </Button>
            </div>
          )}
        </div>

        {/* Create Requirement Form */}
        {showReqForm && (
          <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
            <h4 className="text-xs font-bold text-text-primary uppercase">Request New Document</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1">Document Name</label>
                <Input placeholder="e.g. PAN Card" value={reqName} onChange={(e) => setReqName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1">Allowed File Types</label>
                <Select
                  options={[
                    { value: 'IMAGE', label: 'JPG, JPEG, PNG' },
                    { value: 'PDF/DOCX', label: 'PDF, DOCX' },
                    { value: 'PDF/IMAGE', label: 'PDF, JPG, JPEG, PNG' },
                  ]}
                  value={reqType}
                  onChange={(e) => setReqType(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Description / Instructions</label>
              <Textarea rows={2} placeholder="Instructions for the candidate" value={reqDesc} onChange={(e) => setReqDesc(e.target.value)} />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                  <input type="checkbox" checked={reqRequired} onChange={(e) => setReqRequired(e.target.checked)} />
                  Mandatory
                </label>
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-text-secondary">Max Size (MB):</label>
                  <Input type="number" min="1" max="100" className="w-16 h-8 text-xs py-1" value={reqMaxSize} onChange={(e) => setReqMaxSize(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowReqForm(false)}>Cancel</Button>
                <Button size="sm" onClick={() => createReq.mutate()} loading={createReq.isPending} disabled={!reqName || !reqType}>Create</Button>
              </div>
            </div>
          </div>
        )}

        {reqDocs.length === 0 ? (
          <p className="text-xs text-text-muted italic bg-surface p-3 rounded-lg border border-border">No joining document requirements created yet.</p>
        ) : (
          <div className="space-y-3">
            {reqDocs.map((d, index) => {
              const isUploaded = d.status === 'UPLOADED';
              const isVerified = d.status === 'VERIFIED';
              const isRejected = d.status === 'REJECTED';
              const isPending = d.status === 'PENDING';
              const isEmailed = emailedDocIds.has(d.id) && isPending;

              return (
                <div key={d.id} className={`rounded-xl border bg-surface p-4 space-y-3 transition-colors ${!automateDocEmail && selectedDocIds.has(d.id) ? 'border-accent/50 ring-1 ring-accent/20' : 'border-border'}`}>
                  <div className="flex items-start justify-between gap-2">
                    {canManage && !automateDocEmail && (
                      <input
                        type="checkbox"
                        id={`doc-select-${d.id}`}
                        checked={selectedDocIds.has(d.id)}
                        onChange={() => toggleDocSelect(d.id)}
                        disabled={!isPending && !isRejected}
                        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-accent disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label={`Select ${d.name}`}
                      />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-sm text-text-primary">{d.name}</span>
                        {d.required ? (
                          <Badge variant="danger">Required</Badge>
                        ) : (
                          <Badge variant="outline">Optional</Badge>
                        )}

                        {isVerified && <Badge variant="success">Verified</Badge>}
                        {isRejected && <Badge variant="danger">Rejected</Badge>}
                        {isUploaded && <Badge variant="warning">Uploaded</Badge>}
                        {isPending && <Badge variant="muted">Pending</Badge>}
                        {isEmailed && <Badge variant="outline" className="border-accent/40 text-accent bg-accent/5">Email Sent</Badge>}
                      </div>
                      {d.description && <p className="text-xs text-text-muted mt-1 leading-relaxed">{d.description}</p>}
                      <div className="text-[10px] text-text-muted mt-1">
                        Allowed: {d.type} &middot; Max size: {d.maxSizeInt || 5}MB
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex flex-col items-center gap-1 border-l border-border pl-2 ml-2">
                        <button disabled={index === 0} onClick={() => handleReorder(index, 'up')} className="rounded p-1 text-text-muted hover:bg-surface-raised disabled:opacity-30">
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button disabled={index === reqDocs.length - 1} onClick={() => handleReorder(index, 'down')} className="rounded p-1 text-text-muted hover:bg-surface-raised disabled:opacity-30">
                          <ArrowDown className="h-3 w-3" />
                        </button>
                        <button onClick={() => remove.mutate(d.id)} className="rounded p-1 text-text-muted hover:bg-surface-raised hover:text-danger mt-1">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Upload / Rejection Reason Details */}
                  {(d.fileUrl || isRejected || (isPending && !['Passport Size Photograph', 'Resume', 'Aadhaar Card'].includes(d.name))) && (
                    <div className="border-t border-border pt-2 flex flex-col gap-2">
                      {d.fileUrl && (
                        <div className="flex items-center justify-between bg-surface-raised rounded-lg p-2 text-xs">
                          <span className="truncate max-w-[200px] text-text-secondary">Submitted File</span>
                          <div className="flex gap-2">
                            <a href={getAuthUrl(d.fileUrl)} target="_blank" rel="noreferrer" className="text-accent hover:underline flex items-center gap-1">
                              <ExternalLink className="h-3.5 w-3.5" /> View
                            </a>
                            <a href={`${getAuthUrl(d.fileUrl)}${getAuthUrl(d.fileUrl).includes('?') ? '&' : '?'}download=true`} className="text-accent hover:underline">
                              Download
                            </a>
                          </div>
                        </div>
                      )}

                      {isRejected && d.rejectionReason && (
                        <p className="text-xs text-danger bg-danger/5 border border-danger/15 rounded-lg p-2">
                          <strong>Rejection Reason:</strong> {d.rejectionReason}
                        </p>
                      )}

                      {/* HR Verification / Rejection Actions */}
                      {isUploaded && canManage && (
                        <div className="flex items-center gap-2 justify-end pt-1">
                          <Button size="sm" className="bg-success text-white hover:bg-success/90" onClick={() => verifyDoc.mutate(d.id)} loading={verifyDoc.isPending && verifyDoc.variables === d.id} disabled={verifyDoc.isPending}>
                            <Check className="h-3 w-3 mr-1" /> Verify
                          </Button>
                          <Button size="sm" variant="outline" className="text-danger border-danger/20 hover:bg-danger/5" onClick={() => setRejectId(d.id)} disabled={rejectDoc.isPending}>
                            <X className="h-3 w-3 mr-1" /> Reject
                          </Button>
                        </div>
                      )}


                    </div>
                  )}

                  {/* Reject Dialog inline */}
                  {rejectId === d.id && (
                    <div className="border-t border-border pt-3 space-y-2">
                      <label className="block text-xs font-semibold text-text-secondary">Reason for Rejection</label>
                      <Input placeholder="e.g. Blur image, Expired copy, etc." value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setRejectId(null); setRejectReason(''); }}>Cancel</Button>
                        <Button size="sm" className="bg-danger text-white hover:bg-danger/90" disabled={!rejectReason} onClick={() => rejectDoc.mutate({ docId: d.id, reason: rejectReason })} loading={rejectDoc.isPending}>Reject</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 1.5 Send Offer Letter Section */}
      {canManage && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-text-primary">Send Official Offer Letter</h4>
              <p className="text-xs text-text-muted mt-1">
                Generate the PDF offer letter and email it to the candidate.
              </p>
            </div>
            <Button
              onClick={() => sendFinalOffer.mutate()}
              loading={sendFinalOffer.isPending}
              disabled={offer.status === 'ACCEPTED' || !!offer.signedAt}
              className="bg-accent text-white"
            >
              Send Offer Letter
            </Button>
          </div>
        </div>
      )}

      <hr className="border-border" />

      {/* 2. Manual Attachments Section (Original flow) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">Manual Attachments</h3>
          {canManage && !showManualForm && (
            <Button
              size="sm"
              variant="primary"
              type="button"
              onClick={() => setShowManualForm(true)}
              className="text-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Create
            </Button>
          )}
        </div>

        {canManage && showManualForm && (
          <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1">Document Name</label>
                <Input placeholder="e.g. Experience Certificate" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1">Allowed File Format</label>
                <Select
                  options={[
                    { value: 'PDF/IMAGE', label: 'PDF, JPG, JPEG, PNG' },
                    { value: 'JPG, JPEG, PNG', label: 'JPG, JPEG, PNG only' },
                    { value: 'PDF, DOCX', label: 'PDF, DOCX' },
                    { value: 'PDF only', label: 'PDF only' },
                    { value: 'DOCX only', label: 'DOCX only' },
                  ]}
                  value={allowedFileFormat}
                  onChange={(e) => setAllowedFileFormat(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1">Max Size (MB)</label>
                <Input type="number" min="1" value={maxSize} onChange={(e) => setMaxSize(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border pt-2">
              <div className="flex items-center gap-2">
                <FileUploadButton
                  label="Upload a file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  maxSizeMB={Number(maxSize) || 5}
                  onUploaded={(f) => {
                    const ext = f.fileName.split('.').pop()?.toLowerCase();
                    const allowedMap: Record<string, string[]> = {
                      'PDF/IMAGE': ['pdf', 'jpg', 'jpeg', 'png'],
                      'JPG, JPEG, PNG': ['jpg', 'jpeg', 'png'],
                      'PDF, DOCX': ['pdf', 'docx'],
                      'PDF only': ['pdf'],
                      'DOCX only': ['docx'],
                    };
                    const validExtensions = allowedMap[allowedFileFormat] || ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg'];
                    if (!ext || !validExtensions.includes(ext)) {
                      toast.error(`File format wrong! Allowed formats: ${validExtensions.join(', ').toUpperCase()}`);
                      return;
                    }
                    setStagedFile({ fileName: f.fileName, url: f.url });
                    if (!name) setName(f.fileName.split('.').slice(0, -1).join('.'));
                    toast.success('File uploaded successfully. Click Create to save document.');
                  }}
                />
                {stagedFile && (
                  <span className="text-xs text-text-secondary truncate max-w-xs italic">
                    Staged: {stagedFile.fileName}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => {
                    setShowManualForm(false);
                    setName('');
                    setStagedFile(null);
                    setMaxSize('5');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!stagedFile}
                  onClick={() => {
                    if (!stagedFile) return;
                    const finalName = name ? name.trim() : '';
                    add.mutate({ name: finalName || stagedFile.fileName, fileUrl: stagedFile.url, type: 'OTHER', maxSizeInt: Number(maxSize) || 5 });
                  }}
                  loading={add.isPending}
                >
                  <Plus className="h-4 w-4 mr-1" /> Create
                </Button>
              </div>
            </div>
          </div>
        )}

        {manualDocs.length === 0 ? (
          <p className="text-xs text-text-muted italic bg-surface p-3 rounded-lg border border-border">No manual attachments added.</p>
        ) : (
          <ul className="space-y-2">
            {manualDocs.map((d) => {
              const isVerified = d.status === 'VERIFIED';
              const isRejected = d.status === 'REJECTED';
              const authUrl = getAuthUrl(d.fileUrl);
              const downloadUrl = `${authUrl}${authUrl.includes('?') ? '&' : '?'}download=true`;
              const isEditing = editingId === d.id;

              if (isEditing) {
                return (
                  <li key={d.id} className="rounded-lg border border-accent bg-surface p-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary mb-1">Document Name</label>
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary mb-1">Allowed File Format</label>
                        <Select
                          options={[
                            { value: 'PDF/IMAGE', label: 'PDF, JPG, JPEG, PNG' },
                            { value: 'JPG, JPEG, PNG', label: 'JPG, JPEG, PNG only' },
                            { value: 'PDF, DOCX', label: 'PDF, DOCX' },
                            { value: 'PDF only', label: 'PDF only' },
                            { value: 'DOCX only', label: 'DOCX only' },
                          ]}
                          value={editAllowedFileFormat}
                          onChange={(e) => setEditAllowedFileFormat(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-2">
                      <FileUploadButton
                        label="Change file"
                        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                        onUploaded={(f) => {
                          const ext = f.fileName.split('.').pop()?.toLowerCase();
                          const allowedMap: Record<string, string[]> = {
                            'PDF/IMAGE': ['pdf', 'jpg', 'jpeg', 'png'],
                            'JPG, JPEG, PNG': ['jpg', 'jpeg', 'png'],
                            'PDF, DOCX': ['pdf', 'docx'],
                            'PDF only': ['pdf'],
                            'DOCX only': ['docx'],
                          };
                          const validExtensions = allowedMap[editAllowedFileFormat] || ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg'];
                          if (!ext || !validExtensions.includes(ext)) {
                            toast.error(`File format wrong! Allowed formats: ${validExtensions.join(', ').toUpperCase()}`);
                            return;
                          }
                          setEditFileUrl(f.url);
                          if (!editName) setEditName(f.fileName.split('.').slice(0, -1).join('.'));
                          toast.success('New file staged. Save to commit.');
                        }}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                        <Button size="sm" onClick={() => {
                          updateDoc.mutate({ docId: d.id, data: { name: editName, fileUrl: editFileUrl || d.fileUrl || '', type: 'OTHER' } });
                        }} loading={updateDoc.isPending} disabled={!editName}>Save</Button>
                      </div>
                    </div>
                  </li>
                );
              }

              return (
                <li key={d.id} className="rounded-lg border border-border bg-surface p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="truncate text-sm font-medium text-text-primary">{d.name}</p>
                        {isVerified && <Badge variant="success">Verified</Badge>}
                        {isRejected && <Badge variant="danger">Rejected</Badge>}
                        {!isVerified && !isRejected && <Badge variant="warning">Unverified</Badge>}
                      </div>
                      <p className="text-xs text-text-muted">{d.type}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a href={authUrl} target="_blank" rel="noreferrer" title="View">
                        <Button variant="outline" size="icon" type="button"><ExternalLink className="h-4 w-4" /></Button>
                      </a>
                      <a href={downloadUrl} title="Download">
                        <Button variant="outline" size="icon" type="button"><Download className="h-4 w-4" /></Button>
                      </a>
                      {canManage && (
                        <>
                          <Button variant="outline" size="icon" type="button" title="Edit" onClick={() => {
                            setEditingId(d.id);
                            setEditName(d.name);
                            setEditFileUrl(d.fileUrl || '');
                          }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <button onClick={() => remove.mutate(d.id)} className="rounded p-1 text-text-muted hover:bg-surface-raised hover:text-danger" title="Delete"><Trash2 className="h-4 w-4" /></button>
                        </>
                      )}
                    </div>
                  </div>

                  {isRejected && d.rejectionReason && (
                    <p className="text-xs text-danger bg-danger/5 border border-danger/15 rounded-lg p-2">
                      <strong>Rejection Reason:</strong> {d.rejectionReason}
                    </p>
                  )}

                  {canManage && d.status === 'UPLOADED' && rejectId !== d.id && (
                    <div className="flex items-center gap-2 justify-end border-t border-border pt-2">
                      <Button size="sm" className="bg-success text-white hover:bg-success/90" onClick={() => verifyDoc.mutate(d.id)} loading={verifyDoc.isPending && verifyDoc.variables === d.id} disabled={verifyDoc.isPending}>
                        <Check className="h-3 w-3 mr-1" /> Verify
                      </Button>
                      <Button size="sm" variant="outline" className="text-danger border-danger/20 hover:bg-danger/5" onClick={() => setRejectId(d.id)}>
                        <X className="h-3 w-3 mr-1" /> Reject
                      </Button>
                    </div>
                  )}

                  {rejectId === d.id && (
                    <div className="border-t border-border pt-2 space-y-2">
                      <label className="block text-xs font-semibold text-text-secondary">Reason for Rejection</label>
                      <Input placeholder="e.g. Blur image, Expired copy, etc." value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setRejectId(null); setRejectReason(''); }}>Cancel</Button>
                        <Button size="sm" className="bg-danger text-white hover:bg-danger/90" disabled={!rejectReason} onClick={() => rejectDoc.mutate({ docId: d.id, reason: rejectReason })} loading={rejectDoc.isPending}>Reject</Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

    </div>
  );
}

// ─── ONBOARDING TAB ──────────────────────────────────────────────────────────

const ONBOARDING_OPTIONS: { value: OnboardingStatus; label: string }[] = [
  { value: 'NOT_STARTED', label: 'Not started' }, { value: 'IN_PROGRESS', label: 'In progress' }, { value: 'COMPLETED', label: 'Completed' },
];
const BGV_OPTIONS: { value: BgvStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pending' }, { value: 'IN_PROGRESS', label: 'In progress' }, { value: 'CLEARED', label: 'Cleared' }, { value: 'FLAGGED', label: 'Flagged' },
];

function OnboardingTab({ offer }: { offer: OfferDetail }) {
  const invalidate = useInvalidate(offer.id);
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission(PERMISSIONS.ONBOARDING_MANAGE);
  const ob = offer.onboarding;

  const update = useMutation({
    mutationFn: (patch: { status?: OnboardingStatus; bgvStatus?: BgvStatus; bgvReportUrl?: string }) => offerApi.updateOnboarding(offer.id, patch),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (v: { itemId: string; done: boolean }) => offerApi.toggleChecklistItem(offer.id, v),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!ob) return <p className="text-sm text-text-muted">Onboarding starts once the offer is accepted.</p>;

  const done = ob.checklist.filter((c) => c.done).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">Status</label>
          {canManage
            ? <Select options={ONBOARDING_OPTIONS} value={ob.status} onChange={(e) => update.mutate({ status: e.target.value as OnboardingStatus })} />
            : <Badge variant={ONBOARDING_STATUS_VARIANT[ob.status]}>{ONBOARDING_STATUS_LABEL[ob.status]}</Badge>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">Background check</label>
          {canManage
            ? <Select options={BGV_OPTIONS} value={ob.bgvStatus} onChange={(e) => update.mutate({ bgvStatus: e.target.value as BgvStatus })} />
            : <Badge variant={BGV_STATUS_VARIANT[ob.bgvStatus]}><ShieldCheck className="mr-1 h-3 w-3" />{ob.bgvStatus}</Badge>}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">BGV report</p>
          {ob.bgvReportUrl ? (
            (() => {
              const token = getAccessToken();
              const authUrl = token ? `${ob.bgvReportUrl}?token=${token}` : ob.bgvReportUrl;
              return (
                <a href={authUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
                  <ExternalLink className="h-3 w-3" /> View report
                </a>
              );
            })()
          ) : (
            <p className="text-xs text-text-muted">No report uploaded.</p>
          )}
        </div>
        {canManage && (
          <FileUploadButton
            label={ob.bgvReportUrl ? 'Replace' : 'Upload report'}
            onUploaded={(f) => update.mutate({ bgvReportUrl: f.url })}
          />
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-medium text-text-primary">Checklist</h4>
          <span className="text-xs text-text-muted">{done}/{ob.checklist.length} done</span>
        </div>
        {ob.checklist.length === 0 ? (
          <p className="text-sm text-text-muted">No checklist items.</p>
        ) : (
          <ul className="space-y-2">
            {ob.checklist.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
                <button
                  disabled={!canManage || toggle.isPending}
                  onClick={() => toggle.mutate({ itemId: c.id, done: !c.done })}
                  className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded border', c.done ? 'border-success bg-success text-white' : 'border-border')}
                  aria-label={c.done ? 'Mark incomplete' : 'Mark complete'}>
                  {c.done && <Check className="h-3.5 w-3.5" />}
                </button>
                <span className={cn('text-sm', c.done ? 'text-text-muted line-through' : 'text-text-primary')}>{c.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
