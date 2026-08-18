import { KeyRound, Building, Briefcase, Calendar } from 'lucide-react';
import { Input } from '../../../../components/ui/Input.js';
import { FieldWithHelp } from '../../../../components/ui/FieldWithHelp.js';
import type { IntegrationProviderDef } from './index.js';

/**
 * id must uppercase to exactly 'MICROSOFT_CALENDAR' — matches
 * microsoftCalendarProvider.ts's INTEGRATION_TYPES on the server, so no
 * backend changes are needed for this card to work. Deliberately distinct
 * from the existing 'teams' provider (teamsProvider.tsx) — that one is an
 * unrelated, application-permission-style integration for chat
 * notifications, not this delegated calendar/meeting flow.
 *
 * Each workspace brings its own Entra ID app registration (delegated
 * permissions only: User.Read, Calendars.ReadWrite, OnlineMeetings.ReadWrite,
 * offline_access) — no live "Test connection" exists yet (unlike Google),
 * since there's no admin-console test endpoint for Microsoft Graph yet.
 */
export const microsoftCalendarProvider: IntegrationProviderDef = {
  id: 'microsoft_calendar',
  categoryId: 'calendar',
  name: 'Microsoft Calendar & Teams',
  description: 'Sync scheduled interviews to Outlook Calendar and auto-create Teams meeting links.',
  icon: <img src="https://www.google.com/s2/favicons?domain=microsoft.com&sz=64" alt="Logo" className="w-8 h-8 object-contain rounded-md" />,
  getDefaultState: () => ({
    enabled: true,
    tenantId: '',
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    calendarId: '',
  }),
  getSavePayload: (state, integration) => {
    const config: Record<string, unknown> = {
      tenantId: state.tenantId,
      clientId: state.clientId,
      ...(state.calendarId ? { calendarId: state.calendarId } : {}),
    };
    if (state.clientSecret) config.clientSecret = state.clientSecret;
    else if (integration?.config?.clientSecret) config.clientSecret = '••••••••';

    if (state.refreshToken) config.refreshToken = state.refreshToken;
    else if (integration?.config?.refreshToken) config.refreshToken = '••••••••';

    return config;
  },
  getWizardSteps: ({ state, updateState, integration }) => [
    {
      title: 'Microsoft Calendar Credentials',
      description: 'Enter your Entra ID app registration credentials to connect Outlook Calendar and Teams.',
      isNextDisabled:
        !state.tenantId.trim() ||
        !state.clientId.trim() ||
        (!state.clientSecret && !integration?.config?.clientSecret) ||
        (!state.refreshToken && !integration?.config?.refreshToken),
      content: (
        <div className="space-y-6">
          <FieldWithHelp
            label="Tenant ID (Directory ID)"
            help={{
              what: 'The unique identifier for your Microsoft 365 organization.',
              why: 'Required to authenticate API requests to your specific directory.',
              where: 'Azure Portal → App registrations → Your App → Overview',
            }}
          >
            <div className="relative">
              <Building className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input className="pl-9" value={state.tenantId} onChange={(e) => updateState({ tenantId: e.target.value })} />
            </div>
          </FieldWithHelp>

          <FieldWithHelp
            label="Client ID (Application ID)"
            help={{
              what: 'The unique identifier for the App Registration.',
              why: 'Identifies AgnoHire to Microsoft Graph API.',
              where: 'Azure Portal → App registrations → Your App → Overview',
            }}
          >
            <div className="relative">
              <Briefcase className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input className="pl-9" value={state.clientId} onChange={(e) => updateState({ clientId: e.target.value })} />
            </div>
          </FieldWithHelp>

          <FieldWithHelp
            label="Client Secret Value"
            help={{
              what: 'A password used by AgnoHire to prove its identity.',
              why: 'Secures the server-to-server connection.',
              where: 'Azure Portal → Certificates & secrets',
              commonMistakes: 'Copying the Secret ID instead of the Secret Value.',
            }}
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input
                className="pl-9" type="password" autoComplete="new-password"
                value={state.clientSecret} onChange={(e) => updateState({ clientSecret: e.target.value })}
                placeholder={integration?.config?.clientSecret ? '•••••••• (leave blank to keep existing)' : 'Paste Client Secret Value'}
              />
            </div>
          </FieldWithHelp>

          <FieldWithHelp
            label="Refresh Token"
            help={{
              what: 'A long-lived token obtained from the delegated-consent flow.',
              why: 'Lets AgnoHire call Microsoft Graph on your behalf without you signing in again.',
              where: 'Obtained via the one-time Microsoft sign-in/consent flow — ask your AgnoHire admin if you don’t have this yet.',
            }}
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input
                className="pl-9" type="password" autoComplete="new-password"
                value={state.refreshToken} onChange={(e) => updateState({ refreshToken: e.target.value })}
                placeholder={integration?.config?.refreshToken ? '•••••••• (leave blank to keep existing)' : 'Paste refresh token'}
              />
            </div>
          </FieldWithHelp>

          <FieldWithHelp
            label="Target Calendar ID (optional)"
            help={{ what: 'Which calendar to create events on.', why: 'Defaults to the connected account’s primary calendar.', where: 'Leave blank unless you know you need a different calendar.' }}
          >
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input className="pl-9" value={state.calendarId} onChange={(e) => updateState({ calendarId: e.target.value })} placeholder="defaults to primary" />
            </div>
          </FieldWithHelp>

          <div className="border-t border-border/60 pt-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={state.enabled}
                onChange={(e) => updateState({ enabled: e.target.checked })}
              />
              <span className="flex items-center gap-1.5"><Calendar className="h-4 w-4" /> Calendar sync</span>
            </label>
          </div>

          <p className="text-xs text-text-muted">
            No live "Test connection" is available for Microsoft yet — saving will take effect the next time an interview is
            scheduled, rescheduled, cancelled, or synced.
          </p>
        </div>
      ),
    },
  ],
};
