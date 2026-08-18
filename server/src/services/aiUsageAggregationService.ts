import { prisma } from '../config/database.js';
import { runAsPlatform } from '../config/tenantContext.js';
import { isBillableToTenant } from './aiUsageLogger.js';

function rangeSince(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export interface UsageSummary {
  totalCalls: number;
  successfulCalls: number;
  successRate: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: number;
  billableCostUsd: number;
  unpricedCalls: number;
}

export async function getUsageSummary(days = 30): Promise<UsageSummary> {
  return runAsPlatform(async () => {
    const since = rangeSince(days);
    const [totals, successCount, billable, unpriced] = await Promise.all([
      prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: since } },
        _sum: { totalTokens: true, promptTokens: true, completionTokens: true, costUsd: true },
        _count: { _all: true },
      }),
      prisma.aiUsageLog.count({ where: { createdAt: { gte: since }, success: true } }),
      prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: since }, billable: true },
        _sum: { costUsd: true },
      }),
      prisma.aiUsageLog.count({ where: { createdAt: { gte: since }, costUsd: null } }),
    ]);

    const totalCalls = totals._count._all;
    return {
      totalCalls,
      successfulCalls: successCount,
      successRate: totalCalls ? Math.round((successCount / totalCalls) * 1000) / 10 : 100,
      totalTokens: totals._sum.totalTokens ?? 0,
      promptTokens: totals._sum.promptTokens ?? 0,
      completionTokens: totals._sum.completionTokens ?? 0,
      totalCostUsd: totals._sum.costUsd ? Number(totals._sum.costUsd) : 0,
      billableCostUsd: billable._sum.costUsd ? Number(billable._sum.costUsd) : 0,
      unpricedCalls: unpriced,
    };
  });
}

export interface UsageTrendPoint {
  date: string;
  totalTokens: number;
  costUsd: number;
  calls: number;
}

