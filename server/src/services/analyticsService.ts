import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../config/database.js';
import { recordAudit } from './auditService.js';
import { chatCompletion } from './aiProviderService.js';
import { configService } from './configService.js';
import { logger } from '../config/logger.js';
import type { InterviewContext } from './questionBankService.js';
import { NotFoundError } from '../utils/errors.js';
import { paginate } from '../utils/response.js';
import {
  ROLES,
  PERMISSIONS,
  CONFIG_KEYS,
  isScheduleRound,
  type AnalyticsFilters,
  type ExportReportInput,
  type SnapshotFilters,
  type AnalyticsDashboard,
  type AnalyticsInsights,
  type AnalyticsSnapshotItem,
  type KpiSummary,
  type FunnelStage,
  type TimeSeriesPoint,
  type BreakdownSlice,
} from '@agnohire/shared';

// ─── SCOPE & RANGE ────────────────────────────────────────────────────────────

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/**
 * The sector this query runs against. Admins and holders of ANALYTICS_GLOBAL may
 * pin any sector (or all, when unset); everyone else is locked to their own.
 */
function effectiveSectorId(ctx: InterviewContext, filters: AnalyticsFilters): string | undefined {
  const global = isSuperOrAdmin(ctx.role) || ctx.permissions.includes(PERMISSIONS.ANALYTICS_GLOBAL);
  if (global) return filters.sectorId ?? undefined;
  return ctx.sectorId ?? undefined;
}

interface Resolved {
  sectorId: string | undefined;
  domainId: string | undefined;
  from: Date;
  to: Date;
  granularity: 'day' | 'week' | 'month';
}

function resolve(ctx: InterviewContext, filters: AnalyticsFilters): Resolved {
  const to = filters.to ? endOfDay(new Date(filters.to)) : endOfDay(new Date());
  const from = filters.from ? startOfDay(new Date(filters.from)) : startOfDay(daysAgo(to, 30));
  return {
    sectorId: effectiveSectorId(ctx, filters),
    domainId: filters.domainId,
    from,
    to,
    granularity: filters.granularity,
  };
}

const dateRange = (r: Resolved) => ({ gte: r.from, lte: r.to });

