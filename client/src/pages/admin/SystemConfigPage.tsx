import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Save, Mail, Send, Trash2, ImageIcon, Palette, Eye, X, Info, RotateCcw, Database } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AttachmentMeta } from '@agnohire/shared';
import { PageHeader } from '../../components/common/PageHeader.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { FileUploadButton } from '../../components/ui/FileUploadButton.js';
import { Tooltip } from '../../components/ui/Tooltip.js';
import { AiProviderCard, AI_PROVIDER_KEYS } from './AiProviderCard.js';
import { GOOGLE_CALENDAR_KEYS } from './GoogleCalendarCard.js';
import { TenantTimezoneCard } from './TenantTimezoneCard.js';
import { useThemeStore } from '../../store/themeStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { ROLES, CONFIG_KEYS } from '@agnohire/shared';
import { cn } from '../../utils/cn.js';
import * as adminApi from '../../services/adminApi.js';
import type { ConfigItem } from '../../services/adminApi.js';
import { DEFAULT_LOGO, DEFAULT_LOGIN_BACKGROUND } from '../../config/brand.js';
import { apiErrorMessage } from '../../services/api.js';

/** Exact copy shown on the "Automate Document Email" toggle when no onboarding
 *  document templates are configured yet — both as a warning toast and as the
 *  hover tooltip on the disabled checkbox. */
const NO_TEMPLATES_MESSAGE = "No document templates are defined. Click 'Upload Document' to add templates first.";

