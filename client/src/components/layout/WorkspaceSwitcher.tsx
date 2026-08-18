import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Check, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore.js';
import { setAccessToken, apiErrorMessage } from '../../services/api.js';
import * as workspaceService from '../../services/workspace.service.js';

interface WorkspaceSwitcherProps {
  /** Only fetch the membership tree once the parent dropdown is actually open — avoids the extra join on every menu render. */
  menuOpen: boolean;
  /** Called after a successful switch so the parent dropdown can close itself. */
  onSwitched: () => void;
}

/**
 * Extends the existing Navbar user-menu dropdown with an Organization/
 * Workspace switcher. Renders nothing for the overwhelming majority of
 * tenants — those with exactly one Organization and one Workspace (the
 * default-backfill migration's shape) — so nobody sees a confusing picker
 * for a feature they've never opted into.
 */
export function WorkspaceSwitcher({ menuOpen, onSwitched }: WorkspaceSwitcherProps) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const { data: memberships } = useQuery({
    queryKey: ['auth-memberships'],
    queryFn: workspaceService.fetchMemberships,
    enabled: menuOpen,
    staleTime: Infinity,
  });

  const switchMutation = useMutation({
    mutationFn: (workspaceId: string) => workspaceService.switchWorkspace(workspaceId),
    onSuccess: ({ accessToken, user: nextUser }) => {
      setAccessToken(accessToken);
      setUser(nextUser);
      // Cached queries aren't workspace-scoped, so a workspace switch can leak
      // the previous workspace's lists/stats into the new one otherwise —
      // same rationale as the existing sign-out/impersonation cache wipes.
      qc.clear();
      toast.success(`Switched to ${nextUser.workspaceName ?? 'workspace'}`);
      setExpanded(false);
      onSwitched();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not switch workspace')),
  });

  if (!user) return null;

  const organizations = memberships?.organizations ?? [];
  const hasMultipleContexts =
    organizations.length > 1 || organizations.some((o) => o.workspaces.length > 1);

  if (!hasMultipleContexts) return null;

  return (
    <div className="border-b border-border py-1">
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-surface-overlay"
        onClick={() => setExpanded((o) => !o)}
      >
        <Building2 className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          <span className="block truncate text-text-primary">{user.workspaceName ?? 'Select workspace'}</span>
          {user.organizationName && <span className="block truncate text-xs text-text-muted">{user.organizationName}</span>}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="max-h-56 space-y-2 overflow-y-auto px-1.5 pb-1.5">
          {organizations.map((org) => (
            <div key={org.id}>
              {organizations.length > 1 && (
                <p className="truncate px-2 py-1 text-xs font-medium text-text-muted">{org.name}</p>
              )}
              {org.workspaces.map((ws) => {
                const isCurrent = ws.id === user.workspaceId;
                return (
                  <button
                    key={ws.id}
                    type="button"
                    role="menuitem"
                    disabled={isCurrent || switchMutation.isPending}
                    onClick={() => switchMutation.mutate(ws.id)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-overlay disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className="min-w-0 flex-1 truncate text-left">{ws.name}</span>
                    {isCurrent && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
