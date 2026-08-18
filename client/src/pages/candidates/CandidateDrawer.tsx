import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Info, Paperclip, X } from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { TagInput } from '../../components/ui/TagInput.js';
import * as candidateApi from '../../services/candidateApi.js';
import * as refApi from '../../services/referenceApi.js';
import * as jobApi from '../../services/jobApi.js';
import { apiErrorMessage } from '../../services/api.js';
import { createCandidateSchema } from '@agnohire/shared';
import type { CandidateDetail, CreateCandidateInput } from '@agnohire/shared';

type FormValues = z.input<typeof createCandidateSchema>;

interface Props {
  open: boolean;
  onClose: () => void;
  candidate?: CandidateDetail | null;
  mode?: 'candidate' | 'referral';
  onSuccess?: (newCandidate: any) => void;
  defaultJobRequisitionId?: string | null;
}

const EXPERIENCE_OPTIONS = [
  { value: 'ENTRY', label: 'Entry' },
  { value: 'JUNIOR', label: 'Junior' },
  { value: 'MID', label: 'Mid' },
  { value: 'SENIOR', label: 'Senior' },
  { value: 'LEAD', label: 'Lead' },
  { value: 'PRINCIPAL', label: 'Principal' },
];

const SOURCE_OPTIONS = [
  { value: 'DIRECT', label: 'Direct' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'LINKEDIN', label: 'LinkedIn' },
  { value: 'JOB_BOARD', label: 'Job Board' },
  { value: 'AGENCY', label: 'Agency' },
  { value: 'CAREER_SITE', label: 'Career Site' },
  { value: 'OTHER', label: 'Other' },
];

