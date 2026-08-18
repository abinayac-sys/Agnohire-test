import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Plus, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '../../components/common/PageHeader.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Badge } from '../../components/ui/Badge.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { Spinner } from '../../components/ui/Spinner.js';
import * as platformApi from '../../services/platformApi.js';
import { apiErrorMessage } from '../../services/api.js';
import type { PlanAdminDto } from '@agnohire/shared';

const fmtLimit = (n: number | null) => (n == null ? '∞' : n.toLocaleString());
const fmtPrice = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);

/** Platform-superadmin Plan catalogue management (Billing & Plans). */
export function PlansAdminPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PlanAdminDto | 'new' | null>(null);

  const { data: plans, isLoading } = useQuery({ queryKey: ['platform-plans'], queryFn: platformApi.fetchPlans });

  return (
    <div>
      <PageHeader
        title="Billing & Plans"
        description="Define the subscription plans, usage limits, and feature toggles offered to workspaces."
        actions={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> New plan</Button>}
      />

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : !plans?.length ? (
          <EmptyState icon={<CreditCard className="h-8 w-8" />} title="No plans" description="Create your first subscription plan." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3 font-medium text-left">Plan</th>
                <th className="px-4 py-3 font-medium text-left">Price / mo</th>
                <th className="px-4 py-3 font-medium text-left">Users</th>
                <th className="px-4 py-3 font-medium text-left">Orgs</th>
                <th className="px-4 py-3 font-medium text-left">Workspaces</th>
                <th className="px-4 py-3 font-medium text-left">Jobs</th>
                <th className="px-4 py-3 font-medium text-left">Candidates</th>
                <th className="px-4 py-3 font-medium text-left">Schedules</th>
                <th className="px-4 py-3 font-medium text-left">Features</th>
                <th className="px-4 py-3 font-medium text-left">Status</th>
                <th className="px-4 py-3 font-medium text-left">Tenants</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3"><p className="text-text-primary">{p.name}</p><p className="text-xs text-text-muted">{p.code}</p></td>
                  <td className="px-4 py-3 text-text-secondary">{fmtPrice(p.priceMonthly)}</td>
                  <td className="px-4 py-3 text-text-secondary">{fmtLimit(p.maxUsers)}</td>
                  <td className="px-4 py-3 text-text-secondary">{fmtLimit(p.maxOrganizations)}</td>
                  <td className="px-4 py-3 text-text-secondary">{fmtLimit(p.maxWorkspaces)}</td>
                  <td className="px-4 py-3 text-text-secondary">{fmtLimit(p.maxActiveJobs)}</td>
                  <td className="px-4 py-3 text-text-secondary">{fmtLimit(p.maxCandidates)}</td>
                  <td className="px-4 py-3 text-text-secondary">{fmtLimit(p.maxSchedules)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {p.aiEnabled && <Badge variant="info">AI</Badge>}
                      {p.proctoringEnabled && <Badge variant="info">Proctor</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">{p.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="danger">Inactive</Badge>}</td>
                  <td className="px-4 py-3 text-text-secondary">{p.tenantCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <PlanDrawer
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['platform-plans'] }); }}
        />
      )}
    </div>
  );
}

