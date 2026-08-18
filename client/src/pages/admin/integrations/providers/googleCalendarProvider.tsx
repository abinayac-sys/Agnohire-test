import { KeyRound, Briefcase, Calendar, Video } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Input } from '../../../../components/ui/Input.js';
import { FieldWithHelp } from '../../../../components/ui/FieldWithHelp.js';
import type { IntegrationProviderDef } from './index.js';
import * as adminApi from '../../../../services/adminApi.js';
import { apiErrorMessage } from '../../../../services/api.js';
import { CONFIG_KEYS } from '@agnohire/shared';

/**
 * Auto Meet links (GOOGLE_MEET_ENABLED) is a single global/per-sector System
 * Config value — shared by BOTH the System Config Google card and this one,
 * regardless of which credential source (System Config or this Integration
 * row) actually supplies the connection. Toggling it here changes the same
 * setting the other card shows, saved immediately (not tied to this wizard's
 * Finish Setup button, since it's a different backend mechanism than
 * Integration.configJson).
 */
function AutoMeetToggle() {
  const qc = useQueryClient();
  const { data: config } = useQuery({ queryKey: ['system-config'], queryFn: adminApi.fetchConfig });
  const item = config?.find((c) => c.key === CONFIG_KEYS.GOOGLE_MEET_ENABLED);
  const meetEnabled = (item?.value ?? 'true') === 'true';

  const toggle = useMutation({
    mutationFn: (value: boolean) => adminApi.updateConfig(CONFIG_KEYS.GOOGLE_MEET_ENABLED, value ? 'true' : 'false'),
    onSuccess: () => { toast.success('Auto Meet links setting saved'); qc.invalidateQueries({ queryKey: ['system-config'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not update')),
  });

  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
      <input
        type="checkbox"
        className="h-4 w-4 accent-accent"
        checked={meetEnabled}
        disabled={toggle.isPending}
        onChange={(e) => toggle.mutate(e.target.checked)}
      />
      <span className="flex items-center gap-1.5"><Video className="h-4 w-4" /> Auto Meet links</span>
    </label>
  );
}

/**
 * id must uppercase to exactly 'GOOGLE_CALENDAR' — calendarService.ts's
 * CALENDAR_TYPES already recognizes an Integration row of this type as a
 * valid (legacy-path) credential source, so no backend changes are needed
 * for this card to work.
 *
 * Note: calendarService.ts checks System Configuration keys FIRST, then this
 * Integration row as a fallback. If Admin Console → System Configuration →
 * Integrations already has Google Calendar configured there, that value wins
 * over whatever is saved here — this card only takes effect when the System
 * Config tier is empty/disabled.
 */
export const googleCalendarProvider: IntegrationProviderDef = {
  id: 'google_calendar',
  categoryId: 'calendar',
  name: 'Google Calendar & Meet',
  description: 'Sync scheduled interviews to Google Calendar and auto-create Meet links.',
  icon: <img src="https://www.google.com/s2/favicons?domain=google.com&sz=64" alt="Logo" className="w-8 h-8 object-contain rounded-md" />,
  getDefaultState: () => ({
    enabled: true,
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    accessToken: '',
    calendarId: 'primary',
  }),
  getSavePayload: (state, integration) => {
    const config: Record<string, unknown> = {
      clientId: state.clientId,
      calendarId: state.calendarId || 'primary',
    };
    if (state.clientSecret) config.clientSecret = state.clientSecret;
    else if (integration?.config?.clientSecret) config.clientSecret = '••••••••';

    if (state.refreshToken) config.refreshToken = state.refreshToken;
    else if (integration?.config?.refreshToken) config.refreshToken = '••••••••';

    if (state.accessToken) config.accessToken = state.accessToken;
    else if (integration?.config?.accessToken) config.accessToken = '••••••••';

    return config;
  },
  getWizardSteps: ({ state, updateState, integration, testResult, setTestResult, setIsTesting, save }) => [
    {
      title: 'Google Calendar Credentials',
      description: 'Enter your Google OAuth credentials to connect Calendar and Meet. Saving here only takes effect if Google Calendar is not already configured in System Configuration → Integrations.',
      content: (
        <div className="space-y-6">
          <FieldWithHelp
            label="OAuth Client ID"
            help={{
              what: 'The client ID of your Google Cloud OAuth app.',
              why: 'Identifies AgnoHire to Google’s API.',
              where: 'Google Cloud Console → APIs & Services → Credentials',
            }}
          >
            <div className="relative">
              <Briefcase className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input className="pl-9" value={state.clientId} onChange={(e) => updateState({ clientId: e.target.value })} placeholder="xxxxxx.apps.googleusercontent.com" />
            </div>
          </FieldWithHelp>

          <FieldWithHelp
            label="OAuth Client Secret"
            help={{ what: 'The secret for your Google OAuth app.', why: 'Secures the server-to-server connection.', where: 'Google Cloud Console → APIs & Services → Credentials' }}
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input
                className="pl-9" type="password" autoComplete="new-password"
                value={state.clientSecret} onChange={(e) => updateState({ clientSecret: e.target.value })}
                placeholder={integration?.config?.clientSecret ? '•••••••• (leave blank to keep existing)' : 'Paste Client Secret'}
              />
            </div>
          </FieldWithHelp>

          <FieldWithHelp
            label="Refresh Token"
            help={{ what: 'A long-lived token used to mint access tokens.', why: 'Lets AgnoHire call the Calendar API without you signing in again.', where: 'Obtained via Google OAuth Playground or your own consent flow.' }}
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input
                className="pl-9" type="password" autoComplete="new-password"
                value={state.refreshToken} onChange={(e) => updateState({ refreshToken: e.target.value })}
                placeholder={integration?.config?.refreshToken ? '•••••••• (leave blank to keep existing)' : '1//0g...'}
              />
            </div>
          </FieldWithHelp>

          <FieldWithHelp
            label="Access Token (optional)"
            help={{ what: 'A short-lived token, usually left blank.', why: 'Only needed if you’re not providing a refresh token.', where: 'Usually leave blank — the refresh token is enough.' }}
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input
                className="pl-9" type="password" autoComplete="new-password"
                value={state.accessToken} onChange={(e) => updateState({ accessToken: e.target.value })}
                placeholder={integration?.config?.accessToken ? '•••••••• (leave blank to keep existing)' : 'usually leave blank'}
              />
            </div>
          </FieldWithHelp>

          <FieldWithHelp
            label="Target Calendar ID"
            help={{ what: 'Which calendar to create events on.', why: 'Defaults to the connected account’s primary calendar.', where: 'Leave as "primary" unless you know you need a different calendar.' }}
          >
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input className="pl-9" value={state.calendarId} onChange={(e) => updateState({ calendarId: e.target.value })} placeholder="primary" />
            </div>
          </FieldWithHelp>

          <div className="flex flex-wrap items-center gap-4 border-t border-border/60 pt-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={state.enabled}
                onChange={(e) => updateState({ enabled: e.target.checked })}
              />
              <span className="flex items-center gap-1.5"><Calendar className="h-4 w-4" /> Calendar sync</span>
            </label>
            <AutoMeetToggle />
          </div>

          <button
            type="button"
            className="text-sm font-medium text-accent hover:underline disabled:opacity-50"
            disabled={!save}
            onClick={async () => {
              if (!save) return;
              setIsTesting(true);
              setTestResult(null);
              try {
                await save();
                const r = await adminApi.testCalendar();
                if (r.ok) setTestResult({ ok: true });
                else setTestResult({ ok: false, error: r.error || (r.configured ? 'Connection failed.' : 'Not configured yet.') });
              } catch (e: any) {
                setTestResult({ ok: false, error: apiErrorMessage(e) });
              } finally {
                setIsTesting(false);
              }
            }}
          >
            Save &amp; test connection
          </button>

          {testResult && (
            <div className={`p-4 rounded-lg border w-full text-center ${testResult.ok ? 'bg-green-500/10 border-green-500/20 text-green-700' : 'bg-red-500/10 border-red-500/20 text-red-700'}`}>
              {testResult.ok ? '✅ Connected Successfully!' : `❌ Connection Failed: ${testResult.error}`}
            </div>
          )}
        </div>
      ),
    },
  ],
};