function Field({
  label,
  error,
  required,
  hint,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-sm font-medium text-text-primary">
        {label}
        {required && <span className="text-danger">*</span>}
        {hint && (
          <span title={hint} className="cursor-help text-text-muted">
            <Info className="h-3.5 w-3.5" />
          </span>
        )}
      </label>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

const RESUME_ACCEPT = '.pdf,.docx,.txt,image/jpeg,image/png,image/webp,image/bmp,image/tiff';

export function CandidateDrawer({
  open,
  onClose,
  candidate,
  mode = 'candidate',
  onSuccess,
  defaultJobRequisitionId,
}: Props) {
  const qc = useQueryClient();
  const isEdit = Boolean(candidate);
  const prevSectorRef = useRef<string>('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeUrl, setResumeUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: sectorsData } = useQuery({
    queryKey: ['sectors'],
    queryFn: refApi.fetchSectors,
    enabled: open,
    staleTime: 60_000,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(createCandidateSchema),
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      experienceLevel: undefined,
      skills: [],
      linkedinUrl: '',
      githubUrl: '',
      location: '',
      currentRole: '',
      source: mode === 'referral' ? 'REFERRAL' : undefined,
      sectorId: null,
      domainId: null,
      jobRequisitionId: defaultJobRequisitionId || null,
      consentGiven: mode === 'referral' ? true : false,
    },
  });

  const { control, watch, setValue, formState: { errors } } = form;
  const watchedSectorId = watch('sectorId');

  const { data: domainsData } = useQuery({
    queryKey: ['domains', watchedSectorId],
    queryFn: () => refApi.fetchDomains(watchedSectorId || undefined),
    enabled: open,
    staleTime: 60_000,
  });

  const { data: jobsData } = useQuery({
    queryKey: ['jobs', { limit: 500 }],
    queryFn: () => jobApi.fetchJobs({ limit: 500 }),
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (candidate && open) {
      prevSectorRef.current = candidate.sector?.id ?? '';
      form.reset({
        fullName: candidate.fullName,
        email: candidate.email,
        phone: candidate.phone ?? '',
        experienceLevel: candidate.experienceLevel ?? undefined,
        skills: candidate.skills,
        linkedinUrl: candidate.linkedinUrl ?? '',
        githubUrl: candidate.githubUrl ?? '',
        location: candidate.location ?? '',
        currentRole: candidate.currentRole ?? '',
        source: candidate.source ?? undefined,
        sectorId: candidate.sector?.id ?? null,
        domainId: candidate.domain?.id ?? null,
        jobRequisitionId: candidate.jobApplied?.id ?? null,
        consentGiven: candidate.consentGiven,
      });
    } else if (!candidate && open) {
      prevSectorRef.current = '';
      form.reset({
        fullName: '',
        email: '',
        phone: '',
        experienceLevel: undefined,
        skills: [],
        linkedinUrl: '',
        githubUrl: '',
        location: '',
        currentRole: '',
        source: mode === 'referral' ? 'REFERRAL' : undefined,
        sectorId: null,
        domainId: null,
        jobRequisitionId: defaultJobRequisitionId || null,
        consentGiven: mode === 'referral' ? true : false,
      });
    }
    if (open) {
      setResumeFile(null);
      setResumeUrl('');
    }
  }, [candidate, open, form, mode, defaultJobRequisitionId]);

  const createMutation = useMutation({
    mutationFn: (data: CreateCandidateInput) => candidateApi.createCandidate(data),
    onSuccess: async ({ candidate: created }) => {
      // Attach the resume after the candidate exists (file wins over URL).
      if (resumeFile) {
        try {
          await candidateApi.uploadResume(created.id, resumeFile);
          toast.success('Candidate added — resume uploaded & parsing');
        } catch (e) {
          toast.error(`Candidate added, but the resume upload failed: ${apiErrorMessage(e)}`);
        }
      } else if (resumeUrl.trim()) {
        try {
          await candidateApi.importResumeFromUrl(created.id, resumeUrl.trim());
          toast.success('Candidate added — resume imported & parsing');
        } catch (e) {
          toast.error(`Candidate added, but the resume import failed: ${apiErrorMessage(e)}`);
        }
      } else {
        toast.success('Candidate added');
      }
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['candidate-stats'] });
      qc.invalidateQueries({ queryKey: ['tenant-usage'] });
      if (onSuccess) {
        onSuccess(created);
      }
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not add candidate')),
  });

  const updateMutation = useMutation({
    mutationFn: (data: CreateCandidateInput) => candidateApi.updateCandidate(candidate!.id, data),
    onSuccess: async () => {
      const candidateId = candidate!.id;
      if (resumeFile) {
        try {
          await candidateApi.uploadResume(candidateId, resumeFile);
          toast.success('Candidate updated — resume uploaded & parsing');
        } catch (e) {
          toast.error(`Candidate updated, but the resume upload failed: ${apiErrorMessage(e)}`);
        }
      } else if (resumeUrl.trim()) {
        try {
          await candidateApi.importResumeFromUrl(candidateId, resumeUrl.trim());
          toast.success('Candidate updated — resume imported & parsing');
        } catch (e) {
          toast.error(`Candidate updated, but the resume import failed: ${apiErrorMessage(e)}`);
        }
      } else {
        toast.success('Candidate updated');
      }
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update candidate')),
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  async function save() {
    const valid = await form.trigger();
    if (!valid) {
      const errs = form.formState.errors;
      console.log('Form validation failed:', errs);
      const errorMsg = Object.entries(errs)
        .map(([field, err]) => `${field}: ${err?.message || 'invalid'}`)
        .join(', ');
      toast.error(`Validation failed: ${errorMsg}`);
      return;
    }
    const v = form.getValues();
    const payload: CreateCandidateInput = {
      fullName: v.fullName,
      email: v.email,
      phone: v.phone || undefined,
      experienceLevel: v.experienceLevel,
      skills: v.skills ?? [],
      linkedinUrl: v.linkedinUrl || undefined,
      githubUrl: v.githubUrl || undefined,
      location: v.location || undefined,
      currentRole: v.currentRole || undefined,
      source: v.source,
      sectorId: v.sectorId || null,
      domainId: v.domainId || null,
      jobRequisitionId: v.jobRequisitionId || null,
      consentGiven: v.consentGiven ?? false,
    };
    if (isEdit) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  }

  const sectors = sectorsData?.sectors ?? [];
  const domains = domainsData?.domains ?? [];
  const jobs = (jobsData?.items ?? []).filter((j) => j.status !== 'CLOSED');

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button variant="outline" onClick={onClose} type="button">
        Cancel
      </Button>
      <Button onClick={save} loading={isSaving} type="button">
        {isEdit ? 'Save changes' : (mode === 'referral' ? 'Save' : 'Add candidate')}
      </Button>
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Candidate' : (mode === 'referral' ? 'Create New Candidate' : 'Add Candidate')}
      subtitle={isEdit ? candidate?.fullName : 'Create a candidate profile'}
      size="lg"
      footer={footer}
    >
      <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Full Name" required error={errors.fullName?.message}>
            <Controller
              control={control}
              name="fullName"
              render={({ field }) => <Input {...field} placeholder="e.g. Priya Sharma" />}
            />
          </Field>
          <Field label="Email" required error={errors.email?.message}>
            <Controller
              control={control}
              name="email"
              render={({ field }) => <Input {...field} type="email" placeholder="name@email.com" />}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone" error={errors.phone?.message}>
            <Controller
              control={control}
              name="phone"
              render={({ field }) => <Input {...field} value={field.value ?? ''} placeholder="+91…" />}
            />
          </Field>
          <Field label="Current Role" error={errors.currentRole?.message}>
            <Controller
              control={control}
              name="currentRole"
              render={({ field }) => (
                <Input {...field} value={field.value ?? ''} placeholder="e.g. Backend Engineer" />
              )}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Experience Level" error={errors.experienceLevel?.message}>
            <Controller
              control={control}
              name="experienceLevel"
              render={({ field }) => (
                <Select
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value || undefined)}
                  options={EXPERIENCE_OPTIONS}
                  placeholder="Select level"
                />
              )}
            />
          </Field>
          <Field label="Source" error={errors.source?.message}>
            <Controller
              control={control}
              name="source"
              render={({ field }) =>
                mode === 'referral' ? (
                  <Input
                    value="Referral"
                    readOnly
                    className="bg-surface-raised text-text-primary cursor-not-allowed"
                  />
                ) : (
                  <Select
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || undefined)}
                    options={SOURCE_OPTIONS}
                    placeholder="Select source"
                  />
                )
              }
            />
          </Field>
        </div>

        <Field label="Location" error={errors.location?.message}>
          <Controller
            control={control}
            name="location"
            render={({ field }) => (
              <Input {...field} value={field.value ?? ''} placeholder="e.g. Bengaluru, India" />
            )}
          />
        </Field>

        {mode !== 'referral' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Sector" error={errors.sectorId?.message}>
                <Controller
                  control={control}
                  name="sectorId"
                  render={({ field }) => (
                    <Select
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        const val = e.target.value || null;
                        if (val !== prevSectorRef.current) {
                          setValue('domainId', null, { shouldValidate: false });
                        }
                        prevSectorRef.current = val ?? '';
                        field.onChange(val);
                      }}
                      options={sectors.map((s) => ({ value: s.id, label: s.name }))}
                      placeholder="No sector"
                    />
                  )}
                />
              </Field>
              <Field label="Domain" error={errors.domainId?.message}>
                <Controller
                  control={control}
                  name="domainId"
                  render={({ field }) => (
                    <Select
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                      options={domains.map((d) => ({ value: d.id, label: d.name }))}
                      placeholder="No domain"
                    />
                  )}
                />
              </Field>
            </div>

            <Field label="Job Requisition" error={errors.jobRequisitionId?.message}>
              <Controller
                control={control}
                name="jobRequisitionId"
                render={({ field }) => (
                  <Select
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || null)}
                    options={jobs.map((j) => ({ value: j.id, label: j.title }))}
                    placeholder="No job selected"
                  />
                )}
              />
            </Field>
          </>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="LinkedIn URL" error={errors.linkedinUrl?.message}>
            <Controller
              control={control}
              name="linkedinUrl"
              render={({ field }) => (
                <Input {...field} value={field.value ?? ''} placeholder="https://linkedin.com/in/…" />
              )}
            />
          </Field>
          <Field label="GitHub URL" error={errors.githubUrl?.message}>
            <Controller
              control={control}
              name="githubUrl"
              render={({ field }) => (
                <Input {...field} value={field.value ?? ''} placeholder="https://github.com/…" />
              )}
            />
          </Field>
        </div>

        <Field label="Skills" error={errors.skills?.message} hint="Press Enter or comma to add">
          <Controller
            control={control}
            name="skills"
            render={({ field }) => (
              <TagInput
                value={field.value ?? []}
                onChange={field.onChange}
                placeholder="Add skills (e.g. Python, AWS…)"
              />
            )}
          />
        </Field>

        <div className="space-y-2 rounded-md border border-border bg-surface-raised p-3">
          <p className="text-sm font-medium text-text-primary">Resume (optional)</p>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={RESUME_ACCEPT}
              className="hidden"
              onChange={(e) => {
                setResumeFile(e.target.files?.[0] ?? null);
                if (e.target.files?.[0]) setResumeUrl('');
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-3.5 w-3.5" />
              {resumeFile ? 'Change file' : 'Upload file'}
            </Button>
            {resumeFile && (
              <span className="flex min-w-0 items-center gap-1 text-xs text-text-secondary">
                <span className="truncate">{resumeFile.name}</span>
                <button
                  type="button"
                  aria-label="Remove file"
                  className="text-text-muted hover:text-danger"
                  onClick={() => {
                    setResumeFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="h-px flex-1 bg-border" />
            or paste a link
            <span className="h-px flex-1 bg-border" />
          </div>
          <Input
            placeholder="https://drive.google.com/… (public resume URL)"
            value={resumeUrl}
            disabled={!!resumeFile}
            onChange={(e) => setResumeUrl(e.target.value)}
          />
          <p className="text-xs text-text-muted">
            PDF, Word, text, or an image — it's parsed automatically (OCR included) after saving.
          </p>
        </div>

        <Controller
          control={control}
          name="consentGiven"
          render={({ field }) => (
            <label className="flex items-start gap-2.5 rounded-md border border-border bg-surface-raised p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(field.value)}
                onChange={(e) => field.onChange(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border accent-accent"
              />
              <span className="text-sm text-text-secondary">
                Candidate has given consent to store and process their personal data (GDPR).
              </span>
            </label>
          )}
        />
      </form>
    </Drawer>
  );
}
