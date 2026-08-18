import { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Save, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '../../components/common/PageHeader.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { cn } from '../../utils/cn.js';
import * as adminApi from '../../services/adminApi.js';
import { apiErrorMessage } from '../../services/api.js';
import type { RoleItem, PermissionDef } from '@agnohire/shared';

export function RolesPage() {
  const qc = useQueryClient();
  const { data: roles, isLoading } = useQuery({ queryKey: ['admin-roles'], queryFn: adminApi.fetchRoles });
  const { data: permissions } = useQuery({ queryKey: ['admin-permissions'], queryFn: adminApi.fetchPermissions });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = roles?.find((r) => r.id === selectedId) ?? roles?.[0] ?? null;

  if (isLoading || !roles || !permissions) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div>
      <PageHeader title="Roles & Permissions" description="Grant or revoke permissions per role. The superadmin role always holds every permission." />
      <div className="mt-4 grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="space-y-1.5">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={cn('flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                (selected?.id === r.id) ? 'border-accent bg-accent/10' : 'border-border hover:bg-surface-raised')}
            >
              <span className="flex items-center gap-2 text-text-primary">{r.isSuperadmin && <Lock className="h-3.5 w-3.5 text-text-muted" />}{r.displayName}</span>
              <Badge>{r.permissionKeys.length}</Badge>
            </button>
          ))}
        </div>
        {selected && <PermissionMatrix key={selected.id} role={selected} permissions={permissions} onSaved={() => qc.invalidateQueries({ queryKey: ['admin-roles'] })} />}
      </div>
    </div>
  );
}

function PermissionMatrix({ role, permissions, onSaved }: { role: RoleItem; permissions: PermissionDef[]; onSaved: () => void }) {
  const [granted, setGranted] = useState<Set<string>>(new Set(role.permissionKeys));
  useEffect(() => { setGranted(new Set(role.permissionKeys)); }, [role]);

  const groups = useMemo(() => {
    const m = new Map<string, PermissionDef[]>();
    for (const p of permissions) { if (!m.has(p.group)) m.set(p.group, []); m.get(p.group)!.push(p); }
    return [...m.entries()];
  }, [permissions]);

  const save = useMutation({
    mutationFn: () => adminApi.setRolePermissions(role.id, { permissionKeys: [...granted] }),
    onSuccess: () => { toast.success('Permissions updated'); onSaved(); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update permissions')),
  });

  const locked = role.isSuperadmin;
  const toggle = (key: string) => {
    if (locked) return;
    setGranted((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  };
  const dirty = !locked && (granted.size !== role.permissionKeys.length || role.permissionKeys.some((k) => !granted.has(k)));

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <p className="font-medium text-text-primary">{role.displayName}</p>
          <p className="text-xs text-text-muted">{role.userCount} user{role.userCount === 1 ? '' : 's'} · {granted.size} permission{granted.size === 1 ? '' : 's'}</p>
        </div>
        {locked
          ? <Badge variant="info"><Lock className="mr-1 h-3 w-3" /> Always all permissions</Badge>
          : <Button size="sm" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}><Save className="h-3.5 w-3.5" /> Save</Button>}
      </div>
      <div className="max-h-[60vh] space-y-5 overflow-y-auto p-5">
        {groups.map(([group, perms]) => (
          <div key={group}>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted"><ShieldCheck className="h-3.5 w-3.5" /> {group}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {perms.map((p) => {
                const on = locked || granted.has(p.key);
                return (
                  <label key={p.key} className={cn('flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm', on ? 'border-accent/40 bg-accent/5' : 'border-border', locked && 'cursor-not-allowed opacity-80')}>
                    <input type="checkbox" checked={on} disabled={locked} onChange={() => toggle(p.key)} className="h-4 w-4 rounded border-border" />
                    <span className="text-text-primary">{p.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