export async function getUsageTrend(days = 30): Promise<UsageTrendPoint[]> {
  return runAsPlatform(async () => {
    const since = rangeSince(days);
    const rows = await prisma.$queryRaw<{ day: Date; total_tokens: bigint | null; cost_usd: string | null; calls: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day,
             COALESCE(SUM("totalTokens"), 0) AS total_tokens,
             COALESCE(SUM("costUsd"), 0) AS cost_usd,
             COUNT(*) AS calls
      FROM "AiUsageLog"
      WHERE "createdAt" >= ${since}
      GROUP BY day
      ORDER BY day ASC`;
    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      totalTokens: Number(r.total_tokens ?? 0),
      costUsd: Number(r.cost_usd ?? 0),
      calls: Number(r.calls),
    }));
  });
}

export interface UsageByTenant {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  totalTokens: number;
  totalCostUsd: number;
  billableCostUsd: number;
  calls: number;
  usesPlatformKey: boolean;
}

export async function getUsageByTenant(days = 30): Promise<UsageByTenant[]> {
  return runAsPlatform(async () => {
    const since = rangeSince(days);
    const grouped = await prisma.aiUsageLog.groupBy({
      by: ['tenantId'],
      where: { createdAt: { gte: since }, tenantId: { not: null } },
      _sum: { totalTokens: true, costUsd: true },
      _count: { _all: true },
    });
    const billableGrouped = await prisma.aiUsageLog.groupBy({
      by: ['tenantId'],
      where: { createdAt: { gte: since }, tenantId: { not: null }, billable: true },
      _sum: { costUsd: true },
    });
    const billableByTenant = new Map(billableGrouped.map((g) => [g.tenantId as string, g._sum.costUsd ? Number(g._sum.costUsd) : 0]));

    const tenantIds = grouped.map((g) => g.tenantId as string);
    const tenants = await prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, slug: true } });
    const tenantMap = new Map(tenants.map((t) => [t.id, t]));
    const platformKeyFlags = new Map(await Promise.all(tenantIds.map(async (id) => [id, await isBillableToTenant(id)] as const)));

    return grouped
      .map((g): UsageByTenant => {
        const t = tenantMap.get(g.tenantId as string);
        return {
          tenantId: g.tenantId as string,
          tenantName: t?.name ?? 'Unknown workspace',
          tenantSlug: t?.slug ?? '',
          totalTokens: g._sum.totalTokens ?? 0,
          totalCostUsd: g._sum.costUsd ? Number(g._sum.costUsd) : 0,
          billableCostUsd: billableByTenant.get(g.tenantId as string) ?? 0,
          calls: g._count._all,
          usesPlatformKey: platformKeyFlags.get(g.tenantId as string) ?? false,
        };
      })
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  });
}

export interface UsageByFeature {
  feature: string;
  totalTokens: number;
  totalCostUsd: number;
  calls: number;
}

export async function getUsageByFeature(days = 30): Promise<UsageByFeature[]> {
  return runAsPlatform(async () => {
    const since = rangeSince(days);
    const grouped = await prisma.aiUsageLog.groupBy({
      by: ['feature'],
      where: { createdAt: { gte: since } },
      _sum: { totalTokens: true, costUsd: true },
      _count: { _all: true },
    });
    return grouped
      .map((g) => ({
        feature: g.feature,
        totalTokens: g._sum.totalTokens ?? 0,
        totalCostUsd: g._sum.costUsd ? Number(g._sum.costUsd) : 0,
        calls: g._count._all,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
  });
}

export interface UsageByModel {
  provider: string;
  model: string;
  totalTokens: number;
  totalCostUsd: number;
  calls: number;
  failedCalls: number;
}

export async function getUsageByModel(days = 30): Promise<UsageByModel[]> {
  return runAsPlatform(async () => {
    const since = rangeSince(days);
    const grouped = await prisma.aiUsageLog.groupBy({
      by: ['provider', 'model'],
      where: { createdAt: { gte: since } },
      _sum: { totalTokens: true, costUsd: true },
      _count: { _all: true },
    });
    const failedGrouped = await prisma.aiUsageLog.groupBy({
      by: ['provider', 'model'],
      where: { createdAt: { gte: since }, success: false },
      _count: { _all: true },
    });
    const failedMap = new Map(failedGrouped.map((g) => [`${g.provider}::${g.model}`, g._count._all]));

    return grouped
      .map((g) => ({
        provider: g.provider,
        model: g.model,
        totalTokens: g._sum.totalTokens ?? 0,
        totalCostUsd: g._sum.costUsd ? Number(g._sum.costUsd) : 0,
        calls: g._count._all,
        failedCalls: failedMap.get(`${g.provider}::${g.model}`) ?? 0,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
  });
}

export interface TenantAiUsage {
  summary: UsageSummary;
  byFeature: UsageByFeature[];
  usesPlatformKey: boolean;
  currentMonthBillableCostUsd: number;
}

/** Per-workspace usage detail for the Workspace Accounts drawer, including the
 *  running monthly bill (billable cost so far this calendar month) for
 *  tenants using the platform-provided API key. */
export async function getTenantAiUsage(tenantId: string, days = 30): Promise<TenantAiUsage> {
  return runAsPlatform(async () => {
    const since = rangeSince(days);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [totals, successCount, unpriced, byFeature, monthBillable] = await Promise.all([
      prisma.aiUsageLog.aggregate({
        where: { tenantId, createdAt: { gte: since } },
        _sum: { totalTokens: true, promptTokens: true, completionTokens: true, costUsd: true },
        _count: { _all: true },
      }),
      prisma.aiUsageLog.count({ where: { tenantId, createdAt: { gte: since }, success: true } }),
      prisma.aiUsageLog.count({ where: { tenantId, createdAt: { gte: since }, costUsd: null } }),
      prisma.aiUsageLog.groupBy({
        by: ['feature'],
        where: { tenantId, createdAt: { gte: since } },
        _sum: { totalTokens: true, costUsd: true },
        _count: { _all: true },
      }),
      prisma.aiUsageLog.aggregate({
        where: { tenantId, billable: true, createdAt: { gte: monthStart } },
        _sum: { costUsd: true },
      }),
    ]);

    const totalCalls = totals._count._all;
    const currentMonthBillableCostUsd = monthBillable._sum.costUsd ? Number(monthBillable._sum.costUsd) : 0;
    const usesPlatformKey = await isBillableToTenant(tenantId);

    return {
      summary: {
        totalCalls,
        successfulCalls: successCount,
        successRate: totalCalls ? Math.round((successCount / totalCalls) * 1000) / 10 : 100,
        totalTokens: totals._sum.totalTokens ?? 0,
        promptTokens: totals._sum.promptTokens ?? 0,
        completionTokens: totals._sum.completionTokens ?? 0,
        totalCostUsd: totals._sum.costUsd ? Number(totals._sum.costUsd) : 0,
        billableCostUsd: 0, // not meaningful for the rolling window here — see currentMonthBillableCostUsd
        unpricedCalls: unpriced,
      },
      byFeature: byFeature
        .map((g) => ({
          feature: g.feature,
          totalTokens: g._sum.totalTokens ?? 0,
          totalCostUsd: g._sum.costUsd ? Number(g._sum.costUsd) : 0,
          calls: g._count._all,
        }))
        .sort((a, b) => b.totalTokens - a.totalTokens),
      usesPlatformKey,
      currentMonthBillableCostUsd,
    };
  });
}
