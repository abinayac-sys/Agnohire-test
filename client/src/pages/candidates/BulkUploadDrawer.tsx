import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Upload, Download, FileSpreadsheet, Trash2, Eye } from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import * as candidateApi from '../../services/candidateApi.js';
import * as jobApi from '../../services/jobApi.js';
import * as refApi from '../../services/referenceApi.js';
import * as sourcingApi from '../../services/sourcingApi.js';
import { PreviewCandidateListResponse } from '@agnohire/shared';
import { useConfirm } from '../../providers/ConfirmProvider.js';
import { apiErrorMessage } from '../../services/api.js';

interface Props {
  open: boolean;
  onClose: () => void;
}

const TEMPLATE_HEADERS =
  'fullName,email,phone,currentRole,location,experienceLevel,skills,source,linkedinUrl,githubUrl,resumeUrl';
const TEMPLATE_SAMPLES = [
  'Priya Sharma,priya@example.com,+91 9000000000,Backend Engineer,Bengaluru,SENIOR,Python;AWS;PostgreSQL,JOB_BOARD,https://linkedin.com/in/priya,https://github.com/priya,https://drive.google.com/file/d/FILE_ID/view?usp=sharing',
  'Arjun Mehta,arjun@example.com,,Frontend Engineer,Pune,MID,React;TypeScript,REFERRAL,,,https://example.com/resumes/arjun-mehta.pdf',
];

