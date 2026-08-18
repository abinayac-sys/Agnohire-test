import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { apiErrorMessage } from '../../services/api.js';
import {
  Briefcase, Users, FileText, Video, ClipboardCheck, Award, TrendingUp, Clock,
  Download, Sparkles, Camera, Trash2, RefreshCw, Eye,
} from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer.js';
import { PageHeader } from '../../components/common/PageHeader.js';
import { Button } from '../../components/ui/Button.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { cn } from '../../utils/cn.js';
import type {
  AnalyticsFilters, AnalyticsSnapshotItem, FunnelStage, KpiSummary, JobMetric, AnalyticsInsights,
} from '@agnohire/shared';
import * as analyticsApi from '../../services/analyticsApi.js';
import { useConfirm } from '../../providers/ConfirmProvider.js';
import {
  ActivityAreaChart,
  DonutChart,
  HBarChart,
} from '../../components/dashboard/DashboardCharts.js';
import {
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Cell,
} from 'recharts';
import { formatTitleCase } from '@agnohire/shared';

const RANGE_OPTIONS = [
  { value: '0', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
  { value: 'custom', label: 'Custom' },
];
const GRANULARITY_OPTIONS = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

/** Auto-refresh interval options, in milliseconds. '0' means off. */
const AUTO_REFRESH_OPTIONS = [
  { value: '0', label: 'Auto-refresh: Off' },
  { value: String(30_000), label: 'Every 30s' },
  { value: String(60_000), label: 'Every 1 min' },
  { value: String(2 * 60_000), label: 'Every 2 min' },
  { value: String(5 * 60_000), label: 'Every 5 min' },
  { value: String(10 * 60_000), label: 'Every 10 min' },
  { value: String(30 * 60_000), label: 'Every 30 min' },
];


function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function AnalyticsPage() {
  const qc = useQueryClient();
  const [days, setDays] = useState('30');
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const report = 'overview';
  const [customRange, setCustomRange] = useState({
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });

  const filters: Partial<AnalyticsFilters> = useMemo(
    () => {
      if (days === 'custom') {
        return {
          from: customRange.from,
          to: customRange.to,
          granularity
        };
      }
      return { from: isoDaysAgo(Number(days)), to: new Date().toISOString().slice(0, 10), granularity };
    },
    [days, granularity, customRange],
  );

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['analytics-dashboard', days, granularity],
    queryFn: () => analyticsApi.fetchDashboard(filters),
  });

  const insightsQuery = useQuery({
    queryKey: ['analytics-insights', days, granularity],
    queryFn: () => analyticsApi.fetchInsights(filters),
  });

  // Refresh both the KPI/chart dashboard and the AI insights together so a
  // manual click or an auto-refresh tick always reflects the latest data.
  const refreshAll = useCallback(() => {
    refetch();
    insightsQuery.refetch();
  }, [refetch, insightsQuery.refetch]);

  // Auto-refresh: re-triggers the same Refresh button action on a
  // timer, not a page reload. '0' (Off) clears any running interval.
  const [autoRefreshMs, setAutoRefreshMs] = useState('0');
  useEffect(() => {
    const ms = Number(autoRefreshMs);
    if (!ms) return;
    const id = setInterval(() => refreshAll(), ms);
    return () => clearInterval(id);
  }, [autoRefreshMs, refreshAll]);

  const snapshot = useMutation({
    mutationFn: () => analyticsApi.saveSnapshot(filters),
    onSuccess: () => { toast.success('Snapshot saved'); qc.invalidateQueries({ queryKey: ['analytics-snapshots'] }); },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });

  async function handleExport() {
    try {
      await analyticsApi.downloadReport({ ...filters, report: report as never });
      toast.success('Report downloaded');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const d = data?.dashboard;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics & Reporting"
        description="Recruitment KPIs, funnel conversion, and trend reporting"
        actions={
          <div className="flex items-center gap-2">
            <Select
              className="w-44"
              options={AUTO_REFRESH_OPTIONS}
              value={autoRefreshMs}
              onChange={(e) => setAutoRefreshMs(e.target.value)}
              aria-label="Auto-refresh interval"
              title="Automatically click Refresh on an interval"
            />
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={isFetching || insightsQuery.isFetching}>
              <RefreshCw className={cn('h-4 w-4 mr-1.5', (isFetching || insightsQuery.isFetching) && 'animate-spin')} /> Refresh
            </Button>
          </div>
        }
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3">
        <Select className="w-40" options={RANGE_OPTIONS} value={days} onChange={(e) => setDays(e.target.value)} />
        {days === 'custom' && (
          <div className="flex items-center gap-2">
            <input 
              type="date" 
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              value={customRange.from}
              onChange={e => setCustomRange(prev => ({ ...prev, from: e.target.value }))}
            />
            <span className="text-text-muted text-sm">to</span>
            <input 
              type="date" 
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              value={customRange.to}
              onChange={e => setCustomRange(prev => ({ ...prev, to: e.target.value }))}
            />
          </div>
        )}
        <Select className="w-32" options={GRANULARITY_OPTIONS} value={granularity} onChange={(e) => setGranularity(e.target.value as never)} />
        {(days !== '30' || granularity !== 'day') && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setDays('30');
              setGranularity('day');
            }}
          >
            Clear filters
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleExport}><Download className="h-4 w-4" /> Export CSV</Button>
          <Button variant="outline" size="sm" onClick={() => snapshot.mutate()} loading={snapshot.isPending}><Camera className="h-4 w-4" /> Snapshot</Button>
        </div>
      </div>

      {isLoading || !d ? (
        <div className="py-20 text-center"><Spinner className="mx-auto" /></div>
      ) : (
        <>
          <KpiGrid kpis={d.kpis} />
          <InsightsCard insights={insightsQuery.data?.insights} isLoading={insightsQuery.isLoading} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Applications, interviews & hires" subtitle={`${d.range.from} → ${d.range.to}`}>
              <ActivityAreaChart data={d.timeSeries} />
            </Card>
            <Card title="Recruitment funnel" subtitle="Cumulative stage conversion">
              <Funnel stages={d.funnel} />
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Card title="Jobs by status"><DonutChart data={d.jobsByStatus} height={160} /></Card>
            <Card title="Applications by status"><DonutChart data={d.applicationsByStatus} height={160} /></Card>
            <Card title="Candidates by source"><VerticalColChart data={d.candidatesBySource} height={160} /></Card>
            <Card title="Interviews by status"><HBarChart data={d.interviewsByStatus} height={160} /></Card>
          </div>
          <Card title="Top domains" subtitle="By job requisitions in range"><HBarChart data={d.topDomains} height={200} /></Card>
          
          <Card title="Job Performance Metrics" subtitle="Recruitment metrics per Job Requisition">
            <JobMetricsTable metrics={d.jobMetrics} />
          </Card>

          <SnapshotList />
        </>
      )}
    </div>
  );
}