// ─── DATE HELPERS (UTC) ───────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}
function daysAgo(from: Date, n: number): Date {
  const x = new Date(from);
  x.setUTCDate(x.getUTCDate() - n);
  return x;
}
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Bucket key for a timestamp at the chosen granularity (returns the bucket's start day). */
function bucketStart(d: Date, granularity: Resolved['granularity']): string {
  const x = startOfDay(d);
  if (granularity === 'week') {
    // ISO week — back up to Monday.
    const dow = (x.getUTCDay() + 6) % 7;
    x.setUTCDate(x.getUTCDate() - dow);
  } else if (granularity === 'month') {
    x.setUTCDate(1);
  }
  return isoDay(x);
}

/** Ordered list of bucket-start keys spanning [from, to]. */
function buildBuckets(r: Resolved): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const cursor = startOfDay(r.from);
  while (cursor <= r.to) {
    const key = bucketStart(cursor, r.granularity);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

// ─── WHERE BUILDERS ───────────────────────────────────────────────────────────

function jobWhere(r: Resolved): Prisma.JobRequisitionWhereInput {
  return {
    deletedAt: null,
    ...(r.sectorId && { sectorId: r.sectorId }),
    ...(r.domainId && { domainId: r.domainId }),
  };
}

function candidateWhere(r: Resolved): Prisma.CandidateWhereInput {
  return {
    deletedAt: null,
    ...(r.sectorId && { sectorId: r.sectorId }),
    ...(r.domainId && { domainId: r.domainId }),
  };
}

/** Applications inherit scope from their job. */
function appJobWhere(r: Resolved): Prisma.JobApplicationWhereInput {
  const job: Prisma.JobRequisitionWhereInput = {
    ...(r.sectorId && { sectorId: r.sectorId }),
    ...(r.domainId && { domainId: r.domainId }),
  };
  return Object.keys(job).length ? { job } : {};
}

/** Interviews inherit scope from their candidate. */
function interviewCandidateWhere(r: Resolved): Prisma.InterviewWhereInput {
  const cand: Prisma.CandidateWhereInput = {
    ...(r.sectorId && { sectorId: r.sectorId }),
    ...(r.domainId && { domainId: r.domainId }),
  };
  return Object.keys(cand).length ? { candidate: cand } : {};
}


// ─── KPIs ─────────────────────────────────────────────────────────────────────

async function computeKpis(r: Resolved): Promise<KpiSummary> {
  const range = dateRange(r);

  const [
    totalJobs,
    openJobs,
    totalCandidates,
    totalApplications,
    interviewsTotal,
    interviewsCompleted,
    hires,
    fitAgg,
    offerRows,
    hiredApps,
    interviewsPassed,
    interviewsFailed,
    interviewsHold,
    interviewsWithDecisions,
    interviewScoresAgg,
    jobsList,
    interviewsList,
  ] = await Promise.all([
    prisma.jobRequisition.count({ where: { ...jobWhere(r), createdAt: range } }),
    prisma.jobRequisition.count({ where: { ...jobWhere(r), status: 'OPEN' } }),
    prisma.candidate.count({ where: { ...candidateWhere(r), createdAt: range } }),
    prisma.jobApplication.count({ where: { ...appJobWhere(r), appliedAt: range } }),
    prisma.interview.count({ where: { ...interviewCandidateWhere(r), deletedAt: null, createdAt: range } }),
    prisma.interview.count({
      where: { ...interviewCandidateWhere(r), deletedAt: null, status: { in: ['COMPLETED', 'EVALUATED'] }, createdAt: range },
    }),
    prisma.jobApplication.count({ where: { ...appJobWhere(r), status: 'HIRED', updatedAt: range } }),
    prisma.candidate.aggregate({ _avg: { fitScore: true }, where: { ...candidateWhere(r), fitScore: { not: null } } }),
    prisma.offer.findMany({
      where: { application: appJobWhere(r), createdAt: range },
      select: { status: true },
    }),
    prisma.jobApplication.findMany({
      where: { ...appJobWhere(r), status: 'HIRED', updatedAt: range },
      select: { appliedAt: true, updatedAt: true },
    }),
    prisma.interviewResult.count({ where: { interview: { ...interviewCandidateWhere(r), deletedAt: null, createdAt: range }, aiDecision: 'PASS' } }),
    prisma.interviewResult.count({ where: { interview: { ...interviewCandidateWhere(r), deletedAt: null, createdAt: range }, aiDecision: 'FAIL' } }),
    prisma.interviewResult.count({ where: { interview: { ...interviewCandidateWhere(r), deletedAt: null, createdAt: range }, aiDecision: 'HOLD' } }),
    prisma.interviewResult.count({ where: { interview: { ...interviewCandidateWhere(r), deletedAt: null, createdAt: range }, decision: { not: null } } }),
    prisma.interviewResult.aggregate({ _avg: { percentageScore: true }, where: { interview: { ...interviewCandidateWhere(r), deletedAt: null, createdAt: range }, percentageScore: { not: null } } }),
    prisma.jobRequisition.findMany({
      where: { ...jobWhere(r) },
      select: {
        id: true,
        workflowRounds: { select: { roundNumber: true, roundName: true, roundType: true } },
      },
    }),
    prisma.interview.findMany({
      where: { ...interviewCandidateWhere(r), deletedAt: null, createdAt: range },
      select: {
        jobRequisitionId: true,
        roundNumber: true,
        result: { select: { decision: true, aiDecision: true } },
      },
    }),
  ]);

  const jobScheduleRoundsMap = new Map<string, Map<number, boolean>>();
  jobsList.forEach((j) => {
    const roundMap = new Map<number, boolean>();
    j.workflowRounds.forEach((round) => {
      const isSched = isScheduleRound(round.roundType, round.roundName);
      roundMap.set(round.roundNumber, isSched);
    });
    jobScheduleRoundsMap.set(j.id, roundMap);
  });

  let schedulesScheduled = 0;
  let schedulesPassed = 0;

  interviewsList.forEach((iv) => {
    if (iv.roundNumber == null || iv.jobRequisitionId == null) return;
    const isSched = jobScheduleRoundsMap.get(iv.jobRequisitionId)?.get(iv.roundNumber) ?? false;
    if (isSched) {
      schedulesScheduled++;
      const decision = iv.result?.decision || iv.result?.aiDecision;
      if (decision === 'PASS') {
        schedulesPassed++;
      }
    }
  });

  const offersExtended = offerRows.filter((o) => o.status !== 'DRAFT').length;
  const offersAccepted = offerRows.filter((o) => o.status === 'ACCEPTED').length;
  const offerAcceptanceRate = offersExtended ? round1((offersAccepted / offersExtended) * 100) : null;

  const avgTimeToHireDays = hiredApps.length
    ? round1(
        hiredApps.reduce((sum, a) => sum + (a.updatedAt.getTime() - a.appliedAt.getTime()), 0) /
          hiredApps.length /
          86_400_000,
      )
    : null;

  return {
    totalJobs,
    openJobs,
    totalCandidates,
    totalApplications,
    interviewsTotal,
    interviewsCompleted,
    assessmentsAssigned: schedulesScheduled,
    assessmentsPassed: schedulesPassed,
    offersExtended,
    hires,
    avgFitScore: fitAgg._avg.fitScore != null ? round1(fitAgg._avg.fitScore) : null,
    offerAcceptanceRate,
    avgTimeToHireDays,
    interviewsPassed,
    interviewsFailed,
    interviewsHold,
    interviewsValidationRate: interviewsCompleted > 0 ? round1((interviewsWithDecisions / interviewsCompleted) * 100) : null,
    avgInterviewScore: interviewScoresAgg._avg.percentageScore != null ? round1(interviewScoresAgg._avg.percentageScore) : null,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── FUNNEL ───────────────────────────────────────────────────────────────────


/**
 * Cumulative funnel: a candidate who reached OFFER also passed APPLIED/SCREENING/
 * INTERVIEW. We approximate "reached stage X" as status index >= X using the
 * ordered status enum (REJECTED excluded as an off-funnel terminal state).
 */
async function computeFunnel(r: Resolved): Promise<FunnelStage[]> {
  const range = dateRange(r);

  // 1. Fetch all job requisitions to build schedule rounds map
  const jobs = await prisma.jobRequisition.findMany({
    where: { ...jobWhere(r) },
    select: {
      id: true,
      workflowRounds: { select: { roundNumber: true, roundName: true, roundType: true } },
    },
  });

  const jobScheduleRoundsMap = new Map<string, Map<number, boolean>>();
  jobs.forEach((j) => {
    const roundMap = new Map<number, boolean>();
    j.workflowRounds.forEach((round) => {
      const isSched = isScheduleRound(round.roundType, round.roundName);
      roundMap.set(round.roundNumber, isSched);
    });
    jobScheduleRoundsMap.set(j.id, roundMap);
  });

  // 2. Fetch all applications
  const applications = await prisma.jobApplication.findMany({
    where: { ...appJobWhere(r), appliedAt: range },
    select: {
      candidateId: true,
      jobRequisitionId: true,
      fitScore: true,
      offers: {
        select: {
          status: true,
          onboarding: { select: { status: true } },
        },
      },
    },
  });

  // 3. Fetch all interviews
  const interviews = await prisma.interview.findMany({
    where: {
      jobRequisitionId: { in: jobs.map((j) => j.id) },
      deletedAt: null,
    },
    select: {
      candidateId: true,
      jobRequisitionId: true,
      roundNumber: true,
      result: { select: { decision: true, aiDecision: true } },
    },
  });

  const appInterviewsMap = new Map<string, typeof interviews>();
  interviews.forEach((iv) => {
    const key = `${iv.candidateId}_${iv.jobRequisitionId}`;
    if (!appInterviewsMap.has(key)) {
      appInterviewsMap.set(key, []);
    }
    appInterviewsMap.get(key)!.push(iv);
  });

  // Calculate funnel metrics
  const appliedCount = applications.length;
  let screeningCount = 0;
  let interviewCount = 0;
  let scheduleCount = 0;
  let offerCount = 0;
  let hiredCount = 0;

  applications.forEach((app) => {
    // Screening
    if (app.fitScore != null && app.fitScore >= 50) {
      screeningCount++;
    }

    // Interview & Schedule passed candidates
    const key = `${app.candidateId}_${app.jobRequisitionId}`;
    const ivs = appInterviewsMap.get(key) ?? [];
    
    const passedInterview = ivs.some((iv) => {
      if (iv.roundNumber == null || iv.jobRequisitionId == null) return false;
      const isSched = jobScheduleRoundsMap.get(iv.jobRequisitionId)?.get(iv.roundNumber) ?? false;
      if (isSched) return false;
      const decision = iv.result?.decision || iv.result?.aiDecision;
      return decision === 'PASS';
    });

    const passedSchedule = ivs.some((iv) => {
      if (iv.roundNumber == null || iv.jobRequisitionId == null) return false;
      const isSched = jobScheduleRoundsMap.get(iv.jobRequisitionId)?.get(iv.roundNumber) ?? false;
      if (!isSched) return false;
      const decision = iv.result?.decision || iv.result?.aiDecision;
      return decision === 'PASS';
    });

    if (passedInterview) interviewCount++;
    if (passedSchedule) scheduleCount++;

    // Offers
    const hasAcceptedOffer = app.offers.some((o) => {
      return !['DRAFT', 'TENTATIVE'].includes(o.status);
    });
    if (hasAcceptedOffer) offerCount++;

    // Hired
    const hasCompletedOnboarding = app.offers.some((o) => {
      return o.onboarding?.status === 'COMPLETED';
    });
    if (hasCompletedOnboarding) hiredCount++;
  });

  const top = appliedCount;

  return [
    {
      stage: 'APPLIED',
      count: appliedCount,
      ofTop: 100,
      fromPrev: null,
    },
    {
      stage: 'SCREENING',
      count: screeningCount,
      ofTop: top ? round1((screeningCount / top) * 100) : 0,
      fromPrev: appliedCount ? round1((screeningCount / appliedCount) * 100) : 0,
    },
    {
      stage: 'INTERVIEW',
      count: interviewCount,
      ofTop: top ? round1((interviewCount / top) * 100) : 0,
      fromPrev: screeningCount ? round1((interviewCount / screeningCount) * 100) : 0,
    },
    {
      stage: 'SCHEDULE',
      count: scheduleCount,
      ofTop: top ? round1((scheduleCount / top) * 100) : 0,
      fromPrev: interviewCount ? round1((scheduleCount / interviewCount) * 100) : 0,
    },
    {
      stage: 'OFFER',
      count: offerCount,
      ofTop: top ? round1((offerCount / top) * 100) : 0,
      fromPrev: scheduleCount ? round1((offerCount / scheduleCount) * 100) : 0,
    },
    {
      stage: 'HIRED',
      count: hiredCount,
      ofTop: top ? round1((hiredCount / top) * 100) : 0,
      fromPrev: offerCount ? round1((hiredCount / offerCount) * 100) : 0,
    },
  ];
}

// ─── TIME SERIES ──────────────────────────────────────────────────────────────

async function computeTimeSeries(r: Resolved): Promise<TimeSeriesPoint[]> {
  const range = dateRange(r);
  const [apps, interviews, hires] = await Promise.all([
    prisma.jobApplication.findMany({ where: { ...appJobWhere(r), appliedAt: range }, select: { appliedAt: true } }),
    prisma.interview.findMany({
      where: { ...interviewCandidateWhere(r), deletedAt: null, createdAt: range },
      select: { createdAt: true },
    }),
    prisma.jobApplication.findMany({
      where: { ...appJobWhere(r), status: 'HIRED', updatedAt: range },
      select: { updatedAt: true },
    }),
  ]);

  const buckets = buildBuckets(r);
  const init = () => new Map(buckets.map((b) => [b, 0]));
  const a = init();
  const iv = init();
  const h = init();
  const bump = (m: Map<string, number>, d: Date) => {
    const key = bucketStart(d, r.granularity);
    if (m.has(key)) m.set(key, (m.get(key) ?? 0) + 1);
  };
  apps.forEach((x) => bump(a, x.appliedAt));
  interviews.forEach((x) => bump(iv, x.createdAt));
  hires.forEach((x) => bump(h, x.updatedAt));

  return buckets.map((date) => ({
    date,
    applications: a.get(date) ?? 0,
    interviews: iv.get(date) ?? 0,
    hires: h.get(date) ?? 0,
  }));
}

// ─── BREAKDOWNS ───────────────────────────────────────────────────────────────

function toSlices<T extends string>(rows: { _count: { _all: number } }[], key: (row: never) => T): BreakdownSlice[] {
  return rows
    .map((row) => ({ label: key(row as never) || '—', count: row._count._all }))
    .filter((s) => s.count > 0)
    .sort((x, y) => y.count - x.count);
}

async function computeBreakdowns(r: Resolved) {
  const range = dateRange(r);
  const [jobs, apps, sources, interviews, domainRows, jobMetricsData] = await Promise.all([
    prisma.jobRequisition.groupBy({ by: ['status'], where: { ...jobWhere(r), createdAt: range }, _count: { _all: true } }),
    prisma.jobApplication.groupBy({ by: ['status'], where: { ...appJobWhere(r), appliedAt: range }, _count: { _all: true } }),
    prisma.candidate.groupBy({ by: ['source'], where: { ...candidateWhere(r), createdAt: range }, _count: { _all: true } }),
    prisma.interview.groupBy({
      by: ['status'],
      where: { ...interviewCandidateWhere(r), deletedAt: null, createdAt: range },
      _count: { _all: true },
    }),
    prisma.jobRequisition.groupBy({ by: ['domainId'], where: { ...jobWhere(r), createdAt: range }, _count: { _all: true } }),
    prisma.jobRequisition.findMany({
      where: { ...jobWhere(r), createdAt: range },
      select: {
        id: true,
        title: true,
        workflowRounds: { select: { roundNumber: true, roundName: true, roundType: true } },
        applications: { select: { status: true, offers: { select: { status: true } } } },
        interviews: { select: { roundNumber: true, result: { select: { decision: true, aiDecision: true } } } },
      },
    }),
  ]);

  const jobsByStatus = toSlices(jobs, (row: { status: string }) => row.status);
  const applicationsByStatus = toSlices(apps, (row: { status: string }) => row.status);
  const candidatesBySource = toSlices(sources, (row: { source: string | null }) => row.source ?? 'UNKNOWN');
  const interviewsByStatus = toSlices(interviews, (row: { status: string }) => row.status);

  // Resolve top domain names (plain groupBy gives ids).
  const domainIds = domainRows.map((d) => d.domainId).filter((x): x is string => !!x);
  const domains = domainIds.length
    ? await prisma.domain.findMany({ where: { id: { in: domainIds } }, select: { id: true, name: true } })
    : [];
  const dmap = new Map(domains.map((d) => [d.id, d.name]));
  const topDomains = domainRows
    .map((d) => ({ label: d.domainId ? dmap.get(d.domainId) ?? 'Unknown' : '—', count: d._count._all }))
    .filter((s) => s.count > 0)
    .sort((x, y) => y.count - x.count)
    .slice(0, 5);

  const jobMetrics = jobMetricsData.map((j) => {
    let offersSent = 0;
    let joined = 0;
    j.applications.forEach((a) => {
      if (a.status === 'HIRED') joined++;
      if (a.offers && a.offers.length > 0) offersSent++;
    });

    let schedulesScheduled = 0;
    let schedulesPassed = 0;
    let schedulesFailed = 0;
    let interviewsScheduled = 0;
    let interviewsPassed = 0;
    let interviewsFailed = 0;

    const scheduleRoundsMap = new Map<number, boolean>();
    j.workflowRounds.forEach((round) => {
      const isSched = isScheduleRound(round.roundType, round.roundName);
      scheduleRoundsMap.set(round.roundNumber, isSched);
    });

    j.interviews.forEach((iv) => {
      if (iv.roundNumber == null) return;
      const isSched = scheduleRoundsMap.get(iv.roundNumber) ?? false;
      const decision = iv.result?.decision || iv.result?.aiDecision;

      if (isSched) {
        schedulesScheduled++;
        if (decision === 'PASS') schedulesPassed++;
        if (decision === 'FAIL') schedulesFailed++;
      } else {
        interviewsScheduled++;
        if (decision === 'PASS') interviewsPassed++;
        if (decision === 'FAIL') interviewsFailed++;
      }
    });

    return {
      jobId: j.id,
      jobTitle: j.title,
      totalApplications: j.applications.length,
      schedulesScheduled,
      schedulesPassed,
      schedulesFailed,
      interviewsScheduled,
      interviewsPassed,
      interviewsFailed,
      offersSent,
      joined,
    };
  });

  return { jobsByStatus, applicationsByStatus, candidatesBySource, interviewsByStatus, topDomains, jobMetrics };
}

// ─── DASHBOARD (composite) ──────────────────────────────────────────────────────

export async function getDashboard(filters: AnalyticsFilters, ctx: InterviewContext): Promise<AnalyticsDashboard> {
  const r = resolve(ctx, filters);
  const [kpis, funnel, timeSeries, breakdowns] = await Promise.all([
    computeKpis(r),
    computeFunnel(r),
    computeTimeSeries(r),
    computeBreakdowns(r),
  ]);
  return {
    kpis,
    funnel,
    timeSeries,
    ...breakdowns,
    range: { from: isoDay(r.from), to: isoDay(r.to), granularity: r.granularity },
    generatedAt: new Date().toISOString(),
  };
}

// ─── AI INSIGHTS (graceful) ─────────────────────────────────────────────────────

export async function getInsights(filters: AnalyticsFilters, ctx: InterviewContext): Promise<AnalyticsInsights> {
  const dashboard = await getDashboard(filters, ctx);
  const k = dashboard.kpis;

  // Deterministic highlights — always available, even without an AI key.
  const highlights: string[] = [];
  highlights.push(`${k.totalApplications} applications and ${k.hires} hire(s) in the selected window.`);
  if (k.offerAcceptanceRate != null) highlights.push(`Offer acceptance rate is ${k.offerAcceptanceRate}%.`);
  if (k.avgTimeToHireDays != null) highlights.push(`Average time-to-hire is ${k.avgTimeToHireDays} days.`);
  if (k.avgFitScore != null) highlights.push(`Average candidate fit score is ${k.avgFitScore}.`);
  const dropoff = dashboard.funnel.find((s) => s.fromPrev != null && s.fromPrev < 50);
  if (dropoff) highlights.push(`Largest funnel drop-off at ${dropoff.stage} (${dropoff.fromPrev}% from prior stage).`);

  const configured = await configService.isConfigured(CONFIG_KEYS.OPENAI_API_KEY, ctx.sectorId ?? null);
  if (!configured) {
    return { summary: null, highlights, generated: false };
  }

  try {
    const prompt = [
      'You are a recruitment analytics advisor. Given these hiring metrics, write a concise',
      '3-4 sentence executive summary highlighting trends, bottlenecks, and one actionable recommendation.',
      'Be specific and reference the numbers. Do not use markdown.',
      '',
      `Metrics JSON: ${JSON.stringify({ kpis: dashboard.kpis, funnel: dashboard.funnel, range: dashboard.range })}`,
    ].join('\n');
    const summary = await chatCompletion(
      [{ role: 'user', content: prompt }],
      { sectorId: ctx.sectorId ?? null, maxTokens: 400, temperature: 0.5, feature: 'analytics.insight' },
    );
    return { summary: summary || null, highlights, generated: Boolean(summary) };
  } catch (err) {
    logger.warn('Analytics AI insights failed; returning deterministic highlights', {
      err: (err as Error).message,
    });
    return { summary: null, highlights, generated: false };
  }
}

// ─── EXCEL EXPORT ──────────────────────────────────────────────────────────────

import { EnterpriseExcelBuilder } from '../utils/excelReportGenerator.js';

export async function exportReport(
  input: ExportReportInput,
  ctx: InterviewContext,
  req: Request,
): Promise<{ filename: string; buffer: Buffer }> {
  const dashboard = await getDashboard(input, ctx);
  const stamp = isoDay(new Date());

  const filterNames: Record<string, string> = {
    sectorId: 'Sector ID',
    domainId: 'Domain ID',
    from: 'Start Date',
    to: 'End Date',
    granularity: 'Granularity',
    report: 'Report Type'
  };

  const baseConfig = {
    generatedBy: ctx.userId || 'System',
    environment: process.env.NODE_ENV === 'production' ? 'Production' : 'Development/UAT',
    filters: input,
    filterNames
  };

  let buffer: Buffer;

  switch (input.report) {
    case 'funnel':
      buffer = await EnterpriseExcelBuilder.generate({
        ...baseConfig,
        title: 'Hiring Funnel Report',
        description: 'Drop-off analysis of candidates moving through the pipeline.',
        totalRecords: dashboard.funnel.length,
        summary: {
          'Total Top of Funnel (Applications)': dashboard.funnel[0]?.count || 0
        },
        data: dashboard.funnel,
        columns: [
          { header: 'Stage', key: 'stage' },
          { header: 'Count', key: 'count' },
          { header: '% of Top', key: 'ofTop' },
          { header: '% from Previous', key: 'fromPrev' }
        ]
      });
      break;

    case 'timeseries':
      buffer = await EnterpriseExcelBuilder.generate({
        ...baseConfig,
        title: 'Hiring Over Time Report',
        description: `Trends for applications, interviews, and hires aggregated by ${input.granularity || 'day'}.`,
        totalRecords: dashboard.timeSeries.length,
        summary: {
          'Total Applications': dashboard.kpis.totalApplications,
          'Total Interviews': dashboard.kpis.interviewsTotal,
          'Total Hires': dashboard.kpis.hires
        },
        data: dashboard.timeSeries,
        columns: [
          { header: 'Date', key: 'date' },
          { header: 'Applications', key: 'applications' },
          { header: 'Interviews', key: 'interviews' },
          { header: 'Hires', key: 'hires' }
        ]
      });
      break;

    case 'jobs':
      buffer = await EnterpriseExcelBuilder.generate({
        ...baseConfig,
        title: 'Jobs Breakdown Report',
        description: 'Distribution of jobs by their current status.',
        totalRecords: dashboard.jobsByStatus.length,
        summary: {
          'Total Jobs': dashboard.kpis.totalJobs,
          'Open Jobs': dashboard.kpis.openJobs
        },
        data: dashboard.jobsByStatus,
        columns: [
          { header: 'Status', key: 'label' },
          { header: 'Count', key: 'count' }
        ]
      });
      break;

    case 'applications':
      buffer = await EnterpriseExcelBuilder.generate({
        ...baseConfig,
        title: 'Applications Breakdown Report',
        description: 'Distribution of applications by their current status.',
        totalRecords: dashboard.applicationsByStatus.length,
        summary: {
          'Total Applications': dashboard.kpis.totalApplications,
          'Hired Applications': dashboard.kpis.hires
        },
        data: dashboard.applicationsByStatus,
        columns: [
          { header: 'Status', key: 'label' },
          { header: 'Count', key: 'count' }
        ]
      });
      break;

    case 'overview':
    default: {
      const k = dashboard.kpis;
      const metricsList = [
        { metric: 'Total jobs', value: k.totalJobs },
        { metric: 'Open jobs', value: k.openJobs },
        { metric: 'Total candidates', value: k.totalCandidates },
        { metric: 'Total applications', value: k.totalApplications },
        { metric: 'Interviews scheduled', value: k.interviewsTotal },
        { metric: 'Interviews completed', value: k.interviewsCompleted },
        { metric: 'Assessments assigned', value: k.assessmentsAssigned },
        { metric: 'Assessments passed', value: k.assessmentsPassed },
        { metric: 'Total hires', value: k.hires },
        { metric: 'Avg Fit Score', value: k.avgFitScore },
        { metric: 'Offer Acceptance Rate', value: k.offerAcceptanceRate ? `${k.offerAcceptanceRate}%` : null },
        { metric: 'Avg Time to Hire (Days)', value: k.avgTimeToHireDays }
      ];

      buffer = await EnterpriseExcelBuilder.generate({
        ...baseConfig,
        title: 'Recruitment KPI Overview',
        description: 'High-level metrics and performance indicators for the selected period.',
        totalRecords: metricsList.length,
        summary: {
          'Total Applications': k.totalApplications,
          'Total Hires': k.hires
        },
        data: metricsList,
        columns: [
          { header: 'Metric', key: 'metric' },
          { header: 'Value', key: 'value' }
        ]
      });
      break;
    }
  }

  await recordAudit(req, {
    action: 'EXPORT',
    entity: 'AnalyticsReport',
    description: `Exported ${input.report} report (${dashboard.range.from}…${dashboard.range.to})`,
  });
  return { filename: `agnohire-${input.report}-${stamp}.xlsx`, buffer };
}

// ─── SNAPSHOTS ──────────────────────────────────────────────────────────────────

export async function saveSnapshot(filters: AnalyticsFilters, ctx: InterviewContext, req: Request): Promise<AnalyticsSnapshotItem> {
  const dashboard = await getDashboard(filters, ctx);
  const sectorId = effectiveSectorId(ctx, filters) ?? null;
  const snap = await prisma.analyticsSnapshot.create({
    data: {
      sectorId,
      period: `${dashboard.range.from}…${dashboard.range.to}`,
      data: dashboard as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, period: true, snapshotAt: true, data: true },
  });
  await recordAudit(req, {
    action: 'CREATE',
    entity: 'AnalyticsSnapshot',
    entityId: snap.id,
    description: `Saved analytics snapshot for ${snap.period}`,
  });
  return {
    id: snap.id,
    period: snap.period,
    snapshotAt: snap.snapshotAt.toISOString(),
    data: snap.data as unknown as AnalyticsDashboard,
  };
}

function snapshotScope(ctx: InterviewContext): Prisma.AnalyticsSnapshotWhereInput {
  const global = isSuperOrAdmin(ctx.role) || ctx.permissions.includes(PERMISSIONS.ANALYTICS_GLOBAL);
  if (global) return {};
  if (ctx.sectorId) return { OR: [{ sectorId: ctx.sectorId }, { sectorId: null }] };
  return { sectorId: null };
}

export async function listSnapshots(filters: SnapshotFilters, ctx: InterviewContext) {
  const { page, limit } = filters;
  const where = snapshotScope(ctx);
  const [total, rows] = await Promise.all([
    prisma.analyticsSnapshot.count({ where }),
    prisma.analyticsSnapshot.findMany({
      where,
      orderBy: { snapshotAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: { id: true, period: true, snapshotAt: true, data: true },
    }),
  ]);
  const items: AnalyticsSnapshotItem[] = rows.map((s) => ({
    id: s.id,
    period: s.period,
    snapshotAt: s.snapshotAt.toISOString(),
    data: s.data as unknown as AnalyticsDashboard,
  }));
  return paginate(items, total, page, limit);
}

export async function exportSnapshotPDF(id: string, ctx: InterviewContext): Promise<{ buffer: Buffer; filename: string }> {
  const snap = await prisma.analyticsSnapshot.findFirst({
    where: { id, ...snapshotScope(ctx) },
    select: { period: true, snapshotAt: true, data: true, tenantId: true },
  });
  if (!snap) throw new NotFoundError('Snapshot not found');

  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { fullName: true } });
  const { generateAnalyticsSnapshotPDF } = await import('./pdfReportService.js');
  const buffer = await generateAnalyticsSnapshotPDF(
    { period: snap.period, snapshotAt: snap.snapshotAt, data: snap.data as unknown as AnalyticsDashboard },
    user?.fullName ?? 'Recruiter',
    snap.tenantId,
  );
  const safePeriod = snap.period.replace(/[^a-zA-Z0-9-]+/g, '_');
  return { buffer, filename: `agnohire-analytics-snapshot-${safePeriod}.pdf` };
}

export async function deleteSnapshot(id: string, ctx: InterviewContext, req: Request) {
  const snap = await prisma.analyticsSnapshot.findFirst({ where: { id, ...snapshotScope(ctx) }, select: { id: true } });
  if (!snap) throw new NotFoundError('Snapshot not found');
  await prisma.analyticsSnapshot.delete({ where: { id } });
  await recordAudit(req, { action: 'DELETE', entity: 'AnalyticsSnapshot', entityId: id, description: `Deleted analytics snapshot ${id}` });
  return { deleted: true };
}
