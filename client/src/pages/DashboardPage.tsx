import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Briefcase,
  Users,
  CalendarCheck,
  Sparkles,
  ClipboardCheck,
  FileText,
  UserCheck,
  Percent,
  ArrowRight,
} from 'lucide-react';
import { PERMISSIONS } from '@agnohire/shared';
import { useAuthStore } from '../store/authStore.js';
import { ROLE_BASE } from '../config/rolePaths.js';
import { withTenant } from '../utils/tenantPath.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { StatCard } from '../components/common/StatCard.js';
import { Spinner } from '../components/ui/Spinner.js';
import {
  ChartCard,
  ActivityAreaChart,
  DonutChart,
  HBarChart,
} from '../components/dashboard/DashboardCharts.js';
import * as analyticsApi from '../services/analyticsApi.js';

const num = (n: number) => n.toLocaleString();
const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n)}%`);

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canViewAnalytics = hasPermission(PERMISSIONS.ANALYTICS_VIEW);
  const base = user ? withTenant(ROLE_BASE[user.role], user.tenantSlug) : '';

  // Explicit filters matching the server's own defaults (trailing 30 days,
  // daily granularity) — and a key shaped like AnalyticsPage's, so this
  // shares its cache entry with AnalyticsPage's default view instead of
  // both independently fetching the same dashboard data on every visit.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics-dashboard', '30', 'day'],
    queryFn: () => analyticsApi.fetchDashboard({ from: isoDaysAgo(30), to: isoDaysAgo(0), granularity: 'day' }),
    enabled: canViewAnalytics,
    staleTime: 60_000,
  });

  const d = data?.dashboard;
  const kpis = d?.kpis;
  const funnel = d?.funnel ?? [];
  const funnelTop = funnel[0]?.count ?? 0;

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.fullName.split(' ')[0] ?? ''}`}
        description={`${user?.roleDisplayName} dashboard`}
        actions={
          canViewAnalytics ? (
            <Link
              to={`${base}/analytics`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised"
            >
              View full analytics <ArrowRight className="h-4 w-4" />
            </Link>
          ) : undefined
        }
      />

      {!canViewAnalytics ? (
        <div className="mt-6 card p-6">
          <h2 className="font-heading text-lg text-text-primary">Welcome to AgnoHire</h2>
          <p className="mt-2 max-w-2xl text-sm text-text-muted">
            Use the navigation to access your workspace. Your recruitment analytics are available to
            roles with the Analytics permission.
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : isError || !kpis ? (
        <div className="mt-6 card p-6 text-sm text-text-muted">
          Couldn’t load dashboard metrics. Please try again shortly.
        </div>
      ) : (
        <>
          {/* KPI grid — one signal per module across the hiring lifecycle. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Open Jobs" value={num(kpis.openJobs)} icon={Briefcase} trend={`${num(kpis.totalJobs)} total jobs`} />
            <StatCard label="Candidates" value={num(kpis.totalCandidates)} icon={Users} trend={`${num(kpis.totalApplications)} applications`} />
            <StatCard label="Interviews Done" value={num(kpis.interviewsCompleted)} icon={CalendarCheck} trend={`${num(kpis.interviewsTotal)} scheduled`} />
            <StatCard label="Avg Fit Score" value={pct(kpis.avgFitScore)} icon={Sparkles} trend="AI screening" />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Schedule Passed" value={num(kpis.assessmentsPassed)} icon={ClipboardCheck} trend={`of ${num(kpis.assessmentsAssigned)} scheduled`} />
            <StatCard label="Offers Extended" value={num(kpis.offersExtended)} icon={FileText} trend={`${pct(kpis.offerAcceptanceRate)} accepted`} />
            <StatCard label="Hires" value={num(kpis.hires)} icon={UserCheck} trend={kpis.avgTimeToHireDays != null ? `${Math.round(kpis.avgTimeToHireDays)}d avg to hire` : 'time to hire —'} />
            <StatCard label="Offer Acceptance" value={pct(kpis.offerAcceptanceRate)} icon={Percent} trend="accepted / sent" />
          </div>



          {/* Hiring activity over time + applications breakdown */}
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <ChartCard
              title="Hiring activity"
              subtitle="Applications, interviews & hires over time"
              className="lg:col-span-2"
              action={
                <Link to={`${base}/analytics`} className="text-sm text-accent hover:underline">
                  Details →
                </Link>
              }
            >
              <ActivityAreaChart data={d?.timeSeries ?? []} />
            </ChartCard>
            <ChartCard title="Applications by status">
              <DonutChart data={d?.applicationsByStatus ?? []} />
            </ChartCard>
          </div>

          {/* Secondary breakdowns */}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <ChartCard title="Jobs by status">
              <DonutChart data={d?.jobsByStatus ?? []} height={200} />
            </ChartCard>
            <ChartCard title="Candidate sources">
              <DonutChart data={d?.candidatesBySource ?? []} height={200} />
            </ChartCard>
            <ChartCard title="Interviews by status">
              <HBarChart data={d?.interviewsByStatus ?? []} height={200} />
            </ChartCard>
          </div>

          {/* Recruitment funnel + top domains */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Recruitment progress"
              subtitle="Applied → screening → interview → schedule → offer → hired"
              action={
                <Link to={`${base}/pipeline`} className="text-sm text-accent hover:underline">
                  Open pipeline →
                </Link>
              }
            >
              {funnel.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-muted">No pipeline activity yet.</p>
              ) : (
                <div className="space-y-3 pt-1">
                  {funnel.map((stage, idx) => {
                    const width = funnelTop > 0 ? Math.max((stage.count / funnelTop) * 100, 2) : 0;
                    const color = [
                      '#6366f1',
                      '#0ea5e9',
                      '#059669',
                      '#6366f1',
                      '#0ea5e9',
                      '#059669',
                    ][idx % 6];

                    return (
                      <div key={stage.stage}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="font-medium text-text-secondary">{stage.stage}</span>
                          <span className="text-text-muted">
                            {num(stage.count)}
                            {stage.fromPrev != null && stage.fromPrev > 0 && (
                              <span className="ml-2 text-xs text-text-muted">({Math.round(stage.fromPrev)}% from prev)</span>
                            )}
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface">
                          <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, backgroundColor: color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ChartCard>

            <ChartCard title="Top domains" subtitle="Where candidates are concentrated">
              <HBarChart data={d?.topDomains ?? []} />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