function downloadTemplate() {
  const csv = `${TEMPLATE_HEADERS}\n${TEMPLATE_SAMPLES.join('\n')}\n`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'agnohire-candidates-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function BulkUploadDrawer({ open, onClose }: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [jobRequisitionId, setJobRequisitionId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');

  const [previewData, setPreviewData] = useState<PreviewCandidateListResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<number, boolean>>({});
  const [reusingList, setReusingList] = useState<{ id: string; name: string } | null>(null);
  const [reuseJobId, setReuseJobId] = useState('');
  const [reuseSelectedIds, setReuseSelectedIds] = useState<Record<string, boolean>>({});

  const { data: listsData } = useQuery({
    queryKey: ['candidate-lists', { limit: 5 }],
    queryFn: () => candidateApi.fetchCandidateLists({ limit: 5 }),
    enabled: open,
    staleTime: 15_000,
  });

  const { data: reuseListDetail } = useQuery({
    queryKey: ['candidate-list-detail', reusingList?.id],
    queryFn: () => candidateApi.fetchCandidateList(reusingList!.id),
    enabled: !!reusingList,
  });

  const { data: reuseMembersData, isLoading: reuseMembersLoading } = useQuery({
    queryKey: ['list-members', reusingList?.id],
    queryFn: () => sourcingApi.fetchListMembers(reusingList!.id),
    enabled: !!reusingList,
  });

  const { data: usersData } = useQuery({
    queryKey: ['ref-users'],
    queryFn: refApi.fetchUsers,
    enabled: open,
    staleTime: 120_000,
  });

  const { data: jobsData } = useQuery({
    queryKey: ['bulk-import-jobs'],
    queryFn: () => jobApi.fetchJobs({ status: 'OPEN', limit: 100 }),
    enabled: open,
    staleTime: 30_000,
  });

  const previewMutation = useMutation({
    mutationFn: () => candidateApi.previewCandidateList(file!, name.trim(), jobRequisitionId),
    onSuccess: (data) => {
      setPreviewData(data);
      const initialSelection: Record<number, boolean> = {};
      data.candidates.forEach((c, idx) => {
        initialSelection[idx] = c.status !== 'ERROR';
      });
      setSelectedIds(initialSelection);
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'Failed to preview file')),
  });

  const smartUploadMutation = useMutation({
    mutationFn: async () => {
      const selectedCandidates = previewData!.candidates.filter((_, idx) => selectedIds[idx]);
      if (selectedCandidates.length === 0) throw new Error('No candidates selected');
      const { list: created } = await candidateApi.uploadSmartCandidateList(
        name.trim(),
        jobRequisitionId || null,
        selectedCandidates,
        assignedTo || null,
      );
      // Upload kicks off async processing and returns immediately with
      // status PROCESSING — the candidate rows don't exist yet at this point.
      // Poll until it actually finishes so we only refresh/close once the
      // data is really there, instead of racing the background job.
      let current = created;
      while (current.status === 'PROCESSING') {
        await new Promise((r) => setTimeout(r, 1000));
        const res = await candidateApi.fetchCandidateList(current.id);
        current = res.list;
      }
      return current;
    },
    onSuccess: (list) => {
      if (list.status === 'FAILED') {
        toast.error('Import failed.');
      } else {
        toast.success(
          jobRequisitionId
            ? `${list.validCount} candidate${list.validCount === 1 ? '' : 's'} imported and applied to the job.`
            : `${list.validCount} candidate${list.validCount === 1 ? '' : 's'} imported.`,
        );
      }
      qc.invalidateQueries({ queryKey: ['candidate-lists'] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['candidate-stats'] });
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['passed-candidates'] });
      handleClose();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'Failed to import candidates')),
  });

  const reuseMembers = reuseMembersData?.members ?? [];
  const reuseSelectedCount = reuseMembers.filter((m) => reuseSelectedIds[m.id] ?? true).length;

  const applySelectedMutation = useMutation({
    mutationFn: async () => {
      const targets = reuseMembers.filter((m) => reuseSelectedIds[m.id] ?? true);
      const results = await Promise.allSettled(
        targets.map((m) => candidateApi.createApplication({ candidateId: m.id, jobRequisitionId: reuseJobId })),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { applied: targets.length - failed, failed, total: targets.length };
    },
    onSuccess: ({ applied, failed, total }) => {
      if (failed === 0) {
        toast.success(`Applied ${applied} candidate${applied === 1 ? '' : 's'} to the job.`);
      } else {
        toast.error(`Applied ${applied}/${total} — ${failed} already applied or failed.`);
      }
      qc.invalidateQueries({ queryKey: ['applications'] });
      handleClose();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'Could not apply candidates to the job')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => candidateApi.deleteCandidateList(id),
    onSuccess: () => {
      toast.success('List deleted');
      // A bulk-import list's delete cascades to its candidates server-side —
      // without invalidating these too, the Candidates page keeps showing
      // the now-deleted rows from cache until a manual refresh.
      qc.invalidateQueries({ queryKey: ['candidate-lists'] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['candidate-stats'] });
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'Failed to delete list')),
  });

  function reset() {
    setName('');
    setFile(null);
    setJobRequisitionId('');
    setAssignedTo('');
    setPreviewData(null);
    setSelectedIds({});
    setReusingList(null);
    setReuseJobId('');
    setReuseSelectedIds({});
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleClose() {
    qc.invalidateQueries({ queryKey: ['candidates'] });
    qc.invalidateQueries({ queryKey: ['candidate-stats'] });
    reset();
    onClose();
  }

  const selectedCount = Object.values(selectedIds).filter(Boolean).length;

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button
        variant="outline"
        type="button"
        onClick={() => {
          if (reusingList) {
            setReusingList(null);
            setReuseJobId('');
            setReuseSelectedIds({});
          } else {
            handleClose();
          }
        }}
      >
        {reusingList ? 'Back' : 'Cancel'}
      </Button>
      {reusingList && (
        <Button
          type="button"
          loading={applySelectedMutation.isPending}
          disabled={reuseSelectedCount === 0 || !reuseJobId}
          onClick={() => applySelectedMutation.mutate()}
        >
          <Upload className="h-4 w-4" />
          Apply Selected ({reuseSelectedCount})
        </Button>
      )}
      {!reusingList && !previewData && (
        <Button
          type="button"
          loading={previewMutation.isPending}
          disabled={!file || name.trim().length < 2}
          onClick={() => {
            const ext = file?.name.split('.').pop()?.toLowerCase();
            if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
              toast.error('Please upload a .csv, .xlsx, or .xls file.');
              return;
            }
            previewMutation.mutate();
          }}
        >
          <Eye className="h-4 w-4" />
          Preview Import
        </Button>
      )}
      {!reusingList && previewData && (
        <Button
          type="button"
          loading={smartUploadMutation.isPending}
          disabled={selectedCount === 0}
          onClick={() => smartUploadMutation.mutate()}
        >
          <Upload className="h-4 w-4" />
          Import Candidate ({selectedCount})
        </Button>
      )}
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Bulk Import Candidates"
      subtitle="Upload a CSV or Excel file, review, then import the candidates you select"
      size="lg"
      footer={footer}
    >
      <div className="space-y-5">
        {reusingList && (
          <div className="space-y-4">
            <div className="rounded-lg border border-success/30 bg-success/5 p-4">
              <p className="text-sm font-medium text-text-primary">
                Import complete — "{reusingList.name}".
              </p>
              <p className="text-xs text-text-muted">
                {reuseListDetail?.list.totalCount ?? '…'} rows{' '}
                {reuseListDetail?.list.validCount ?? '…'} imported
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-primary">Select Job to Apply</label>
              <Select
                value={reuseJobId}
                onChange={(e) => setReuseJobId(e.target.value)}
                placeholder="[ Select Job to Apply ▼ ]"
                options={jobsData?.items.map((j) => ({ value: j.id, label: j.title })) ?? []}
              />
            </div>

            {reuseMembersLoading ? (
              <p className="py-8 text-center text-sm text-text-muted">Loading candidates…</p>
            ) : (
              <div className="max-h-96 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-surface sticky top-0">
                    <tr className="text-left text-text-muted">
                      <th className="px-3 py-2 w-10 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-accent"
                          checked={reuseSelectedCount === reuseMembers.length && reuseMembers.length > 0}
                          onChange={(e) => {
                            const newSelection: Record<string, boolean> = {};
                            reuseMembers.forEach((m) => { newSelection[m.id] = e.target.checked; });
                            setReuseSelectedIds(newSelection);
                          }}
                        />
                      </th>
                      <th className="px-3 py-2 text-left">Candidate</th>
                      <th className="px-3 py-2 text-left">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reuseMembers.map((m) => (
                      <tr key={m.id} className="border-t border-border hover:bg-surface-raised">
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-accent"
                            checked={reuseSelectedIds[m.id] ?? true}
                            onChange={(e) => setReuseSelectedIds((prev) => ({ ...prev, [m.id]: e.target.checked }))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-text-primary">{m.fullName}</p>
                        </td>
                        <td className="px-3 py-2 text-text-secondary">{m.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {!reusingList && !previewData && (
          <>
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-accent">
                  <FileSpreadsheet className="h-4 w-4" />
                  File format
                </div>
                <Button variant="ghost" size="sm" type="button" onClick={downloadTemplate}>
                  <Download className="h-3.5 w-3.5" />
                  Download template
                </Button>
              </div>
              <p className="text-xs text-text-muted">
                Required: a name column and an email column. Optional: phone, currentRole,
                location, experienceLevel, skills
                (semicolon-separated), source, linkedinUrl, githubUrl,{' '}
                <code className="text-text-secondary">resumeUrl</code>.
              </p>
              <p className="text-xs text-text-muted">
                Column names and order don't need to match the template — e.g.{' '}
                <code className="text-text-secondary">Candidate Name</code>,{' '}
                <code className="text-text-secondary">E-Mail Id</code>, or{' '}
                <code className="text-text-secondary">Contact No.</code> are all recognized
                automatically.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-primary">
                List name <span className="text-danger">*</span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. LinkedIn export — June 2026"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-primary">Assign To</label>
              <Select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="[ Select Recruiter ▼ ]"
                options={(usersData?.users ?? [])
                  .filter((u) => u.role.name !== 'SUPERADMIN')
                  .map((u) => ({
                    value: u.id,
                    label: `${u.fullName} - ${u.role.displayName}`
                  }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-primary">
                CSV or Excel file <span className="text-danger">*</span>
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-surface-overlay file:px-3 file:py-2 file:text-sm file:text-text-primary hover:file:bg-surface-raised"
              />
              {file && <p className="text-xs text-text-muted">{file.name}</p>}
            </div>
          </>
        )}

        {/* Preview Screen */}
        {!reusingList && previewData && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-surface-raised p-4">
              <h3 className="text-sm font-medium">Import Preview</h3>
              <p className="text-xs text-text-muted">
                Total in CSV: {previewData.totalRecords} | Ready to import: {previewData.matchedCount}
                {previewData.totalRecords - previewData.matchedCount > 0 &&
                  ` | Invalid rows: ${previewData.totalRecords - previewData.matchedCount}`}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-primary">Assign to Job</label>
              <Select
                value={jobRequisitionId}
                onChange={(e) => setJobRequisitionId(e.target.value)}
                placeholder="[ Select Job to Apply ▼ ]"
                options={jobsData?.items.map((j) => ({ value: j.id, label: j.title })) ?? []}
              />
            </div>

            <div className="max-h-96 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface sticky top-0">
                  <tr className="text-left text-text-muted">
                    <th className="px-3 py-2 w-10 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={selectedCount === previewData.candidates.length && previewData.candidates.length > 0}
                        onChange={(e) => {
                          const newSelection: Record<number, boolean> = {};
                          previewData.candidates.forEach((c, idx) => {
                            newSelection[idx] = c.status !== 'ERROR' && e.target.checked;
                          });
                          setSelectedIds(newSelection);
                        }}
                      />
                    </th>
                    <th className="px-3 py-2 text-left">Candidate</th>
                    <th className="px-3 py-2 text-left">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.candidates.map((c, i) => (
                    <tr key={i} className="border-t border-border hover:bg-surface-raised">
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-accent"
                          checked={selectedIds[i] || false}
                          disabled={c.status === 'ERROR'}
                          onChange={(e) => {
                            setSelectedIds(prev => ({ ...prev, [i]: e.target.checked }));
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-text-primary">{c.fullName}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className={c.status === 'ERROR' ? 'text-danger' : 'text-text-secondary'}>
                          {c.email}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recent imports */}
        {!reusingList && !previewData && (listsData?.items.length ?? 0) > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
              Recent imports
            </h3>
            <div className="space-y-1.5">
              {listsData!.items.map((l) => (
                <div
                  key={l.id}
                  onClick={() => setReusingList({ id: l.id, name: l.name })}
                  className="flex w-full cursor-pointer items-center justify-between rounded-md border border-border bg-surface px-3 py-2 hover:bg-surface-raised"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-text-primary">{l.name}</p>
                    <p className="text-xs text-text-muted">
                      {format(new Date(l.createdAt), 'dd MMM yyyy, HH:mm')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="success">{l.validCount}</Badge>
                    {l.errorCount > 0 && <Badge variant="danger">{l.errorCount}</Badge>}
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (await confirm({
                          title: 'Delete Import List',
                          message: `Are you sure you want to delete "${l.name}"? This will also permanently remove the candidates it imported from the Candidates module.`,
                          confirmText: 'Delete',
                          variant: 'danger',
                        })) deleteMutation.mutate(l.id);
                      }}
                      className="ml-2 rounded p-1 text-text-muted hover:bg-surface-raised hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
