import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Boxes, Check, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '../../components/common/PageHeader.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { PlanLimitNotice } from '../../components/common/PlanLimitNotice.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { Select } from '../../components/ui/Select.js';
import { cn } from '../../utils/cn.js';
import * as adminApi from '../../services/adminApi.js';
import { apiErrorMessage } from '../../services/api.js';
import type { OrganizationItem, WorkspaceItem, WorkspaceMemberItem } from '@agnohire/shared';
import { useConfirm } from '../../providers/ConfirmProvider.js';
import { usePlanUsage } from '../../hooks/usePlanUsage.js';

/**
 * Tenant self-service Organization/Workspace management. Mirrors the
 * Sectors/Domains master-detail pattern one tier deeper: Organizations ->
 * Workspaces (of the selected org) -> Members (of the selected workspace).
 * Every tenant starts with exactly one of each (the "default" org/workspace
 * from the backfill migration) — this page is how a tenant admin creates a
 * SECOND one, which is also the only thing that makes the Navbar's
 * Organization/Workspace switcher appear at all.
 */
export function OrganizationsWorkspacesPage() {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedWsId, setSelectedWsId] = useState<string | null>(null);

  const { data: organizations, isLoading: orgsLoading } = useQuery({
    queryKey: ['admin-organizations'],
    queryFn: adminApi.fetchOrganizations,
  });
  const org = organizations?.find((o) => o.id === selectedOrgId) ?? organizations?.[0] ?? null;
  const { isBlocked } = usePlanUsage();
  const orgsFull = isBlocked('ORGANIZATIONS');
  const workspacesFull = isBlocked('WORKSPACES');

  if (orgsLoading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div>
      <PageHeader
        title="Organizations & Workspaces"
        description="Group this tenant's data into separate Organizations and Workspaces, each with its own members and credentials."
      />

      <div className="mt-4 space-y-2">
        <PlanLimitNotice metric="ORGANIZATIONS" />
        <PlanLimitNotice metric="WORKSPACES" />
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1fr_1fr]">
        <OrganizationPanel
          organizations={organizations ?? []}
          selectedId={org?.id ?? null}
          onSelect={(id) => { setSelectedOrgId(id); setSelectedWsId(null); }}
          createDisabled={orgsFull}
        />
        {org && (
          <WorkspacePanel
            organizationId={org.id}
            organizationName={org.name}
            selectedId={selectedWsId}
            onSelect={setSelectedWsId}
            createDisabled={workspacesFull}
          />
        )}
        {selectedWsId && <MemberPanel workspaceId={selectedWsId} />}
      </div>
    </div>
  );
}

