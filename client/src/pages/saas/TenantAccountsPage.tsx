import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Trash2, Copy, Pencil, LogIn, Phone, Check, X, Mail, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { ROLE_HOME, type TenantStatus, type TenantListItem } from '@agnohire/shared';
import { PageHeader } from '../../components/common/PageHeader.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { useConfirm } from '../../providers/ConfirmProvider.js';
import * as platformApi from '../../services/platformApi.js';
import { fetchBillingConfig } from '../../services/billingApi.js';
import { apiErrorMessage, setAccessToken } from '../../services/api.js';
import { withTenant } from '../../utils/tenantPath.js';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatUsd(n: number): string {
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function statusVariant(s: TenantStatus): 'success' | 'danger' | 'warning' | 'info' {
  if (s === 'ACTIVE') return 'success';
  if (s === 'SUSPENDED') return 'warning';
  if (s === 'CANCELLED') return 'danger';
  return 'info';
}

type Tab = 'pending' | 'mine' | 'self';

/** Platform-superadmin Workspace Accounts admin (list, detail, create, edit, impersonate). */
export function TenantAccountsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TenantListItem | null>(null);

  const { data: workspaces, isLoading } = useQuery({ queryKey: ['platform-workspaces'], queryFn: platformApi.fetchTenants });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['platform-workspaces'] });

  const all = workspaces ?? [];
  const pending = all.filter((w) => w.approvalStatus === 'PENDING');
  const mine = all.filter((w) => w.createdByMe);
  const self = all.filter((w) => !w.createdById);
  const rows = tab === 'mine' ? mine : tab === 'self' ? self : pending;

  const approve = useMutation({
    mutationFn: (id: string) => platformApi.approveTenant(id),
    onSuccess: (_d, id) => {
      const w = all.find((x) => x.id === id);
      const isPaid = !!w?.planCode && w.planCode !== 'FREE';
      toast.success(isPaid ? 'Workspace approved — owner can now sign in' : 'Workspace approved — owner can now sign in (14-day trial started)');
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not approve workspace')),
  });

  const reject = useMutation({
    mutationFn: (id: string) => platformApi.rejectTenant(id),
    onSuccess: () => { toast.success('Workspace rejected'); invalidate(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not reject workspace')),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'SUSPENDED' }) => platformApi.setTenantStatus(id, status),
    onSuccess: (_d, v) => { toast.success(v.status === 'SUSPENDED' ? 'Workspace suspended' : 'Workspace reactivated'); invalidate(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update workspace')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => platformApi.deleteTenant(id),
    onSuccess: () => { toast.success('Workspace deleted'); invalidate(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not delete workspace')),
  });

  const impersonate = useMutation({
    mutationFn: (id: string) => platformApi.loginToTenant(id),
    onSuccess: ({ accessToken, user }) => {
      setAccessToken(accessToken);
      // Entering a different tenant: drop every cached query so the operator's
      // own (or a previously-impersonated tenant's) jobs/stats/lists can't
      // linger. Query keys aren't tenant-scoped.
      qc.clear();
      toast.success(`Signed in as ${user.email}`);
      // Hard navigation, NOT client-side: switching identity (SUPERADMIN → the
      // tenant's ADMIN) while still on this role-guarded platform route makes
      // the current RoleRoute bounce to /unauthorized before we land — the "403
      // until refresh" bug. A full load re-bootstraps from the owner's refresh
      // cookie, exactly like a manual refresh does.
      window.location.assign(withTenant(ROLE_HOME[user.role], user.tenantSlug));
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not sign in to workspace')),
  });

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'pending', label: 'Pending Approval', count: pending.length },
    { key: 'mine', label: 'Provisioned', count: mine.length },
    { key: 'self', label: 'Self-Registered', count: self.length },
  ];

  return (
    <div>
      <PageHeader
        title="Workspace Accounts"
        description="Every tenant workspace on the platform, with usage stats and lifecycle controls."
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Create workspace</Button>}
      />

      <div className="mt-4 inline-flex rounded-lg border border-border bg-surface p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === t.key ? 'bg-accent text-accent-fg' : 'text-text-secondary hover:text-text-primary'}`}
          >
            {t.label} <span className="opacity-70">({t.count})</span>
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : !rows.length ? (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title={tab === 'pending' ? 'No workspaces awaiting approval' : tab === 'mine' ? 'No provisioned workspaces yet' : 'No self-registered workspaces'}
            description={tab === 'pending' ? 'Self-registered signups appear here for you to call and approve before they can sign in.' : tab === 'mine' ? 'Use “Create workspace” to provision one you can manage and sign into.' : 'Tenants that sign up themselves appear here.'}
          />
        ) : tab === 'pending' ? (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3 font-medium text-left">Workspace</th>
                <th className="px-4 py-3 font-medium text-left">Contact</th>
                <th className="px-4 py-3 font-medium text-left">Plan</th>
                <th className="px-4 py-3 font-medium text-left">Requested</th>
                <th className="px-4 py-3 font-medium text-right">Decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const isPaidPlan = !!w.planCode && w.planCode !== 'FREE';
                const awaitingPayment = isPaidPlan && w.subscriptionStatus !== 'ACTIVE';
                return (
                <tr key={w.id} className="border-b border-border/60 last:border-0 hover:bg-surface-raised">
                  <td className="px-4 py-3">
                    <p className="text-text-primary">{w.name}</p>
                    <p className="flex items-center gap-1 text-xs text-text-muted"><Mail className="h-3 w-3" />{w.ownerEmail ?? '—'}
                      {w.ownerEmailFreemail && <Badge variant="warning" className="ml-1">free email</Badge>}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <a href={w.phone ? `tel:${w.phone}` : undefined} className="flex items-center gap-1.5 text-text-primary hover:text-accent">
                      <Phone className="h-3.5 w-3.5" />{w.phone ?? 'no phone'}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {w.planName ?? w.planCode ?? '—'}
                    {awaitingPayment && <Badge variant="warning" className="ml-2">Awaiting payment</Badge>}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{new Date(w.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        disabled={approve.isPending || reject.isPending || awaitingPayment}
                        title={awaitingPayment ? 'This workspace selected a paid plan and hasn’t completed payment yet' : undefined}
                        onClick={() => approve.mutate(w.id)}
                      >
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button size="sm" variant="ghost" className="text-danger" disabled={approve.isPending || reject.isPending}
                        onClick={async () => { if (await confirm({ title: 'Reject workspace', message: `Reject ${w.name}? Its owner won't be able to sign in.`, confirmText: 'Reject', variant: 'danger' })) reject.mutate(w.id); }}>
                        <X className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3 font-medium text-left">Workspace</th>
                <th className="px-4 py-3 font-medium text-left">Plan</th>
                <th className="px-4 py-3 font-medium text-left">Status</th>
                <th className="px-4 py-3 font-medium text-left">Users</th>
                <th className="px-4 py-3 font-medium text-left">Jobs</th>
                <th className="px-4 py-3 font-medium text-left">Candidates</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-raised" onClick={() => setOpenId(w.id)}>
                  <td className="px-4 py-3"><p className="text-text-primary">{w.name}</p><p className="text-xs text-text-muted">{w.slug} · {w.ownerEmail ?? 'no owner yet'}</p></td>
                  <td className="px-4 py-3 text-text-secondary">{w.planName ?? '—'}</td>
                  <td className="px-4 py-3"><Badge variant={statusVariant(w.status)}>{w.status}</Badge></td>
                  <td className="px-4 py-3 text-text-secondary">{w.userCount}</td>
                  <td className="px-4 py-3 text-text-secondary">{w.jobCount}</td>
                  <td className="px-4 py-3 text-text-secondary">{w.candidateCount}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-2">
                      {w.createdByMe && (
                        <>
                          <Button size="sm" variant="secondary" disabled={!w.ownerUserId || impersonate.isPending} onClick={() => impersonate.mutate(w.id)}><LogIn className="h-3.5 w-3.5" /> Login</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(w)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                        </>
                      )}
                      {w.status === 'SUSPENDED' ? (
                        <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: w.id, status: 'ACTIVE' })}>Activate</Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: w.id, status: 'SUSPENDED' })}>Suspend</Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-danger" onClick={async () => { if (await confirm({ title: 'Delete workspace', message: `Delete ${w.name}? This soft-deletes the workspace and blocks its users.`, confirmText: 'Delete', variant: 'danger' })) remove.mutate(w.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <TenantDetailDrawer id={openId} onClose={() => setOpenId(null)} />
      {creating && <CreateTenantDrawer onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setTab('mine'); invalidate(); }} />}
      {editing && <EditTenantDrawer tenant={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} />}
    </div>
  );
}

function TenantDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: w, isLoading } = useQuery({
    queryKey: ['platform-workspace', id],
    queryFn: () => platformApi.fetchTenant(id!),
    enabled: !!id,
  });
  const { data: aiUsage } = useQuery({
    queryKey: ['platform-workspace-ai-usage', id],
    queryFn: () => platformApi.fetchTenantAiUsage(id!, 30),
    enabled: !!id,
  });
  const { data: storage } = useQuery({
    queryKey: ['platform-workspace-storage', id],
    queryFn: () => platformApi.fetchTenantStorageUsage(id!),
    enabled: !!id,
  });

  const toggleCareersFeature = useMutation({
    mutationFn: (enabled: boolean) => platformApi.setTenantCareersFeature(id!, enabled),
    onSuccess: (_d, enabled) => {
      toast.success(enabled ? 'Careers page feature granted' : 'Careers page feature revoked');
      qc.invalidateQueries({ queryKey: ['platform-workspace', id] });
      qc.invalidateQueries({ queryKey: ['platform-workspaces'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update feature grant')),
  });

  return (
    <Drawer open={!!id} onClose={onClose} title="Workspace" subtitle={w?.name}>
      {isLoading || !w ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="space-y-5 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <Info label="Slug" value={w.slug} />
            <Info label="Status" value={w.status} />
            <Info label="Plan" value={w.planName ?? '—'} />
            <Info label="Subscription" value={w.subscriptionStatus ?? '—'} />
            <Info label="Owner" value={w.ownerEmail ?? '—'} />
            <Info label="Origin" value={w.createdById ? (w.createdByMe ? 'Provisioned by you' : 'Provisioned by an operator') : 'Self-registered'} />
            <Info label="Created" value={new Date(w.createdAt).toLocaleDateString()} />
          </div>
          <div className="rounded-lg border border-border p-3">
            <label className="flex items-start justify-between gap-3">
              <span>
                <span className="block font-medium text-text-primary">Careers page (website embed)</span>
                <span className="block text-xs text-text-muted">Feature access is superadmin-only — off by default. Grant it for this workspace to request; if not requested, leave it off to keep it hidden from their Integrations page.</span>
              </span>
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-accent"
                checked={w.careersPageEnabled}
                disabled={toggleCareersFeature.isPending}
                onChange={(e) => toggleCareersFeature.mutate(e.target.checked)}
              />
            </label>
          </div>
          {(aiUsage || storage) && (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-medium text-text-primary">AI usage &amp; storage (last 30 days)</p>
              {aiUsage && (
                <div className="mb-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                    <span>AI key</span>
                    <Badge variant={aiUsage.usesPlatformKey ? 'warning' : 'info'}>{aiUsage.usesPlatformKey ? 'Platform key (billable)' : 'Own key (BYOK)'}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <Info label="AI calls" value={String(aiUsage.summary.totalCalls)} />
                    <Info label="Tokens used" value={formatTokens(aiUsage.summary.totalTokens)} />
                    <Info label="Est. cost (30d)" value={formatUsd(aiUsage.summary.totalCostUsd)} />
                    <Info label={aiUsage.usesPlatformKey ? 'Bill so far this month' : 'Billable this month'} value={aiUsage.usesPlatformKey ? formatUsd(aiUsage.currentMonthBillableCostUsd) : '$0.00 (BYOK)'} />
                  </div>
                </div>
              )}
              {storage && (
                <div className="border-t border-border pt-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <Info label="Candidate storage" value={formatBytes(storage.totalBytes)} />
                    <Info label="Candidates" value={String(storage.candidateCount)} />
                  </div>
                </div>
              )}
            </div>
          )}
          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-text-muted">Usage vs plan limits</p>
            <div className="space-y-3">
              {w.usage.map((u) => {
                const pct = u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
                return (
                  <div key={u.metric}>
                    <div className="mb-1 flex justify-between text-xs text-text-secondary">
                      <span>{u.metric.replace(/_/g, ' ')}</span>
                      <span>{u.used} / {u.limit ?? '∞'}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-border">
                      <div className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-accent'}`} style={{ width: u.limit ? `${pct}%` : '4%' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Info label="Jobs" value={String(w.jobCount)} />
            <Info label="Candidates" value={String(w.candidateCount)} />
            <Info label="Interviews" value={String(w.interviewCount)} />
            <Info label="Users" value={String(w.userCount)} />
          </div>
        </div>
      )}
    </Drawer>
  );
}

function CreateTenantDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [companyName, setCompanyName] = useState('');
  const [ownerFullName, setOwnerFullName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [planCode, setPlanCode] = useState('');
  const [done, setDone] = useState<{ token: string; email: string } | null>(null);

  const { data: config } = useQuery({ queryKey: ['billing', 'config'], queryFn: fetchBillingConfig });
  const planOptions = (config?.plans ?? []).map((p) => ({ value: p.code, label: `${p.name} (${p.code})` }));

  const create = useMutation({
    mutationFn: () => platformApi.createTenant({ companyName: companyName.trim(), ownerFullName: ownerFullName.trim(), ownerEmail: ownerEmail.trim(), ownerPassword, planCode }),
    onSuccess: (r) => { toast.success('Workspace provisioned'); setDone({ token: r.setPasswordToken, email: r.ownerEmail }); onCreated(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not create workspace')),
  });

  const passwordValid = ownerPassword.length >= 8 && /[A-Z]/.test(ownerPassword) && /[a-z]/.test(ownerPassword) && /[0-9]/.test(ownerPassword);
  const canSave = companyName.trim() && ownerFullName.trim() && /.+@.+\..+/.test(ownerEmail) && passwordValid && planCode;
  const setPasswordLink = done ? `${window.location.origin}/accept-invite?token=${done.token}` : '';

  return (
    <Drawer open onClose={onClose} title="Create workspace" subtitle="Provisions a tenant, subscription, and owner account"
      footer={done ? <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
        : <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={!canSave} onClick={() => create.mutate()}>Create</Button></div>}>
      {done ? (
        <div className="space-y-4 text-sm">
          <p className="text-text-secondary">Workspace created and its owner account is ready. <strong>{done.email}</strong> can sign in now with the password you set, and you can also enter it directly via the <strong>Login</strong> button in the list.</p>
          <p className="text-text-secondary">Optionally, share this set-password link so they can choose their own password (also emailed if SMTP is configured):</p>
          <div className="flex gap-2">
            <Input readOnly value={setPasswordLink} />
            <Button variant="outline" onClick={() => { navigator.clipboard.writeText(setPasswordLink); toast.success('Link copied'); }}><Copy className="h-4 w-4" /></Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Company name"><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Inc." /></Field>
          <Field label="Owner full name"><Input value={ownerFullName} onChange={(e) => setOwnerFullName(e.target.value)} /></Field>
          <Field label="Owner email"><Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@acme.com" /></Field>
          <Field label="Owner password">
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                placeholder="Min 8 chars, upper/lower/digit"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {ownerPassword.length > 0 && !passwordValid && <p className="mt-1 text-xs text-danger">Min 8 chars with an uppercase, lowercase and digit.</p>}
          </Field>
          <Field label="Plan"><Select placeholder="Select a plan" value={planCode} options={planOptions} onChange={(e) => setPlanCode(e.target.value)} /></Field>
        </div>
      )}
    </Drawer>
  );
}

function EditTenantDrawer({ tenant, onClose, onSaved }: { tenant: TenantListItem; onClose: () => void; onSaved: () => void }) {
  const confirm = useConfirm();
  const [name, setName] = useState(tenant.name);
  const [planCode, setPlanCode] = useState(tenant.planCode ?? '');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const { data: config } = useQuery({ queryKey: ['billing', 'config'], queryFn: fetchBillingConfig });
  const planOptions = (config?.plans ?? []).map((p) => ({ value: p.code, label: `${p.name} (${p.code})` }));

  const save = useMutation({
    mutationFn: () => platformApi.updateTenant(tenant.id, {
      name: name.trim(),
      ...(planCode && planCode !== tenant.planCode ? { planCode } : {}),
    }),
    onSuccess: () => { toast.success('Workspace updated'); onSaved(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update workspace')),
  });

  const resetPassword = useMutation({
    mutationFn: () => platformApi.resetOwnerPassword(tenant.id, ownerPassword),
    onSuccess: () => { toast.success('Owner password reset — they can sign in with the new password now.'); setOwnerPassword(''); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not reset owner password')),
  });

  const canSave = name.trim().length >= 2 && (name.trim() !== tenant.name || planCode !== (tenant.planCode ?? ''));
  const passwordValid = ownerPassword.length >= 8 && /[A-Z]/.test(ownerPassword) && /[a-z]/.test(ownerPassword) && /[0-9]/.test(ownerPassword);

  return (
    <Drawer open onClose={onClose} title="Edit workspace" subtitle={tenant.slug}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>Save</Button></div>}>
      <div className="space-y-4">
        <Field label="Workspace name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Plan"><Select value={planCode} options={planOptions} onChange={(e) => setPlanCode(e.target.value)} /></Field>
        <p className="text-xs text-text-muted">Slug (<span className="font-mono">{tenant.slug}</span>) is fixed — it backs subdomain routing and cannot be changed here.</p>

        <div className="border-t border-border pt-4">
          <p className="mb-1.5 text-sm font-medium text-text-secondary">Reset owner password</p>
          <p className="mb-3 text-xs text-text-muted">
            Set a new password for {tenant.ownerEmail ?? 'the workspace owner'} if they've forgotten theirs. This signs them out everywhere.
          </p>
          {!tenant.ownerUserId ? (
            <p className="text-xs text-text-muted">Workspace has no owner account yet.</p>
          ) : (
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={ownerPassword}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                    placeholder="Min 8 chars, upper/lower/digit"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {ownerPassword.length > 0 && !passwordValid && (
                  <p className="mt-1 text-xs text-danger">Min 8 chars with an uppercase, lowercase and digit.</p>
                )}
              </div>
              <Button
                variant="outline"
                disabled={!passwordValid || resetPassword.isPending}
                loading={resetPassword.isPending}
                onClick={async () => {
                  if (await confirm({
                    title: 'Reset owner password',
                    message: `Reset the password for ${tenant.ownerEmail}? They will be signed out of all active sessions.`,
                    confirmText: 'Reset password',
                    variant: 'danger',
                  })) resetPassword.mutate();
                }}
              >
                Reset
              </Button>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-sm font-medium text-text-secondary">{label}</label>{children}</div>;
}
function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="mb-1 text-xs uppercase tracking-wide text-text-muted">{label}</p><p className="break-words text-text-primary">{value}</p></div>;
}

export default TenantAccountsPage;
