import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Search, FileSignature, Plus, UserCheck, Trash2, FileText } from 'lucide-react';
import { PageHeader } from '../../components/common/PageHeader.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Tooltip } from '../../components/ui/Tooltip.js';
import { OfferDetailPanel } from './OfferDetailPanel.js';
import { OFFER_STATUS_VARIANT, OFFER_STATUS_OPTIONS, OFFER_STATUS_LABEL, ONBOARDING_STATUS_LABEL, ONBOARDING_STATUS_VARIANT } from './offerMeta.js';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS, type OfferStatus, type CreateOfferInput } from '@agnohire/shared';
import * as offerApi from '../../services/offerApi.js';
import * as candidateApi from '../../services/candidateApi.js';
import * as adminApi from '../../services/adminApi.js';
import { useConfirm } from '../../providers/ConfirmProvider.js';

const AUTOMATE_DOC_EMAIL_KEY = 'offer.automate_document_email';


export function OffersPage({ onboardingMode = false }: { onboardingMode?: boolean }) {
  const qc = useQueryClient();
  const { hasPermission } = useAuthStore();
  const canManage = hasPermission(PERMISSIONS.OFFER_MANAGE);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OfferStatus | ''>('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingDocuments, setEditingDocuments] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // ── Automate Document Email config ────────────────────────────────────────
  const { data: configItems } = useQuery({
    queryKey: ['system-config'],
    queryFn: adminApi.fetchConfig,
    staleTime: 30_000,
  });
  const automateDocEmail = configItems
    ? (configItems.find((c) => c.key === AUTOMATE_DOC_EMAIL_KEY)?.value ?? 'true') !== 'false'
    : true;

  const saveAutomate = useMutation({
    mutationFn: (enabled: boolean) =>
      adminApi.updateConfig(AUTOMATE_DOC_EMAIL_KEY, enabled.toString()),
    onSuccess: (_data, enabled) => {
      toast.success(enabled ? 'Document email automation enabled' : 'Document email automation disabled');
      qc.invalidateQueries({ queryKey: ['system-config'] });
    },
    onError: (e: Error) => toast.error(`Failed to update setting: ${e.message}`),
  });

  // Fetch onboarding documents config to check if any exist
  const { data: docConfig } = useQuery({
    queryKey: ['onboarding-documents-config'],
    queryFn: () => offerApi.fetchOnboardingDocumentsConfig(),
    staleTime: 30_000,
  });
  const hasDocuments = (() => {
    if (!docConfig?.value) return false;
    try {
      const parsed = JSON.parse(docConfig.value);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  })();


  const { data, isLoading } = useQuery({
    queryKey: ['offers', search, status],
    queryFn: () => offerApi.fetchOffers({ search: search || undefined, status: status || undefined, limit: 500 }),
  });
  const rawItems = data?.items ?? [];
  const items = rawItems.filter((o) => {
    if (onboardingMode) {
      if (!status) {
        return ['ACCEPTED', 'TENTATIVE', 'DOCUMENTS_PENDING', 'DOCUMENTS_SUBMITTED', 'DOCUMENTS_VERIFIED'].includes(o.status);
      }
    }
    return true;
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => offerApi.deleteOffer(id)));
    },
    onSuccess: () => {
      toast.success(onboardingMode ? 'Onboarding record(s) deleted' : 'Offer(s) deleted');
      setSelectedIds([]);
      qc.invalidateQueries({ queryKey: ['offers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });



  return (
    <div className="space-y-6">
      <PageHeader
        title={onboardingMode ? 'Onboarding' : 'Offers'}
        description={onboardingMode ? 'Track accepted offers through background verification and onboarding' : 'Compose, send, and track candidate offers'}
        actions={
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <>
                <Button variant="danger" onClick={() => deleteMutation.mutate(selectedIds)} disabled={deleteMutation.isPending}>
                  Delete Selected ({selectedIds.length})
                </Button>
                <Button variant="outline" onClick={() => setSelectedIds([])}>
                  Cancel
                </Button>
              </>
            )}
            {canManage && !onboardingMode && (
              <>
                <Tooltip
                  placement="bottom"
                  maxWidth={340}
                  content={
                    hasDocuments ? (
                      <div>
                        <p className="font-semibold mb-1" style={{ color: 'var(--color-text-primary, #fff)', fontSize: 13 }}>
                          Automate Document Email
                        </p>
                        <p style={{ marginBottom: 8 }}>
                          <span style={{ color: 'var(--color-success, #22c55e)', fontWeight: 600 }}>When enabled —</span>{' '}
                          the document upload request email is sent to the candidate automatically as soon as they accept the tentative offer.
                        </p>
                        <p>
                          <span style={{ color: 'var(--color-warning, #f59e0b)', fontWeight: 600 }}>When disabled —</span>{' '}
                          no email is sent automatically. You must trigger it manually from the <strong>Document</strong> tab after tentative acceptance.
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="font-semibold mb-1" style={{ color: 'var(--color-text-primary, #fff)', fontSize: 13 }}>
                          No Documents Configured
                        </p>
                        <p>
                          No document requirements configured. Click "Upload Document" to add document templates with name, file format, and mandatory options first.
                        </p>
                      </div>
                    )
                  }
                >
                  <label
                    onClick={(e) => {
                      if (!hasDocuments) {
                        e.preventDefault();
                      }
                    }}
                    className={`flex items-center gap-2 px-4 py-2 border border-border rounded-lg bg-surface text-sm font-medium text-text-primary shadow-sm transition-colors select-none h-10 ${!hasDocuments
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:border-accent hover:bg-surface-raised cursor-pointer'
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={hasDocuments ? automateDocEmail : false}
                      disabled={!hasDocuments || saveAutomate.isPending}
                      onChange={(e) => {
                        if (hasDocuments) {
                          saveAutomate.mutate(e.target.checked);
                        }
                      }}
                      className={`h-4 w-4 rounded border-border text-accent focus:ring-accent ${!hasDocuments ? 'cursor-not-allowed' : 'cursor-pointer'
                        }`}
                    />
                    <span>Automate Document Email</span>
                  </label>
                </Tooltip>
                <Button variant="outline" onClick={() => setEditingDocuments(true)}>
                  <FileText className="h-4 w-4" /> Upload Document
                </Button>
                <Button onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> New offer
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <Input className="pl-9" placeholder="Search by candidate…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select className="w-40" options={OFFER_STATUS_OPTIONS} placeholder="All statuses" value={status} onChange={(e) => setStatus(e.target.value as OfferStatus)} />
        {(search || status) && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setSearch('');
              setStatus('');
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-16 text-center"><Spinner className="mx-auto" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={onboardingMode ? <UserCheck className="h-8 w-8" /> : <FileSignature className="h-8 w-8" />}
          title={onboardingMode ? 'No one onboarding yet' : 'No offers'}
          description={onboardingMode ? 'Accepted offers appear here for onboarding and background verification.' : 'Draft an offer for a candidate to get started.'} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                <th className="w-10 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent cursor-pointer rounded"
                    checked={items.length > 0 && selectedIds.length === items.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(items.map((o) => o.id));
                      } else {
                        setSelectedIds([]);
                      }
                    }}
                  />
                </th>
                <th className="px-4 py-3 text-left">Candidate</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">{onboardingMode ? 'Onboarding' : 'Joining'}</th>
                <th className="px-4 py-3 text-left">Created</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} onClick={() => setActiveId(o.id)} className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-raised/50">
                  <td className="w-10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent cursor-pointer rounded"
                      checked={selectedIds.includes(o.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds((prev) => [...prev, o.id]);
                        } else {
                          setSelectedIds((prev) => prev.filter((id) => id !== o.id));
                        }
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-primary">{o.candidate.fullName}</p>
                    <p className="text-xs text-text-muted">{o.candidate.email}</p>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{o.job.title}</td>
                  <td className="px-4 py-3"><Badge variant={OFFER_STATUS_VARIANT[o.status]}>{OFFER_STATUS_LABEL[o.status] || o.status}</Badge></td>
                  <td className="px-4 py-3">
                    {onboardingMode
                      ? (o.onboardingStatus ? <Badge variant={ONBOARDING_STATUS_VARIANT[o.onboardingStatus]}>{ONBOARDING_STATUS_LABEL[o.onboardingStatus]}</Badge> : <span className="text-text-muted">—</span>)
                      : <span className="text-text-secondary">{o.joiningDate ? format(new Date(o.joiningDate), 'dd MMM yyyy') : '—'}</span>}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{format(new Date(o.createdAt), 'dd MMM yyyy')}</td>
                  {canManage && (
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-text-muted hover:text-danger hover:bg-danger/10 h-8 w-8 p-0 flex items-center justify-center inline-flex"
                        onClick={() => {
                          if (window.confirm(onboardingMode ? `Are you sure you want to delete the onboarding record for "${o.candidate.fullName}"?` : `Are you sure you want to delete the offer for "${o.candidate.fullName}"?`)) {
                            deleteMutation.mutate([o.id]);
                          }
                        }}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <OfferDetailPanel open={!!activeId} offerId={activeId} canManage={canManage} initialTab={onboardingMode ? 'onboarding' : 'offer'} hideOnboardingTab={!onboardingMode} onClose={() => setActiveId(null)} />
      {creating && <CreateOfferDrawer onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setActiveId(id); }} />}
      {editingDocuments && <ConfigureDocumentsDrawer onClose={() => setEditingDocuments(false)} />}
    </div>
  );
}

function CreateOfferDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [applicationId, setApplicationId] = useState('');
  const [salaryOffered, setSalary] = useState('');
  const [joiningDate, setJoining] = useState('');
  const [validUntil, setValid] = useState('');
  const [notes, setNotes] = useState('');

  // Offers attach to an application; surface those not yet rejected and without
  // an active offer already (the server enforces one active offer per application).
  const { data: appsData } = useQuery({ queryKey: ['offer-apps'], queryFn: () => candidateApi.fetchApplications({ limit: 500 }) });
  const { data: offersData } = useQuery({ queryKey: ['offers', 'all-active'], queryFn: () => offerApi.fetchOffers({ limit: 500 }) });
  const takenAppIds = new Set(
    (offersData?.items ?? [])
      .filter((o) => o.status === 'DRAFT' || o.status === 'SENT' || o.status === 'ACCEPTED')
      .map((o) => o.applicationId),
  );
  const appOptions = (appsData?.items ?? [])
    .filter((a) => a.status !== 'REJECTED' && !takenAppIds.has(a.id))
    .map((a) => ({ value: a.id, label: `${a.candidate.fullName} · ${a.job.title}` }));

  const create = useMutation({
    mutationFn: () => {
      const body: CreateOfferInput = {
        applicationId,
        salaryOffered: salaryOffered ? Number(salaryOffered) : undefined,
        joiningDate: joiningDate ? new Date(joiningDate) : undefined,
        validUntil: validUntil ? new Date(validUntil) : undefined,
        notes: notes || undefined,
      };
      return offerApi.createOffer(body);
    },
    onSuccess: (res) => { toast.success('Offer drafted'); qc.invalidateQueries({ queryKey: ['offers'] }); onCreated(res.offer.id); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Drawer open onClose={onClose} size="md" title="New offer" subtitle="Draft an offer for a candidate's application"
      footer={<div className="flex justify-end"><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!applicationId}>Create draft</Button></div>}>
      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">Application</label>
          <Select options={appOptions} placeholder={appOptions.length ? 'Select an application…' : 'No applications'} value={applicationId} onChange={(e) => setApplicationId(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">Salary offered</label>
          <Input type="number" min="0" placeholder="e.g. 120000" value={salaryOffered} onChange={(e) => setSalary(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Joining date</label>
            <Input type="date" value={joiningDate} onChange={(e) => setJoining(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Tentative Valid End</label>
            <Input type="date" value={validUntil} onChange={(e) => setValid(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">Notes</label>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes…" />
        </div>
      </div>
    </Drawer>
  );
}

interface DocRequirementSetting {
  name: string;
  type: string;
  required: boolean;
}

const FILE_FORMAT_OPTIONS = [
  { value: 'IMAGE', label: 'JPG, JPEG, PNG' },
  { value: 'PDF/DOCX', label: 'PDF, DOCX' },
  { value: 'PDF/IMAGE', label: 'PDF, JPG, JPEG, PNG' },
  { value: 'PDF', label: 'PDF only' },
  { value: 'DOCX', label: 'DOCX only' },
];

function formatLabel(type: string): string {
  return FILE_FORMAT_OPTIONS.find(o => o.value === type)?.label ?? type;
}

/* Pill badges for each format token */
function FormatTags({ type }: { type: string }) {
  const label = formatLabel(type);
  const tokens = label.split(',').map(t => t.trim()).filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1">
      {tokens.map(t => (
        <span key={t} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-100">
          {t}
        </span>
      ))}
    </div>
  );
}

/* Pill toggle switch */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${checked ? 'bg-accent' : 'bg-border'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
    </button>
  );
}

function ConfigureDocumentsDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();

  // Add row state
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addType, setAddType] = useState('PDF/IMAGE');
  const [addRequired, setAddRequired] = useState(true);

  // Edit state
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('PDF/IMAGE');
  const [editRequired, setEditRequired] = useState(true);

  // Multi-select
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Drag and drop state
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const { data: configData, isLoading } = useQuery({
    queryKey: ['onboarding-documents-config'],
    queryFn: () => offerApi.fetchOnboardingDocumentsConfig(),
  });

  const documents: DocRequirementSetting[] = (() => {
    if (!configData?.value) return [];
    try { return JSON.parse(configData.value); } catch { return []; }
  })();

  const saveMutation = useMutation({
    mutationFn: (docs: DocRequirementSetting[]) => offerApi.updateOnboardingDocumentsConfig(JSON.stringify(docs)),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['onboarding-documents-config'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIdx === index) return;
    setDragOverIdx(index);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIndex) return;

    const reordered = [...documents];
    const [movedItem] = reordered.splice(draggedIdx, 1);
    reordered.splice(targetIndex, 0, movedItem);

    // Save the new order
    saveMutation.mutate(reordered);
    handleDragEnd();
  };

  const handleAdd = () => {
    if (!addName.trim()) { toast.error('Document name is required'); return; }
    if (documents.some(d => d.name.toLowerCase() === addName.trim().toLowerCase())) { toast.error('Name already exists'); return; }
    saveMutation.mutate([...documents, { name: addName.trim(), type: addType, required: addRequired }]);
    setAddName(''); setAddType('PDF/IMAGE'); setAddRequired(true); setShowAdd(false);
  };

  const startEdit = (idx: number) => {
    const d = documents[idx];
    setEditIdx(idx); setEditName(d.name); setEditType(d.type); setEditRequired(d.required);
  };

  const saveEdit = () => {
    if (!editName.trim()) { toast.error('Name required'); return; }
    if (documents.some((d, i) => i !== editIdx && d.name.toLowerCase() === editName.trim().toLowerCase())) { toast.error('Name already exists'); return; }
    saveMutation.mutate(documents.map((d, i) => i === editIdx ? { name: editName.trim(), type: editType, required: editRequired } : d));
    setEditIdx(null);
  };

  const deleteSingle = async (idx: number) => {
    const ok = await confirm({
      title: 'Delete Document Requirement',
      message: `Are you sure you want to delete "${documents[idx].name}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    saveMutation.mutate(documents.filter((_, i) => i !== idx));
    setSelected(prev => { const s = new Set(prev); s.delete(idx); return s; });
  };

  const deleteSelected = async () => {
    if (!selected.size) return;
    const ok = await confirm({
      title: 'Delete Document Requirements',
      message: `Are you sure you want to delete ${selected.size} selected document requirement(s)? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    saveMutation.mutate(documents.filter((_, i) => !selected.has(i)));
    setSelected(new Set());
  };

  const toggleSelect = (idx: number) =>
    setSelected(prev => { const s = new Set(prev); s.has(idx) ? s.delete(idx) : s.add(idx); return s; });

  const allSelected = documents.length > 0 && selected.size === documents.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(documents.map((_, i) => i)));

  const toggleRequired = (idx: number) => {
    saveMutation.mutate(documents.map((d, i) => i === idx ? { ...d, required: !d.required } : d));
  };

  return (
    <Drawer open onClose={onClose} size="md" title="Configure Required Onboarding Documents" subtitle="Manage onboarding document templates for candidates.">
      {isLoading ? (
        <div className="flex h-full items-center justify-center"><Spinner /></div>
      ) : (
        <div className="flex flex-col gap-0 -mx-1">

          {/* Toolbar */}
          <div className="flex items-center justify-end px-1 pb-3">
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <button
                  onClick={deleteSelected}
                  className="flex items-center gap-1.5 text-xs font-medium text-rose-500 hover:text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove {selected.size} selected
                </button>
              )}
              {documents.length > 0 && !showAdd && (
                <button
                  onClick={() => setShowAdd(true)}
                  className="flex items-center gap-1 py-1 px-3 text-xs font-medium text-accent hover:text-accent/90 bg-accent/10 hover:bg-accent/15 border border-accent/20 rounded-lg transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Document
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border overflow-hidden">
            {/* Header — hidden when empty state is active */}
            {(documents.length > 0 || showAdd) && (
              <div className="grid grid-cols-[24px_32px_1fr_auto_72px_52px] items-center gap-3 px-3 py-2 bg-surface-raised border-b border-border">
                <div className="flex items-center justify-center">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={documents.length === 0}
                    className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent" />
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted text-center">S.No</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Document</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Format</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted text-center">Mandatory</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted text-center">Actions</div>
              </div>
            )}

            {/* ── Empty state: replace entire table body with a welcoming CTA ── */}
            {documents.length === 0 && !showAdd ? (
              <div className="flex flex-col items-center justify-center gap-4 py-10 px-6 text-center">
                {/* Step indicator dots */}
                <div className="flex gap-1.5 mb-1">
                  {[0, 1, 2].map(i => (
                    <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === 0 ? 'bg-accent w-4' : 'bg-border'}`} />
                  ))}
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-text-primary">Start by adding your first document</p>
                  <p className="text-xs text-text-muted max-w-[220px] leading-relaxed">
                    Define which documents candidates must submit during onboarding.
                  </p>
                </div>
                <button
                  onClick={() => setShowAdd(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors shadow-sm"
                >
                  <Plus className="h-4 w-4" />
                  Add first document
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {documents.map((doc, idx) =>
                  editIdx === idx ? (
                    /* ── Edit row ── */
                    <div key={idx} className="px-3 py-3 bg-accent/5 border-l-2 border-accent space-y-2">
                      <div className="text-[10px] font-bold text-accent uppercase tracking-wide mb-1">Editing row</div>
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <input
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          placeholder="Document name"
                          className="text-sm px-2.5 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                        />
                        <select
                          value={editType}
                          onChange={e => setEditType(e.target.value)}
                          className="text-xs px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                        >
                          {FILE_FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                          <Toggle checked={editRequired} onChange={setEditRequired} />
                          <span>{editRequired ? 'Mandatory' : 'Optional'}</span>
                        </label>
                        <div className="flex gap-2">
                          <button onClick={() => setEditIdx(null)} className="text-xs px-2.5 py-1 rounded-lg border border-border text-text-muted hover:text-text-secondary transition-colors">Cancel</button>
                          <button onClick={saveEdit} disabled={saveMutation.isPending}
                            className="text-xs px-2.5 py-1 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* ── Normal row ── */
                    <div
                      key={idx}
                      draggable={editIdx === null}
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragEnd={handleDragEnd}
                      onDrop={(e) => handleDrop(e, idx)}
                      className={`grid grid-cols-[24px_32px_1fr_auto_72px_52px] items-center gap-3 px-3 py-3 transition-all ${draggedIdx === idx ? 'opacity-40 bg-accent/5' :
                          dragOverIdx === idx ? 'border-t-2 border-accent bg-accent/5' :
                            selected.has(idx) ? 'bg-accent/5' : 'hover:bg-surface-raised'
                        }`}
                    >
                      <div className="flex items-center justify-center">
                        <input type="checkbox" checked={selected.has(idx)} onChange={() => toggleSelect(idx)}
                          className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent" />
                      </div>
                      <div className="text-xs font-semibold text-text-secondary text-center select-none">
                        {idx + 1}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-text-primary leading-tight">{doc.name}</div>
                      </div>
                      <FormatTags type={doc.type} />
                      <div className="flex justify-center">
                        <Toggle checked={doc.required} onChange={() => toggleRequired(idx)} />
                      </div>
                      <div className="flex items-center justify-center gap-0.5">
                        <button onClick={() => startEdit(idx)}
                          className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent/10 transition-colors">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button onClick={() => deleteSingle(idx)}
                          className="p-1.5 rounded-md text-text-muted hover:text-rose-500 hover:bg-rose-50 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                )}

                {/* Add row — inline */}
                {showAdd && (
                  <div className="px-3 py-3 bg-surface-raised border-l-2 border-dashed border-accent/40 space-y-2">
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <input
                        autoFocus
                        value={addName}
                        onChange={e => setAddName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setShowAdd(false); setAddName(''); } }}
                        placeholder="Document name, e.g. PAN Card"
                        className="text-sm px-2.5 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                      />
                      <select
                        value={addType}
                        onChange={e => setAddType(e.target.value)}
                        className="text-xs px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                      >
                        {FILE_FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center justify-between pt-0.5">
                      <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                        <Toggle checked={addRequired} onChange={setAddRequired} />
                        <span>{addRequired ? 'Mandatory' : 'Optional'}</span>
                      </label>
                      <div className="flex gap-2">
                        <button onClick={() => { setShowAdd(false); setAddName(''); setAddType('PDF/IMAGE'); setAddRequired(true); }}
                          className="text-xs px-2.5 py-1 rounded-lg border border-border text-text-muted hover:text-text-secondary transition-colors">Cancel</button>
                        <button onClick={handleAdd} disabled={saveMutation.isPending}
                          className="text-xs px-2.5 py-1 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Legend */}
          <p className="text-[10px] text-text-muted px-1 pt-3 leading-relaxed">
            Toggle the <span className="font-semibold">Mandatory</span> switch to update instantly. Changes are saved automatically.
          </p>
        </div>
      )}
    </Drawer>
  );
}


