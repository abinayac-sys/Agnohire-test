import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Globe2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '../../components/common/PageHeader.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Badge } from '../../components/ui/Badge.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { Spinner } from '../../components/ui/Spinner.js';
import * as adminApi from '../../services/adminApi.js';
import { fetchCareersFeatureStatus } from '../../services/billingApi.js';
import { apiErrorMessage } from '../../services/api.js';
import { CONFIG_KEYS, type IntegrationItem } from '@agnohire/shared';
import { useConfirm } from '../../providers/ConfirmProvider.js';
import { PROVIDER_REGISTRY, INTEGRATION_CATEGORIES, type IntegrationProviderDef } from './integrations/providers/index.js';
import { IntegrationCard } from './integrations/IntegrationCard.js';
import { IntegrationWizardWrapper } from './integrations/IntegrationWizardWrapper.js';

export function IntegrationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: integrations, isLoading } = useQuery({ queryKey: ['admin-integrations'], queryFn: adminApi.fetchIntegrations });
  const [editing, setEditing] = useState<IntegrationItem | 'new' | null>(null);
  const [wizardProvider, setWizardProvider] = useState<IntegrationProviderDef | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const toggle = useMutation({
    mutationFn: (i: IntegrationItem) => adminApi.updateIntegration(i.id, { isEnabled: !i.isEnabled }),
    onSuccess: () => { toast.success('Integration updated'); qc.invalidateQueries({ queryKey: ['admin-integrations'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteIntegration(id),
    onSuccess: () => { toast.success('Integration deleted'); qc.invalidateQueries({ queryKey: ['admin-integrations'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not delete')),
  });

  // Superadmin-only feature grant: hide the Careers Page card entirely for a
  // workspace that hasn't been granted it (default false — see tenantAdminService.ts).
  const { data: careersFeature } = useQuery({ queryKey: ['tenant-features'], queryFn: fetchCareersFeatureStatus });
  const careersFeatureGranted = careersFeature?.careersPageEnabled ?? false;

  const { data: config } = useQuery({ queryKey: ['system-config'], queryFn: adminApi.fetchConfig });
  const careersEnabledItem = config?.find((c) => c.key === CONFIG_KEYS.CAREERS_ENABLED);
  const careersEnabled = (careersEnabledItem?.value ?? 'true') === 'true';
  const toggleCareersEnabled = useMutation({
    mutationFn: (value: boolean) => adminApi.updateConfig(CONFIG_KEYS.CAREERS_ENABLED, value ? 'true' : 'false'),
    onSuccess: (_data, value) => {
      toast.success(value ? 'Careers page activated' : 'Careers page deactivated');
      qc.invalidateQueries({ queryKey: ['system-config'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update')),
  });

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  const items = integrations ?? [];
  const customIntegrations = items.filter(i => !PROVIDER_REGISTRY[i.type] && i.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div>
      <PageHeader title="Integrations" description="Third-party connections. Secret values are encrypted at rest and never shown in full." actions={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> New integration</Button>} />
      
      <div className="mt-6 mb-8">
        <Input 
          placeholder="Search integrations..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-md"
        />
      </div>

      <div className="space-y-12">
        {careersFeatureGranted && ('website'.includes(searchQuery.toLowerCase()) || 'careers page'.includes(searchQuery.toLowerCase()) || searchQuery.trim() === '') ? (
          <div className="space-y-4">
            <div className="border-b border-border/50 pb-4 mb-6">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">🌐</span>
                <h2 className="text-lg font-semibold text-text-primary">Website</h2>
              </div>
              <p className="text-sm text-text-secondary">Publish your careers page on your own website.</p>
              <p className="text-xs font-medium text-text-muted mt-2">1 Integration</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl border border-border bg-surface p-5 shadow-elev-1 transition-colors hover:border-accent/50 flex flex-col h-full">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-alt">
                      <Globe2 className="h-5 w-5 text-accent" />
                    </div>
                    <div>
                      <h3 className="font-heading text-base font-semibold text-text-primary">Careers Page</h3>
                      <p className="text-xs text-text-muted mt-1">Embed your open jobs on your own website with a single iframe snippet.</p>
                    </div>
                  </div>
                  <Badge variant={careersEnabled ? 'success' : 'muted'}>{careersEnabled ? 'Active' : 'Inactive'}</Badge>
                </div>
                <div className="flex-1" />
                <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={toggleCareersEnabled.isPending}
                    onClick={() => toggleCareersEnabled.mutate(!careersEnabled)}
                  >
                    {careersEnabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => navigate('careers-embed')}>
                    Get embed code
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {Object.values(INTEGRATION_CATEGORIES).sort((a, b) => a.order - b.order).map(category => {
          const categoryProviders = Object.values(PROVIDER_REGISTRY).filter(p => p.categoryId === category.id && (p.name.toLowerCase().includes(searchQuery.toLowerCase()) || category.name.toLowerCase().includes(searchQuery.toLowerCase())));
          
          if (categoryProviders.length === 0) return null;

          return (
            <div key={category.id} className="space-y-4">
              <div className="border-b border-border/50 pb-4 mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">{category.icon}</span>
                  <h2 className="text-lg font-semibold text-text-primary">{category.name}</h2>
                </div>
                <p className="text-sm text-text-secondary">{category.description}</p>
                <p className="text-xs font-medium text-text-muted mt-2">{categoryProviders.length} Integration{categoryProviders.length === 1 ? '' : 's'}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {categoryProviders.map((provider) => {
                  const integration = items.find((i) => i.type === provider.id);
                  return (
                    <IntegrationCard
                      key={provider.id}
                      provider={provider}
                      integration={integration}
                      onConfigure={() => setWizardProvider(provider)}
                      onToggle={(i) => toggle.mutate(i)}
                      onDelete={(id) => remove.mutate(id)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Uncategorized custom integrations */}
        {customIntegrations.length > 0 && (
          <div className="space-y-4">
             <div className="border-b border-border/50 pb-4 mb-6">
                <h2 className="text-lg font-semibold text-text-primary">Custom Integrations</h2>
                <p className="text-sm text-text-secondary">Legacy or custom webhook integrations.</p>
             </div>
             <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {customIntegrations.map((i) => (
                  <div key={i.id} className="rounded-xl border border-border bg-surface p-4 flex flex-col h-full shadow-elev-1">
                     <div className="flex items-start justify-between">
                       <div><p className="font-medium text-text-primary">{i.name}</p><p className="text-xs text-text-muted">{i.type}</p></div>
                       {i.isEnabled ? <Badge variant="success">Enabled</Badge> : <Badge>Disabled</Badge>}
                     </div>
                     {i.webhookUrl && <p className="mt-2 truncate text-xs text-text-muted">{i.webhookUrl}</p>}
                     <div className="flex-1" />
                     <div className="mt-4 flex gap-2 border-t border-border/60 pt-4">
                       <Button size="sm" variant="outline" onClick={() => toggle.mutate(i)}>{i.isEnabled ? 'Disable' : 'Enable'}</Button>
                       <Button size="sm" variant="ghost" onClick={() => setEditing(i)}><Pencil className="h-3.5 w-3.5" /></Button>
                       <Button size="sm" variant="ghost" className="text-danger" onClick={async () => { if (await confirm({ title: 'Delete Integration', message: `Delete ${i.name}?`, confirmText: 'Delete', variant: 'danger' })) remove.mutate(i.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                     </div>
                  </div>
                ))}
             </div>
          </div>
        )}
      </div>
      {editing && <IntegrationDrawer integration={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['admin-integrations'] }); }} />}
      {wizardProvider && (
        <IntegrationWizardWrapper 
          provider={wizardProvider} 
          integration={items.find(i => i.type === wizardProvider.id)} 
          onClose={() => setWizardProvider(null)} 
        />
      )}
    </div>
  );
}

function IntegrationDrawer({ integration, onClose, onSaved }: { integration: IntegrationItem | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(integration?.name ?? '');
  const [type, setType] = useState(integration?.type ?? '');
  const [webhookUrl, setWebhookUrl] = useState(integration?.webhookUrl ?? '');
  const [configText, setConfigText] = useState(JSON.stringify(integration?.config ?? {}, null, 2));
  const [err, setErr] = useState('');

  const save = useMutation({
    mutationFn: () => {
      let config: Record<string, unknown> = {};
      if (configText.trim()) { try { config = JSON.parse(configText); } catch { throw new Error('Config must be valid JSON'); } }
      return integration
        ? adminApi.updateIntegration(integration.id, { name, webhookUrl: webhookUrl || null, config })
        : adminApi.createIntegration({ name, type, webhookUrl: webhookUrl || null, config });
    },
    onSuccess: () => { toast.success(integration ? 'Integration updated' : 'Integration created'); onSaved(); },
    onError: (e) => { const m = apiErrorMessage(e, 'Could not save'); setErr(m); toast.error(m); },
  });

  return (
    <Drawer open onClose={onClose} title={integration ? 'Edit integration' : 'New integration'} subtitle={integration?.type}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!name.trim() || (!integration && !type.trim())} onClick={() => { setErr(''); save.mutate(); }}>{integration ? 'Save' : 'Create'}</Button></div>}>
      <div className="space-y-4">
        <div><label className="mb-1.5 block text-sm font-medium text-text-secondary">Name</label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="mb-1.5 block text-sm font-medium text-text-secondary">Type</label>{integration ? <p className="text-sm text-text-secondary">{type}</p> : <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="e.g. slack, linkedin, calendar" />}</div>
        <div><label className="mb-1.5 block text-sm font-medium text-text-secondary">Webhook URL (optional)</label><Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://…" /></div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">Config (JSON)</label>
          <Textarea rows={8} className="font-mono text-xs" value={configText} onChange={(e) => setConfigText(e.target.value)} />
          <p className="mt-1 text-xs text-text-muted">Keys containing "key/secret/token/password" are encrypted at rest and shown masked. Leave a masked value (••••) unchanged to keep the existing secret.</p>
        </div>
        {err && <p className="text-sm text-danger">{err}</p>}
      </div>
    </Drawer>
  );
}
