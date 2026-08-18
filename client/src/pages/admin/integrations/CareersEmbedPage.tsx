import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, AlertTriangle, Globe2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '../../../components/common/PageHeader.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Textarea } from '../../../components/ui/Textarea.js';
import { Spinner } from '../../../components/ui/Spinner.js';
import { CopyButton } from '../../../components/ui/CopyButton.js';
import { useAuthStore } from '../../../store/authStore.js';
import * as adminApi from '../../../services/adminApi.js';
import * as careersAdminApi from '../../../services/careersAdminApi.js';
import { fetchCareersFeatureStatus } from '../../../services/billingApi.js';
import { apiErrorMessage } from '../../../services/api.js';
import { CONFIG_KEYS } from '@agnohire/shared';

const PREVIEW_MIN_HEIGHT = 800;

type EmbedMethod = 'iframe' | 'widget' | 'api';

const METHOD_TABS: { id: EmbedMethod; label: string; enabled: boolean }[] = [
  { id: 'iframe', label: 'Website Embed', enabled: true },
  { id: 'widget', label: 'JS Widget', enabled: false },
  { id: 'api', label: 'Public API', enabled: false },
];

export function CareersEmbedPage() {
  const tenantSlug = useAuthStore((s) => s.user?.tenantSlug);
  const [method, setMethod] = useState<EmbedMethod>('iframe');
  const qc = useQueryClient();

  // Superadmin-only feature grant — defensive guard in case of direct
  // navigation to this route while the Integrations card is hidden.
  const { data: careersFeature, isLoading: featureLoading } = useQuery({ queryKey: ['tenant-features'], queryFn: fetchCareersFeatureStatus });

  const { data: config, isLoading: configLoading } = useQuery({ queryKey: ['system-config'], queryFn: adminApi.fetchConfig });
  const showHeaderItem = config?.find((c) => c.key === CONFIG_KEYS.CAREERS_SHOW_HEADER);
  const showHeader = (showHeaderItem?.value ?? 'true') === 'true';
  const careersEnabledItem = config?.find((c) => c.key === CONFIG_KEYS.CAREERS_ENABLED);
  const careersEnabled = (careersEnabledItem?.value ?? 'true') === 'true';

  const toggleHeaderSetting = useMutation({
    mutationFn: (value: boolean) => adminApi.updateConfig(CONFIG_KEYS.CAREERS_SHOW_HEADER, value ? 'true' : 'false'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['system-config'] }),
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update setting')),
  });
  const toggleCareersEnabled = useMutation({
    mutationFn: (value: boolean) => adminApi.updateConfig(CONFIG_KEYS.CAREERS_ENABLED, value ? 'true' : 'false'),
    onSuccess: () => { toast.success(careersEnabled ? 'Careers page deactivated' : 'Careers page activated'); qc.invalidateQueries({ queryKey: ['system-config'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update setting')),
  });

  const { data: careersJobs, isLoading: jobsLoading } = useQuery({ queryKey: ['careers-admin-jobs'], queryFn: careersAdminApi.fetchCareersJobs });
  const toggleJobSalary = useMutation({
    mutationFn: ({ jobId, value }: { jobId: string; value: boolean }) => careersAdminApi.updateJobSalaryVisibility(jobId, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['careers-admin-jobs'] }),
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update salary visibility')),
  });

  const careersUrl = tenantSlug ? `${window.location.origin}/careers/${tenantSlug}` : '';
  const iframeSnippet = `<iframe
  src="${careersUrl}"
  title="Careers"
  style="width:100%; min-height:${PREVIEW_MIN_HEIGHT}px; border:0;"
  loading="lazy">
</iframe>`;

  if (featureLoading) {
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }

  if (!careersFeature?.careersPageEnabled) {
    return (
      <div>
        <Link to="../integrations" className="mb-4 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to Integrations
        </Link>
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <Globe2 className="mx-auto mb-3 h-8 w-8 text-text-muted" />
          <p className="font-heading text-base font-semibold text-text-primary">Careers Page isn't available yet</p>
          <p className="mt-1 text-sm text-text-secondary">This feature is enabled per workspace by AgnoHire. Reach out to request access.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="../integrations" className="mb-4 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" /> Back to Integrations
      </Link>
      <PageHeader
        title="Careers Page"
        description="Publish your open jobs on your own website — no code beyond a single embed snippet."
      />

      {!configLoading && !careersEnabled && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
          <div className="flex items-center gap-2 text-sm text-text-primary">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            Your careers page is deactivated — the hosted page and any embedded iframe on your website are currently down.
          </div>
          <Button size="sm" variant="outline" disabled={toggleCareersEnabled.isPending} onClick={() => toggleCareersEnabled.mutate(true)}>
            Activate
          </Button>
        </div>
      )}

      {!tenantSlug ? (
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-text-secondary">
          Could not determine your workspace slug. Please reload the page.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-surface p-5 shadow-elev-1">
            <h3 className="mb-1 font-heading text-base font-semibold text-text-primary">Display settings</h3>
            <p className="mb-4 text-xs text-text-muted">Control what candidates see on your public careers page. Changes apply immediately.</p>
            {configLoading ? (
              <Spinner size="sm" />
            ) : (
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-border accent-accent"
                  checked={showHeader}
                  disabled={toggleHeaderSetting.isPending}
                  onChange={(e) => toggleHeaderSetting.mutate(e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium text-text-primary">Show header section</span>
                  <span className="block text-xs text-text-muted">Displays your company name as a banner at the top of the careers page. Turn off if your own site already has a header above the embed.</span>
                </span>
              </label>
            )}
          </div>

          <div className="rounded-xl border border-border bg-surface p-5 shadow-elev-1">
            <h3 className="mb-1 font-heading text-base font-semibold text-text-primary">Salary visibility per job</h3>
            <p className="mb-4 text-xs text-text-muted">Choose which of your open jobs show their budget range publicly — off by default since compensation is sensitive. Checked jobs display salary on both the public list and detail page.</p>
            {jobsLoading ? (
              <Spinner size="sm" />
            ) : !careersJobs?.length ? (
              <p className="text-sm text-text-muted">No open jobs to configure yet.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {careersJobs.map((job) => (
                  <label key={job.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text-primary">{job.title}</span>
                      {job.showSalaryPublicly && (job.budgetMin != null || job.budgetMax != null) && (
                        <span className="block text-xs text-text-muted">
                          {job.budgetMin != null && job.budgetMax != null
                            ? `${job.budgetMin.toLocaleString()} – ${job.budgetMax.toLocaleString()}`
                            : `${(job.budgetMin ?? job.budgetMax)!.toLocaleString()}`}
                        </span>
                      )}
                    </div>
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-border accent-accent"
                      checked={job.showSalaryPublicly}
                      disabled={toggleJobSalary.isPending}
                      onChange={(e) => toggleJobSalary.mutate({ jobId: job.id, value: e.target.checked })}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 border-b border-border/60">
            {METHOD_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                disabled={!tab.enabled}
                onClick={() => tab.enabled && setMethod(tab.id)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  method === tab.id
                    ? 'border-accent text-text-primary'
                    : 'border-transparent text-text-muted hover:text-text-secondary'
                } ${!tab.enabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                {tab.label}
                {!tab.enabled && <span className="ml-1.5 text-xs">(Coming soon)</span>}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-surface p-5 shadow-elev-1">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-alt">
                <Globe2 className="h-5 w-5 text-accent" />
              </div>
              <div>
                <h3 className="font-heading text-base font-semibold text-text-primary">Your public careers URL</h3>
                <p className="text-xs text-text-muted">Share this link directly, or use the embed snippet below to add it to your own site.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Input readOnly value={careersUrl} />
              <CopyButton value={careersUrl} label="Careers URL copied" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5 shadow-elev-1">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-heading text-base font-semibold text-text-primary">Embed on your website</h3>
                <p className="text-xs text-text-muted">Paste this snippet anywhere in your site's HTML.</p>
              </div>
              <CopyButton value={iframeSnippet} label="Embed snippet copied" />
            </div>
            <Textarea readOnly rows={7} className="font-mono text-xs" value={iframeSnippet} />
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-text-muted">
              <li>Recommended size: 100% width, at least {PREVIEW_MIN_HEIGHT}px height.</li>
              <li>The page is fully responsive and adjusts to whatever width its container gives it.</li>
              <li>This is the website embed for candidates browsing your own site — separate from social (Instagram/Facebook) posting.</li>
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5 shadow-elev-1">
            <h3 className="mb-3 font-heading text-base font-semibold text-text-primary">Live preview</h3>
            <div className="overflow-hidden rounded-lg border border-border">
              <iframe
                src={careersUrl}
                title="Careers page preview"
                style={{ width: '100%', minHeight: PREVIEW_MIN_HEIGHT, border: 0 }}
                loading="lazy"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
