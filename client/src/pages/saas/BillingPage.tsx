import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Spinner } from '../../components/ui/Spinner.js';
import {
  fetchBillingOverview,
  fetchBillingConfig,
  changePlan,
  cancelSubscription,
  resumeSubscription,
  openRazorpayCheckout,
  verifyCheckout,
  purchaseAddon,
  decreaseAddon,
  cancelPendingAddonChange,
  setAutoPay,
} from '../../services/billingApi.js';
import { apiErrorMessage } from '../../services/api.js';
import { useAuthStore } from '../../store/authStore.js';
import type { BillableMetric, OverageCharge, PendingAddonChangeItem, RecurringAddonBreakdownItem, UsageEntry } from '@agnohire/shared';

const RENEWAL_WARNING_LEAD_MS = 5 * 24 * 60 * 60 * 1000; // 5 days — mirrors the server's reminder lead time

/** Singular entity noun for a billable metric, e.g. "organization". */
const ENTITY_LABEL: Record<BillableMetric, string> = {
  ORGANIZATIONS: 'organization',
  WORKSPACES: 'workspace',
  USERS: 'user',
  CANDIDATES: 'candidate',
};

/** metric+delta may be split across several separate purchase requests (e.g.
 * clicking "Remove 1" three times) — group them for display so the page
 * shows one "Remove 3, effective <date>" line instead of three duplicates,
 * while still tracking each underlying id so "Undo all" can cancel every one. */
interface PendingGroup {
  metric: BillableMetric;
  effectiveAt: string | null;
  totalUnits: number;
  ids: string[];
}
function groupPendingChanges(changes: PendingAddonChangeItem[]): Map<BillableMetric, PendingGroup> {
  const map = new Map<string, PendingGroup>();
  for (const c of changes) {
    const key = `${c.metric}|${c.effectiveAt ?? ''}`;
    const g = map.get(key) ?? { metric: c.metric, effectiveAt: c.effectiveAt, totalUnits: 0, ids: [] };
    g.totalUnits += Math.abs(c.delta);
    g.ids.push(c.id);
    map.set(key, g);
  }
  // Callers look up by metric only — a metric practically only ever has one
  // effective date pending at once (they all target "next renewal").
  const byMetric = new Map<BillableMetric, PendingGroup>();
  for (const g of map.values()) byMetric.set(g.metric, g);
  return byMetric;
}

/** used/limit bar — "Unlimited" text (not a near-empty sliver) when there's no
 * cap, and a clear "+N over" chip instead of a bar that's just solid red with
 * no sense of scale when usage has gone past the limit. */
function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit == null) {
    return <span className="text-xs text-text-secondary">Unlimited</span>;
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const over = used > limit;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 shrink-0 overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full ${over ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {over && (
        <span className="whitespace-nowrap rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
          +{used - limit} over
        </span>
      )}
    </div>
  );
}

/**
 * Tenant billing & usage (admin/owner). New page inside the existing AppLayout
 * shell — the client only mirrors server-enforced limits.
 */