export function SystemConfigPage() {
  const { data: config, isLoading } = useQuery({ queryKey: ['system-config'], queryFn: adminApi.fetchConfig });
  const [previewOpen, setPreviewOpen] = useState(false);

  const user = useAuthStore((s) => s.user);
  const isPlatformSuperAdmin = user?.role === ROLES.SUPERADMIN;

  const groups = useMemo(() => {
    const m = new Map<string, ConfigItem[]>();
    for (const c of config ?? []) {
      // Exclude default timezone setting for all tenant users
      if (c.key === 'general.default_timezone') continue;
      // Exclude GENERAL settings for all non-platform-superadmins
      if (c.category === 'GENERAL' && !isPlatformSuperAdmin) continue;
      // THEME/AI have dedicated cards below; EMAIL_BRANDING is edited from
      // the Template Customizer's Branding & Themes tab, not here — showing it
      // in both places duplicated the same controls.
      if (c.category === 'THEME' || c.category === 'AI' || c.category === 'EMAIL_BRANDING') continue;
      // The onboarding required-documents list and the offer expiry reminder
      // threshold are platform-operator-only knobs — hide from tenant
      // admins/HR entirely (mirrors the server-side restriction in
      // system.controller.ts) rather than showing a row only SUPERADMIN can save.
      if (
        (c.key === CONFIG_KEYS.ONBOARDING_REQUIRED_DOCUMENTS || c.key === CONFIG_KEYS.OFFER_REMINDER_DAYS_BEFORE) &&
        !isPlatformSuperAdmin
      ) continue;
      if (!m.has(c.category)) m.set(c.category, []);
      m.get(c.category)!.push(c);
    }
    const generalOrder = [
      'general.app_icon',
      'general.company_logo',
      'general.sidebar_logo_height',
      'general.sidebar_logo_width',
      'general.company_name',
      'general.login_background'
    ];
    for (const [cat, items] of m.entries()) {
      if (cat === 'GENERAL') {
        items.sort((a, b) => {
          const idxA = generalOrder.indexOf(a.key);
          const idxB = generalOrder.indexOf(b.key);
          return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });
      }
    }
    return [...m.entries()];
  }, [config, isPlatformSuperAdmin]);

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;

  const aiItems = config?.filter((c) => c.category === 'AI') ?? [];
  const providerItems = aiItems.filter((c) => AI_PROVIDER_KEYS.includes(c.key));
  const chatbotItems = aiItems.filter((c) => !AI_PROVIDER_KEYS.includes(c.key));

  return (
    <div>
      <PageHeader title="System Configuration" description="Runtime settings stored in the database. Secret values are encrypted at rest and shown masked." />
      <div className="mt-5 space-y-6">
        <TenantTimezoneCard />

        {/* Render AI Provider configuration first */}
        {providerItems.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <Settings className="h-3.5 w-3.5" /> AI
            </p>
            <div className="mb-3"><AiProviderCard items={providerItems} /></div>
          </div>
        )}

        {/* Render Chatbot configuration second */}
        {chatbotItems.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <Settings className="h-3.5 w-3.5" /> Chatbot
            </p>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              {chatbotItems.map((c) => <ConfigRow key={c.id} item={c} onPreview={() => setPreviewOpen(true)} />)}
            </div>
          </div>
        )}

        {/* Render other categories dynamically */}
        {groups.map(([category, items]) => {
          // Google Calendar is now configured on the Integrations page (as an
          // Integration row) instead of here — hide these keys entirely
          // rather than showing raw, cardless rows for a superseded UI path.
          const rows = items.filter((c) => !GOOGLE_CALENDAR_KEYS.includes(c.key));
          if (rows.length === 0) return null;

          return (
            <div key={category}>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <Settings className="h-3.5 w-3.5" /> {category}
              </p>
              {rows.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-border bg-surface">
                  {rows.map((c) => <ConfigRow key={c.id} item={c} onPreview={() => setPreviewOpen(true)} />)}
                </div>
              )}
              {category === 'EMAIL' && <div className="mt-4"><EmailTester /></div>}
            </div>
          );
        })}
      </div>

      {/* Appearance opens the global Theme Customizer drawer (also reachable from
          the floating cog on the right of every page). */}
      <div className="mt-6">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted"><Settings className="h-3.5 w-3.5" /> Appearance</p>
        <AppearanceLauncher />
      </div>

      {isPlatformSuperAdmin && (
        <div className="mt-6">
          <ConnectionInfoCard />
        </div>
      )}

      {previewOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface overflow-hidden animate-scale-in">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 z-10 shrink-0">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-accent" />
              <span className="text-sm font-semibold text-text-primary">Login Page Preview</span>
              <span className="rounded-full bg-accent-muted px-2 py-0.5 text-[10px] font-medium text-accent">read-only</span>
            </div>
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="rounded-lg p-1.5 text-text-muted hover:bg-bg hover:text-text-primary transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* Preview Area */}
          <div className="flex-1 bg-bg relative overflow-hidden">
            <iframe
              src="/login?preview=true"
              className="h-full w-full border-0"
              title="Login Page Preview"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AppearanceLauncher() {
  const setOpen = useThemeStore((s) => s.setCustomizerOpen);
  const activeThemeName = useThemeStore((s) => s.activeThemeName);
  const tokens = useThemeStore((s) => s.tokens);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition hover:border-text-muted"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Palette className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text-primary">Theme &amp; appearance</span>
        <span className="block truncate text-xs text-text-muted">Active theme: {activeThemeName}. Open the customizer to change colours.</span>
      </span>
      <span className="flex -space-x-1">
        {(['bg', 'surface', 'accent', 'text-primary'] as const).map((k) => (
          <span key={k} className="h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: tokens[k] }} />
        ))}
      </span>
    </button>
  );
}

