import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Users, Plus, Search, KeyRound, Pencil, Mail, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '../../components/common/PageHeader.js';
import { PlanLimitNotice } from '../../components/common/PlanLimitNotice.js';
import { usePlanUsage } from '../../hooks/usePlanUsage.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { Spinner } from '../../components/ui/Spinner.js';
import * as adminApi from '../../services/adminApi.js';
import * as workspaceService from '../../services/workspace.service.js';
import { apiErrorMessage } from '../../services/api.js';
import { MessageUsersDrawer } from './MessageUsersDrawer.js';
import { useConfirm } from '../../providers/ConfirmProvider.js';
import { useAuthStore } from '../../store/authStore.js';
import type { AdminUserItem, UserFilters } from '@agnohire/shared';

export function UsersPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [filters, setFilters] = useState<Partial<UserFilters>>({ page: 1, limit: 25 });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AdminUserItem | 'new' | null>(null);
  const [compose, setCompose] = useState<{ ids: string[] } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', filters],
    queryFn: () => adminApi.fetchUsers(filters),
    placeholderData: keepPreviousData,
  });
  const { data: roles } = useQuery({ queryKey: ['admin-roles'], queryFn: adminApi.fetchRoles });
  // Sourced from /auth/memberships (self-service, same as the Navbar
  // switcher) rather than /api/workspaces: this picker only needs "which
  // workspaces am I a member of," not the org.view/workspace.view
  // permission that the Organizations & Workspaces admin page requires —
  // a workspace-scoped canManageUsers grantee (see workspaceMembershipService)
  // still needs to be able to pick their own workspace here even without it.
  const { data: membershipTree } = useQuery({ queryKey: ['auth-memberships-for-users'], queryFn: workspaceService.fetchMemberships });
  const organizations = membershipTree?.organizations ?? [];
  const workspaces = organizations.flatMap((o) =>
    o.workspaces.map((w) => ({ id: w.id, label: organizations.length > 1 ? `${w.name} — ${o.name}` : w.name })),
  );
  const { isBlocked } = usePlanUsage();
  const usersFull = isBlocked('USERS');

  const toggleActive = useMutation({
    mutationFn: (u: AdminUserItem) => adminApi.updateUser(u.id, { isActive: !u.isActive }),
    onSuccess: () => { toast.success('User updated'); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update user')),
  });

  const removeUser = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => { toast.success('User deleted'); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not delete user')),
  });

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Users"
        description="Manage staff accounts, role and sector assignment, and access."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCompose({ ids: [] })}><Mail className="h-4 w-4" /> Message users</Button>
            <span title={usersFull ? 'Plan limit reached — upgrade to add more users' : undefined}>
              <Button onClick={() => setEditing('new')} disabled={usersFull}><Plus className="h-4 w-4" /> New user</Button>
            </span>
          </div>
        }
      />

      <div className="mt-4"><PlanLimitNotice metric="USERS" /></div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form onSubmit={(e) => { e.preventDefault(); setFilters((f) => ({ ...f, search: search.trim() || undefined, page: 1 })); }} className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <Input className="pl-9" placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <Select
          className="w-44" placeholder="All roles" value={filters.roleId ?? ''}
          options={(roles ?? []).map((r) => ({ value: r.id, label: r.displayName }))}
          onChange={(e) => setFilters((f) => ({ ...f, roleId: e.target.value || undefined, page: 1 }))}
        />
        <Select
          className="w-36" placeholder="All status" value={filters.isActive === undefined ? '' : String(filters.isActive)}
          options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]}
          onChange={(e) => setFilters((f) => ({ ...f, isActive: e.target.value === '' ? undefined : e.target.value === 'true', page: 1 }))}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Users className="h-8 w-8" />} title="No users" description="No accounts match these filters." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <tr><th className="px-4 py-3 font-medium text-left">Name</th><th className="px-4 py-3 font-medium text-left">Role</th><th className="px-4 py-3 font-medium text-left">Workspace</th><th className="px-4 py-3 font-medium text-left">Sector</th><th className="px-4 py-3 font-medium text-left">Status</th><th className="px-4 py-3 font-medium text-left">Last login</th><th className="px-4 py-3 font-medium text-right">Actions</th></tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3"><p className="text-text-primary">{u.fullName}</p><p className="text-xs text-text-muted">{u.email}</p></td>
                  <td className="px-4 py-3 text-text-secondary">{u.roleName}</td>
                  <td className="px-4 py-3 text-text-secondary">{u.workspaceName ?? '—'}</td>
                  <td className="px-4 py-3 text-text-secondary">{u.sectorName ?? '—'}</td>
                  <td className="px-4 py-3">{u.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="danger">Inactive</Badge>}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-text-muted">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setCompose({ ids: [u.id] })} title="Message"><Mail className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(u)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                      <Button size="sm" variant="outline" onClick={() => toggleActive.mutate(u)}>{u.isActive ? 'Deactivate' : 'Activate'}</Button>
                      <Button size="sm" variant="ghost" className="text-danger" onClick={async () => { if (await confirm({ title: 'Delete User', message: `Delete user ${u.fullName}?`, confirmText: 'Delete', variant: 'danger' })) removeUser.mutate(u.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <UserDrawer
          user={editing === 'new' ? null : editing}
          roles={(roles ?? []).map((r) => ({ id: r.id, label: r.displayName }))}
          workspaces={workspaces}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['admin-users'] }); qc.invalidateQueries({ queryKey: ['tenant-usage'] }); }}
        />
      )}

      {compose && (
        <MessageUsersDrawer open onClose={() => setCompose(null)} users={items} initialIds={compose.ids} />
      )}
    </div>
  );
}