/** Empty string → null (unlimited); otherwise a non-negative integer. */
function toLimit(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
const fromLimit = (n: number | null | undefined) => (n == null ? '' : String(n));

/** Empty string → null (no overage pricing configured); otherwise a non-negative amount. */
function toMoney(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
const fromMoney = (n: number | null | undefined) => (n == null ? '' : String(n));

function PlanDrawer({ plan, onClose, onSaved }: { plan: PlanAdminDto | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [priceMonthly, setPriceMonthly] = useState(plan?.priceMonthly != null ? String(plan.priceMonthly) : '');
  const [priceYearly, setPriceYearly] = useState(plan?.priceYearly != null ? String(plan.priceYearly) : '');
  const [maxUsers, setMaxUsers] = useState(fromLimit(plan?.maxUsers));
  const [maxOrganizations, setMaxOrganizations] = useState(fromLimit(plan?.maxOrganizations));
  const [maxWorkspaces, setMaxWorkspaces] = useState(fromLimit(plan?.maxWorkspaces));
  const [maxActiveJobs, setMaxActiveJobs] = useState(fromLimit(plan?.maxActiveJobs));
  const [maxCandidates, setMaxCandidates] = useState(fromLimit(plan?.maxCandidates));
  const [maxSchedules, setMaxSchedules] = useState(fromLimit(plan?.maxSchedules));
  const [maxInterviewedCandidates, setMaxInterviewed] = useState(fromLimit(plan?.maxInterviewedCandidates));
  const [pricePerOrganization, setPricePerOrganization] = useState(fromMoney(plan?.pricePerOrganization));
  const [pricePerWorkspace, setPricePerWorkspace] = useState(fromMoney(plan?.pricePerWorkspace));
  const [pricePerUser, setPricePerUser] = useState(fromMoney(plan?.pricePerUser));
  const [pricePerCandidate, setPricePerCandidate] = useState(fromMoney(plan?.pricePerCandidate));
  const [minOrganizations, setMinOrganizations] = useState(fromLimit(plan?.minOrganizations));
  const [minWorkspaces, setMinWorkspaces] = useState(fromLimit(plan?.minWorkspaces));
  const [minUsers, setMinUsers] = useState(fromLimit(plan?.minUsers));
  const [minCandidates, setMinCandidates] = useState(fromLimit(plan?.minCandidates));
  const [trialDays, setTrialDays] = useState(fromLimit(plan?.trialDays));
  const [aiEnabled, setAiEnabled] = useState(plan?.aiEnabled ?? true);
  const [proctoringEnabled, setProctoring] = useState(plan?.proctoringEnabled ?? true);
  const [isActive, setIsActive] = useState(plan?.isActive ?? true);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        priceMonthly: priceMonthly.trim() === '' ? null : Number(priceMonthly),
        priceYearly: priceYearly.trim() === '' ? null : Number(priceYearly),
        maxUsers: toLimit(maxUsers),
        maxOrganizations: toLimit(maxOrganizations),
        maxWorkspaces: toLimit(maxWorkspaces),
        maxActiveJobs: toLimit(maxActiveJobs),
        maxCandidates: toLimit(maxCandidates),
        maxSchedules: toLimit(maxSchedules),
        maxInterviewedCandidates: toLimit(maxInterviewedCandidates),
        pricePerOrganization: toMoney(pricePerOrganization),
        pricePerWorkspace: toMoney(pricePerWorkspace),
        pricePerUser: toMoney(pricePerUser),
        pricePerCandidate: toMoney(pricePerCandidate),
        minOrganizations: toLimit(minOrganizations),
        minWorkspaces: toLimit(minWorkspaces),
        minUsers: toLimit(minUsers),
        minCandidates: toLimit(minCandidates),
        trialDays: toLimit(trialDays),
        aiEnabled,
        proctoringEnabled,
        isActive,
      };
      return plan
        ? platformApi.updatePlan(plan.id, body)
        : platformApi.createPlan({ code: code.trim().toUpperCase(), currency: 'INR', ...body });
    },
    onSuccess: () => { toast.success(plan ? 'Plan updated' : 'Plan created'); onSaved(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save plan')),
  });

  const canSave = name.trim() && (plan || /^[A-Z0-9_]{2,}$/.test(code.trim().toUpperCase()));

  return (
    <Drawer open onClose={onClose} title={plan ? 'Edit plan' : 'New plan'} subtitle={plan?.code}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>{plan ? 'Save' : 'Create'}</Button></div>}>
      <div className="space-y-4">
        <Field label="Plan code (immutable)">
          {plan ? <p className="text-sm text-text-secondary">{plan.code}</p>
            : <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. GROWTH" />}
        </Field>
        <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price / month (₹)"><Input type="number" min={0} value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} placeholder="0 = free" /></Field>
          <Field label="Price / year (₹)"><Input type="number" min={0} value={priceYearly} onChange={(e) => setPriceYearly(e.target.value)} /></Field>
        </div>
        <Field label="Free trial length (days)">
          <Input type="number" min={0} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} placeholder="Platform default" />
        </Field>
        <p className="pt-2 text-xs uppercase tracking-wide text-text-muted">Usage limits — leave blank for unlimited</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max users"><Input type="number" min={0} value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} placeholder="∞" /></Field>
          <Field label="Max organizations"><Input type="number" min={0} value={maxOrganizations} onChange={(e) => setMaxOrganizations(e.target.value)} placeholder="∞" /></Field>
          <Field label="Max workspaces"><Input type="number" min={0} value={maxWorkspaces} onChange={(e) => setMaxWorkspaces(e.target.value)} placeholder="∞" /></Field>
          <Field label="Max active jobs"><Input type="number" min={0} value={maxActiveJobs} onChange={(e) => setMaxActiveJobs(e.target.value)} placeholder="∞" /></Field>
          <Field label="Max candidates"><Input type="number" min={0} value={maxCandidates} onChange={(e) => setMaxCandidates(e.target.value)} placeholder="∞" /></Field>
          <Field label="Max schedules"><Input type="number" min={0} value={maxSchedules} onChange={(e) => setMaxSchedules(e.target.value)} placeholder="∞" /></Field>
          <Field label="Max interviewed / period"><Input type="number" min={0} value={maxInterviewedCandidates} onChange={(e) => setMaxInterviewed(e.target.value)} placeholder="∞" /></Field>
        </div>
        <p className="pt-2 text-xs uppercase tracking-wide text-text-muted">
          Overage pricing — leave blank to hard-block instead of billing past the limit above
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="₹ / extra organization"><Input type="number" min={0} step="0.01" value={pricePerOrganization} onChange={(e) => setPricePerOrganization(e.target.value)} placeholder="no overage" /></Field>
          <Field label="₹ / extra workspace"><Input type="number" min={0} step="0.01" value={pricePerWorkspace} onChange={(e) => setPricePerWorkspace(e.target.value)} placeholder="no overage" /></Field>
          <Field label="₹ / extra user"><Input type="number" min={0} step="0.01" value={pricePerUser} onChange={(e) => setPricePerUser(e.target.value)} placeholder="no overage" /></Field>
          <Field label="₹ / extra candidate"><Input type="number" min={0} step="0.01" value={pricePerCandidate} onChange={(e) => setPricePerCandidate(e.target.value)} placeholder="no overage" /></Field>
        </div>
        <p className="pt-2 text-xs uppercase tracking-wide text-text-muted">
          Deletion floor — leave blank for no floor beyond the built-in default org/workspace protection
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min organizations"><Input type="number" min={0} value={minOrganizations} onChange={(e) => setMinOrganizations(e.target.value)} placeholder="no floor" /></Field>
          <Field label="Min workspaces"><Input type="number" min={0} value={minWorkspaces} onChange={(e) => setMinWorkspaces(e.target.value)} placeholder="no floor" /></Field>
          <Field label="Min users"><Input type="number" min={0} value={minUsers} onChange={(e) => setMinUsers(e.target.value)} placeholder="no floor" /></Field>
          <Field label="Min candidates"><Input type="number" min={0} value={minCandidates} onChange={(e) => setMinCandidates(e.target.value)} placeholder="no floor" /></Field>
        </div>
        <div className="space-y-2 pt-2">
          <Toggle label="AI features enabled" checked={aiEnabled} onChange={setAiEnabled} />
          <Toggle label="Proctoring enabled" checked={proctoringEnabled} onChange={setProctoring} />
          <Toggle label="Plan active (offered to workspaces)" checked={isActive} onChange={setIsActive} />
        </div>
      </div>
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-sm font-medium text-text-secondary">{label}</label>{children}</div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-border" />
      {label}
    </label>
  );
}

export default PlansAdminPage;
