import { Badge } from '../../../components/ui/Badge.js';
import { Button } from '../../../components/ui/Button.js';
import { Pencil, Trash2 } from 'lucide-react';
import type { IntegrationItem } from '@agnohire/shared';
import type { IntegrationProviderDef } from './providers/index.js';
import { useConfirm } from '../../../providers/ConfirmProvider.js';

export function IntegrationCard({
  provider,
  integration,
  onConfigure,
  onToggle,
  onDelete,
}: {
  provider: IntegrationProviderDef;
  integration?: IntegrationItem;
  onConfigure: () => void;
  onToggle: (integration: IntegrationItem) => void;
  onDelete: (id: string) => void;
}) {
  const confirm = useConfirm();
  const isConnected = integration?.isEnabled ?? false;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-elev-1 transition-colors hover:border-accent/50 flex flex-col h-full">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-alt">
            {provider.icon}
          </div>
          <div>
            <h3 className="font-heading text-base font-semibold text-text-primary">{provider.name}</h3>
            <p className="text-xs text-text-muted mt-1">{provider.description}</p>
          </div>
        </div>
        <Badge variant={isConnected ? 'success' : 'muted'}>{isConnected ? 'Connected' : 'Not Connected'}</Badge>
      </div>
      
      <div className="flex-1" />

      {isConnected && integration && (
        <div className="mt-4 text-xs text-text-secondary border-t border-border/60 pt-3 space-y-1">
          <p><strong>Name:</strong> {integration.name}</p>
          {integration.lastSyncAt && (
            <p><strong>Tested:</strong> {new Date(integration.lastSyncAt).toLocaleDateString()}</p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-4">
        {isConnected && integration ? (
          <>
            <Button size="sm" variant="outline" onClick={() => onToggle(integration)}>
              {integration.isEnabled ? 'Disable' : 'Enable'}
            </Button>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={onConfigure}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button 
                size="sm" 
                variant="ghost" 
                className="text-danger" 
                onClick={async () => {
                  if (await confirm({ title: 'Delete Integration', message: `Delete ${provider.name} connection?`, confirmText: 'Delete', variant: 'danger' })) {
                    onDelete(integration.id);
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </>
        ) : (
          <Button size="sm" className="w-full" onClick={onConfigure}>
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}
