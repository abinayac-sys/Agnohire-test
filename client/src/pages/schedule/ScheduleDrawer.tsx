import { isScheduleRound } from '@agnohire/shared';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ShieldCheck, CalendarCheck2, Info, Pencil, Clock } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { cn } from '../../utils/cn.js';
import { formatTimeInZone, formatDateTimeInZone } from '../../utils/datetime.js';
import * as scheduleApi from '../../services/scheduleApi.js';
import * as referenceApi from '../../services/referenceApi.js';
import * as jobApi from '../../services/jobApi.js';
import { apiErrorMessage } from '../../services/api.js';
import { useAuthStore } from '../../store/authStore.js';
import type { ScheduleDetail } from '@agnohire/shared';

interface Props {
  open: boolean;
  onClose: () => void;
  /** When set, the drawer reschedules this interview instead of creating one. */
  schedule?: ScheduleDetail | null;
}

const DURATIONS = [
  { value: '30', label: '30 minutes' },
  { value: '45', label: '45 minutes' },
  { value: '60', label: '60 minutes' },
  { value: '90', label: '90 minutes' },
  { value: '120', label: '2 hours' },
];
const TIMEZONES = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney'];

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Convert a local datetime-local input value to an ISO string with a Z offset. */
function localDatetimeToISO(value: string, _timezone: string): string {
  // The datetime-local input gives us a local wall-clock time string like "2026-06-20T14:00".
  // We interpret it as-is in the selected timezone via the Intl API, then convert to UTC.
  // For simplicity we append timezone offset manually via toISOString after Date construction.
  // The backend already does timezone-aware working-hours checks using the `timezone` field.
  return new Date(value).toISOString();
}

