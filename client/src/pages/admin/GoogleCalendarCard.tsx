import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, Save, Video, KeyRound, PlugZap } from 'lucide-react';
import toast from 'react-hot-toast';
import { CONFIG_KEYS } from '@agnohire/shared';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Badge } from '../../components/ui/Badge.js';
import * as adminApi from '../../services/adminApi.js';
import type { ConfigItem } from '../../services/adminApi.js';
import { apiErrorMessage } from '../../services/api.js';

/** Config keys this card owns — the generic list hides these to avoid duplication. */
export const GOOGLE_CALENDAR_KEYS: string[] = [
  CONFIG_KEYS.GOOGLE_CALENDAR_ENABLED,
  CONFIG_KEYS.GOOGLE_MEET_ENABLED,
  CONFIG_KEYS.GOOGLE_CLIENT_ID,
  CONFIG_KEYS.GOOGLE_CLIENT_SECRET,
  CONFIG_KEYS.GOOGLE_REFRESH_TOKEN,
  CONFIG_KEYS.GOOGLE_ACCESS_TOKEN,
  CONFIG_KEYS.GOOGLE_CALENDAR_ID,
];

function valueOf(items: ConfigItem[], key: string): string {
  return items.find((c) => c.key === key)?.value ?? '';
}
function hasValueOf(items: ConfigItem[], key: string): boolean {
  return Boolean(items.find((c) => c.key === key)?.hasValue);
}

/**
 * Friendly editor for the Google Calendar / Google Meet integration. Writes to
 * the same `integrations.google_*` config keys the scheduling engine reads, so
 * saving switches calendar sync on/off live — no restart, exactly like the AI
 * provider card.
 */
export function GoogleCalendarCard({ items }: { items: ConfigItem[] }) {
  const qc = useQueryClient();
  const secretSet = (key: string) => hasValueOf(items, key);

  const [enabled, setEnabled] = useState(() => (valueOf(items, CONFIG_KEYS.GOOGLE_CALENDAR_ENABLED) || 'false') === 'true');
  const [meetEnabled, setMeetEnabled] = useState(() => (valueOf(items, CONFIG_KEYS.GOOGLE_MEET_ENABLED) || 'true') === 'true');
  const [clientId, setClientId] = useState(() => valueOf(items, CONFIG_KEYS.GOOGLE_CLIENT_ID));
  const [calendarId, setCalendarId] = useState(() => valueOf(items, CONFIG_KEYS.GOOGLE_CALENDAR_ID) || 'primary');
  // Secrets: blank means "keep the existing encrypted value".
  const [clientSecret, setClientSecret] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [accessToken, setAccessToken] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      const writes: Promise<unknown>[] = [
        adminApi.updateConfig(CONFIG_KEYS.GOOGLE_CALENDAR_ENABLED, String(enabled)),
        adminApi.updateConfig(CONFIG_KEYS.GOOGLE_MEET_ENABLED, String(meetEnabled)),
        adminApi.updateConfig(CONFIG_KEYS.GOOGLE_CLIENT_ID, clientId.trim()),
        adminApi.updateConfig(CONFIG_KEYS.GOOGLE_CALENDAR_ID, calendarId.trim() || 'primary'),
      ];
      // Only send secrets the admin actually typed; blank keeps the stored value.
      if (clientSecret.trim()) writes.push(adminApi.updateConfig(CONFIG_KEYS.GOOGLE_CLIENT_SECRET, clientSecret.trim()));
      if (refreshToken.trim()) writes.push(adminApi.updateConfig(CONFIG_KEYS.GOOGLE_REFRESH_TOKEN, refreshToken.trim()));
      if (accessToken.trim()) writes.push(adminApi.updateConfig(CONFIG_KEYS.GOOGLE_ACCESS_TOKEN, accessToken.trim()));
      await Promise.all(writes);
    },
    onSuccess: () => {
      toast.success('Google Calendar settings saved');
      setClientSecret('');
      setRefreshToken('');
      setAccessToken('');
      qc.invalidateQueries({ queryKey: ['system-config'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save Google Calendar settings')),
  });

  const test = useMutation({
    mutationFn: adminApi.testCalendar,
    onSuccess: (r) => {
      if (r.ok) toast.success(`Connected to "${r.calendar}" (${r.source === 'integration' ? 'legacy integration' : 'system config'})`);
      else if (!r.configured) toast.error('No usable credentials yet — fill them in and save first.');
      else toast.error(`Connection failed: ${r.error ?? 'unknown error'}`);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Calendar test failed')),
  });

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-elev-1">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-heading text-base font-semibold text-text-primary">Google Calendar &amp; Meet</h3>
            <p className="text-xs text-text-muted">
              Sync scheduled interviews to Google Calendar and auto-create Meet links. Saving here takes effect immediately.
            </p>
          </div>
        </div>
        <Badge variant={enabled ? 'success' : 'muted'}>{enabled ? 'Enabled' : 'Disabled'}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="OAuth Client ID">
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxxxx.apps.googleusercontent.com" />
        </Field>

        <Field label="OAuth Client Secret">
          <SecretInput value={clientSecret} onChange={setClientSecret} isSet={secretSet(CONFIG_KEYS.GOOGLE_CLIENT_SECRET)} />
        </Field>

        <Field label="Refresh Token">
          <SecretInput value={refreshToken} onChange={setRefreshToken} isSet={secretSet(CONFIG_KEYS.GOOGLE_REFRESH_TOKEN)} placeholder="1//0g..." />
        </Field>

        <Field label="Access Token (optional)">
          <SecretInput value={accessToken} onChange={setAccessToken} isSet={secretSet(CONFIG_KEYS.GOOGLE_ACCESS_TOKEN)} placeholder="usually leave blank" />
        </Field>

        <Field label="Target Calendar ID">
          <Input value={calendarId} onChange={(e) => setCalendarId(e.target.value)} placeholder="primary" />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span className="flex items-center gap-1.5"><Calendar className="h-4 w-4" /> Calendar sync</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={meetEnabled} onChange={(e) => setMeetEnabled(e.target.checked)} />
            <span className="flex items-center gap-1.5"><Video className="h-4 w-4" /> Auto Meet links</span>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" loading={test.isPending} onClick={() => test.mutate()}>
            <PlugZap className="h-4 w-4" /> Test connection
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            <Save className="h-4 w-4" /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function SecretInput({ value, onChange, isSet, placeholder }: { value: string; onChange: (v: string) => void; isSet: boolean; placeholder?: string }) {
  return (
    <>
      <div className="relative">
        <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
        <Input
          className="pl-9"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isSet ? '•••••••• (leave blank to keep existing)' : (placeholder ?? 'Paste value')}
        />
      </div>
      {isSet && <p className="mt-1 text-xs text-success">A value is currently set. Leave blank to keep it.</p>}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}
