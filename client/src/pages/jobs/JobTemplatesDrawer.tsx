import { useState } from 'react';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, ChevronLeft, Layers } from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { TagInput } from '../../components/ui/TagInput.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import * as jobApi from '../../services/jobApi.js';
import * as refApi from '../../services/referenceApi.js';
import { createJobTemplateSchema } from '@agnohire/shared';
import type { CreateJobTemplateInput, JobTemplate } from '@agnohire/shared';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS } from '@agnohire/shared';
import { apiErrorMessage } from '../../services/api.js';

// Use the schema INPUT type so zodResolver generics align (skills has a default).
type FormValues = z.input<typeof createJobTemplateSchema>;

interface JobTemplatesDrawerProps {
  open: boolean;
  onClose: () => void;
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-sm font-medium text-text-primary">
        {label}
        {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

// ─── Template list item ───────────────────────────────────────────────────────

function TemplateCard({
  template,
  onEdit,
  onDelete,
  canEdit,
  canDelete,
}: {
  template: JobTemplate;
  onEdit: (t: JobTemplate) => void;
  onDelete: (t: JobTemplate) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-2 hover:border-accent/40 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-text-primary truncate">{template.name}</p>
          {template.domainId && (
            <p className="text-xs text-text-muted mt-0.5">Domain linked</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(template)}
              aria-label="Edit template"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(template)}
              aria-label="Delete template"
              className="text-danger hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {template.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {template.skills.slice(0, 5).map((s) => (
            <Badge key={s} variant="outline" className="text-xs">
              {s}
            </Badge>
          ))}
          {template.skills.length > 5 && (
            <Badge variant="muted" className="text-xs">
              +{template.skills.length - 5}
            </Badge>
          )}
        </div>
      )}

      {(template.experienceMin != null || template.experienceMax != null) && (
        <p className="text-xs text-text-muted">
          Exp: {template.experienceMin ?? 0}–{template.experienceMax ?? '∞'} yrs
          {template.workMode && ` · ${template.workMode}`}
        </p>
      )}
    </div>
  );
}

// ─── Template form ────────────────────────────────────────────────────────────

function TemplateForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial?: JobTemplate;
  onSave: (data: FormValues) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const { data: sectorsData } = useQuery({
    queryKey: ['sectors'],
    queryFn: () => refApi.fetchSectors(),
    staleTime: 60_000,
  });

  const { data: domainsData } = useQuery({
    queryKey: ['domains'],
    queryFn: () => refApi.fetchDomains(),
    staleTime: 60_000,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(createJobTemplateSchema),
    defaultValues: {
      name: initial?.name ?? '',
      sectorId: initial?.sectorId ?? undefined,
      domainId: initial?.domainId ?? undefined,
      description: initial?.description ?? '',
      skills: initial?.skills ?? [],
      experienceMin: initial?.experienceMin ?? undefined,
      experienceMax: initial?.experienceMax ?? undefined,
      workMode: initial?.workMode ?? undefined,
    },
  });

  const { control, handleSubmit, formState: { errors }, watch } = form;
  const sectors = sectorsData?.sectors ?? [];
  const allDomains = domainsData?.domains ?? [];
  
  const selectedSectorId = watch('sectorId');
  const domains = selectedSectorId 
    ? allDomains.filter(d => d.sectorId === selectedSectorId)
    : allDomains;

  return (
    <form onSubmit={handleSubmit(onSave)} className="space-y-4">
      <Field label="Template Name" required error={errors.name?.message}>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <Input {...field} placeholder="e.g. Senior Software Engineer" />
          )}
        />
      </Field>

      <Field label="Sector" required error={errors.sectorId?.message}>
        <Controller
          control={control}
          name="sectorId"
          render={({ field }) => (
            <Select
              {...field}
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value || undefined)}
              options={sectors.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Select sector"
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
              {...field}
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value || undefined)}
              options={domains.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="No specific domain"
            />
          )}
        />
      </Field>

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
              onChange={(e) => field.onChange(e.target.value || undefined)}
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

      <div className="grid grid-cols-2 gap-4">
        <Field label="Min Experience (yrs)" error={errors.experienceMin?.message}>
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
                  field.onChange(e.target.value === '' ? undefined : Number(e.target.value))
                }
              />
            )}
          />
        </Field>
        <Field label="Max Experience (yrs)" error={errors.experienceMax?.message}>
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
                  field.onChange(e.target.value === '' ? undefined : Number(e.target.value))
                }
              />
            )}
          />
        </Field>
      </div>

      <Field label="Skills" error={errors.skills?.message}>
        <Controller
          control={control}
          name="skills"
          render={({ field }) => (
            <TagInput
              value={field.value ?? []}
              onChange={field.onChange}
              placeholder="Add skills (press Enter or comma)"
            />
          )}
        />
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button size="sm" loading={isSaving} type="submit">
          {initial ? 'Save changes' : 'Create template'}
        </Button>
      </div>
    </form>
  );
}