// ─── KPI CARDS ──────────────────────────────────────────────────────────────

function KpiGrid({ kpis }: { kpis: KpiSummary }) {
  const cards = [
    { label: 'Open jobs', value: kpis.openJobs, sub: `${kpis.totalJobs} total`, icon: Briefcase, trend: '+4%', trendUp: true },
    { label: 'Candidates', value: kpis.totalCandidates, sub: 'in range', icon: Users, trend: '+12%', trendUp: true },
    { label: 'Applications', value: kpis.totalApplications, sub: 'in range', icon: FileText, trend: '+8%', trendUp: true },
    { label: 'Interviews', value: kpis.interviewsTotal, sub: `${kpis.interviewsCompleted} completed`, icon: Video, trend: '+15%', trendUp: true },
    { label: 'Schedule', value: kpis.assessmentsAssigned, sub: `${kpis.assessmentsPassed} passed`, icon: ClipboardCheck, trend: kpis.assessmentsAssigned > 0 ? `${Math.round((kpis.assessmentsPassed / kpis.assessmentsAssigned) * 100)}% pass` : '0% pass', trendUp: true },
    { label: 'Hires', value: kpis.hires, sub: `${kpis.offersExtended} offers`, icon: Award, trend: '+2 new', trendUp: true },
    { label: 'Offer acceptance', value: kpis.offerAcceptanceRate != null ? `${kpis.offerAcceptanceRate}%` : '—', sub: 'accepted / extended', icon: TrendingUp, trend: 'Strong', trendUp: true },
    { label: 'Time to hire', value: kpis.avgTimeToHireDays != null ? `${kpis.avgTimeToHireDays}d` : '—', sub: 'avg, applied → hired', icon: Clock, trend: '-3 days', trendUp: false },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.label} className="group relative rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-accent/45 hover:shadow-md overflow-hidden">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{c.label}</span>
                <p className="text-3xl font-extrabold text-text-primary tracking-tight" style={{ fontFamily: 'var(--app-font-family)' }}>
                  {c.value}
                </p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent group-hover:bg-accent group-hover:text-white transition-all duration-300">
                <Icon className="h-4.5 w-4.5" />
              </span>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[11px] text-text-muted font-medium">{c.sub}</span>
              <span className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                c.trendUp ? "bg-emerald-500/10 text-emerald-600" : "bg-blue-500/10 text-blue-600"
              )}>
                {c.trend}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── AI INSIGHTS ────────────────────────────────────────────────────────────

