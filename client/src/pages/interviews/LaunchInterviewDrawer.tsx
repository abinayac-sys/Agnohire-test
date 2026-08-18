import { useEffect, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Copy, ExternalLink } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { SendInviteButton } from '../../components/common/SendInviteButton.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Drawer } from '../../components/ui/Drawer.js';
import * as interviewApi from '../../services/interviewApi.js';
import * as candidateApi from '../../services/candidateApi.js';
import * as bankApi from '../../services/questionBankApi.js';
import * as jobApi from '../../services/jobApi.js';
import type { InterviewDetail } from '@agnohire/shared';
import { isScheduleRound } from '@agnohire/shared';

interface Props {
  open: boolean;
  onClose: () => void;
}

function interviewLink(token: string): string {
  return `${window.location.origin}/interview/${token}`;
}

export function LaunchInterviewDrawer({ open, onClose }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedCandidates, setSelectedCandidates] = useState<Map<string, { id: string; fullName: string; email?: string | null }>>(new Map());
  const [jobRequisitionId, setJobRequisitionId] = useState('');
  const [bankId, setBankId] = useState('');
  const [duration, setDuration] = useState('');
  const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set());
  const [questionsPerCandidate, setQuestionsPerCandidate] = useState('');
  const [created, setCreated] = useState<InterviewDetail[]>([]);

  const [isOpenDropdown, setIsOpenDropdown] = useState(false);

  useEffect(() => {
    const handleOutsideClick = () => {
      if (isOpenDropdown) {
        setIsOpenDropdown(false);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [isOpenDropdown]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setSelectedCandidates(new Map());
      setJobRequisitionId('');
      setBankId('');
      setDuration('');
      setSelectedQuestions(new Set());
      setQuestionsPerCandidate('');
      setCreated([]);
      setIsOpenDropdown(false);
    }
  }, [open]);

  const [roundNumber, setRoundNumber] = useState<string>('');

  const { data: jobsData } = useQuery({
    queryKey: ['jobs', { limit: 500 }],
    // No status filter: this launches interviews for candidates already on a
    // job's pipeline, in any job status — see PipelinePage.tsx/ScheduleDrawer.tsx
    // for the same reasoning (unlike BulkUploadDrawer/CandidateListDetailDrawer,
    // which create NEW assignments and correctly stay OPEN-only, matching the
    // backend's own assignJobToList enforcement).
    queryFn: () => jobApi.fetchJobs({ limit: 500 }),
    enabled: open && created.length === 0,
    staleTime: 60_000,
  });
  // Only OPEN requisitions are selectable — DRAFT/PENDING_APPROVAL jobs
  // haven't cleared approval yet and CLOSED ones are no longer hiring.
  const jobs = jobsData?.items ?? [];
  const selectedJob = useMemo(() => jobs.find((j) => j.id === jobRequisitionId), [jobs, jobRequisitionId]);

  const { data: jobDetailResponse } = useQuery({
    queryKey: ['job', jobRequisitionId],
    queryFn: () => jobApi.fetchJob(jobRequisitionId),
    enabled: open && !!jobRequisitionId,
  });
  const jobDetail = jobDetailResponse?.job;
  const workflowRounds = jobDetail?.workflowRounds || [];
  const sortedWorkflowRounds = useMemo(() => {
    return [...workflowRounds].sort((a, b) => a.orderIndex - b.orderIndex);
  }, [workflowRounds]);

  // A job may legitimately have no interview workflow rounds configured (the
  // create-job wizard does not require any). In that case there is no round to
  // pick, so round selection must not gate the rest of the drawer — otherwise
  // the candidate list never loads and the job can never have an interview
  // launched. `valid` below already allows workflowRounds.length === 0.
  const hasRounds = sortedWorkflowRounds.length > 0;
  const roundReady = !hasRounds || !!roundNumber;

  const isRoundSchedule = useMemo(() => {
    if (!roundNumber || !sortedWorkflowRounds.length) return false;
    const selectedRound = sortedWorkflowRounds.find(r => String(r.orderIndex) === roundNumber);
    return !!(selectedRound && isScheduleRound(selectedRound.roundType, selectedRound.roundName));
  }, [roundNumber, sortedWorkflowRounds]);

  const { data: appData } = useQuery({
    queryKey: ['applications', { search, jobRequisitionId, roundNumber: roundNumber ? Number(roundNumber) : undefined, limit: 100 }],
    queryFn: () => candidateApi.fetchApplications({
      search: search || undefined,
      jobRequisitionId: jobRequisitionId || undefined,
      roundNumber: roundNumber ? Number(roundNumber) : undefined,
      limit: 100
    }),
    enabled: open && created.length === 0 && !!jobRequisitionId && roundReady && !isRoundSchedule,
  });

  // Show every question bank the user can access — not just ones whose domain
  // matches the selected job. Filtering by the job's domain hid freshly created
  // banks (and any cross-domain bank), so the team couldn't pick them here.
  const { data: banksData } = useQuery({
    queryKey: ['question-banks', 'launch'],
    queryFn: () => bankApi.fetchBanks({ limit: 500 }),
    enabled: open && created.length === 0,
    staleTime: 60_000,
  });
  const { data: bankDetail } = useQuery({
    queryKey: ['question-bank', bankId],
    queryFn: () => bankApi.fetchBank(bankId),
    enabled: open && !!bankId && created.length === 0,
  });

  // Default to all questions selected whenever a new bank's questions load.
  useEffect(() => {
    if (bankDetail?.bank) {
      setSelectedQuestions(new Set(bankDetail.bank.questions.map((q) => q.id)));
    }
  }, [bankDetail]);

  const mutation = useMutation({
    mutationFn: async () => {
      const allQuestions = bankDetail?.bank.questions ?? [];
      const useSubset =
        selectedQuestions.size > 0 && selectedQuestions.size < allQuestions.length;
      
      const promises = Array.from(selectedCandidates.keys()).map(id => 
        interviewApi.createInterview({
          candidateId: id,
          questionBankId: bankId,
          jobRequisitionId: jobRequisitionId || undefined,
          durationMin: duration ? Number(duration) : undefined,
          questionIds: useSubset ? [...selectedQuestions] : undefined,
          questionsPerCandidate: questionsPerCandidate ? Number(questionsPerCandidate) : undefined,
          roundNumber: roundNumber ? Number(roundNumber) : undefined,
        })
      );
      
      const results = await Promise.all(promises);
      return results.map(r => r.interview);
    },
    onSuccess: (interviews) => {
      toast.success(`Created ${interviews.length} interview${interviews.length > 1 ? 's' : ''}`);
      qc.invalidateQueries({ queryKey: ['interviews'] });
      setCreated(interviews);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendInviteMutation = useMutation({
    mutationFn: (selectedChannels?: string[]) => {
      if (created.length === 0) throw new Error('No interview created');
      return interviewApi.sendBulkInvites(created.map(c => c.id), selectedChannels);
    },
    onSuccess: (res, selectedChannels) => {
      const data = res.result as any;
      const emailText = `${data.sent} email invite${data.sent === 1 ? '' : 's'} sent`;
      const waText = selectedChannels?.includes('whatsapp')
        ? `, ${data.whatsappSent ?? 0} WhatsApp invite${data.whatsappSent === 1 ? '' : 's'} sent`
        : '';

      toast.success(`Interview invites processed: ${emailText}${waText}`);

      if (data.warnings && data.warnings.length > 0) {
        toast.error(
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Some WhatsApp invitations were skipped:</span>
            <ul className="list-disc pl-4 text-xs max-h-40 overflow-y-auto mt-1">
              {data.warnings.map((w: string, idx: number) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>,
          { duration: 8000 }
        );
      }
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const candidates = useMemo(() => {
    const map = new Map();
    if (appData?.items) {
      for (const app of appData.items) {
        if (!map.has(app.candidate.id)) map.set(app.candidate.id, app.candidate);
      }
    }
    const uniqueCandidates = Array.from(map.values());

    console.log('[DEBUG] Launch Interview Filters:', {
      selectedJobRequisitionId: jobRequisitionId || 'None',
      jobApplicationCount: appData?.items?.length || 0,
      filteredCandidateCount: uniqueCandidates.length
    });

    return uniqueCandidates;
  }, [appData, jobRequisitionId]);

  const banks = useMemo(() => {
    const list = banksData?.items ?? [];
    if (!selectedJob?.domain?.id) return list;
    return [...list].sort((a, b) => {
      const aMatch = a.domain?.id === selectedJob.domain.id;
      const bMatch = b.domain?.id === selectedJob.domain.id;
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [banksData, selectedJob]);
  const questions = bankDetail?.bank.questions ?? [];

  const allSelected = candidates.length > 0 && candidates.every((c) => selectedCandidates.has(c.id));

  const handleSelectAll = () => {
    setSelectedCandidates((prev) => {
      const next = new Map(prev);
      if (allSelected) {
        for (const c of candidates) {
          next.delete(c.id);
        }
      } else {
        for (const c of candidates) {
          next.set(c.id, { id: c.id, fullName: c.fullName, email: c.email });
        }
      }
      return next;
    });
  };

  const selectedNamesText = Array.from(selectedCandidates.values()).map(c => c.fullName).join(', ');

  const valid = !isRoundSchedule && selectedCandidates.size > 0 && !!bankId && !!jobRequisitionId && selectedQuestions.size > 0 && 
    (workflowRounds.length === 0 || !!roundNumber);

  function toggleQuestion(id: string) {
    setSelectedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCandidate(c: { id: string; fullName: string; email?: string | null }) {
    setSelectedCandidates((prev) => {
      const next = new Map(prev);
      if (next.has(c.id)) {
        next.delete(c.id);
      } else {
        next.set(c.id, c);
      }
      return next;
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={created.length > 0 ? 'Interviews Ready' : 'Launch Interview'}
      subtitle={
        created.length > 0
          ? 'Share these links with the candidates'
          : 'Assign a question bank and generate candidate links'
      }
      size="md"
      footer={
        created.length > 0 ? (
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={onClose}>
              Close
            </Button>
            <SendInviteButton
              onSend={(channels) => sendInviteMutation.mutate(channels)}
              loading={sendInviteMutation.isPending}
              placement="top"
            />
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!valid}
              loading={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Create & generate link
            </Button>
          </div>
        )
      }
    >
      {created.length > 0 ? (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          {created.map(interview => (
            <div key={interview.id} className="space-y-4 mb-6 border-b border-border pb-6 last:border-0 last:pb-0">
              <div className="rounded-lg border border-border bg-surface-raised p-4">
                <p className="mb-1 text-sm font-medium text-text-primary">
                  {interview.candidate.fullName}
                </p>
                <p className="text-xs text-text-muted">{interview.candidate.email}</p>
                <p className="mt-2 text-xs text-text-muted">
                  {interview._count.questions} questions
                  {interview.duration ? ` · ${interview.duration} min` : ' · untimed'}
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-primary">Candidate link</label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={interview.accessToken ? interviewLink(interview.accessToken) : ''} />
                  <Button variant="outline" size="icon" type="button" onClick={() => {
                      if(interview.accessToken) {
                          navigator.clipboard.writeText(interviewLink(interview.accessToken));
                          toast.success('Link copied');
                      }
                  }} aria-label="Copy link">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                {interview.accessToken && (
                  <a
                    href={interviewLink(interview.accessToken)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open preview
                  </a>
                )}
              </div>
            </div>
          ))}
          <p className="text-xs text-text-muted">
            The candidates start the interview from these links. Answers are scored automatically once submitted.
          </p>
        </div>
      ) : (
        <div className="space-y-4">

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-primary">
                Job Requisition <span className="text-danger">*</span>
              </label>
              <Select
                options={jobs.map((j) => ({ value: j.id, label: j.title }))}
                placeholder="Select Job Requisition"
                value={jobRequisitionId}
                onChange={(e) => {
                  setJobRequisitionId(e.target.value);
                  setRoundNumber('');
                }}
              />
            </div>
            {jobRequisitionId && workflowRounds.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-primary">
                  Workflow Round <span className="text-danger">*</span>
                </label>
                <Select
                  options={sortedWorkflowRounds.map((r: any) => {
                    const isSchedule = isScheduleRound(r.roundType, r.roundName);
                    const label = isSchedule ? `🔒 ${r.roundName} (Conduct in Schedule Module)` : r.roundName;
                    return { value: String(r.orderIndex), label };
                  })}
                  placeholder="Select Workflow Round"
                  value={roundNumber}
                  onChange={(e) => {
                    setRoundNumber(e.target.value);
                    setSelectedCandidates(new Map());
                  }}
                />
              </div>
            )}
            {jobRequisitionId && hasRounds && !roundNumber && (
              <p className="text-sm text-text-muted">
                Please select a workflow round to load eligible candidates.
              </p>
            )}
            {jobRequisitionId && roundNumber && isRoundSchedule && (
              <div className="rounded-lg border border-border bg-surface-raised p-4 text-text-secondary text-sm font-medium">
                This round is conducted through the Schedule page.
              </div>
            )}
            {jobRequisitionId && roundReady && !isRoundSchedule && (
              <>
                <div className="space-y-2 relative" onClick={(e) => e.stopPropagation()}>
                  <label className="text-sm font-medium text-text-primary">
                    Candidates <span className="text-danger">*</span>
                  </label>
                  <Input
                    placeholder="Search by name or email…"
                    value={isOpenDropdown ? search : (selectedCandidates.size > 0 ? selectedNamesText : '')}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setIsOpenDropdown(true);
                    }}
                    onFocus={() => setIsOpenDropdown(true)}
                    className="mb-2"
                  />
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-primary">
                      Selected ({selectedCandidates.size}/{candidates.length})
                    </label>
                    {candidates.length > 0 && (
                      <button
                        type="button"
                        className="text-xs text-accent hover:underline"
                        onClick={handleSelectAll}
                      >
                        {allSelected ? 'Clear all' : 'Select all'}
                      </button>
                    )}
                  </div>
                  {isOpenDropdown && (
                    <div className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-surface shadow-lg p-2">
                      {!appData && jobRequisitionId ? (
                        <div className="py-4 text-center">
                          <Spinner className="mx-auto" />
                        </div>
                      ) : candidates.length === 0 ? (
                        <p className="text-sm text-text-muted p-2">No candidates are eligible for this round.</p>
                      ) : (
                        <ul className="space-y-1">
                          {candidates.map((c) => (
                            <li key={c.id}>
                              <label className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-sm hover:bg-surface-raised">
                                <input
                                  type="checkbox"
                                  className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                                  checked={selectedCandidates.has(c.id)}
                                  onChange={() => toggleCandidate({ id: c.id, fullName: c.fullName, email: c.email })}
                                />
                                <span className="min-w-0">
                                  <span className="text-text-primary font-medium">{c.fullName}</span>
                                  <span className="text-text-muted ml-2">{c.email}</span>
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-primary">
                    Question bank <span className="text-danger">*</span>
                  </label>
                  <Select
                    options={banks.map((b) => ({ value: b.id, label: `${b.name} (${b._count.questions})` }))}
                    placeholder={banks.length ? 'Select a bank' : 'No banks available'}
                    value={bankId}
                    onChange={(e) => setBankId(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-primary">Time limit (minutes)</label>
                  <Input
                    type="number"
                    min={5}
                    max={300}
                    placeholder="Leave blank for untimed"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  />
                </div>

                {selectedCandidates.size > 1 && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-text-primary">
                      Questions per candidate
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={selectedQuestions.size || undefined}
                      placeholder={`Leave blank to use all ${selectedQuestions.size || 0} selected`}
                      value={questionsPerCandidate}
                      onChange={(e) => setQuestionsPerCandidate(e.target.value)}
                    />
                    <p className="text-xs text-text-muted">
                      Each candidate draws a random subset (and order) from the selected
                      questions, favoring ones fewer of their peers have seen — so
                      candidates interviewing back-to-back don't get the same set.
                    </p>
                  </div>
                )}

                {bankId && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-primary">
                        Questions ({selectedQuestions.size}/{questions.length})
                      </label>
                      {questions.length > 0 && (
                        <button
                          type="button"
                          className="text-xs text-accent hover:underline"
                          onClick={() =>
                            setSelectedQuestions(
                              selectedQuestions.size === questions.length
                                ? new Set()
                                : new Set(questions.map((q) => q.id)),
                            )
                          }
                        >
                          {selectedQuestions.size === questions.length ? 'Clear all' : 'Select all'}
                        </button>
                      )}
                    </div>
                    {!bankDetail ? (
                      <div className="py-4 text-center">
                        <Spinner className="mx-auto" />
                      </div>
                    ) : questions.length === 0 ? (
                      <p className="text-sm text-text-muted">This bank has no questions yet.</p>
                    ) : (
                      <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                        {questions.map((q, i) => (
                          <li key={q.id}>
                            <label className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-sm hover:bg-surface-raised">
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                                checked={selectedQuestions.has(q.id)}
                                onChange={() => toggleQuestion(q.id)}
                              />
                              <span className="min-w-0">
                                <span className="text-text-muted">Q{i + 1} · {q.type} · </span>
                                <span className="text-text-secondary">{q.text}</span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Drawer>
  );
}