// ─── Confirm delete ───────────────────────────────────────────────────────────

function DeleteConfirm({
  template,
  onConfirm,
  onCancel,
  loading,
}: {
  template: JobTemplate;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 space-y-3">
      <p className="text-sm text-text-secondary">
        Delete template <strong>"{template.name}"</strong>? Jobs using this template will not be affected.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button variant="danger" size="sm" loading={loading} onClick={onConfirm} type="button">
          Delete
        </Button>
      </div>
    </div>
  );
}

// ─── Main drawer ──────────────────────────────────────────────────────────────

type ViewState =
  | { mode: 'list' }
  | { mode: 'create' }
  | { mode: 'edit'; template: JobTemplate }
  | { mode: 'delete'; template: JobTemplate };

export function JobTemplatesDrawer({ open, onClose }: JobTemplatesDrawerProps) {
  const qc = useQueryClient();
  const { hasPermission } = useAuthStore();
  const [view, setView] = useState<ViewState>({ mode: 'list' });
  const [page, setPage] = useState(1);

  const canCreate = hasPermission(PERMISSIONS.JOB_CREATE);
  const canEdit = hasPermission(PERMISSIONS.JOB_EDIT);
  const canDelete = hasPermission(PERMISSIONS.JOB_DELETE);

  const { data, isLoading } = useQuery({
    queryKey: ['job-templates', page],
    queryFn: () => jobApi.fetchTemplates({ page, limit: 25 }),
    enabled: open,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (d: CreateJobTemplateInput) => jobApi.createTemplate(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job-templates'] });
      toast.success('Template created');
      setView({ mode: 'list' });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreateJobTemplateInput }) =>
      jobApi.updateTemplate(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job-templates'] });
      toast.success('Template updated');
      setView({ mode: 'list' });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => jobApi.deleteTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job-templates'] });
      toast.success('Template deleted');
      setView({ mode: 'list' });
    },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  const templates = data?.items ?? [];
  const meta = data?.meta;

  const title =
    view.mode === 'create'
      ? 'New Template'
      : view.mode === 'edit'
        ? 'Edit Template'
        : 'Job Templates';

  return (
    <Drawer open={open} onClose={onClose} title={title} size="md">
      {/* Back button when not in list view */}
      {view.mode !== 'list' && (
        <button
          className="mb-4 flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
          onClick={() => setView({ mode: 'list' })}
          type="button"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to templates
        </button>
      )}

      {/* List view */}
      {view.mode === 'list' && (
        <div className="space-y-4">
          {canCreate && (
            <Button
              size="sm"
              onClick={() => setView({ mode: 'create' })}
              className="w-full"
            >
              <Plus className="h-4 w-4" />
              New Template
            </Button>
          )}

          {isLoading && (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          )}

          {!isLoading && templates.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Layers className="h-10 w-10 text-text-muted opacity-40" />
              <p className="text-sm text-text-muted">No templates yet.</p>
              {canCreate && (
                <p className="text-xs text-text-muted">
                  Create a template to speed up job creation.
                </p>
              )}
            </div>
          )}

          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              canEdit={canEdit}
              canDelete={canDelete}
              onEdit={(tmpl) => setView({ mode: 'edit', template: tmpl })}
              onDelete={(tmpl) => setView({ mode: 'delete', template: tmpl })}
            />
          ))}

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-sm text-text-muted">
              <span>
                {(meta.page - 1) * meta.pageSize + 1}–
                {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === meta.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create view */}
      {view.mode === 'create' && (
        <TemplateForm
          onSave={(d) => createMutation.mutate({ ...d, skills: d.skills ?? [], workflowRounds: d.workflowRounds ?? [] })}
          onCancel={() => setView({ mode: 'list' })}
          isSaving={createMutation.isPending}
        />
      )}

      {/* Edit view */}
      {view.mode === 'edit' && (
        <TemplateForm
          initial={view.template}
          onSave={(d) => updateMutation.mutate({ id: view.template.id, data: { ...d, skills: d.skills ?? [], workflowRounds: d.workflowRounds ?? [] } })}
          onCancel={() => setView({ mode: 'list' })}
          isSaving={updateMutation.isPending}
        />
      )}

      {/* Delete confirmation */}
      {view.mode === 'delete' && (
        <DeleteConfirm
          template={view.template}
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(view.template.id)}
          onCancel={() => setView({ mode: 'list' })}
        />
      )}
    </Drawer>
  );
}
