import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog } from '@headlessui/react';
import { Button } from '../../components/ui/Button.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Badge } from '../../components/ui/Badge.js';
import { api, unwrap } from '../../services/api.js';

interface HrApprovalModalProps {
  interviewId: string;
  candidateId?: string;
  candidateName: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { action: 'APPROVE' | 'REJECT' | 'REASSESS'; remarks: string; delayMinutes?: number }) => void;
  isSubmitting: boolean;
  initialAction?: 'APPROVE' | 'REJECT' | 'REASSESS';
  hasDocuments?: boolean;
}

export function HrApprovalModal({ interviewId, candidateId, candidateName, isOpen, onClose, onSubmit, isSubmitting, initialAction, hasDocuments = true }: HrApprovalModalProps) {
  const [action, setAction] = useState<'APPROVE' | 'REJECT' | 'REASSESS'>('APPROVE');
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    if (isOpen) {
      setAction(initialAction || 'APPROVE');
      setRemarks('');
    }
  }, [isOpen, initialAction]);

  const { data: reportData, isLoading } = useQuery({
    queryKey: ['hr-report', candidateId],
    queryFn: async () => {
      if (!candidateId) return null;
      const res = await api.get(`/hr/report/${candidateId}`);
      return unwrap(res.data);
    },
    enabled: isOpen && !!candidateId,
  });

  const report = (reportData as any)?.report;
  const currentInterview = report?.interviews?.find((i: any) => i.id === interviewId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ action, remarks, delayMinutes: 0 });
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="mx-auto w-full max-w-2xl rounded-xl bg-surface p-6 shadow-xl border border-border overflow-y-auto max-h-[90vh]">
          <Dialog.Title className="text-xl font-bold mb-4 text-text-primary">
            Approve Candidate: {candidateName}
          </Dialog.Title>

          {isLoading ? (
            <div className="py-8 flex justify-center"><Spinner /></div>
          ) : report ? (
            <div className="mb-6 space-y-4 border rounded-lg p-4 bg-surface-raised border-border text-sm">
              <h3 className="font-semibold text-text-primary border-b border-border pb-2">Candidate Consolidated Report</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-text-muted text-xs">Email</p>
                  <p className="font-medium">{report.email}</p>
                </div>
                <div>
                  <p className="text-text-muted text-xs">Job Requisition</p>
                  <p className="font-medium">{currentInterview?.jobRequisition?.title || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-text-muted text-xs">Interview Score</p>
                  <p className="font-medium">
                    {currentInterview?.result?.percentageScore != null
                      ? `${currentInterview.result.percentageScore}%`
                      : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-text-muted text-xs">Interviewer Decision</p>
                  <p className="font-medium">
                    <Badge variant={currentInterview?.result?.decision === 'PASS' ? 'success' : 'danger'}>
                      {currentInterview?.result?.decision || 'N/A'}
                    </Badge>
                  </p>
                </div>
                <div>
                  <p className="text-text-muted text-xs">Interview Round</p>
                  <p className="font-medium">{currentInterview?.roundNumber ? `Round ${currentInterview.roundNumber}` : 'N/A'}</p>
                </div>
                <div>
                  <p className="text-text-muted text-xs">Interview Status</p>
                  <p className="font-medium">
                    <Badge variant={currentInterview?.status === 'COMPLETED' ? 'success' : 'warning'}>
                      {currentInterview?.status || 'N/A'}
                    </Badge>
                  </p>
                </div>
                {currentInterview?.schedule?.scheduledDate && (
                  <div className="col-span-2">
                    <p className="text-text-muted text-xs">Interview Date & Time</p>
                    <p className="font-medium">
                      {new Date(currentInterview.schedule.scheduledDate).toLocaleString()}
                      {currentInterview.schedule.timezone ? ` (${currentInterview.schedule.timezone})` : ''}
                    </p>
                  </div>
                )}
              </div>

              {currentInterview?.result?.interviewerComments && (
                <div>
                  <p className="text-text-muted text-xs mb-1">Interview Feedback</p>
                  <div className="bg-surface p-2 rounded text-text-secondary border border-border">
                    {currentInterview.result.interviewerComments}
                  </div>
                </div>
              )}

              {currentInterview?.result?.strengths && (
                <div>
                  <p className="text-text-muted text-xs mb-1">Assessment Strengths</p>
                  <p className="text-text-secondary">{currentInterview.result.strengths}</p>
                </div>
              )}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-text-secondary mb-2">Action</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="action" checked={action === 'APPROVE'} onChange={() => setAction('APPROVE')} className="text-primary focus:ring-primary" />
                    <span className="font-medium">Approve (Send Offer)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="action" checked={action === 'REJECT'} onChange={() => setAction('REJECT')} className="text-danger focus:ring-danger" />
                    <span className="font-medium">Reject</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="action" checked={action === 'REASSESS'} onChange={() => setAction('REASSESS')} className="text-warning focus:ring-warning" />
                    <span className="font-medium">Hold / Reassess</span>
                  </label>
                </div>
              </div>


              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  HR Comments / Notes <span className="text-red-500 font-bold">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface p-2.5 text-sm focus:border-accent focus:ring-accent focus:outline-none"
                  placeholder="Enter approval notes, rejection reason, or additional comments..."
                />
              </div>
            </div>

            {action === 'APPROVE' && !hasDocuments && (
              <div className="p-3 bg-danger/10 border border-danger/20 rounded-md text-xs text-red-500 font-medium mb-4">
                No document requirements configured. Please click "Upload Document" in the Offers page to add at least one document template (with name, format, and mandatory options) before approving candidates.
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={isSubmitting || (action === 'APPROVE' && !hasDocuments)}>
                {isSubmitting ? <Spinner className="w-4 h-4 mr-2" /> : null}
                {action === 'APPROVE' ? 'Approve & Generate Offer' : action === 'REJECT' ? 'Reject Candidate' : 'Hold Candidate'}
              </Button>
            </div>
          </form>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