function UserDrawer({ user, roles, workspaces, onClose, onSaved }: { user: AdminUserItem | null; roles: { id: string; label: string }[]; workspaces: { id: string; label: string }[]; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const authUser = useAuthStore((s) => s.user);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [roleId, setRoleId] = useState(user?.roleId ?? roles[0]?.id ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [password, setPassword] = useState('');
  // Default to the caller's OWN current workspace when it's in their list;
  // otherwise the first one they're allowed to target (e.g. a
  // workspace-scoped grantee only ever has their own workspace to pick).
  const [workspaceId, setWorkspaceId] = useState(
    () => workspaces.find((w) => w.id === authUser?.workspaceId)?.id ?? workspaces[0]?.id ?? '',
  );

  const save = useMutation({
    mutationFn: () => user
      ? adminApi.updateUser(user.id, { fullName, roleId, phone })
      : adminApi.createUser({ fullName, email, roleId, phone, password, workspaceId: workspaceId || undefined }),
    onSuccess: () => { toast.success(user ? 'User updated' : 'User created'); onSaved(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save user')),
  });

  const reset = useMutation({
    mutationFn: () => adminApi.resetUserPassword(user!.id, { password }),
    onSuccess: () => { toast.success('Password reset'); setPassword(''); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not reset password')),
  });

  const canSave = fullName.trim() && roleId && phone.trim() && (user || (email.trim() && password.length >= 8));

  const handleSave = () => {
    if (!user && (!password || password.length < 8)) {
      toast.error('Temporary password must be at least 8 characters.', { id: 'password-length-toast' });
      return;
    }
    save.mutate();
  };

  return (
    <Drawer open onClose={onClose} title={user ? 'Edit user' : 'New user'} subtitle={user?.email}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!canSave} onClick={handleSave}>{user ? 'Save' : 'Create'}</Button></div>}>
      <div className="space-y-4">
        <Field label="Full name"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        <Field label="Email">{user ? <p className="text-sm text-text-secondary">{email}</p> : <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.com" />}</Field>
        <Field label="Role"><Select value={roleId} options={roles.map((r) => ({ value: r.id, label: r.label }))} onChange={(e) => setRoleId(e.target.value)} /></Field>
        {!user && (
          <Field label="Workspace">
            <Select
              value={workspaceId}
              options={workspaces.map((w) => ({ value: w.id, label: w.label }))}
              onChange={(e) => setWorkspaceId(e.target.value)}
              disabled={workspaces.length <= 1}
            />
            <p className="mt-1 text-xs text-text-muted">The user will belong to this workspace only.</p>
          </Field>
        )}
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        {!user && (
          <Field label="Temporary password">
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 8 characters" />
            {password && password.length < 8 && (
              <p className="mt-1 text-xs text-danger">Password must be at least 8 characters</p>
            )}
          </Field>
        )}
        {user && (
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-text-primary"><KeyRound className="h-4 w-4" /> Reset password</p>
            <div className="flex gap-2">
              <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (min 8)" />
              <Button variant="outline" loading={reset.isPending} disabled={password.length < 8} onClick={() => reset.mutate()}>Reset</Button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-sm font-medium text-text-secondary">{label}</label>{children}</div>;
}
