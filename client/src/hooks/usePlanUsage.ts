import { useQuery } from '@tanstack/react-query';
import { ROLES, type UsageMetric, type UsageEntry } from '@agnohire/shared';
import { fetchTenantUsage } from '../services/billingApi.js';
import { useAuthStore } from '../store/authStore.js';

/**
 * Plan-usage for the current tenant, used to gate create actions in
 * the UI (the server is still the authority — every write re-checks the limit
 * and returns 402). Skipped for candidates and platform operators, who have no
 * tenant meter; on any error it fails open (no gating) so the app never blocks
 * on a usage read.
 */
export function usePlanUsage() {
  const user = useAuthStore((s) => s.user);
  const enabled = !!user && user.role !== ROLES.CANDIDATE && user.role !== ROLES.SUPERADMIN;

  const query = useQuery({
    queryKey: ['tenant-usage'],
    queryFn: fetchTenantUsage,
    enabled,
    retry: false,
    staleTime: 10_000,
  });

  const byMetric = new Map<UsageMetric, UsageEntry>((query.data?.usage ?? []).map((e) => [e.metric, e]));

  return {
    usage: query.data,
    /** The usage entry (used/limit/remaining) for a metric, if metered. */
    entryFor: (metric: UsageMetric): UsageEntry | undefined => byMetric.get(metric),
    /**
     * True once the plan's included quota for this metric — plus any
     * purchased add-on capacity, already folded into `limit` server-side —
     * is used up. The server always hard-blocks creation at this point (see
     * entitlementService.assertWithinLimit); there is no metered-overage
     * bypass anymore, so this is also exactly when a "create" action should
     * be disabled (kept as a separate name from isBlocked below purely so
     * call sites can say what they mean).
     */
    isReached: (metric: UsageMetric): boolean => {
      const e = byMetric.get(metric);
      return !!e && e.limit != null && (e.remaining ?? 0) <= 0;
    },
    /** Alias for isReached — use this to disable a "create" action. */
    isBlocked: (metric: UsageMetric): boolean => {
      const e = byMetric.get(metric);
      return !!e && e.limit != null && (e.remaining ?? 0) <= 0;
    },
  };
}
