import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../../services/api.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { PageHeader } from '../../components/common/PageHeader.js';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { useState } from 'react';
import { HrApprovalModal } from './HrApprovalModal.js';
import { Trash2 } from 'lucide-react';
import { DateRangeFilter } from '../../components/common/DateRangeFilter.js';
import { Tooltip } from '../../components/ui/Tooltip.js';
import * as offerApi from '../../services/offerApi.js';

export function HrApprovalQueuePage() {
  const qc = useQueryClient();
  const page = 1;
  const [tab, setTab] = useState<'PENDING' | 'PROCESSED'>('PENDING');
  const [activeItem, setActiveItem] = useState<any>(null);
  const [modalAction, setModalAction] = useState<'APPROVE' | 'REJECT' | 'REASSESS'>('APPROVE');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

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
    queryKey: ['hr-queue', page, fromDate, toDate],
    queryFn: async () => {
      const res = await api.get('/hr/queue', { params: { page, limit: 20, from: fromDate || undefined, to: toDate || undefined } });
      return unwrap(res.data);
    },
    enabled: tab === 'PENDING'
  });

  const { data: processedData, isLoading: processedLoading } = useQuery({
    queryKey: ['hr-processed', page, fromDate, toDate],
    queryFn: async () => {
      const res = await api.get('/hr/processed', { params: { page, limit: 20, from: fromDate || undefined, to: toDate || undefined } });
      return unwrap(res.data);
    },
    enabled: tab === 'PROCESSED'
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => api.delete(`/hr/process/${id}`)));
    },
    onSuccess: () => {
      toast.success('HR approval result(s) deleted');
      setSelectedIds([]);
      qc.invalidateQueries({ queryKey: ['hr-queue'] });
      qc.invalidateQueries({ queryKey: ['hr-processed'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const processMutation = useMutation({
    mutationFn: async ({ interviewId, action, remarks, delayMinutes }: { interviewId: string, action: 'APPROVE' | 'REJECT' | 'REASSESS', remarks: string, delayMinutes?: number }) => {
      const res = await api.post(`/hr/process/${interviewId}`, { action, remarks, delayMinutes });
      return unwrap(res.data);
    },
    onSuccess: () => {
      toast.success('Candidate processed successfully!');
      setActiveItem(null);
      qc.invalidateQueries({ queryKey: ['hr-queue'] });
      qc.invalidateQueries({ queryKey: ['hr-processed'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });



  const items = (data as any)?.items || [];
  const processedItems = (processedData as any)?.items || [];
  const activeItems = tab === 'PENDING' ? items : processedItems;

  return (
    <div className="space-y-6">
      <PageHeader
        title="HR Verification Queue"
        description="Verify candidates and progress their hiring status"
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
          </div>
        }
      />

      <div className="flex space-x-4 border-b border-border">
        <button
          className={`pb-2 px-1 text-sm font-medium transition-colors ${tab === 'PENDING' ? 'border-b-2 border-primary text-primary' : 'text-text-muted hover:text-text-primary'}`}
          onClick={() => setTab('PENDING')}
        >
          Pending Approval
        </button>
        <button
          className={`pb-2 px-1 text-sm font-medium transition-colors ${tab === 'PROCESSED' ? 'border-b-2 border-primary text-primary' : 'text-text-muted hover:text-text-primary'}`}
          onClick={() => setTab('PROCESSED')}
        >
          Processed Candidates
        </button>
      </div>

      <div className="flex items-center gap-3">
        <DateRangeFilter
          from={fromDate}
          to={toDate}
          onChange={(f, t) => {
            setFromDate(f || '');
            setToDate(t || '');
          }}
        />
        {(fromDate || toDate) && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setFromDate('');
              setToDate('');
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {isLoading && tab === 'PENDING' ? (
        <div className="py-12 text-center"><Spinner className="mx-auto" /></div>
      ) : processedLoading && tab === 'PROCESSED' ? (
        <div className="py-12 text-center"><Spinner className="mx-auto" /></div>
      ) : (tab === 'PENDING' ? items : processedItems).length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-text-muted">
          {tab === 'PENDING' ? 'No candidates pending HR approval.' : 'No processed candidates found.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                <th className="w-10 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent cursor-pointer rounded"
                    checked={activeItems.length > 0 && selectedIds.length === activeItems.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(activeItems.map((item: any) => item.interviewId));
                      } else {
                        setSelectedIds([]);
                      }
                    }}
                  />
                </th>
                <th className="px-4 py-3 text-left">Candidate</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Submitted</th>
                {tab === 'PENDING' ? (
                  <>
                    <th className="px-4 py-3 text-left">Interviewer Recommendation</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">Actions</th>
                  </>
                ) : (
                  <>
                    <th className="px-4 py-3 text-left">Decision</th>
                    <th className="px-4 py-3 text-left">Processed By</th>
                    <th className="px-4 py-3 text-left">Processed Date</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">Actions</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface">
              {activeItems.map((item: any) => (
                <tr key={item.id} className="hover:bg-surface-raised/50">
                  <td className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent cursor-pointer rounded"
                      checked={selectedIds.includes(item.interviewId)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds((prev) => [...prev, item.interviewId]);
                        } else {
                          setSelectedIds((prev) => prev.filter((id) => id !== item.interviewId));
                        }
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-text-primary">{item.interview?.candidate?.fullName}</p>
                      {item.hrStatus === 'REASSESS' && (
                        <Badge variant="warning">HOLD</Badge>
                      )}
                    </div>
                    <p className="text-xs text-text-muted">{item.interview?.candidate?.email}</p>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {item.interview?.jobRequisition?.title || 'Unknown Role'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {item.decidedAt ? format(new Date(item.decidedAt), 'dd MMM yyyy') : 'N/A'}
                  </td>
                  {tab === 'PENDING' ? (
                    <>
                      <td className="px-4 py-3">
                        <Badge variant={item.decision === 'PASS' ? 'success' : item.decision === 'HOLD' ? 'warning' : 'danger'}>
                          {item.decision}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-2 items-center">
                          {!hasDocuments ? (
                            <Tooltip
                              content="No document requirements configured. Click 'Upload Document' in Offers to define name, file format, and mandatory options before approving candidates."
                              placement="top"
                            >
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => { }}
                                disabled={true}
                              >
                                Approve
                              </Button>
                            </Tooltip>
                          ) : (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => {
                                setActiveItem(item);
                                setModalAction('APPROVE');
                              }}
                            >
                              Approve
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              setActiveItem(item);
                              setModalAction('REJECT');
                            }}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setActiveItem(item);
                              setModalAction('APPROVE');
                            }}
                          >
                            View Details
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-text-muted hover:text-danger hover:bg-danger/10 h-8 w-8 p-0 flex items-center justify-center inline-flex"
                            onClick={() => {
                              if (window.confirm(`Are you sure you want to delete HR approval record for "${item.interview?.candidate?.fullName}"?`)) {
                                deleteMutation.mutate([item.interviewId]);
                              }
                            }}
                            title="Delete Record"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3">
                        <Badge variant={item.hrStatus === 'APPROVED' ? 'success' : item.hrStatus === 'REJECTED' ? 'danger' : 'warning'}>
                          {item.hrStatus}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {item.hrApprovedByName || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {item.hrApprovedAt ? format(new Date(item.hrApprovedAt), 'dd MMM yyyy') : 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-text-muted hover:text-danger hover:bg-danger/10 h-8 w-8 p-0 flex items-center justify-center inline-flex"
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to delete HR approval record for "${item.interview?.candidate?.fullName}"?`)) {
                              deleteMutation.mutate([item.interviewId]);
                            }
                          }}
                          title="Delete Record"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeItem && (
        <HrApprovalModal
          isOpen={!!activeItem}
          onClose={() => setActiveItem(null)}
          candidateId={activeItem.interview?.candidate?.id}
          candidateName={activeItem.interview?.candidate?.fullName || 'Candidate'}
          interviewId={activeItem.interviewId}
          isSubmitting={processMutation.isPending}
          initialAction={modalAction}
          hasDocuments={hasDocuments}
          onSubmit={(data) => {
            processMutation.mutate({
              interviewId: activeItem.interviewId,
              ...data
            });
          }}
        />
      )}
    </div>
  );
}
