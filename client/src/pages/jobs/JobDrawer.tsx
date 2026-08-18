import { useState, useEffect, useRef } from 'react';
import { z } from 'zod';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Sparkles, ChevronRight, ChevronLeft, Info, Layers, X as XIcon, Plus, Minus, Trash2, GripVertical, Loader2 } from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Select } from '../../components/ui/Select.js';
import { TagInput } from '../../components/ui/TagInput.js';
import * as jobApi from '../../services/jobApi.js';
import * as refApi from '../../services/referenceApi.js';
import { formatTitleCase, createJobSchema, isScheduleRound } from '@agnohire/shared';
import type { JobDetail, CreateJobInput } from '@agnohire/shared';
import { cn } from '../../utils/cn.js';
import { JobCopilot } from './JobCopilot.js';
import { apiErrorMessage } from '../../services/api.js';

// ─── Types ────────────────────────────────────────────────────────────────────

// Use the schema INPUT type so zodResolver generics align (defaults are optional in input)
type FormValues = z.input<typeof createJobSchema>;

interface JobDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Pass a job to enter edit mode */
  job?: JobDetail | null;
}

const STEPS = [
  { label: 'Basic Info', fields: ['title', 'sectorId', 'domainId', 'workMode', 'location', 'headcount'] },
  { label: 'Requirements', fields: ['experienceMin', 'experienceMax', 'budgetMin', 'budgetMax', 'skills', 'deadline'] },
  { label: 'Job Description', fields: ['description'] },
  { label: 'Interview Workflow', fields: ['workflowRounds'] },
  { label: 'Review', fields: [] },
] as const;

// ─── Field wrapper ────────────────────────────────────────────────────────────

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

// ─── Step indicators ──────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            i < current
              ? 'bg-accent'
              : i === current
                ? 'bg-accent/60'
                : 'bg-surface-overlay',
          )}
        />
      ))}
    </div>
  );
}

// ─── AI JD Modal ──────────────────────────────────────────────────────────────

