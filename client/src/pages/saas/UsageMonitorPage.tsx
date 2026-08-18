import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HardDrive, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '../../components/common/PageHeader.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { ExportDropdown } from '../../components/ui/ExportDropdown.js';
import * as platformApi from '../../services/platformApi.js';
import type { UsageTrendPoint } from '../../services/platformApi.js';
import { apiErrorMessage } from '../../services/api.js';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatUsd(n: number): string {
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type Tab = 'ai' | 'storage';

/** Platform-superadmin usage monitor: AI token spend + candidate storage, both
 *  platform-wide and broken down per workspace — the two inputs the pricing
 *  model needs, especially for tenants billed monthly on platform-key AI usage. */
export function UsageMonitorPage() {
  const [tab, setTab] = useState<Tab>('ai');
  const [days, setDays] = useState(30);

  return (
    <div>
      <PageHeader
        title="Usage Monitor"
        description="AI token spend and candidate storage footprint, platform-wide and per workspace."
      />

      <div className="mt-4 inline-flex rounded-lg border border-border bg-surface p-1">
        {([
          { key: 'ai', label: 'AI Token Usage' },
          { key: 'storage', label: 'Candidate Storage' },
        ] as { key: Tab; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === t.key ? 'bg-accent text-accent-fg' : 'text-text-secondary hover:text-text-primary'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ai' ? <AiUsageTab days={days} setDays={setDays} /> : <StorageTab />}
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text-primary">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-text-muted">{sub}</p>}
    </div>
  );
}

/** Daily token-usage column chart: one series (tokens), calls/cost riding along
 *  in the tooltip. Bars are capped at 20px (never fill the slot) with a hairline
 *  0/50%/100% gridline, y-axis ticks, and selective x-axis date labels — the
 *  peak day gets a direct label per the "label the extreme, not every point" rule. */
function DailyTokenChart({ trend }: { trend: UsageTrendPoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const chartHeight = 140;
  const maxTokens = Math.max(1, ...trend.map((t) => t.totalTokens));
  const peakIdx = trend.reduce((best, t, i) => (t.totalTokens > trend[best].totalTokens ? i : best), 0);
  // At most ~6 x-axis labels, evenly spaced, always including the first and last day.
  const labelStep = Math.max(1, Math.ceil(trend.length / 6));

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="mb-4 text-sm font-medium text-text-primary">Daily token usage</p>
      <div className="flex gap-3">
        <div className="flex w-10 shrink-0 flex-col justify-between text-right text-[10px] text-text-muted" style={{ height: chartHeight }}>
          <span>{formatTokens(maxTokens)}</span>
          <span>{formatTokens(Math.round(maxTokens / 2))}</span>
          <span>0</span>
        </div>
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-border" />
          <div className="pointer-events-none absolute inset-x-0 border-t border-border" style={{ top: chartHeight / 2, opacity: 0.6 }} />
          <div className="pointer-events-none absolute inset-x-0 border-t border-border" style={{ top: chartHeight }} />

          <div className="flex items-end gap-0.5" style={{ height: chartHeight }}>
            {trend.map((t, i) => {
              const barPx = Math.max(2, (t.totalTokens / maxTokens) * chartHeight);
              const isHovered = hoverIdx === i;
              return (
                <div
                  key={t.date}
                  className="group relative flex h-full flex-1 items-end justify-center outline-none"
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                  onFocus={() => setHoverIdx(i)}
                  onBlur={() => setHoverIdx(null)}
                  tabIndex={0}
                >
                  {i === peakIdx && !isHovered && (
                    <span className="absolute -top-4 whitespace-nowrap text-[10px] font-medium text-text-secondary">
                      {formatTokens(t.totalTokens)}
                    </span>
                  )}
                  <div
                    className="w-full max-w-[20px] rounded-t-[4px] transition-colors"
                    style={{
                      height: `${barPx}px`,
                      backgroundColor: isHovered ? 'var(--color-accent-hover)' : 'var(--color-accent)',
                    }}
                  />
                  {isHovered && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs shadow-elev-2">
                      <p className="font-medium text-text-primary">{formatTokens(t.totalTokens)} tokens</p>
                      <p className="text-text-muted">{shortDate(t.date)} · {t.calls} calls · {formatUsd(t.costUsd)}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex pl-[52px]">
        {trend.map((t, i) => (
          <div key={t.date} className="flex-1 text-center text-[10px] text-text-muted">
            {i === 0 || i === trend.length - 1 || i % labelStep === 0 ? shortDate(t.date) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

function AiUsageTab({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  const [exportingPdf, setExportingPdf] = useState(false);
  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['ai-usage-summary', days],
    queryFn: () => platformApi.fetchAiUsageSummary(days),
  });
  const { data: trend } = useQuery({ queryKey: ['ai-usage-trend', days], queryFn: () => platformApi.fetchAiUsageTrend(days) });
  const { data: byTenant, isLoading: loadingByTenant } = useQuery({ queryKey: ['ai-usage-by-tenant', days], queryFn: () => platformApi.fetchAiUsageByTenant(days) });
  const { data: byFeature } = useQuery({ queryKey: ['ai-usage-by-feature', days], queryFn: () => platformApi.fetchAiUsageByFeature(days) });
  const { data: byModel } = useQuery({ queryKey: ['ai-usage-by-model', days], queryFn: () => platformApi.fetchAiUsageByModel(days) });

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      await platformApi.exportAiUsagePdf(days);
      toast.success('PDF exported successfully');
    } catch (e: any) {
      toast.error(apiErrorMessage(e, 'Failed to export PDF'));
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="mt-4 space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-secondary">Range:</span>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${days === d ? 'bg-accent text-accent-fg' : 'border border-border text-text-secondary hover:text-text-primary'}`}
            >
              {d}d
            </button>
          ))}
        </div>
        <ExportDropdown variant="outline" size="sm" onExportPdf={handleExportPdf} loadingPdf={exportingPdf} />
      </div>

      {loadingSummary || !summary ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card label="Total Calls" value={String(summary.totalCalls)} sub={`${summary.successRate}% success`} />
            <Card label="Total Tokens" value={formatTokens(summary.totalTokens)} sub={`${formatTokens(summary.promptTokens)} in / ${formatTokens(summary.completionTokens)} out`} />
            <Card label="Total Cost (est.)" value={formatUsd(summary.totalCostUsd)} sub={summary.unpricedCalls ? `${summary.unpricedCalls} calls unpriced` : 'All models priced'} />
            <Card label="Billable to Tenants" value={formatUsd(summary.billableCostUsd)} sub="Platform-key usage, this range" />
          </div>

          {!!trend?.length && <DailyTokenChart trend={trend} />}

          <div className="rounded-xl border border-border bg-surface">
            <div className="border-b border-border px-4 py-3"><p className="text-sm font-medium text-text-primary">Cost by workspace</p></div>
            {loadingByTenant ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : !byTenant?.length ? (
              <EmptyState icon={<Building2 className="h-8 w-8" />} title="No AI usage recorded yet" description="Usage appears here once workspaces start using AI features." />
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Workspace</th>
                    <th className="px-4 py-2 font-medium">Key</th>
                    <th className="px-4 py-2 font-medium text-right">Calls</th>
                    <th className="px-4 py-2 font-medium text-right">Tokens</th>
                    <th className="px-4 py-2 font-medium text-right">Total Cost</th>
                    <th className="px-4 py-2 font-medium text-right">Billable</th>
                  </tr>
                </thead>
                <tbody>
                  {byTenant.map((t) => (
                    <tr key={t.tenantId} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2 text-text-primary">{t.tenantName}<span className="ml-1 text-xs text-text-muted">{t.tenantSlug}</span></td>
                      <td className="px-4 py-2">
                        {t.usesPlatformKey ? <Badge variant="warning">Platform key</Badge> : <Badge variant="info">Own key</Badge>}
                      </td>
                      <td className="px-4 py-2 text-right text-text-secondary">{t.calls}</td>
                      <td className="px-4 py-2 text-right text-text-secondary">{formatTokens(t.totalTokens)}</td>
                      <td className="px-4 py-2 text-right text-text-secondary">{formatUsd(t.totalCostUsd)}</td>
                      <td className="px-4 py-2 text-right font-medium text-text-primary">{t.billableCostUsd > 0 ? formatUsd(t.billableCostUsd) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface">
              <div className="border-b border-border px-4 py-3"><p className="text-sm font-medium text-text-primary">Cost by feature</p></div>
              <table className="w-full text-sm">
                <tbody>
                  {(byFeature ?? []).map((f) => (
                    <tr key={f.feature} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2 text-text-primary">{f.feature}</td>
                      <td className="px-4 py-2 text-right text-text-secondary">{formatTokens(f.totalTokens)}</td>
                      <td className="px-4 py-2 text-right text-text-secondary">{formatUsd(f.totalCostUsd)}</td>
                    </tr>
                  ))}
                  {!byFeature?.length && <tr><td className="px-4 py-6 text-center text-text-muted" colSpan={3}>No data yet</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="rounded-xl border border-border bg-surface">
              <div className="border-b border-border px-4 py-3"><p className="text-sm font-medium text-text-primary">Cost by provider / model</p></div>
              <table className="w-full text-sm">
                <tbody>
                  {(byModel ?? []).map((m) => (
                    <tr key={`${m.provider}::${m.model}`} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2 text-text-primary">{m.model}<span className="ml-1 text-xs text-text-muted">{m.provider}</span></td>
                      <td className="px-4 py-2 text-right text-text-secondary">{formatTokens(m.totalTokens)}</td>
                      <td className="px-4 py-2 text-right text-text-secondary">{formatUsd(m.totalCostUsd)}</td>
                      {m.failedCalls > 0 && <td className="px-4 py-2 text-right"><Badge variant="danger">{m.failedCalls} failed</Badge></td>}
                    </tr>
                  ))}
                  {!byModel?.length && <tr><td className="px-4 py-6 text-center text-text-muted" colSpan={3}>No data yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StorageTab() {
  const [exportingPdf, setExportingPdf] = useState(false);
  const { data: summary, isLoading: loadingSummary } = useQuery({ queryKey: ['storage-summary'], queryFn: platformApi.fetchStorageSummary });
  const { data: byTenant, isLoading: loadingByTenant } = useQuery({ queryKey: ['storage-by-tenant'], queryFn: platformApi.fetchStorageByTenant });

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      await platformApi.exportStorageUsagePdf();
      toast.success('PDF exported successfully');
    } catch (e: any) {
      toast.error(apiErrorMessage(e, 'Failed to export PDF'));
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="mt-4 space-y-6">
      <div className="flex justify-end">
        <ExportDropdown variant="outline" size="sm" onExportPdf={handleExportPdf} loadingPdf={exportingPdf} />
      </div>
      {loadingSummary || !summary ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card label="Total Storage" value={formatBytes(summary.totalBytes)} sub={`${summary.tenantCount} workspaces`} />
          <Card label="Resumes" value={formatBytes(summary.resumeBytes)} />
          <Card label="Proctoring Snapshots" value={formatBytes(summary.proctorShotBytes + summary.assessmentProctorShotBytes)} sub="Interviews + assessments" />
          <Card label="Attachments + Biometric" value={formatBytes(summary.attachmentBytes + summary.biometricBytes)} />
        </div>
      )}

      {!!summary?.unattributedBytes && (
        <p className="text-xs text-text-muted">
          {formatBytes(summary.unattributedBytes)} of storage belongs to no workspace (orphaned rows) and is included in the total above but not in the table below.
        </p>
      )}

      <div className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-4 py-3"><p className="text-sm font-medium text-text-primary">Storage by workspace</p></div>
        {loadingByTenant ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : !byTenant?.length ? (
          <EmptyState icon={<HardDrive className="h-8 w-8" />} title="No candidate storage yet" description="Storage appears here once workspaces start uploading resumes and running interviews." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Workspace</th>
                <th className="px-4 py-2 font-medium text-right">Candidates</th>
                <th className="px-4 py-2 font-medium text-right">Resumes</th>
                <th className="px-4 py-2 font-medium text-right">Attachments</th>
                <th className="px-4 py-2 font-medium text-right">Proctoring</th>
                <th className="px-4 py-2 font-medium text-right">Biometric</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {byTenant.map((t) => (
                <tr key={t.tenantId} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 text-text-primary">{t.tenantName}<span className="ml-1 text-xs text-text-muted">{t.tenantSlug}</span></td>
                  <td className="px-4 py-2 text-right text-text-secondary">{t.candidateCount}</td>
                  <td className="px-4 py-2 text-right text-text-secondary">{formatBytes(t.resumeBytes)}</td>
                  <td className="px-4 py-2 text-right text-text-secondary">{formatBytes(t.attachmentBytes)}</td>
                  <td className="px-4 py-2 text-right text-text-secondary">{formatBytes(t.proctorShotBytes + t.assessmentProctorShotBytes)}</td>
                  <td className="px-4 py-2 text-right text-text-secondary">{formatBytes(t.biometricBytes)}</td>
                  <td className="px-4 py-2 text-right font-medium text-text-primary">{formatBytes(t.totalBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default UsageMonitorPage;