/** Click the pencil to rename inline — Enter saves, Escape cancels. */
function EditableName({ name, onSave, saving }: { name: string; onSave: (name: string) => void; saving: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  if (!editing) {
    return (
      <span className="group inline-flex items-center gap-1.5">
        <span className="text-text-primary">{name}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setValue(name); setEditing(true); }}
          className="text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-primary"
          title="Rename"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    );
  }

  const save = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) onSave(trimmed);
    setEditing(false);
  };

  return (
    <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="h-7 w-40 px-2 text-sm"
      />
      <button type="button" onClick={save} disabled={saving} className="text-success">
        <Check className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-text-muted">
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

// ─── ORGANIZATIONS ───────────────────────────────────────────────────────────

function OrganizationPanel({
  organizations,
  selectedId,
  onSelect,
  createDisabled,
}: {
  organizations: OrganizationItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  createDisabled: boolean;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [name, setName] = useState('');

  const create = useMutation({
    mutationFn: () => adminApi.createOrganization({ name: name.trim() }),
    onSuccess: (created) => {
      toast.success('Organization created');
      setName('');
      qc.invalidateQueries({ queryKey: ['admin-organizations'] });
      onSelect(created.id);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not create organization')),
  });
  const toggle = useMutation({
    mutationFn: (o: OrganizationItem) => adminApi.updateOrganization(o.id, { isActive: !o.isActive }),
    onSuccess: () => { toast.success('Organization updated'); qc.invalidateQueries({ queryKey: ['admin-organizations'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update organization')),
  });
  const rename = useMutation({
    mutationFn: ({ id, name: newName }: { id: string; name: string }) => adminApi.updateOrganization(id, { name: newName }),
    onSuccess: () => { toast.success('Organization renamed'); qc.invalidateQueries({ queryKey: ['admin-organizations'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not rename organization')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteOrganization(id),
    onSuccess: () => { toast.success('Organization deleted'); qc.invalidateQueries({ queryKey: ['admin-organizations'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not delete organization')),
  });

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium text-text-primary">
        <Building2 className="h-4 w-4" /> Organizations
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim() && !createDisabled) create.mutate(); }}
        className="flex gap-2 border-b border-border p-3"
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New organization name…" disabled={createDisabled} />
        <span title={createDisabled ? 'Plan limit reached — upgrade to add more organizations' : undefined}>
          <Button type="submit" loading={create.isPending} disabled={!name.trim() || createDisabled}><Plus className="h-4 w-4" /></Button>
        </span>
      </form>
      {organizations.length === 0 ? (
        <EmptyState icon={<Building2 className="h-8 w-8" />} title="No organizations" description="Add one to begin." />
      ) : (
        <ul className="divide-y divide-border/60">
          {organizations.map((o) => (
            <li
              key={o.id}
              onClick={() => onSelect(o.id)}
              className={cn('flex cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-surface-raised', selectedId === o.id && 'bg-surface-raised')}
            >
              <div className="min-w-0">
                <EditableName name={o.name} saving={rename.isPending} onSave={(newName) => rename.mutate({ id: o.id, name: newName })} />{' '}
                {!o.isActive && <Badge variant="warning">inactive</Badge>}
                <p className="text-xs text-text-muted">{o.workspaceCount} workspace{o.workspaceCount === 1 ? '' : 's'} · {o.memberCount} member{o.memberCount === 1 ? '' : 's'}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={(ev) => { ev.stopPropagation(); toggle.mutate(o); }}>{o.isActive ? 'Disable' : 'Enable'}</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={async (ev) => {
                    ev.stopPropagation();
                    if (await confirm({ title: 'Delete organization', message: `Delete ${o.name}? Its workspaces must be removed first.`, confirmText: 'Delete', variant: 'danger' })) {
                      remove.mutate(o.id);
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── WORKSPACES ──────────────────────────────────────────────────────────────

function WorkspacePanel({
  organizationId,
  organizationName,
  selectedId,
  onSelect,
  createDisabled,
}: {
  organizationId: string;
  organizationName: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  createDisabled: boolean;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const { data: workspaces, isLoading } = useQuery({
    queryKey: ['admin-workspaces', organizationId],
    queryFn: () => adminApi.fetchWorkspaces(organizationId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-workspaces', organizationId] });
    qc.invalidateQueries({ queryKey: ['admin-organizations'] }); // workspaceCount changed
  };
  const create = useMutation({
    mutationFn: () => adminApi.createWorkspace({ organizationId, name: name.trim() }),
    onSuccess: (created) => { toast.success('Workspace created'); setName(''); invalidate(); onSelect(created.id); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not create workspace')),
  });
  const toggle = useMutation({
    mutationFn: (w: WorkspaceItem) => adminApi.updateWorkspace(w.id, { isActive: !w.isActive }),
    onSuccess: () => { toast.success('Workspace updated'); invalidate(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update workspace')),
  });
  const rename = useMutation({
    mutationFn: ({ id, name: newName }: { id: string; name: string }) => adminApi.updateWorkspace(id, { name: newName }),
    onSuccess: () => { toast.success('Workspace renamed'); invalidate(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not rename workspace')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteWorkspace(id),
    onSuccess: () => { toast.success('Workspace deleted'); invalidate(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not delete workspace')),
  });

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium text-text-primary">
        <Boxes className="h-4 w-4" /> Workspaces — {organizationName}
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim() && !createDisabled) create.mutate(); }}
        className="flex gap-2 border-b border-border p-3"
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New workspace name…" disabled={createDisabled} />
        <span title={createDisabled ? 'Plan limit reached — upgrade to add more workspaces' : undefined}>
          <Button type="submit" loading={create.isPending} disabled={!name.trim() || createDisabled}><Plus className="h-4 w-4" /></Button>
        </span>
      </form>
      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (workspaces ?? []).length === 0 ? (
        <EmptyState icon={<Boxes className="h-8 w-8" />} title="No workspaces" description="Add one to this organization." />
      ) : (
        <ul className="divide-y divide-border/60">
          {(workspaces ?? []).map((w) => (
            <li
              key={w.id}
              onClick={() => onSelect(w.id)}
              className={cn('flex cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-surface-raised', selectedId === w.id && 'bg-surface-raised')}
            >
              <div className="min-w-0">
                <EditableName name={w.name} saving={rename.isPending} onSave={(newName) => rename.mutate({ id: w.id, name: newName })} />{' '}
                {!w.isActive && <Badge variant="warning">inactive</Badge>}
                <p className="text-xs text-text-muted">{w.memberCount} member{w.memberCount === 1 ? '' : 's'}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={(ev) => { ev.stopPropagation(); toggle.mutate(w); }}>{w.isActive ? 'Disable' : 'Enable'}</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={async (ev) => {
                    ev.stopPropagation();
                    if (await confirm({ title: 'Delete workspace', message: `Delete ${w.name}? Its sectors must be moved first.`, confirmText: 'Delete', variant: 'danger' })) {
                      remove.mutate(w.id);
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── MEMBERS ─────────────────────────────────────────────────────────────────

function MemberPanel({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'WORKSPACE_ADMIN' | 'WORKSPACE_MEMBER'>('WORKSPACE_MEMBER');
  const [canManageUsers, setCanManageUsers] = useState(false);

  const { data: members, isLoading } = useQuery({
    queryKey: ['admin-workspace-members', workspaceId],
    queryFn: () => adminApi.fetchWorkspaceMembers(workspaceId),
  });
  // Broad tenant user list for the picker — this tool targets small/medium
  // tenants; a searchable picker is a fast-follow if that stops being true.
  const { data: users } = useQuery({
    queryKey: ['admin-users-for-membership'],
    queryFn: () => adminApi.fetchUsers({ limit: 500 }),
  });
  const memberIds = new Set((members ?? []).map((m) => m.userId));
  const candidates = (users?.items ?? []).filter((u) => !memberIds.has(u.id));

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-workspace-members', workspaceId] });
  const add = useMutation({
    mutationFn: () => adminApi.addWorkspaceMember(workspaceId, { userId, role, canManageUsers }),
    onSuccess: () => { toast.success('Member added'); setUserId(''); setCanManageUsers(false); invalidate(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not add member')),
  });
  const changeRole = useMutation({
    mutationFn: ({ id, role: r }: { id: string; role: 'WORKSPACE_ADMIN' | 'WORKSPACE_MEMBER' }) =>
      adminApi.updateWorkspaceMemberRole(workspaceId, id, { role: r }),
    onSuccess: () => { toast.success('Role updated'); invalidate(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update role')),
  });
  const toggleCanManageUsers = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      adminApi.updateWorkspaceMemberRole(workspaceId, id, { canManageUsers: value }),
    onSuccess: () => { toast.success('Updated'); invalidate(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.removeWorkspaceMember(workspaceId, id),
    onSuccess: () => { toast.success('Member removed'); invalidate(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not remove member')),
  });

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium text-text-primary">
        <UserPlus className="h-4 w-4" /> Members
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); if (userId) add.mutate(); }}
        className="flex flex-col gap-2 border-b border-border p-3"
      >
        <Select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="Select a user to add…"
          options={candidates.map((u) => ({ value: u.id, label: `${u.fullName} (${u.email})` }))}
        />
        <div className="flex gap-2">
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as 'WORKSPACE_ADMIN' | 'WORKSPACE_MEMBER')}
            options={[
              { value: 'WORKSPACE_MEMBER', label: 'Member' },
              { value: 'WORKSPACE_ADMIN', label: 'Admin' },
            ]}
            className="flex-1"
          />
          <Button type="submit" loading={add.isPending} disabled={!userId}><Plus className="h-4 w-4" /> Add</Button>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={canManageUsers}
            onChange={(e) => setCanManageUsers(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border"
          />
          Can manage this workspace's users (create/edit/remove, scoped to here only)
        </label>
      </form>
      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (members ?? []).length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-text-muted">No members yet — add one above.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {(members ?? []).map((m: WorkspaceMemberItem) => (
            <li key={m.userId} className="flex flex-col gap-1.5 px-4 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-text-primary">{m.fullName}</p>
                  <p className="truncate text-xs text-text-muted">{m.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Select
                    value={m.role}
                    onChange={(e) => changeRole.mutate({ id: m.userId, role: e.target.value as 'WORKSPACE_ADMIN' | 'WORKSPACE_MEMBER' })}
                    options={[
                      { value: 'WORKSPACE_MEMBER', label: 'Member' },
                      { value: 'WORKSPACE_ADMIN', label: 'Admin' },
                    ]}
                    className="h-8 w-28 text-xs"
                  />
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove.mutate(m.userId)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={m.canManageUsers}
                  onChange={(e) => toggleCanManageUsers.mutate({ id: m.userId, value: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                Can manage this workspace's users
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