function AiJdPanel({
  jobTitle,
  domainName,
  skills,
  experienceMin,
  experienceMax,
  budgetMin,
  budgetMax,
  workMode,
  location,
  workflowRounds,
  onInsert,
}: {
  jobTitle: string;
  domainName: string;
  skills: string[];
  experienceMin?: number | null;
  experienceMax?: number | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  workMode?: string | null;
  location?: string | null;
  workflowRounds?: Array<{ roundName: string; roundType: string }> | null;
  onInsert: (text: string) => void;
}) {
  const [additionalContext, setAdditionalContext] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState('');

  async function generate() {
    setGenerating(true);
    setResult('');
    try {
      const { jd } = await jobApi.generateJd({
        title: jobTitle,
        domain: domainName,
        skills,
        experienceMin: experienceMin ?? undefined,
        experienceMax: experienceMax ?? undefined,
        budgetMin: budgetMin ?? undefined,
        budgetMax: budgetMax ?? undefined,
        workMode: workMode ?? undefined,
        location: location ?? undefined,
        workflowRounds: workflowRounds ?? undefined,
        additionalContext: additionalContext || undefined,
      });
      setResult(jd);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Generation failed';
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <span className="text-sm font-medium text-accent">Generate with AI</span>
      </div>

      <Textarea
        placeholder="Optional: add context (seniority, team size, tech stack…)"
        value={additionalContext}
        onChange={(e) => setAdditionalContext(e.target.value)}
        className="min-h-16 text-sm"
      />

      <Button
        variant="primary"
        size="sm"
        loading={generating}
        onClick={generate}
        disabled={!jobTitle || !domainName}
        type="button"
      >
        {generating ? 'Generating…' : 'Generate JD'}
      </Button>

      {result && (
        <div className="space-y-2">
          <div className="max-h-48 overflow-y-auto rounded border border-border bg-surface p-3 text-xs text-text-secondary whitespace-pre-wrap">
            {result}
          </div>
          <Button size="sm" type="button" onClick={() => onInsert(result)}>
            Use this JD
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main drawer ──────────────────────────────────────────────────────────────

export function JobDrawer({ open, onClose, job }: JobDrawerProps) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [showAi, setShowAi] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);
  const [aiJdUsed, setAiJdUsed] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [appliedTemplateName, setAppliedTemplateName] = useState<string | null>(null);
  const isEdit = Boolean(job);
  // Track previous sectorId so domain is only cleared on user-initiated sector changes
  const prevSectorRef = useRef<string>('');

  const { data: sectorsData } = useQuery({
    queryKey: ['sectors'],
    queryFn: refApi.fetchSectors,
    enabled: open,
    staleTime: 60_000,
  });

  const { data: approversData } = useQuery({
    queryKey: ['approvers'],
    queryFn: jobApi.fetchApprovers,
    enabled: open,
    staleTime: 60_000,
  });

  const { data: templatesData } = useQuery({
    queryKey: ['job-templates', 'all'],
    queryFn: () => jobApi.fetchTemplates({ limit: 500 }),
    enabled: open && !isEdit,
    staleTime: 60_000,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(createJobSchema),
    defaultValues: {
      title: '',
      description: '',
      sectorId: '',
      domainId: '',
      workMode: undefined,
      location: '',
      headcount: 1,
      skills: [],
      experienceMin: undefined,
      experienceMax: undefined,
      budgetMin: undefined,
      budgetMax: undefined,
      deadline: null,
      templateId: null,
      workflowRounds: [],
    },
  });

  const { watch, setValue, control, formState: { errors } } = form;
  const watchedSectorId = watch('sectorId');
  const watchedExperienceMin = watch('experienceMin');
  const watchedExperienceMax = watch('experienceMax');
  const watchedBudgetMin = watch('budgetMin');
  const watchedBudgetMax = watch('budgetMax');

  const experienceError =
    watchedExperienceMin != null &&
    watchedExperienceMax != null &&
    watchedExperienceMax < watchedExperienceMin
      ? 'Max Experience must be greater than or equal to Min Experience.'
      : null;

  const budgetError =
    watchedBudgetMin != null &&
    watchedBudgetMax != null &&
    watchedBudgetMax <= watchedBudgetMin
      ? 'Max Budget must be greater than Min Budget.'
      : null;

  const { fields: roundFields, append: appendRound, remove: removeRound } = useFieldArray({
    control,
    name: 'workflowRounds',
  });

  // Domains filtered by selected sector
  const { data: domainsData } = useQuery({
    queryKey: ['domains', watchedSectorId],
    queryFn: () => refApi.fetchDomains(watchedSectorId || undefined),
    enabled: open,
    staleTime: 60_000,
  });

  // Populate form when editing; reset AI flag and sector ref on every open
  const handleCopilotUpdate = (updates: any) => {
    Object.entries(updates).forEach(([key, value]) => {
      setValue(key as any, value, { shouldValidate: true, shouldDirty: true });
    });
  };

  const generateRequisitionMutation = useMutation({
    mutationFn: () => jobApi.generateCompleteRequisition({
      jobTitle: form.getValues('title'),
      department: domains.find(d => d.id === form.getValues('domainId'))?.name || '',
      experience: `${form.getValues('experienceMin') || 0}-${form.getValues('experienceMax') || 0}`,
      location: form.getValues('location') || '',
      employmentType: form.getValues('workMode') || '',
      industry: sectors.find(s => s.id === form.getValues('sectorId'))?.name || '',
    }),
    onSuccess: (data) => {
      setValue('description', data.jobDescription, { shouldValidate: true });
      if (data.requiredSkills) setValue('skills', data.requiredSkills, { shouldValidate: true });
      if (data.interviewWorkflow) {
        const enrichedWorkflow = data.interviewWorkflow.map((round: any) => ({
          ...round,
          isMandatory: true,
          autoProgression: true
        }));
        setValue('workflowRounds', enrichedWorkflow, { shouldValidate: true });
      }
      toast.success('Successfully generated the full job requisition!');
      setStep(1); // move to JD tab
    },
    onError: (err: any) => toast.error(apiErrorMessage(err, 'Failed to generate requisition'))
  });



  useEffect(() => {
    if (job && open) {
      prevSectorRef.current = job.sector.id;
      form.reset({
        title: job.title,
        description: job.description,
        sectorId: job.sector.id,
        domainId: job.domain.id,
        workMode: (job.workMode as FormValues['workMode']) ?? undefined,
        location: job.location ?? '',
        headcount: job.headcount,
        skills: job.skills,
        experienceMin: job.experienceMin ?? undefined,
        experienceMax: job.experienceMax ?? undefined,
        budgetMin: job.budgetMin ? Number(job.budgetMin) : undefined,
        budgetMax: job.budgetMax ? Number(job.budgetMax) : undefined,
        deadline: job.deadline ?? null,
        templateId: job.templateId,
        workflowRounds: job.workflowRounds || [],
      });
      setStep(0);
      setAiJdUsed(false);
    } else if (!job && open) {
      prevSectorRef.current = '';
      form.reset();
      setStep(0);
      setAiJdUsed(false);
      setAppliedTemplateName(null);
      setShowTemplatePicker(false);
    }
  }, [job, open, form]);

  const createMutation = useMutation({
    mutationFn: (data: CreateJobInput) => jobApi.createJob(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['jobs-stats'] });
      toast.success('Job created as draft');
      onClose();
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const updateMutation = useMutation({
    mutationFn: (data: CreateJobInput) => jobApi.updateJob(job!.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['jobs-stats'] });
      qc.invalidateQueries({ queryKey: ['job', job!.id] });
      toast.success('Job updated');
      onClose();
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  async function nextStep() {
    const stepFields = STEPS[step].fields;
    if (stepFields.length > 0) {
      const valid = await form.trigger(stepFields as unknown as (keyof FormValues)[]);
      if (!valid) return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function save() {
    const valid = await form.trigger();
    if (!valid) return;
    const values = form.getValues();
    const payload: CreateJobInput = {
      title: values.title,
      description: values.description,
      sectorId: values.sectorId,
      domainId: values.domainId,
      workMode: (values.workMode as string) ? values.workMode : undefined,
      location: values.location || undefined,
      headcount: values.headcount ?? 1,
      skills: values.skills ?? [],
      experienceMin: values.experienceMin,
      experienceMax: values.experienceMax,
      budgetMin: values.budgetMin,
      budgetMax: values.budgetMax,
      deadline: values.deadline || undefined,
      templateId: values.templateId,
      aiGeneratedJd: aiJdUsed,
      workflowRounds: values.workflowRounds?.map(r => ({
        ...r,
        passPercentage: isScheduleRound(r.roundType, r.roundName) ? null : r.passPercentage,
        isMandatory: r.isMandatory ?? true,
        autoProgression: r.autoProgression ?? true
      })) as any,
    };
    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  }

  function applyTemplate(t: import('@agnohire/shared').JobTemplate) {
    if (t.sectorId) {
      prevSectorRef.current = t.sectorId;
    }
    form.reset({
      ...form.getValues(),
      title: t.name,
      sectorId: t.sectorId || '',
      domainId: t.domainId || '',
      skills: t.skills || [],
      experienceMin: t.experienceMin ?? undefined,
      experienceMax: t.experienceMax ?? undefined,
      workMode: (t.workMode as FormValues['workMode']) ?? undefined,
      description: t.description || '',
      templateId: t.id,
    });
    setAppliedTemplateName(t.name);
    setShowTemplatePicker(false);
  }

  const sectors = sectorsData?.sectors ?? [];
  const domains = domainsData?.domains ?? [];
  const approvers = approversData?.approvers ?? [];
  const availableTemplates = templatesData?.items ?? [];

  const domainName =
    domains.find((d) => d.id === watch('domainId'))?.name ?? '';

  const footer = (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {step > 0 && (
          <Button variant="ghost" onClick={() => setStep((s) => s - 1)} type="button">
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onClose} type="button">
          Cancel
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={nextStep} type="button" disabled={!!experienceError || !!budgetError}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={save} loading={isSaving} type="button" disabled={!!experienceError || !!budgetError}>
            {isEdit ? 'Save changes' : 'Save as draft'}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Job Requisition' : 'Create Job Requisition'}
      subtitle={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step].label}`}
      size="lg"
      footer={footer}
    >
      <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
        <StepIndicator current={step} total={STEPS.length} />

        {/* ── Step 0: Basic Info ─────────────────────────────────────── */}
        {step === 0 && (
          <>
            {/* Template picker (create mode only) */}
            {!isEdit && (
              <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-text-muted" />
                    <span className="text-sm font-medium text-text-primary">
                      {appliedTemplateName ? (
                        <>Template: <span className="text-accent">{appliedTemplateName}</span></>
                      ) : (
                        'Start from a template'
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {appliedTemplateName && (
                      <button
                        type="button"
                        className="text-xs text-text-muted hover:text-danger transition-colors flex items-center gap-0.5"
                        onClick={() => {
                          setValue('templateId', null, { shouldValidate: false });
                          setAppliedTemplateName(null);
                        }}
                      >
                        <XIcon className="h-3 w-3" />
                        Clear
                      </button>
                    )}
                    {availableTemplates.length > 0 && (
                      <button
                        type="button"
                        className="text-xs text-accent hover:underline ml-2"
                        onClick={() => setShowTemplatePicker((v) => !v)}
                      >
                        {showTemplatePicker ? 'Hide' : 'Choose template'}
                      </button>
                    )}
                    {availableTemplates.length === 0 && (
                      <span className="text-xs text-text-muted">No templates available</span>
                    )}
                  </div>
                </div>

                {showTemplatePicker && (
                  <div className="max-h-48 overflow-y-auto space-y-1 pt-1">
                    {availableTemplates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="flex w-full items-start gap-3 rounded-md border border-border bg-surface p-2.5 text-left hover:border-accent/50 hover:bg-surface-raised transition-colors"
                        onClick={() => applyTemplate(t)}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text-primary truncate">{t.name}</p>
                          {t.skills.length > 0 && (
                            <p className="text-xs text-text-muted mt-0.5 truncate">
                              {t.skills.slice(0, 4).join(', ')}{t.skills.length > 4 ? '…' : ''}
                            </p>
                          )}
                        </div>
                        {t.workMode && (
                          <span className="shrink-0 text-xs text-text-muted">{t.workMode}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Field label="Job Title" required error={errors.title?.message}>
              <Controller
                control={control}
                name="title"
                render={({ field }) => (
                  <Input {...field} placeholder="e.g. Senior Software Engineer" />
                )}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Sector" required error={errors.sectorId?.message}>
                <Controller
                  control={control}
                  name="sectorId"
                  render={({ field }) => (
                    <Select
                      {...field}
                      onChange={(e) => {
                        // Clear domain whenever the user picks a different sector
                        if (e.target.value !== prevSectorRef.current) {
                          setValue('domainId', '', { shouldValidate: false });
                        }
                        prevSectorRef.current = e.target.value;
                        field.onChange(e);
                      }}
                      options={sectors.map((s) => ({ value: s.id, label: s.name }))}
                      placeholder="Select sector"
                    />
                  )}
                />
              </Field>
              <Field label="Domain" required error={errors.domainId?.message}>
                <Controller
                  control={control}
                  name="domainId"
                  render={({ field }) => (
                    <Select
                      {...field}
                      options={domains.map((d) => ({ value: d.id, label: d.name }))}
                      placeholder="Select domain"
                      disabled={!watchedSectorId && domains.length === 0}
                    />
                  )}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Work Mode" error={errors.workMode?.message}>
                <Controller
                  control={control}
                  name="workMode"
                  render={({ field }) => (
                    <Select
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value || undefined)
                      }
                      options={[
                        { value: 'ONSITE', label: 'On-site' },
                        { value: 'REMOTE', label: 'Remote' },
                        { value: 'HYBRID', label: 'Hybrid' },
                      ]}
                      placeholder="No preference"
                    />
                  )}
                />
              </Field>
              <Field label="Headcount" required error={errors.headcount?.message}>
                <Controller
                  control={control}
                  name="headcount"
                  render={({ field }) => (
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        onClick={() => {
                          const val = Number(field.value);
                          if (!isNaN(val) && val > 1) {
                            field.onChange(val - 1);
                          } else {
                            field.onChange(1);
                          }
                        }}
                        disabled={Number(field.value) <= 1}
                        className="h-10 w-10 shrink-0 border border-border"
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="flex-1 text-center h-10 font-semibold"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '') {
                            field.onChange('');
                          } else {
                            const cleaned = val.replace(/[^0-9]/g, '');
                            if (cleaned === '') {
                              field.onChange('');
                            } else {
                              const parsed = parseInt(cleaned, 10);
                              field.onChange(parsed);
                            }
                          }
                        }}
                        onBlur={(e) => {
                          const val = e.target.value;
                          const parsed = parseInt(val, 10);
                          if (isNaN(parsed) || parsed < 1) {
                            field.onChange(1);
                          } else {
                            field.onChange(parsed);
                          }
                          field.onBlur();
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        onClick={() => {
                          const val = Number(field.value);
                          if (!isNaN(val)) {
                            field.onChange(val + 1);
                          } else {
                            field.onChange(1);
                          }
                        }}
                        className="h-10 w-10 shrink-0 border border-border"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                />
              </Field>
            </div>

            <Field label="Location" error={errors.location?.message}>
              <Controller
                control={control}
                name="location"
                render={({ field }) => (
                  <Input {...field} placeholder="e.g. Bengaluru, Karnataka" />
                )}
              />
            </Field>

            {!isEdit && (
              <div className="pt-4 border-t border-border">
                <Button 
                  type="button" 
                  onClick={() => generateRequisitionMutation.mutate()} 
                  disabled={generateRequisitionMutation.isPending || !watch('title')}
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg"
                >
                  {generateRequisitionMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  Generate Complete Requisition
                </Button>
                <p className="text-xs text-text-muted mt-2 text-center">AI will automatically draft your Job Description, Interview Workflow, Skills, and other requisition details based on the basic information provided above.</p>
              </div>
            )}
          </>
        )}

        {/* ── Step 1: Requirements ───────────────────────────────────── */}
        {step === 1 && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Min Experience (years)"
                error={errors.experienceMin?.message}
              >
                <Controller
                  control={control}
                  name="experienceMin"
                  render={({ field }) => (
                    <Input
                      type="number"
                      min={0}
                      max={50}
                      placeholder="0"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                    />
                  )}
                />
              </Field>
              <Field
                label="Max Experience (years)"
                error={errors.experienceMax?.message || experienceError || undefined}
              >
                <Controller
                  control={control}
                  name="experienceMax"
                  render={({ field }) => (
                    <Input
                      type="number"
                      min={0}
                      max={50}
                      placeholder="10"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                    />
                  )}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Min Budget (₹)" error={errors.budgetMin?.message}>
                <Controller
                  control={control}
                  name="budgetMin"
                  render={({ field }) => (
                    <Input
                      type="number"
                      min={0}
                      placeholder="e.g. 800000"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                    />
                  )}
                />
              </Field>
              <Field label="Max Budget (₹)" error={errors.budgetMax?.message || budgetError || undefined}>
                <Controller
                  control={control}
                  name="budgetMax"
                  render={({ field }) => (
                    <Input
                      type="number"
                      min={0}
                      placeholder="e.g. 1500000"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                    />
                  )}
                />
              </Field>
            </div>

            <Field label="Application Deadline" error={errors.deadline?.message}>
              <Controller
                control={control}
                name="deadline"
                render={({ field }) => (
                  <Input
                    type="datetime-local"
                    {...field}
                    // The control works in LOCAL wall-clock. Render the stored
                    // UTC instant as local time (date-fns formats in local TZ),
                    // and on change parse the local value back to UTC for
                    // storage — otherwise the time appears shifted by the
                    // browser's timezone offset.
                    value={
                      field.value
                        ? format(new Date(field.value), "yyyy-MM-dd'T'HH:mm")
                        : ''
                    }
                    onChange={(e) =>
                      field.onChange(
                        e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      )
                    }
                  />
                )}
              />
            </Field>

            <Field
              label="Required Skills"
              error={errors.skills?.message}
              hint="Press Enter or comma to add each skill"
            >
              <Controller
                control={control}
                name="skills"
                render={({ field }) => (
                  <TagInput
                    value={field.value ?? []}
                    onChange={field.onChange}
                    placeholder="Add skills (e.g. React, TypeScript…)"
                  />
                )}
              />
            </Field>
          </>
        )}

        {/* ── Step 2: Job Description ────────────────────────────────── */}
        {step === 2 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-secondary">
                Write the job description, or use AI to generate one.
              </p>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setShowAi((v) => !v)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {showAi ? 'Hide AI' : 'Generate with AI'}
              </Button>
            </div>

            {showAi && (
              <AiJdPanel
                jobTitle={watch('title')}
                domainName={domainName}
                skills={watch('skills') ?? []}
                experienceMin={watch('experienceMin')}
                experienceMax={watch('experienceMax')}
                budgetMin={watch('budgetMin')}
                budgetMax={watch('budgetMax')}
                workMode={watch('workMode')}
                location={watch('location')}
                workflowRounds={watch('workflowRounds')}
                onInsert={(text) => {
                  setValue('description', text, { shouldValidate: true });
                  setAiJdUsed(true);
                  setShowAi(false);
                }}
              />
            )}

            <Field label="Job Description" required error={errors.description?.message}>
              <Controller
                control={control}
                name="description"
                render={({ field }) => (
                  <Textarea
                    {...field}
                    rows={14}
                    placeholder="Describe the role, responsibilities, and requirements…"
                    className="min-h-[320px]"
                  />
                )}
              />
            </Field>
          </>
        )}

        {/* ── Step 3: Interview Workflow ────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-text-primary">Interview Rounds</h3>
                <p className="text-xs text-text-muted">Define the sequence of interview rounds for candidates.</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => appendRound({ roundName: '', roundType: 'Technical Interview', isMandatory: true, autoProgression: true })}
                type="button"
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Round
              </Button>
            </div>

            {roundFields.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center bg-surface-raised">
                <Layers className="h-8 w-8 mx-auto text-text-muted mb-2 opacity-50" />
                <p className="text-sm font-medium text-text-primary">No interview rounds defined</p>
                <p className="text-xs text-text-muted mt-1">Candidates will bypass interviews unless you add rounds.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {roundFields.map((field, index) => (
                  <div key={field.id} className="relative rounded-lg border border-border bg-surface-raised p-4 pr-12 group">
                    <div className="absolute right-2 top-2 flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => removeRound(index)}
                        className="p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="absolute left-2 top-1/2 -translate-y-1/2 text-border cursor-grab active:cursor-grabbing hover:text-accent transition-colors hidden sm:block">
                      <GripVertical className="h-4 w-4" />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:ml-6">
                      <Field label={`Round ${index + 1} Name`} error={errors.workflowRounds?.[index]?.roundName?.message}>
                        <Controller
                          control={control}
                          name={`workflowRounds.${index}.roundName`}
                          render={({ field }) => (
                            <Input placeholder="e.g. Initial Screening" {...field} />
                          )}
                        />
                      </Field>
                      <Field label="Round Type" error={errors.workflowRounds?.[index]?.roundType?.message}>
                        <Controller
                          control={control}
                          name={`workflowRounds.${index}.roundType`}
                          render={({ field }) => (
                            <Select {...field} options={[
                              { value: 'Assessment', label: 'Assessment' },
                              { value: 'Technical Interview', label: 'Technical Interview' },
                              { value: 'Coding Assessment', label: 'Coding Assessment' },
                              { value: 'Aptitude Test', label: 'Aptitude Test' },
                              { value: 'AI Interview', label: 'AI Interview' },
                              { value: 'HR Interview', label: 'HR Interview' },
                              { value: 'Final Discussion', label: 'Final Discussion' },
                            ]} />
                          )}
                        />
                      </Field>

                      {!isScheduleRound(watch(`workflowRounds.${index}.roundType`), watch(`workflowRounds.${index}.roundName`)) ? (
                        <Field label="Pass Percentage (%)" hint="Required for AI/Assessment rounds" error={errors.workflowRounds?.[index]?.passPercentage?.message}>
                          <Controller
                            control={control}
                            name={`workflowRounds.${index}.passPercentage`}
                            render={({ field }) => (
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                placeholder="e.g. 60"
                                {...field}
                                value={field.value ?? ''}
                                onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
                              />
                            )}
                          />
                        </Field>
                      ) : (
                        <div />
                      )}

                      <div className="flex flex-col justify-center gap-2 pt-1">
                        <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                          <Controller
                            control={control}
                            name={`workflowRounds.${index}.isMandatory`}
                            render={({ field }) => (
                              <input type="checkbox" className="rounded border-border text-accent focus:ring-accent" checked={field.value} onChange={field.onChange} />
                            )}
                          />
                          Mandatory Round
                        </label>
                        <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                          <Controller
                            control={control}
                            name={`workflowRounds.${index}.autoProgression`}
                            render={({ field }) => (
                              <input type="checkbox" className="rounded border-border text-accent focus:ring-accent" checked={field.value} onChange={field.onChange} />
                            )}
                          />
                          Auto Progression
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Review ─────────────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-surface-raised p-4 space-y-3">
              <ReviewRow label="Title" value={watch('title')} />
              <ReviewRow
                label="Sector / Domain"
                value={`${sectors.find((s) => s.id === watch('sectorId'))?.name ?? '—'} / ${domainName || '—'}`}
              />
              <ReviewRow
                label="Work Mode"
                value={
                  watch('workMode')
                    ? { ONSITE: 'On-site', REMOTE: 'Remote', HYBRID: 'Hybrid' }[
                        watch('workMode')!
                      ]
                    : '—'
                }
              />
              <ReviewRow label="Headcount" value={String(watch('headcount'))} />
              {watch('location') && (
                <ReviewRow label="Location" value={watch('location')!} />
              )}
              {(watch('experienceMin') != null || watch('experienceMax') != null) && (
                <ReviewRow
                  label="Experience"
                  value={`${watch('experienceMin') ?? 0}–${watch('experienceMax') ?? '∞'} years`}
                />
              )}
              {(watch('skills') ?? []).length > 0 && (
                <ReviewRow
                  label="Skills"
                  value={(watch('skills') ?? []).join(', ')}
                />
              )}
              {watch('deadline') && (
                <ReviewRow
                  label="Deadline"
                  value={format(new Date(watch('deadline')!), 'dd MMM yyyy, HH:mm')}
                />
              )}
              {(watch('workflowRounds') ?? []).length > 0 && (
                <div className="flex items-start gap-4">
                  <span className="w-28 shrink-0 text-xs font-medium text-text-muted uppercase tracking-wider mt-0.5">
                    Interview Workflow
                  </span>
                  <div className="flex-1 space-y-2">
                    {watch('workflowRounds')?.map((round, idx) => (
                      <div key={idx} className="text-sm text-text-primary bg-surface p-2 rounded border border-border">
                        <strong>Round {idx + 1}:</strong> {formatTitleCase(round.roundName)} <span className="text-text-muted">({formatTitleCase(round.roundType)})</span>
                        <div className="text-xs text-text-muted mt-1 flex items-center gap-3">
                          {round.passPercentage != null && <span>Pass: {round.passPercentage}%</span>}
                          <span>{round.isMandatory ? 'Mandatory' : 'Optional'}</span>
                          <span>{round.autoProgression ? 'Auto-Progress' : 'Manual-Progress'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <p className="text-sm text-text-muted">
              The job will be saved as a <strong>Draft</strong>. You can then submit it
              for approval from the jobs list.
            </p>

            {approvers.length > 0 && (
              <div className="rounded-md border border-border bg-surface p-3 text-sm text-text-secondary">
                <span className="font-medium text-text-primary">Tip:</span> After saving,
                use "Submit for approval" to send to one of{' '}
                <strong>{approvers.length} approver{approvers.length !== 1 ? 's' : ''}</strong>.
              </div>
            )}


          </div>
        )}
      </form>
      
      {showCopilot && (
        <JobCopilot 
          onClose={() => setShowCopilot(false)} 
          currentContext={form.getValues()} 
          onUpdateForm={handleCopilotUpdate} 
        />
      )}
    </Drawer>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-4">
      <span className="w-28 shrink-0 text-xs font-medium text-text-muted uppercase tracking-wider">
        {label}
      </span>
      <span className="text-sm text-text-primary">{value}</span>
    </div>
  );
}