export function BillingPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const overview = useQuery({ queryKey: ['billing', 'overview'], queryFn: fetchBillingOverview });
  const config = useQuery({ queryKey: ['billing', 'config'], queryFn: fetchBillingConfig });

  /** Shared by changePlan/resumeSubscription: both return either an immediate
   * {changed:true} (FREE downgrade) or a CheckoutBootstrap that must be handed
   * to Razorpay to actually collect payment. */
  function handleCheckoutResult(result: { changed: true } | Awaited<ReturnType<typeof changePlan>>, successMsg: string) {
    if ('changed' in result) {
      toast.success(successMsg);
      qc.invalidateQueries({ queryKey: ['billing'] });
      return;
    }
    openRazorpayCheckout({
      keyId: result.keyId,
      razorpaySubscriptionId: result.razorpaySubscriptionId,
      name: user?.fullName ?? '',
      email: user?.email ?? '',
      onSuccess: async (payload) => {
        try {
          await verifyCheckout(payload);
          toast.success('Payment successful — ' + successMsg.toLowerCase());
        } catch (err) {
          toast.error(apiErrorMessage(err, 'Payment verification failed'));
        } finally {
          qc.invalidateQueries({ queryKey: ['billing'] });
        }
      },
      onDismiss: () => {
        toast.error('Payment was not completed — change was not applied.');
        qc.invalidateQueries({ queryKey: ['billing'] });
      },
    });
  }

  const change = useMutation({
    mutationFn: ({ code }: { code: string }) => changePlan(code),
    onSuccess: (result) => handleCheckoutResult(result, 'Plan changed.'),
    onError: (err) => toast.error(apiErrorMessage(err, 'Plan change failed')),
  });

  const cancel = useMutation({
    mutationFn: () => cancelSubscription(true),
    onSuccess: () => {
      toast.success('Subscription will cancel at the end of the current period.');
      qc.invalidateQueries({ queryKey: ['billing'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Cancellation failed')),
  });

  const resume = useMutation({
    mutationFn: () => resumeSubscription(),
    onSuccess: (result) => handleCheckoutResult(result, 'Subscription resumed.'),
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not resume subscription')),
  });

  const autoPay = useMutation({
    mutationFn: (enabled: boolean) => setAutoPay(enabled),
    onSuccess: (result) => {
      toast.success(result.autoPayEnabled ? 'Auto-pay enabled.' : 'Auto-pay disabled.');
      qc.invalidateQueries({ queryKey: ['billing'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not update auto-pay')),
  });

  if (overview.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (overview.isError || !overview.data) {
    return <p className="p-6 text-sm text-text-secondary">Billing information is unavailable for this account.</p>;
  }

  const { subscription, usage, invoices, overage, addonPurchases, recurringAddon, pendingAddonChanges } = overview.data;
  const canAutoPay = subscription.plan.priceMonthly != null && Number(subscription.plan.priceMonthly) > 0;

  const overageByMetric = new Map<string, OverageCharge>(overage.charges.map((c) => [c.metric, c]));
  const addonByMetric = new Map<string, RecurringAddonBreakdownItem>(recurringAddon.breakdown.map((b) => [b.metric, b]));
  const pendingByMetric = groupPendingChanges(pendingAddonChanges);

  // Persistent warning: shows continuously from 5 days before renewal through
  // to the renewal itself (recomputed live on every render off the actual
  // date, not a one-time flag) whenever there's a nonzero recurring add-on/
  // overage amount that would ride along with that renewal.
  const upcomingTotal = recurringAddon.total + overage.total;
  const periodEndMs = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).getTime() : null;
  const showRenewalWarning = upcomingTotal > 0 && periodEndMs != null && periodEndMs - Date.now() <= RENEWAL_WARNING_LEAD_MS;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Billing &amp; Usage</h1>
        <p className="text-sm text-text-secondary">Your plan, usage meters, and invoices.</p>
      </div>

      {/* Persistent pre-renewal warning — visible continuously for the last 5
          days of the cycle whenever a nonzero add-on/overage amount will ride
          along with the renewal (see RENEWAL_WARNING_LEAD_MS above). This is
          the same lead time the server's email/in-app reminder uses. */}
      {showRenewalWarning && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <span className="text-red-700 dark:text-red-300">
            Your subscription renews on {new Date(subscription.currentPeriodEnd!).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })} and will include an extra{' '}
            <strong>₹{upcomingTotal.toLocaleString('en-IN')}</strong> for add-on capacity and usage beyond your plan.{' '}
            {subscription.autoPayEnabled
              ? 'This will be collected automatically since auto-pay is enabled.'
              : 'Auto-pay is OFF, so this will not be collected automatically — enable it below, or it will remain outstanding.'}
          </span>
        </div>
      )}

      {/* Current plan */}
      <div className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm text-text-secondary">Current plan</div>
            <div className="text-lg font-semibold text-text-primary">{subscription.plan.name}</div>
            <div className="mt-1 text-xs text-text-secondary">
              Status: <span className="font-medium">{subscription.status}</span>
              {subscription.currentPeriodEnd &&
                ` · renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`}
              {subscription.cancelAtPeriodEnd && ' · cancels at period end'}
            </div>
          </div>
          {subscription.cancelAtPeriodEnd ? (
            <div className="flex flex-col items-end gap-1">
              <Button variant="secondary" onClick={() => resume.mutate()} disabled={resume.isPending}>
                Resume subscription
              </Button>
              <p className="max-w-xs text-right text-xs text-text-secondary">
                You'll be asked to confirm payment again — resuming starts a fresh billing cycle from today rather than continuing the current one.
              </p>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Cancel at period end
            </Button>
          )}
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={subscription.autoPayEnabled}
              disabled={autoPay.isPending || !canAutoPay}
              onChange={(e) => autoPay.mutate(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border"
            />
            <span>
              <span className="font-medium text-text-primary">Auto-pay add-on &amp; usage charges</span>
              <p className="text-xs text-text-secondary">
                {canAutoPay
                  ? 'When enabled, the recurring add-on/overage amount is automatically added to your next Razorpay-collected invoice — using the payment mandate you already set up, no new card details. Off by default; you can turn it off any time.'
                  : 'Available once you\'re on a paid plan with an active Razorpay mandate.'}
                {subscription.autoPayConsentedAt && (
                  <> Last enabled {new Date(subscription.autoPayConsentedAt).toLocaleDateString()}.</>
                )}
              </p>
            </span>
          </label>
        </div>
      </div>

      {/* Usage & add-on capacity — everything about one metric (this period's
          usage, any add-on capacity you own and its recurring cost, a
          scheduled removal, over-quota overage, and the buy/remove controls)
          lives in ONE row instead of being scattered across separate cards —
          that scattering was the main source of confusion this replaces. */}
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-sm font-medium text-text-primary">Usage &amp; add-on capacity</h2>
        <p className="mb-4 text-xs text-text-secondary">
          What you're using this period, plus any extra capacity you've bought. Metrics with a price per unit can be
          topped up below; others are hard limits set by your plan.
        </p>
        <div className="divide-y divide-border">
          {usage.usage.map((u) => (
            <UsageMetricRow
              key={u.metric}
              entry={u}
              overageCharge={overageByMetric.get(u.metric)}
              addonBreakdown={addonByMetric.get(u.metric)}
              pending={u.unitPrice != null ? pendingByMetric.get(u.metric as BillableMetric) : undefined}
              autoPayEnabled={subscription.autoPayEnabled}
            />
          ))}
        </div>
        {recurringAddon.total > 0 && (
          <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm font-semibold text-text-primary">
            <span>Recurring add-on total / mo</span>
            <span>₹{recurringAddon.total.toLocaleString('en-IN')}</span>
          </div>
        )}
        {overage.total > 0 && (
          <div className="mt-2 flex items-center justify-between text-sm font-semibold text-amber-700 dark:text-amber-400">
            <span>
              Overage total this period
              {subscription.autoPayEnabled ? ' (auto-collected at renewal)' : ' (estimate — auto-pay is off)'}
            </span>
            <span>₹{overage.total.toLocaleString('en-IN')}</span>
          </div>
        )}
      </div>

      {/* Add-on purchase history */}
      {addonPurchases.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="mb-4 text-sm font-medium text-text-primary">Add-on purchase history</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-secondary">
                <th className="pb-2 text-left">Date</th>
                <th className="pb-2 text-left">Item</th>
                <th className="pb-2 text-left">Amount</th>
              </tr>
            </thead>
            <tbody>
              {addonPurchases.map((p) => (
                <tr key={p.id} className="border-t border-border text-text-primary">
                  <td className="py-2 align-top">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 align-top text-text-secondary">
                    {p.quantity} × {ENTITY_LABEL[p.metric]}{p.quantity === 1 ? '' : 's'} (₹{p.unitPrice.toLocaleString('en-IN')} each)
                    {p.prorationAmount != null && (
                      <div className="mt-0.5 text-xs">
                        Prorated charge ₹{p.prorationAmount.toLocaleString('en-IN')} —{' '}
                        {p.paymentLinkStatus === 'PAID'
                          ? 'paid'
                          : p.paymentLinkStatus === 'EXPIRED' || p.paymentLinkStatus === 'CANCELLED'
                            ? p.paymentLinkStatus.toLowerCase()
                            : 'awaiting payment'}
                      </div>
                    )}
                  </td>
                  <td className="py-2 align-top">₹{p.amount.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Plan catalogue */}
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-4 text-sm font-medium text-text-primary">Change plan</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(config.data?.plans ?? []).map((p) => {
            const isCurrent = p.code === subscription.plan.code;
            return (
              <div key={p.code} className="flex flex-col rounded-xl border border-border p-4">
                <div className="font-medium text-text-primary">{p.name}</div>
                <div className="mt-1 text-xs text-text-secondary">
                  {p.priceMonthly != null ? `₹${Number(p.priceMonthly).toLocaleString('en-IN')}/mo` : '—'}
                </div>
                <Button
                  variant={isCurrent ? 'ghost' : 'secondary'}
                  className="mt-3 w-full"
                  disabled={isCurrent || change.isPending}
                  onClick={() => change.mutate({ code: p.code })}
                >
                  {isCurrent ? 'Current plan' : 'Switch'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invoices */}
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-4 text-sm font-medium text-text-primary">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-text-secondary">No invoices yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-secondary">
                <th className="pb-2 text-left">Date</th>
                <th className="pb-2 text-left">Amount</th>
                <th className="pb-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-border text-text-primary">
                  <td className="py-2">{new Date(inv.paidAt ?? inv.createdAt).toLocaleDateString()}</td>
                  <td className="py-2">
                    {inv.amount != null ? `₹${Number(inv.amount).toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="py-2">{inv.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * One usage metric, fully self-contained: this period's usage, any add-on
 * capacity owned + its recurring cost, a scheduled removal (if any), an
 * over-quota overage note (if any), and — only for metrics with a per-unit
 * price configured — the buy/remove controls.
 */
function UsageMetricRow({
  entry,
  overageCharge,
  addonBreakdown,
  pending,
  autoPayEnabled,
}: {
  entry: UsageEntry;
  overageCharge: OverageCharge | undefined;
  addonBreakdown: RecurringAddonBreakdownItem | undefined;
  pending: PendingGroup | undefined;
  autoPayEnabled: boolean;
}) {
  const purchasable = entry.unitPrice != null;
  const metric = entry.metric as BillableMetric;

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium capitalize text-text-primary">{entry.metric.replace(/_/g, ' ').toLowerCase()}</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-secondary">
            {entry.used} / {entry.limit ?? '∞'}
          </span>
          <UsageBar used={entry.used} limit={entry.limit} />
        </div>
      </div>

      {addonBreakdown && (
        <p className="mt-1 text-xs text-text-secondary">
          {addonBreakdown.extraUnits} extra {ENTITY_LABEL[metric]}{addonBreakdown.extraUnits === 1 ? '' : 's'} owned — ₹
          {addonBreakdown.amount.toLocaleString('en-IN')}/mo (₹{addonBreakdown.unitPrice.toLocaleString('en-IN')} each), included in every renewal.
        </p>
      )}

      {overageCharge && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          {overageCharge.unitsOver} over your included quota — ₹{overageCharge.amount.toLocaleString('en-IN')}{' '}
          {autoPayEnabled ? '(auto-collected at renewal)' : '(estimate — auto-pay is off, buy add-on capacity below to cover it going forward)'}
        </p>
      )}

      {pending && (
        <PendingChangeNote metric={metric} totalUnits={pending.totalUnits} effectiveAt={pending.effectiveAt} ids={pending.ids} />
      )}

      {purchasable && <AddonControls metric={metric} unitPrice={entry.unitPrice!} extra={entry.extra} />}
    </div>
  );
}

/** Consolidated "N pending removals" line — one Undo action cancels every
 * underlying request in the group, instead of showing one row per click. */
function PendingChangeNote({
  metric,
  totalUnits,
  effectiveAt,
  ids,
}: {
  metric: BillableMetric;
  totalUnits: number;
  effectiveAt: string | null;
  ids: string[];
}) {
  const qc = useQueryClient();
  const undoAll = useMutation({
    mutationFn: () => Promise.all(ids.map((id) => cancelPendingAddonChange(id))),
    onSuccess: () => {
      toast.success('Scheduled removal cancelled.');
      qc.invalidateQueries({ queryKey: ['billing'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not cancel')),
  });
  const when = effectiveAt ? new Date(effectiveAt).toLocaleDateString() : 'next renewal';

  return (
    <div className="mt-1 flex items-center justify-between text-xs">
      <span className="text-text-secondary">
        Scheduled: remove {totalUnits} {ENTITY_LABEL[metric]}{totalUnits === 1 ? '' : 's'} — effective {when}
      </span>
      <Button size="sm" variant="ghost" loading={undoAll.isPending} onClick={() => undoAll.mutate()}>
        Undo
      </Button>
    </div>
  );
}

/** Buy/remove controls for one metric's add-on capacity — its own local quantity state and mutations. */
function AddonControls({ metric, unitPrice, extra }: { metric: BillableMetric; unitPrice: number; extra: number }) {
  const qc = useQueryClient();
  const [buyQty, setBuyQty] = useState('1');
  const [removeQty, setRemoveQty] = useState('1');
  const [payLink, setPayLink] = useState<{ url: string; amount: number } | null>(null);
  const qty = Math.max(1, Math.floor(Number(buyQty) || 1));
  const rQty = Math.max(1, Math.min(extra, Math.floor(Number(removeQty) || 1)));

  const buy = useMutation({
    mutationFn: () => purchaseAddon(metric, qty),
    onSuccess: (result) => {
      toast.success(`Purchased ${result.quantity} more ${ENTITY_LABEL[metric]}${result.quantity === 1 ? '' : 's'}.`);
      setBuyQty('1');
      if (result.paymentLinkUrl && result.prorationAmount) {
        setPayLink({ url: result.paymentLinkUrl, amount: result.prorationAmount });
      }
      qc.invalidateQueries({ queryKey: ['billing'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Purchase failed')),
  });

  const remove = useMutation({
    mutationFn: () => decreaseAddon(metric, rQty),
    onSuccess: (change) => {
      const when = change.effectiveAt ? new Date(change.effectiveAt).toLocaleDateString() : 'your next renewal';
      toast.success(`Scheduled removal of ${rQty} ${ENTITY_LABEL[metric]}${rQty === 1 ? '' : 's'}, effective ${when}.`);
      setRemoveQty('1');
      qc.invalidateQueries({ queryKey: ['billing'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not schedule removal')),
  });

  return (
    <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
      <div>
        <div className="text-[11px] text-text-secondary">Add capacity — ₹{unitPrice.toLocaleString('en-IN')} each</div>
        <div className="mt-1 flex items-center gap-2">
          <Input type="number" min={1} value={buyQty} onChange={(e) => setBuyQty(e.target.value)} className="w-16" />
          <Button size="sm" loading={buy.isPending} onClick={() => buy.mutate()}>
            Buy for ₹{(qty * unitPrice).toLocaleString('en-IN')}
          </Button>
        </div>
      </div>
      {extra > 0 && (
        <div>
          <div className="text-[11px] text-text-secondary">Remove capacity — takes effect next renewal</div>
          <div className="mt-1 flex items-center gap-2">
            <Input type="number" min={1} max={extra} value={removeQty} onChange={(e) => setRemoveQty(e.target.value)} className="w-16" />
            <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </Button>
          </div>
        </div>
      )}
      {payLink && (
        <div className="mt-1 w-full rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="text-amber-800 dark:text-amber-300">
            Your new capacity is active now. A prorated charge of <strong>₹{payLink.amount.toLocaleString('en-IN')}</strong>{' '}
            covers the rest of this billing cycle — pay it now to settle it immediately (the next renewal will already bill the full amount).
          </p>
          <a href={payLink.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-medium text-primary underline">
            Pay ₹{payLink.amount.toLocaleString('en-IN')} now
          </a>
        </div>
      )}
    </div>
  );
}

export default BillingPage;
