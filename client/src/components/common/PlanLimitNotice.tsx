import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { ROLES, type UsageMetric } from '@agnohire/shared';
import { Button } from '../ui/Button.js';
import { useAuthStore } from '../../store/authStore.js';
import { ROLE_BASE } from '../../config/rolePaths.js';
import { withTenant } from '../../utils/tenantPath.js';
import { usePlanUsage } from '../../hooks/usePlanUsage.js';

/** Human label for the action a metric gates, used in the hard-block message. */
const ACTION_LABEL: Record<UsageMetric, string> = {
  CANDIDATES: 'add more candidates',
  SCHEDULES: 'schedule more interviews',
  ACTIVE_JOBS: 'open more active jobs',
  USERS: 'add more users',
  INTERVIEWED_CANDIDATES: 'interview more candidates this period',
  ORGANIZATIONS: 'create more organizations',
  WORKSPACES: 'create more workspaces',
};

/** Singular entity noun, used in the metered-overage message ("₹100/organization"). */
const ENTITY_LABEL: Record<UsageMetric, string> = {
  CANDIDATES: 'candidate',
  SCHEDULES: 'schedule',
  ACTIVE_JOBS: 'active job',
  USERS: 'user',
  INTERVIEWED_CANDIDATES: 'interviewed candidate',
  ORGANIZATIONS: 'organization',
  WORKSPACES: 'workspace',
};

/** Roles that can change the plan (billing is role-gated on the server). */
const CAN_BILL = new Set<string>([ROLES.ADMIN, ROLES.TENANT_OWNER, ROLES.SUPERADMIN]);

/**
 * Inline banner shown once the current plan's included quota (plus any
 * purchased add-on capacity) for `metric` is used up. Renders nothing when
 * under the limit. Creation is always hard-blocked at this point — there is
 * no automatic metered-overage bypass — so this always points billing-
 * capable users at either buying more add-on capacity or upgrading the plan,
 * both on the Billing & Usage page.
 */
export function PlanLimitNotice({ metric }: { metric: UsageMetric }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { entryFor, isReached } = usePlanUsage();

  if (!user || !isReached(metric)) return null;
  const e = entryFor(metric);
  const canBill = CAN_BILL.has(user.role);
  const canBuyAddon = e?.unitPrice != null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
      <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          You&apos;ve reached your plan limit to {ACTION_LABEL[metric]}
          {e?.limit != null ? ` (${e.used}/${e.limit})` : ''}.{' '}
          {canBill
            ? canBuyAddon
              ? `Buy add-on ${ENTITY_LABEL[metric]} capacity on the Billing & Usage page, or upgrade your plan.`
              : 'Upgrade your plan to continue.'
            : 'Contact your workspace admin to buy add-on capacity or upgrade the plan.'}
        </span>
      </div>
      {canBill && (
        <Button size="sm" variant="outline" onClick={() => navigate(`${withTenant(ROLE_BASE[user.role], user.tenantSlug)}/billing`)}>
          {canBuyAddon ? 'Buy add-on capacity' : 'Upgrade plan'}
        </Button>
      )}
    </div>
  );
}