function ConfigRow({ item, onPreview }: { item: ConfigItem; onPreview: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(item.isSecret ? '' : item.value ?? '');
  const [dirty, setDirty] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const user = useAuthStore((s) => s.user);
  const isPlatformSuperAdmin = user?.role === ROLES.SUPERADMIN;
  const isFieldDisabled = (!isPlatformSuperAdmin && (item.key === 'general.company_name'));

  const isWidthOrHeight = item.key === 'general.sidebar_logo_width' || item.key === 'general.sidebar_logo_height';
  const handleReset = () => {
    const defaultValue = item.key === 'general.sidebar_logo_width' ? '195' : '200';
    setValue(defaultValue);
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () => adminApi.updateConfig(item.key, value),
    onSuccess: () => {
      toast.success(`${item.label} saved`);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['system-config'] });
      if (item.key === 'general.sidebar_logo_width') {
        useThemeStore.getState().setSidebarLogoWidth(value);
      }
      if (item.key === 'general.sidebar_logo_height') {
        useThemeStore.getState().setSidebarLogoHeight(value);
      }
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save')),
  });

  if (item.dataType === 'IMAGE') return <ImageConfigRow item={item} onPreview={onPreview} />;
  if (item.key === CONFIG_KEYS.OFFER_AUTOMATE_DOCUMENT_EMAIL) return <AutomateDocumentEmailRow item={item} />;

  const isBool = item.dataType === 'BOOLEAN';

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0">
      <div className="min-w-[200px] flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm text-text-primary">{item.label}</p>
          {item.isSecret && <Badge variant="warning">secret</Badge>}
          {item.isSecret && item.hasValue && <Badge variant="success">set</Badge>}
          {item.key === 'email.smtp_pass' && (
            <button type="button" onClick={() => setShowHelp(true)} className="text-text-muted hover:text-accent" title="How to get an App Password">
              <Info className="h-4 w-4" />
            </button>
          )}
        </div>
        {item.description && <p className="text-xs text-text-muted">{item.description}</p>}
        <p className="text-[11px] text-text-muted">{item.key}</p>
        
        {showHelp && item.key === 'email.smtp_pass' && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 animate-in fade-in">
            <div className="w-full max-w-md rounded-xl bg-surface p-6 shadow-xl border border-border">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-text-primary">How to get an App Password</h3>
                <button onClick={() => setShowHelp(false)} className="rounded-md p-1 hover:bg-bg text-text-muted hover:text-text-primary transition-colors"><X className="h-5 w-5" /></button>
              </div>
              <div className="space-y-3 text-sm text-text-secondary">
                <p>If you are using Gmail, you need to generate an App Password:</p>
                <ol className="list-decimal pl-5 space-y-2">
                  <li>Go to your Google Account and log in with your email ID.</li>
                  <li>Go to <strong>Security</strong> on the left panel.</li>
                  <li>Ensure <strong>2-Step Verification</strong> is turned ON.</li>
                  <li>Search for <strong>App passwords</strong> in the search bar.</li>
                  <li>Select "Other" for app, enter a name (e.g., "AgnoHire"), and click <strong>Generate</strong>.</li>
                  <li>Copy the 16-character password and paste it here.</li>
                </ol>
              </div>
              <div className="mt-6 flex justify-end">
                <Button onClick={() => setShowHelp(false)}>Got it</Button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {isBool ? (
          <select className="h-9 rounded-md border border-border bg-bg px-2 text-sm text-text-primary disabled:opacity-60 disabled:cursor-not-allowed" value={value || item.value || 'false'} disabled={isFieldDisabled} onChange={(e) => { setValue(e.target.value); setDirty(true); }}>
            <option value="true">true</option><option value="false">false</option>
          </select>
        ) : (
          <Input className="w-56" type={item.isSecret ? 'password' : 'text'} placeholder={item.isSecret ? (item.hasValue ? '•••••••• (set)' : 'unset') : ''} value={value} disabled={isFieldDisabled} onChange={(e) => { setValue(e.target.value); setDirty(true); }} />
        )}
        {isWidthOrHeight && (
          <Button size="sm" variant="ghost" title="Reset to default" onClick={handleReset}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button size="sm" variant="outline" loading={save.isPending} disabled={!dirty || isFieldDisabled} onClick={() => save.mutate()}><Save className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

/**
 * The "Automate Document Email" toggle. Rendered as a checkbox (rather than
 * the generic true/false dropdown) so it can enforce a safeguard: with no
 * onboarding document templates configured yet, the setting is meaningless
 * (there's nothing to attach to the request email), so the checkbox forces
 * itself to the unchecked/off state and refuses to be toggled — surfacing a
 * warning toast on click and the same message as a hover tooltip.
 */
function AutomateDocumentEmailRow({ item }: { item: ConfigItem }) {
  const qc = useQueryClient();
  const { data: config } = useQuery({ queryKey: ['system-config'], queryFn: adminApi.fetchConfig });

  const hasDocuments = (() => {
    const docsItem = config?.find((c) => c.key === CONFIG_KEYS.ONBOARDING_REQUIRED_DOCUMENTS);
    if (!docsItem?.value) return false;
    try {
      const parsed = JSON.parse(docsItem.value);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  })();

  const checked = hasDocuments && item.value !== 'false';

  const save = useMutation({
    mutationFn: (enabled: boolean) => adminApi.updateConfig(item.key, enabled.toString()),
    onSuccess: (_r, enabled) => {
      toast.success(enabled ? 'Document email automation enabled' : 'Document email automation disabled');
      qc.invalidateQueries({ queryKey: ['system-config'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save')),
  });

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0">
      <div className="min-w-[200px] flex-1">
        <p className="text-sm text-text-primary">{item.label}</p>
        {item.description && <p className="text-xs text-text-muted">{item.description}</p>}
        <p className="text-[11px] text-text-muted">{item.key}</p>
      </div>
      <Tooltip
        placement="top"
        maxWidth={320}
        content={hasDocuments ? (item.description || item.label) : NO_TEMPLATES_MESSAGE}
      >
        <label
          onClick={(e) => {
            if (!hasDocuments) {
              e.preventDefault();
              toast.error(NO_TEMPLATES_MESSAGE);
            }
          }}
          className={cn(
            'flex items-center gap-2 select-none',
            !hasDocuments ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          )}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={!hasDocuments || save.isPending}
            onChange={(e) => {
              if (hasDocuments) save.mutate(e.target.checked);
            }}
            className={cn('h-4 w-4 rounded border-border text-accent focus:ring-accent', !hasDocuments ? 'cursor-not-allowed' : 'cursor-pointer')}
          />
          <span className="text-sm text-text-secondary">{checked ? 'Enabled' : 'Disabled'}</span>
        </label>
      </Tooltip>
    </div>
  );
}

/**
 * An image-valued config row: previews the current image, uploads a replacement
 * to the attachment store, and saves the attachment id back to config. The
 * preview uses the public branding URL so it renders without an auth header.
 */
function ImageConfigRow({ item, onPreview }: { item: ConfigItem; onPreview: () => void }) {
  const qc = useQueryClient();
  const setAppIcon = useThemeStore((s) => s.setAppIcon);
  const setCompanyLogo = useThemeStore((s) => s.setCompanyLogo);
  const setLoginBackground = useThemeStore((s) => s.setLoginBackground);
  const attachmentId = item.value ?? '';
  const brandUrl = (id: string) => {
    if (!id) return '';
    if (id.startsWith('/') || id.startsWith('http')) return id;
    return `/api/system/branding/${encodeURIComponent(item.key)}?v=${encodeURIComponent(id)}`;
  };
  const previewUrl = attachmentId ? brandUrl(attachmentId) : null;
  const defaultFallbackUrl =
    item.key === 'general.company_logo'
      ? DEFAULT_LOGO
      : item.key === 'general.app_icon'
      ? '/favicon.png'
      : item.key === 'general.login_background'
      ? DEFAULT_LOGIN_BACKGROUND
      : null;

  const displayUrl = previewUrl || defaultFallbackUrl;

  // Reflect the change live in the sidebar/login without a full reload.
  const applyLive = (id: string) => {
    const url = id ? brandUrl(id) : null;
    if (item.key === 'general.app_icon') {
      setAppIcon(url);
      if (url) localStorage.setItem('agnohire.appIcon', url);
      else localStorage.removeItem('agnohire.appIcon');
    }
    if (item.key === 'general.company_logo') {
      setCompanyLogo(url);
      if (url) localStorage.setItem('agnohire.companyLogo', url);
      else localStorage.removeItem('agnohire.companyLogo');
    }
    if (item.key === 'general.login_background') setLoginBackground(url);
  };

  const save = useMutation({
    mutationFn: (id: string) => adminApi.updateConfig(item.key, id),
    onSuccess: (_r, id) => {
      toast.success(`${item.label} ${id ? 'updated' : 'removed'}`);
      qc.invalidateQueries({ queryKey: ['system-config'] });
      applyLive(id);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save')),
  });

  const onUploaded = (meta: AttachmentMeta) => save.mutate(meta.id);

  const displayLabel = item.key === 'general.company_logo'
    ? 'Sidebar logo'
    : item.key === 'general.app_icon'
    ? 'Web icon'
    : item.label;

  const displayDescription = item.key === 'general.company_logo'
    ? 'Full / wide logo image (PNG, JPG, WEBP) shown in the sidebar. Leave empty to use the app icon + name.'
    : item.key === 'general.app_icon'
    ? 'Square icon (PNG, JPG, WEBP) shown in the website browser tab. Leave empty to use the default favicon.'
    : item.description;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0">
      <div className="min-w-[200px] flex-1">
        <p className="text-sm text-text-primary">{displayLabel}</p>
        {displayDescription && <p className="text-xs text-text-muted">{displayDescription}</p>}
        <p className="text-[11px] text-text-muted">{item.key}</p>
      </div>
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex items-center justify-center overflow-hidden rounded-lg border border-border bg-bg p-1",
          item.key === 'general.company_logo' ? "h-12 w-28" : item.key === 'general.login_background' ? "h-12 w-20" : "h-12 w-12"
        )}>
          {displayUrl ? (
            <img
              src={displayUrl}
              alt="logo preview"
              className={cn(
                "max-h-full max-w-full",
                item.key === 'general.login_background' ? "object-cover h-full w-full" : "object-contain"
              )}
            />
          ) : (
            <ImageIcon className="h-5 w-5 text-text-muted" />
          )}
        </div>
        {item.key === 'general.login_background' && (
          <Button
            size="sm"
            variant="outline"
            onClick={onPreview}
            title="Preview login page"
            type="button"
          >
            <Eye className="h-4 w-4" />
          </Button>
        )}
        <FileUploadButton
          label={attachmentId ? 'Replace' : 'Upload'}
          accept=".png,.jpg,.jpeg,.webp"
          onUploaded={onUploaded}
        />
        {attachmentId && (
          <Button size="sm" variant="ghost" loading={save.isPending} onClick={() => save.mutate('')}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Read-only visibility into DB connection capacity for SUPERADMIN. Nothing
 * here is editable — changing any of it requires editing docker-compose.yml/
 * .env and restarting the Postgres/PgBouncer containers, not a web request.
 */
function ConnectionInfoCard() {
  const { data, isLoading } = useQuery({ queryKey: ['connection-info'], queryFn: adminApi.fetchConnectionInfo });

  const Row = ({ label, value, hint }: { label: string; value: string | null | undefined; hint?: string }) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5 last:border-0">
      <div>
        <p className="text-sm text-text-primary">{label}</p>
        {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
      </div>
      <span className="rounded-md bg-bg px-2 py-1 text-xs font-mono text-text-secondary">{value ?? '—'}</span>
    </div>
  );

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
        <Database className="h-3.5 w-3.5" /> Connections (read-only)
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : !data ? (
          <p className="px-4 py-4 text-sm text-text-muted">Could not load connection info.</p>
        ) : (
          <>
            <div className="border-b border-border/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Postgres — live</div>
            <Row label="max_connections" value={data.live.postgresMaxConnections} hint="Hard ceiling on real backend connections Postgres will accept, from everywhere combined (PgBouncer, migrations, admin tools). Queried from the running server right now." />
            <Row label="shared_buffers" value={data.live.postgresSharedBuffers} hint="Postgres's own page cache in shared memory — bigger means more of the working data set stays in RAM instead of hitting disk. Queried from the running server right now." />

            <div className="border-b border-t border-border/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">PgBouncer — configured (docker-compose.yml)</div>
            <Row label="DEFAULT_POOL_SIZE" value={data.configured?.pgbouncerDefaultPoolSize} hint="Real backend connections to Postgres PgBouncer keeps open under normal load, shared across every client connection via transaction pooling." />
            <Row label="RESERVE_POOL_SIZE" value={data.configured?.pgbouncerReservePoolSize} hint="Extra backend connections borrowed only during a burst, on top of DEFAULT_POOL_SIZE. DEFAULT_POOL_SIZE + RESERVE_POOL_SIZE is the hard ceiling PgBouncer will ever use." />
            <Row label="RESERVE_POOL_TIMEOUT" value={data.configured?.pgbouncerReservePoolTimeout} hint="Seconds a client must already be waiting for a connection before PgBouncer is allowed to dip into the reserve pool at all." />
            <Row label="MAX_CLIENT_CONN" value={data.configured?.pgbouncerMaxClientConn} hint="Cheap client-side (frontend) connections PgBouncer will accept at once — this is what scales to thousands of concurrent candidates, not the real backend pool above." />
            <Row label="QUERY_WAIT_TIMEOUT" value={data.configured?.pgbouncerQueryWaitTimeout} hint="How long a request queues for a free backend connection before failing outright, once DEFAULT_POOL_SIZE + RESERVE_POOL_SIZE are all busy." />
            <Row label="SERVER_IDLE_TIMEOUT" value={data.configured?.pgbouncerServerIdleTimeout} hint="Seconds a backend connection can sit idle (checked back into the pool, unused) before PgBouncer closes it — this is what lets the pool actually shrink back down at rest." />
            <Row label="SERVER_LIFETIME" value={data.configured?.pgbouncerServerLifetime} hint="Hard cap (seconds) on how long any single backend connection can live, even if it's kept constantly busy and never idle long enough to hit SERVER_IDLE_TIMEOUT." />

            <div className="border-b border-t border-border/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">This app's own pool (DATABASE_URL)</div>
            <Row label="connection_limit" value={data.appPool.connectionLimit} hint="Max connections this Node process's Prisma client will open to PgBouncer's frontend. Prisma opens these lazily under load but never closes them back down on its own — only process restart resets it." />
            <Row label="pool_timeout" value={data.appPool.poolTimeout} hint="Seconds a query waits for a free connection from THIS app's own pool (above) before failing fast, distinct from PgBouncer's own QUERY_WAIT_TIMEOUT one layer down." />
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-text-muted">
        Read-only. Changing any of this requires editing docker-compose.yml/.env and restarting the Postgres/PgBouncer containers — not something this page can trigger.
      </p>
    </div>
  );
}

function EmailTester() {
  const [to, setTo] = useState('');
  const test = useMutation({
    mutationFn: () => adminApi.testEmail(to || undefined),
    onSuccess: (r) => {
      if (!r.verified) toast.error(`SMTP not configured: ${r.error ?? 'verify failed'}`);
      else if (r.sent) toast.success('Test email sent');
      else toast.success('SMTP verified (no recipient given)');
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Email test failed')),
  });

  return (
    <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex-1 min-w-[220px]">
        <label className="mb-1 flex items-center gap-1.5 text-sm font-medium text-text-secondary"><Mail className="h-4 w-4" /> Test Email Delivery</label>
        <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient@example.com (optional — blank just verifies)" />
      </div>
      <Button variant="outline" loading={test.isPending} onClick={() => test.mutate()}><Send className="h-4 w-4" /> Send test</Button>
    </div>
  );
}