export function ScheduleDrawer({ open, onClose, schedule }: Props) {
  const qc = useQueryClient();
  const editing = !!schedule;

  const [candSearch, setCandSearch] = useState('');
  const [jobRequisitionId, setJobRequisitionId] = useState('');
  const [selectedCandidates, setSelectedCandidates] = useState<Map<string, { id: string; fullName: string; email?: string | null }>>(new Map());
  const [interviewerIds, setInterviewerIds] = useState<string[]>([]);
  const [type, setType] = useState<'LIVE' | 'PANEL'>('LIVE');
  const [duration, setDuration] = useState('60');
  const tenantTimezone = useAuthStore((s) => s.user?.tenantTimezone);
  // Defaults to the tenant's timezone (most interviews are
  // scheduled in it); the recruiter can still override per interview.
  const [timezone, setTimezone] = useState(tenantTimezone ?? 'UTC');
  const [date, setDate] = useState(todayUTC());
  const [selectedSlot, setSelectedSlot] = useState('');
  const [useCustomSlot, setUseCustomSlot] = useState(false);
  const [customDatetime, setCustomDatetime] = useState('');
  const [meetingProvider, setMeetingProvider] = useState<'GOOGLE_MEET' | 'MS_TEAMS' | 'ZOOM' | 'CUSTOM'>('GOOGLE_MEET');
  const [meetingLink, setMeetingLink] = useState('');
  const [instructions, setInstructions] = useState('');
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
    if (!open) return;
    if (schedule) {
      setSelectedCandidates(new Map([[schedule.candidate.id, schedule.candidate]]));
      setCandSearch(schedule.candidate.email ? `${schedule.candidate.fullName} (${schedule.candidate.email})` : schedule.candidate.fullName);
      setInterviewerIds(schedule.interviewers.map((i) => i.id));
      setType(schedule.type === 'PANEL' ? 'PANEL' : 'LIVE');
      setDuration(String(schedule.duration));
      setTimezone(schedule.timezone);
      setDate(schedule.scheduledDate.slice(0, 10));
      setSelectedSlot(schedule.scheduledDate);
      setMeetingProvider(((schedule as any).meetingProvider || 'GOOGLE_MEET') as typeof meetingProvider);
      setMeetingLink(schedule.meetingLink ?? '');
      setInstructions(schedule.instructions ?? '');
      setUseCustomSlot(false);
      setCustomDatetime('');
    } else {
      setCandSearch(''); setJobRequisitionId(''); setSelectedCandidates(new Map()); setInterviewerIds([]); setType('LIVE');
      setRoundNumber('');
      setDuration('60'); setTimezone(tenantTimezone ?? 'UTC'); setDate(todayUTC()); setSelectedSlot('');
      setUseCustomSlot(false); setCustomDatetime('');
      setMeetingProvider('GOOGLE_MEET');
      setMeetingLink(''); setInstructions('');
      setIsOpenDropdown(false);
    }
  }, [open, schedule, tenantTimezone]);

  const { data: calendarData } = useQuery({
    queryKey: ['calendar-status'],
    queryFn: () => scheduleApi.fetchCalendarStatus(),
    enabled: open,
    staleTime: 60_000,
  });
  const calendarConfigured = calendarData?.configured ?? false;

  // Only candidates who passed their AI interview may be scheduled.
  const [roundNumber, setRoundNumber] = useState<string>('');

  const { data: usersData } = useQuery({
    queryKey: ['ref-users'],
    queryFn: () => referenceApi.fetchUsers(),
    enabled: open,
    staleTime: 60_000,
  });
  const { data: jobsData } = useQuery({
    queryKey: ['jobs', { limit: 500 }],
    // No status filter: candidates can be scheduled for interviews on a job
    // in any status (e.g. assigned before formal approval, or still active
    // on a job that's since closed) — restricting this to OPEN made those
    // candidates permanently unschedulable once their job left OPEN status.
    queryFn: () => jobApi.fetchJobs({ limit: 500 }),
    enabled: open && !editing,
    staleTime: 60_000,
  });
  
  const { data: jobDetailResponse } = useQuery({
    queryKey: ['job', jobRequisitionId],
    queryFn: () => jobApi.fetchJob(jobRequisitionId),
    enabled: open && !!jobRequisitionId && !editing,
  });
  const jobDetail = jobDetailResponse?.job;
  const workflowRounds = jobDetail?.workflowRounds || [];

  const sortedWorkflowRounds = useMemo(() => {
    return [...workflowRounds].sort((a, b) => a.orderIndex - b.orderIndex);
  }, [workflowRounds]);

  const isRoundSchedule = useMemo(() => {
    if (!roundNumber || !sortedWorkflowRounds.length) return false;
    const selectedRound = sortedWorkflowRounds.find(r => String(r.orderIndex) === roundNumber);
    return !!(selectedRound && isScheduleRound(selectedRound.roundType, selectedRound.roundName));
  }, [roundNumber, sortedWorkflowRounds]);

  // Only candidates who are eligible for the selected schedule round will be returned.
  const { data: candData } = useQuery({
    queryKey: ['passed-candidates', { jobRequisitionId, roundNumber: roundNumber ? Number(roundNumber) : undefined }],
    queryFn: () => scheduleApi.fetchPassedCandidates(
      jobRequisitionId || undefined,
      roundNumber ? Number(roundNumber) : undefined
    ),
    enabled: open && !editing && !!jobRequisitionId && !!roundNumber && isRoundSchedule,
  });

  const { data: avail, isFetching: loadingSlots } = useQuery({
    queryKey: ['availability', interviewerIds, date, duration, timezone, schedule?.id ?? null],
    queryFn: () =>
      scheduleApi.fetchAvailability({
        interviewerIds,
        date,
        duration: Number(duration),
        excludeInterviewId: editing ? schedule!.id : undefined,
        timeZone: timezone,
      }),
    enabled: open && interviewerIds.length > 0 && !!date && !useCustomSlot,
  });

  // The final ISO scheduledDate sent to the API.
  const scheduledDate = useCustomSlot ? (customDatetime ? localDatetimeToISO(customDatetime, timezone) : '') : selectedSlot;

  const mutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        return scheduleApi.rescheduleInterview(schedule!.id, {
          scheduledDate: scheduledDate !== schedule!.scheduledDate ? scheduledDate : undefined,
          duration: Number(duration),
          interviewerIds,
          timezone,
          meetingProvider,
          meetingLink: meetingLink || '',
          instructions: instructions || '',
        });
      }
      const promises = Array.from(selectedCandidates.keys()).map((id) =>
        scheduleApi.createSchedule({
          candidateId: id,
          interviewerIds,
          scheduledDate,
          duration: Number(duration),
          timezone,
          type,
          meetingProvider,
          meetingLink: meetingLink || '',
          instructions: instructions || '',
          jobRequisitionId,
          roundNumber: roundNumber ? Number(roundNumber) : undefined,
        })
      );
      const results = await Promise.all(promises);
      return results[0];
    },
    onSuccess: (data) => {
      const s = data.schedule;
      const autoLink = s.meetingLink && !meetingLink;
      if (autoLink) {
        toast.success(
          editing
            ? `Interview rescheduled — Meet link auto-generated: ${s.meetingLink}`
            : `Interview(s) scheduled — Meet link auto-generated`,
          { duration: 6000 },
        );
      } else {
        toast.success(editing ? 'Interview rescheduled' : 'Interview(s) scheduled');
      }
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      if (editing) qc.invalidateQueries({ queryKey: ['schedule', schedule!.id] });
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not schedule the interview')),
  });

  const passedCandidates = candData?.candidates ?? [];
  const candidates = useMemo(() => {
    const q = candSearch.trim().toLowerCase();
    if (!q) return passedCandidates;
    return passedCandidates.filter(
      (c) => c.fullName.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q),
    );
  }, [passedCandidates, candSearch]);
  const users = usersData?.users ?? [];
  const jobs = jobsData?.items ?? [];
  const slots = avail?.slots ?? [];
  const availableSlots = useMemo(() => slots.filter((s) => s.available), [slots]);

  function toggleInterviewer(id: string) {
    setInterviewerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setSelectedSlot('');
  }

  function toggleCandidate(c: { id: string; fullName: string; email?: string | null }) {
    setSelectedCandidates((prev) => {
      const next = new Map(prev);
      if (editing) {
        return new Map([[c.id, c]]);
      }
      if (next.has(c.id)) {
        next.delete(c.id);
      } else {
        next.set(c.id, c);
      }
      return next;
    });
  }

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

  const valid =
    (editing ||
      (selectedCandidates.size > 0 &&
        !!jobRequisitionId &&
        isRoundSchedule &&
        (workflowRounds.length === 0 || !!roundNumber))) &&
    interviewerIds.length > 0 &&
    !!scheduledDate;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? 'Reschedule Interview' : 'Schedule Interview'}
      subtitle={editing ? schedule?.candidate.fullName : 'Book a live or panel interview'}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!valid} loading={mutation.isPending} onClick={() => mutation.mutate()}>
            {editing ? 'Save changes' : 'Schedule'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Google Calendar integration status banner */}
        {calendarConfigured && (
          <div className="flex items-start gap-2.5 rounded-md border border-accent/30 bg-accent/5 p-3">
            <CalendarCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p className="text-xs text-text-secondary">
              <span className="font-medium text-text-primary">Google Calendar is connected.</span>{' '}
              A calendar event will be created automatically and a Google Meet link will be
              generated — no manual link entry required.
            </p>
          </div>
        )}

        {!editing && (
          <>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-primary">Job Requisition <span className="text-danger">*</span></label>
              <Select
                options={jobs.map((j) => ({ value: j.id, label: j.title }))}
                placeholder="Select Job Requisition"
                value={jobRequisitionId}
                onChange={(e) => {
                  setJobRequisitionId(e.target.value);
                  setRoundNumber('');
                  setSelectedCandidates(new Map());
                }}
              />
            </div>
            {jobRequisitionId && workflowRounds.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-primary">Workflow Round <span className="text-danger">*</span></label>
                <Select
                  options={sortedWorkflowRounds.map((r: any) => {
                    const isSchedule = isScheduleRound(r.roundType, r.roundName);
                    // Determine sequence-based Available / Completed / Locked status
                    const priorScheduleRounds = sortedWorkflowRounds.filter(
                      (w: any) => isScheduleRound(w.roundType, w.roundName) && w.orderIndex < r.orderIndex
                    );
                    const isLocked = isSchedule && priorScheduleRounds.length > 0;
                    
                    let label = r.roundName;
                    let disabled = false;
                    if (!isSchedule) {
                      label = `✓ ${r.roundName} (Completed)`;
                    } else if (isLocked) {
                      label = `🔒 ${r.roundName} (Locked)`;
                      disabled = true;
                    } else {
                      label = `✓ ${r.roundName} (Available)`;
                    }
                    
                    return { value: String(r.orderIndex), label, disabled };
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
            {jobRequisitionId && !roundNumber && (
              <p className="text-sm text-text-muted">
                Please select a workflow round to load eligible candidates.
              </p>
            )}
            {jobRequisitionId && roundNumber && !isRoundSchedule && (
              <div className="rounded-lg border border-border bg-surface-raised p-4 text-text-secondary text-sm font-medium">
                This round must be conducted from the Interview page.
              </div>
            )}
            {jobRequisitionId && roundNumber && isRoundSchedule && (
              <div className="space-y-1.5 relative" onClick={(e) => e.stopPropagation()}>
                <label className="text-sm font-medium text-text-primary">Candidate <span className="text-danger">*</span></label>
                <Input
                  placeholder="Search passed candidates…"
                  value={isOpenDropdown ? candSearch : (selectedCandidates.size > 0 ? Array.from(selectedCandidates.values()).map(c => c.fullName).join(', ') : '')}
                  onChange={(e) => {
                    setCandSearch(e.target.value);
                    if (!editing) setSelectedCandidates(new Map());
                    setIsOpenDropdown(true);
                  }}
                  onFocus={() => setIsOpenDropdown(true)}
                />
                {!editing && (
                  <div className="flex items-center justify-between mt-1 px-1">
                    <span className="text-xs text-text-muted font-medium">
                      Selected ({selectedCandidates.size} candidates)
                    </span>
                    {candidates.length > 0 && (
                      <button
                        type="button"
                        className="text-xs font-medium text-accent hover:underline"
                        onClick={handleSelectAll}
                      >
                        {allSelected ? 'Clear all' : 'Select all'}
                      </button>
                    )}
                  </div>
                )}
                {isOpenDropdown && (
                  <div className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-surface shadow-lg p-2">
                    {passedCandidates.length === 0 ? (
                      <div className="px-3 py-2.5 text-sm text-text-muted">No candidates are eligible for this round</div>
                    ) : candidates.length === 0 ? (
                      <div className="px-3 py-2.5 text-sm text-text-muted">No matches found</div>
                    ) : (
                      <ul className="space-y-1">
                        {candidates.map((c) => (
                          <li key={c.id}>
                            <label className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-sm hover:bg-surface-raised">
                              <input
                                type={editing ? "radio" : "checkbox"}
                                name="candidate-select"
                                className={editing ? "mt-0.5 h-4 w-4 shrink-0 accent-accent rounded-full" : "mt-0.5 h-4 w-4 shrink-0 accent-accent rounded"}
                                checked={selectedCandidates.has(c.id)}
                                onChange={() => {
                                  toggleCandidate({ id: c.id, fullName: c.fullName, email: c.email });
                                  if (editing) {
                                    setCandSearch(c.email ? `${c.fullName} (${c.email})` : c.fullName);
                                    setIsOpenDropdown(false);
                                  }
                                }}
                              />
                              <span className="min-w-0">
                                <span className="font-semibold text-text-primary block">{c.fullName}</span>
                                {c.email && <span className="text-xs text-text-muted block">{c.email}</span>}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <p className="text-xs text-text-muted">Only candidates who are currently at this workflow round can be scheduled.</p>
              </div>
            )}
          </>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text-primary">
            Interviewer(s) <span className="text-danger">*</span>
          </label>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {users.length === 0 ? (
              <p className="p-2 text-sm text-text-muted">No users available</p>
            ) : (
              users.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm hover:bg-surface-raised">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={interviewerIds.includes(u.id)}
                    onChange={() => toggleInterviewer(u.id)}
                  />
                  <span className="text-text-secondary">{u.fullName}</span>
                  <span className="text-xs text-text-muted">· {u.role.displayName}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {!editing && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-primary">Type</label>
              <Select
                options={[{ value: 'LIVE', label: 'Live (1:1)' }, { value: 'PANEL', label: 'Panel' }]}
                value={type}
                onChange={(e) => setType(e.target.value as 'LIVE' | 'PANEL')}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-primary">Duration</label>
            <Select options={DURATIONS} value={duration} onChange={(e) => { setDuration(e.target.value); setSelectedSlot(''); }} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-primary">Timezone</label>
            <Select
              options={TIMEZONES.map((t) => ({ value: t, label: t }))}
              value={timezone}
              onChange={(e) => { setTimezone(e.target.value); setSelectedSlot(''); }}
            />
          </div>
        </div>

        {/* Slot selection: predefined or custom */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-primary">
              Time slot <span className="text-danger">*</span>
            </label>
            <button
              type="button"
              onClick={() => { setUseCustomSlot((v) => !v); setSelectedSlot(''); setCustomDatetime(''); }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                useCustomSlot
                  ? 'bg-accent/10 text-accent border border-accent/30'
                  : 'border border-border text-text-muted hover:text-text-secondary hover:bg-surface-raised',
              )}
            >
              {useCustomSlot ? <Pencil className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {useCustomSlot ? 'Custom slot (on)' : 'Custom slot'}
            </button>
          </div>

          {useCustomSlot ? (
            <div className="space-y-1.5">
              <div className="flex items-start gap-2.5 rounded-md border border-info/30 bg-info/5 p-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                <p className="text-xs text-text-secondary">
                  Enter any date and time. Working-hours constraints still apply — the server
                  will reject times outside configured hours.
                </p>
              </div>
              <Input
                type="datetime-local"
                value={customDatetime}
                onChange={(e) => setCustomDatetime(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
              />
              {customDatetime && (
                <p className="text-xs text-text-muted">
                  Selected: {formatDateTimeInZone(localDatetimeToISO(customDatetime, timezone), timezone)} {timezone}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div>
                <label className="text-sm font-medium text-text-primary">Date</label>
                <Input type="date" min={todayUTC()} value={date} onChange={(e) => { setDate(e.target.value); setSelectedSlot(''); }} className="mt-1" />
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-text-muted">
                  Available slots <span className="font-medium">(times in {timezone})</span>
                </p>
                {interviewerIds.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-text-muted">
                    Select interviewer(s) to see open times.
                  </p>
                ) : loadingSlots ? (
                  <div className="py-6 text-center"><Spinner className="mx-auto" /></div>
                ) : !avail?.workingDay ? (
                  <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-text-muted">
                    {date} is not a working day. Pick another date or use custom slot.
                  </p>
                ) : availableSlots.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-text-muted">
                    No open slots this day — every working slot is booked or in the past. Try another date or use custom slot.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {availableSlots.map((s) => {
                      const on = selectedSlot === s.start;
                      return (
                        <button
                          key={s.start}
                          type="button"
                          onClick={() => setSelectedSlot(s.start)}
                          className={cn(
                            'rounded-md border px-2 py-1.5 text-sm transition-colors',
                            on
                              ? 'border-accent bg-accent/10 text-text-primary'
                              : 'border-border text-text-secondary hover:bg-surface-raised',
                          )}
                        >
                          {formatTimeInZone(s.start, timezone)}
                        </button>
                      );
                    })}
                  </div>
                )}
                {editing && selectedSlot && !useCustomSlot && (
                  <p className="text-xs text-text-muted">
                    Selected: {formatDateTimeInZone(selectedSlot, timezone)} {timezone}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-primary">Meeting Provider</label>
            <Select
              options={[
                { value: 'GOOGLE_MEET', label: 'Google Meet (Auto-generated)' },
                { value: 'MS_TEAMS', label: 'Microsoft Teams' },
                { value: 'ZOOM', label: 'Zoom' },
                { value: 'CUSTOM', label: 'Custom Link' },
              ]}
              value={meetingProvider}
              onChange={(e) => {
                setMeetingProvider(e.target.value as typeof meetingProvider);
                if (e.target.value === 'GOOGLE_MEET' || e.target.value === 'MS_TEAMS') {
                  setMeetingLink('');
                }
              }}
            />
          </div>

          {(meetingProvider === 'GOOGLE_MEET' || meetingProvider === 'MS_TEAMS') && (
             <p className="text-xs text-text-muted">
               {meetingProvider === 'GOOGLE_MEET'
                 ? 'A Google Meet link and Calendar event will be automatically generated and sent to the candidate and interviewers when you click Schedule.'
                 : 'A Microsoft Teams link and Outlook Calendar event will be automatically generated and sent to the candidate and interviewers when you click Schedule.'}
             </p>
          )}

          {meetingProvider !== 'GOOGLE_MEET' && meetingProvider !== 'MS_TEAMS' && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-primary">Meeting link</label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="https://zoom.us/j/123456789"
                  value={meetingLink}
                  onChange={(e) => setMeetingLink(e.target.value)}
                />
              </div>
              <p className="text-xs text-text-muted">
                Paste your custom meeting link here. It will be included in the invitation email.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text-primary">Instructions for candidate</label>
          <Textarea placeholder="Anything the candidate should know…" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </div>

        <div className="flex items-start gap-2.5 rounded-md border border-success/30 bg-success/5 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <p className="text-xs text-text-secondary">
            <span className="font-medium text-text-primary">Proctoring is enforced on AI interviews.</span>{' '}
            Candidate links run with webcam + microphone monitoring, identity snapshot, tab-switch /
            fullscreen-exit / copy-paste detection, and automatic termination after repeated
            violations (configured in System Config → Interviews).
          </p>
        </div>
      </div>
    </Drawer>
  );
}