function InsightsCard({ insights, isLoading }: { insights: AnalyticsInsights | undefined; isLoading: boolean }) {
  return (
    <div className="relative rounded-2xl border border-border bg-surface p-5 shadow-sm overflow-hidden">
      <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-accent animate-pulse" />
        <h3 className="font-semibold text-text-primary text-sm">AI Insights &amp; Recommendations</h3>
        {insights && !insights.generated && <Badge variant="muted">AI key not configured</Badge>}
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-3">
          {insights?.summary && <p className="text-sm leading-relaxed text-text-secondary font-medium">{insights.summary}</p>}
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(insights?.highlights ?? []).map((h, i) => (
              <li key={i} className="flex items-center gap-2.5 text-xs text-text-secondary bg-surface-raised p-2.5 rounded-xl border border-border/30 hover:border-accent/20 transition-all">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent font-bold text-[9px]">{i + 1}</span>
                <span className="leading-normal">{h}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── CHART PRIMITIVES ───────────────────────────────────────────────────────

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="font-semibold text-text-primary text-sm tracking-tight">{title}</h3>
        {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Funnel({ stages }: { stages: FunnelStage[] }) {
  if (!stages || stages.length === 0 || stages.every((s) => s.count === 0)) return <EmptyChart />;

  // Exact colors matching "Applications by status" donut (CHART_COLORS[0..2])
  const COLORS = ['#6366f1', '#0ea5e9', '#059669', '#6366f1', '#0ea5e9', '#059669'];

  const ROW_H = 34;      // height of each trapezoid segment
  const GAP = 8;         // gap between segments
  const SLOT = ROW_H + GAP;
  const totalH = stages.length * SLOT - GAP;
  const viewH = totalH + 10;
  const centerX = 270;

  return (
    <div className="flex justify-center items-center py-2 w-full" style={{ height: `${viewH + 20}px` }}>
      <svg viewBox={`0 0 480 ${viewH}`} className="w-full h-full">
        <defs>
          <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#0f172a" floodOpacity="0.08" />
          </filter>
        </defs>

        {stages.map((stage, i) => {
          const yStart = i * SLOT;
          const yEnd = yStart + ROW_H;
          const yMid = yStart + ROW_H / 2;

          // Symmetric inverted trapezoid coordinates centered at centerX=270
          const wTop = 260 - i * 36;
          const wBottom = i === stages.length - 1 ? 80 : 260 - (i + 1) * 36;

          const xLeftTop = centerX - wTop / 2;
          const xLeftBottom = centerX - wBottom / 2;
          const xRightTop = centerX + wTop / 2;
          const xRightBottom = centerX + wBottom / 2;

          const points = `${xLeftTop},${yStart} ${xRightTop},${yStart} ${xRightBottom},${yEnd} ${xLeftBottom},${yEnd}`;

          return (
            <g key={stage.stage} className="group">
              {/* Funnel segment shape */}
              <polygon
                points={points}
                fill={COLORS[i % 3]}
                filter="url(#shadow)"
                className="opacity-95 hover:opacity-100 transition-all duration-200 cursor-pointer"
              />

              {/* Stage label — left-aligned properly in a single line */}
              <text
                x={45}
                y={yMid + 4}
                textAnchor="start"
                className="fill-text-secondary font-bold pointer-events-none"
                style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}
              >
                {formatTitleCase(stage.stage)}
              </text>

              {/* Only count appears in the inside color row */}
              <text
                x={centerX}
                y={yMid + 4}
                textAnchor="middle"
                className="fill-white pointer-events-none"
                style={{ fontSize: 12, fontWeight: 800 }}
              >
                {stage.count}
              </text>

              {/* Conversion label on the right side connected with dotted line */}
              {stage.fromPrev != null && stage.fromPrev > 0 && (
                <g>
                  <line
                    x1={xRightTop - 10}
                    y1={yMid}
                    x2={425}
                    y2={yMid}
                    stroke="#e2e8f0"
                    strokeDasharray="2 2"
                    className="opacity-75 group-hover:opacity-100 transition-all duration-200"
                  />
                  <text
                    x={430}
                    y={yMid + 3}
                    className="fill-text-secondary text-[10px] font-semibold"
                    textAnchor="start"
                  >
                    {Math.round(stage.fromPrev)}%
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function EmptyChart({ compact }: { compact?: boolean }) {
  return (
    <div className={cn('flex items-center justify-center text-sm text-text-muted', compact ? 'py-6' : 'py-12')}>
      No data in this range
    </div>
  );
}

function JobMetricsTable({ metrics }: { metrics?: JobMetric[] }) {
  if (!metrics || metrics.length === 0) return <EmptyChart />;

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const totalPages = Math.ceil(metrics.length / itemsPerPage);

  const paginatedMetrics = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return metrics.slice(startIndex, startIndex + itemsPerPage);
  }, [metrics, currentPage]);

  if (currentPage > totalPages && totalPages > 0) {
    setCurrentPage(1);
  }

  const startIdx = (currentPage - 1) * itemsPerPage + 1;
  const endIdx = Math.min(currentPage * itemsPerPage, metrics.length);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="bg-surface-raised text-text-muted text-xs uppercase tracking-wider border-b border-border">
            <tr>
              <th className="px-5 py-4 font-bold text-left">Job Title</th>
              <th className="px-5 py-4 font-bold text-center">Applications</th>
              <th className="px-5 py-4 font-bold text-center">Interviews</th>
              <th className="px-5 py-4 font-bold text-center">Int. Passed</th>
              <th className="px-5 py-4 font-bold text-center">Int. Failed</th>
              <th className="px-5 py-4 font-bold text-center">Schedules</th>
              <th className="px-5 py-4 font-bold text-center">Sched. Passed</th>
              <th className="px-5 py-4 font-bold text-center">Sched. Failed</th>
              <th className="px-5 py-4 font-bold text-center">Offers</th>
              <th className="px-5 py-4 font-bold text-center">Hired</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginatedMetrics.map((m) => (
              <tr key={m.jobTitle} className="hover:bg-surface-raised/40 transition-colors">
                <td className="px-5 py-4 font-semibold text-text-primary flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-text-muted shrink-0" />
                  {m.jobTitle}
                </td>
                <td className="px-5 py-4 text-center">
                  <span className="inline-flex min-w-[32px] items-center justify-center rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    {m.totalApplications}
                  </span>
                </td>
                <td className="px-5 py-4 text-center">
                  <span className="inline-flex min-w-[32px] items-center justify-center rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    {m.interviewsScheduled}
                  </span>
                </td>
                <td className="px-5 py-4 text-center">
                  <span className="inline-flex min-w-[32px] items-center justify-center rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 border border-emerald-100">
                    {m.interviewsPassed}
                  </span>
                </td>
                <td className="px-5 py-4 text-center">
                  <span className="inline-flex min-w-[32px] items-center justify-center rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 border border-rose-100">
                    {m.interviewsFailed}
                  </span>
                </td>
                <td className="px-5 py-4 text-center">
                  <span className="inline-flex min-w-[32px] items-center justify-center rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    {m.schedulesScheduled}
                  </span>
                </td>
                <td className="px-5 py-4 text-center">
                  <span className="inline-flex min-w-[32px] items-center justify-center rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 border border-emerald-100">
                    {m.schedulesPassed}
                  </span>
                </td>
                <td className="px-5 py-4 text-center">
                  <span className="inline-flex min-w-[32px] items-center justify-center rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 border border-rose-100">
                    {m.schedulesFailed}
                  </span>
                </td>
                <td className="px-5 py-4 text-center">
                  <span className="inline-flex min-w-[32px] items-center justify-center rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    {m.offersSent}
                  </span>
                </td>
                <td className="px-5 py-4 text-center">
                  <span className="inline-flex min-w-[32px] items-center justify-center rounded-full bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent border border-accent/20">
                    {m.joined}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {metrics.length > itemsPerPage && (
        <div className="flex items-center justify-between border-t border-border bg-surface-raised px-5 py-3 text-xs">
          <div className="text-text-muted">
            Showing <span className="font-semibold text-text-primary">{startIdx}</span> to{' '}
            <span className="font-semibold text-text-primary">{endIdx}</span> of{' '}
            <span className="font-semibold text-text-primary">{metrics.length}</span> jobs
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <Button
                key={page}
                variant={currentPage === page ? 'primary' : 'outline'}
                size="sm"
                className="w-7 h-7 flex items-center justify-center p-0"
                onClick={() => setCurrentPage(page)}
              >
                {page}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SNAPSHOTS ──────────────────────────────────────────────────────────────

function SnapshotList() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [viewing, setViewing] = useState<AnalyticsSnapshotItem | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['analytics-snapshots'],
    queryFn: () => analyticsApi.fetchSnapshots({ limit: 10 }),
  });
  const del = useMutation({
    mutationFn: (id: string) => analyticsApi.deleteSnapshot(id),
    onSuccess: () => { toast.success('Snapshot deleted'); qc.invalidateQueries({ queryKey: ['analytics-snapshots'] }); },
    onError: (e: Error) => toast.error(apiErrorMessage(e)),
  });
  const items = data?.items ?? [];
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function handleDownload(s: AnalyticsSnapshotItem) {
    setDownloadingId(s.id);
    try {
      await analyticsApi.downloadSnapshotPdf(s.id, s.period);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to download snapshot');
    } finally {
      setDownloadingId(null);
    }
  }

  if (isLoading) return null;
  if (items.length === 0) {
    return (
      <Card title="Saved snapshots">
        <EmptyState icon={<Camera className="h-7 w-7" />} title="No snapshots" description="Capture a snapshot to archive the current metrics for later comparison." />
      </Card>
    );
  }
  return (
    <Card title="Saved snapshots" subtitle="Archived metric captures">
      <div className="grid grid-cols-1 gap-4">
        {items.map((s) => (
          <div key={s.id} className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface hover:border-accent/30 hover:shadow-sm transition-all duration-200">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/5 text-accent border border-accent/10">
                <Camera className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-text-primary text-sm truncate">{s.period}</p>
                <div className="flex items-center gap-1.5 text-xs text-text-muted mt-0.5">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{format(new Date(s.snapshotAt), 'dd MMM yyyy, HH:mm')}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3 shrink-0 ml-3">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-text-secondary border border-border/60">
                {s.data.kpis.totalApplications} apps · {s.data.kpis.hires} hires
              </span>
              <div className="flex items-center border border-border/80 rounded-lg overflow-hidden bg-surface">
                <button 
                  type="button" 
                  className="flex h-8 w-8 items-center justify-center text-text-muted hover:text-accent hover:bg-accent/5 border-r border-border/80 transition-colors"
                  onClick={() => setViewing(s)}
                >
                  <Eye className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={downloadingId === s.id}
                  className="flex h-8 w-8 items-center justify-center text-text-muted hover:text-accent hover:bg-accent/5 border-r border-border/80 transition-colors disabled:opacity-50"
                  onClick={() => handleDownload(s)}
                  title="Download snapshot as PDF"
                >
                  {downloadingId === s.id ? (
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center text-text-muted hover:text-danger hover:bg-danger/5 transition-colors"
                  onClick={async () => { 
                    if (await confirm({ title: 'Delete Snapshot', message: 'Delete this snapshot?', confirmText: 'Delete', variant: 'danger' })) {
                      del.mutate(s.id); 
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <Drawer
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `Snapshot · ${viewing.period}` : 'Snapshot'}
        size="lg"
      >
        {viewing && (
          <div className="space-y-5">
            <p className="text-xs text-text-muted">
              Captured {format(new Date(viewing.snapshotAt), 'dd MMM yyyy, HH:mm')} · range{' '}
              {viewing.data.range.from} → {viewing.data.range.to}
            </p>
            <KpiGrid kpis={viewing.data.kpis} />
            <Card title="Jobs by status"><DonutChart data={viewing.data.jobsByStatus} height={160} /></Card>
            <Card title="Applications by status"><DonutChart data={viewing.data.applicationsByStatus} height={160} /></Card>
            <Card title="Candidates by source"><VerticalColChart data={viewing.data.candidatesBySource} height={160} /></Card>
            <Card title="Interviews by status"><HBarChart data={viewing.data.interviewsByStatus} height={160} /></Card>
          </div>
        )}
      </Drawer>
    </Card>
  );
}

function VerticalColChart({ data, height = 180 }: { data: { label: string; count: number }[]; height?: number }) {
  if (!data || data.length === 0) return <div className="text-xs text-text-muted py-8 text-center">No data</div>;
  const colors = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e8f3" vertical={false} />
        <XAxis dataKey="label" tickFormatter={(v) => formatTitleCase(String(v))} tick={{ fontSize: 10, fill: '#8b94ab' }} stroke="#e4e8f3" />
        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#8b94ab' }} stroke="#e4e8f3" />
        <RechartsTooltip 
          contentStyle={{
            borderRadius: 12,
            border: '1px solid #e4e8f3',
            background: '#ffffff',
            boxShadow: '0 4px 16px rgb(17 23 38 / 0.08)',
            fontSize: 11,
          }}
        />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={24}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

