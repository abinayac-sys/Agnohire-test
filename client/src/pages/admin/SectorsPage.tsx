import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Trash2, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '../../components/common/PageHeader.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { cn } from '../../utils/cn.js';
import * as adminApi from '../../services/adminApi.js';
import { apiErrorMessage } from '../../services/api.js';
import type { SectorItem } from '@agnohire/shared';
import { useConfirm } from '../../providers/ConfirmProvider.js';

export function SectorsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: sectors, isLoading } = useQuery({ queryKey: ['admin-sectors'], queryFn: adminApi.fetchAdminSectors });
  const [selected, setSelected] = useState<string | null>(null);
  const sector = sectors?.find((s) => s.id === selected) ?? sectors?.[0] ?? null;

  const [name, setName] = useState(''); const [type, setType] = useState('');
  const create = useMutation({
    mutationFn: () => adminApi.createSector({ name: name.trim(), type: type.trim() || 'general' }),
    onSuccess: () => { toast.success('Sector created'); setName(''); setType(''); qc.invalidateQueries({ queryKey: ['admin-sectors'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not create sector')),
  });
  const toggle = useMutation({
    mutationFn: (s: SectorItem) => adminApi.updateSector(s.id, { isActive: !s.isActive }),
    onSuccess: () => { toast.success('Sector updated'); qc.invalidateQueries({ queryKey: ['admin-sectors'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update sector')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteSector(id),
    onSuccess: () => { toast.success('Sector archived'); qc.invalidateQueries({ queryKey: ['admin-sectors'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not archive sector')),
  });

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div>
      <PageHeader title="Sectors & Domains" description="Business sectors and their domains. Sector isolation is enforced across the platform." />

      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }} className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-4">
        <div className="flex-1 min-w-[180px]"><label className="mb-1 block text-xs text-text-muted">Sector name</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Healthcare" /></div>
        <div className="w-40"><label className="mb-1 block text-xs text-text-muted">Type</label><Input value={type} onChange={(e) => setType(e.target.value)} placeholder="general" /></div>
        <Button type="submit" loading={create.isPending} disabled={!name.trim()}><Plus className="h-4 w-4" /> Add sector</Button>
      </form>

      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          {(sectors ?? []).length === 0 ? (
            <EmptyState icon={<Building2 className="h-8 w-8" />} title="No sectors" description="Add a sector to begin." />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted"><tr><th className="px-4 py-3 font-medium text-left">Sector</th><th className="px-4 py-3 font-medium text-left">Users</th><th className="px-4 py-3 font-medium text-left">Domains</th><th className="px-4 py-3 font-medium text-right">Actions</th></tr></thead>
              <tbody>
                {(sectors ?? []).map((s) => (
                  <tr key={s.id} onClick={() => setSelected(s.id)} className={cn('cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-raised', sector?.id === s.id && 'bg-surface-raised')}>
                    <td className="px-4 py-3"><span className="text-text-primary">{s.name}</span> {!s.isActive && <Badge variant="warning">inactive</Badge>}<p className="text-xs text-text-muted">{s.type}</p></td>
                    <td className="px-4 py-3 text-text-secondary">{s.userCount}</td>
                    <td className="px-4 py-3 text-text-secondary">{s.domainCount}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={(ev) => { ev.stopPropagation(); toggle.mutate(s); }}>{s.isActive ? 'Disable' : 'Enable'}</Button>
                      <Button size="sm" variant="ghost" className="text-danger" onClick={async (ev) => { ev.stopPropagation(); if (await confirm({ title: 'Delete sector', message: `Delete sector ${s.name}?`, confirmText: 'Delete', variant: 'danger' })) remove.mutate(s.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {sector && <DomainPanel sectorId={sector.id} sectorName={sector.name} />}
      </div>
    </div>
  );
}

function DomainPanel({ sectorId, sectorName }: { sectorId: string; sectorName: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: domains, isLoading } = useQuery({ queryKey: ['admin-domains', sectorId], queryFn: () => adminApi.fetchAdminDomains(sectorId) });
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => adminApi.createDomain({ name: name.trim(), sectorId }),
    onSuccess: () => { toast.success('Domain added'); setName(''); qc.invalidateQueries({ queryKey: ['admin-domains', sectorId] }); qc.invalidateQueries({ queryKey: ['admin-sectors'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not add domain')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteDomain(id),
    onSuccess: () => { toast.success('Domain archived'); qc.invalidateQueries({ queryKey: ['admin-domains', sectorId] }); qc.invalidateQueries({ queryKey: ['admin-sectors'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not archive domain')),
  });

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium text-text-primary"><Layers className="h-4 w-4" /> Domains — {sectorName}</div>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }} className="flex gap-2 border-b border-border p-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New domain name…" />
        <Button type="submit" loading={create.isPending} disabled={!name.trim()}><Plus className="h-4 w-4" /></Button>
      </form>
      {isLoading ? <div className="flex justify-center py-8"><Spinner /></div> : (domains ?? []).length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-text-muted">No domains in this sector yet.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {(domains ?? []).map((d) => (
            <li key={d.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-text-primary">{d.name} {!d.isActive && <Badge variant="warning">inactive</Badge>}</span>
              <Button size="sm" variant="ghost" className="text-danger" onClick={async () => { if (await confirm({ title: 'Delete domain', message: `Delete domain ${d.name}?`, confirmText: 'Delete', variant: 'danger' })) remove.mutate(d.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
