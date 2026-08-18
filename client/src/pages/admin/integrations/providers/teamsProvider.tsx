import { ExternalLink, KeyRound, Building, Briefcase } from 'lucide-react';
import { Button } from '../../../../components/ui/Button.js';
import { Input } from '../../../../components/ui/Input.js';
import { FieldWithHelp } from '../../../../components/ui/FieldWithHelp.js';
import type { IntegrationProviderDef } from './index.js';
import { api, apiErrorMessage } from '../../../../services/api.js';

export const teamsProvider: IntegrationProviderDef = {
  id: 'teams',
  categoryId: 'communication',
  name: 'Microsoft Teams',
  description: 'Connect Microsoft Teams to send interview notifications and meeting links.',
  icon: (
    <svg className="text-[#6264A7]" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.983 2.083c0-1.15.932-2.083 2.083-2.083s2.084.933 2.084 2.083-.933 2.084-2.084 2.084-2.083-.934-2.083-2.084zm6.05 0c0-1.15.932-2.083 2.083-2.083s2.083.933 2.083 2.083-.932 2.084-2.083 2.084-2.083-.934-2.083-2.084zm-.054 2.768c-1.353-.162-2.613.565-3.13 1.777v5.334c1.196.16 2.083 1.203 2.083 2.455v2.895h2.5c1.378 0 2.5-1.121 2.5-2.5v-7.461c0-1.378-1.122-2.5-2.5-2.5h-1.453zm-3.979 2.064h-3.958c-1.378 0-2.5 1.122-2.5 2.5v9.167c0 1.378 1.122 2.5 2.5 2.5h3.958v-14.167zm-5.417-2.064H1.479C.664 4.851 0 5.516 0 6.331v10.41c0 .814.664 1.478 1.479 1.478h8.104v-13.368zM5.531 6.518h3.334v1.667H5.531v3.333H3.864V8.185H.531V6.518h3.333V3.185h1.667v3.333z"/>
    </svg>
  ),
  getDefaultState: () => ({
    tenantId: '',
    clientId: '',
    clientSecret: '',
  }),
  getSavePayload: (state, integration) => {
    const config: Record<string, unknown> = {
      tenantId: state.tenantId,
      clientId: state.clientId,
      status: 'CONNECTED',
    };
    if (state.clientSecret) config.clientSecret = state.clientSecret;
    else if (integration?.config?.clientSecret) config.clientSecret = '••••••••';
    return config;
  },
  getWizardSteps: ({ state, updateState, integration, testResult, setTestResult, isTesting, setIsTesting }) => [
    {
      title: 'Connect Microsoft Teams',
      description: 'Send interview reminders and Teams meeting links automatically. You will need access to the Azure Portal.',
      content: (
        <div className="flex flex-col items-center justify-center py-10">
          <Button onClick={() => updateState({ step: 1 })}>Start Setup</Button>
        </div>
      ),
    },
    {
      title: 'Register an App in Azure',
      description: 'Create an app registration in Microsoft Entra ID (formerly Azure AD).',
      content: (
        <div className="space-y-4 text-sm text-text-secondary">
          <ol className="list-decimal list-inside space-y-3 bg-surface-alt p-4 rounded-lg border border-border">
            <li>Go to the <strong>Azure Portal</strong> and open <strong>Microsoft Entra ID</strong>.</li>
            <li>Click <strong>App registrations</strong> → <strong>New registration</strong>.</li>
            <li>Name it "AgnoHire Integration".</li>
            <li>Supported account types: <em>Accounts in any organizational directory</em>.</li>
            <li>Click <strong>Register</strong>.</li>
          </ol>
          <div className="pt-4">
            <a href="https://portal.azure.com/" target="_blank" rel="noopener noreferrer">
              <Button variant="outline"><ExternalLink className="h-4 w-4 mr-2" /> Open Azure Portal</Button>
            </a>
          </div>
        </div>
      ),
    },
    {
      title: 'Copy Tenant & Client IDs',
      isNextDisabled: !state.tenantId.trim() || !state.clientId.trim(),
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
              <Input 
                className="pl-9"
                value={state.tenantId} 
                onChange={(e) => updateState({ tenantId: e.target.value })} 
              />
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
              <Input 
                className="pl-9"
                value={state.clientId} 
                onChange={(e) => updateState({ clientId: e.target.value })} 
              />
            </div>
          </FieldWithHelp>
        </div>
      ),
    },
    {
      title: 'Generate Client Secret',
      isNextDisabled: !state.clientSecret && !integration?.config?.clientSecret,
      content: (
        <div className="space-y-6">
          <div className="text-sm text-text-secondary bg-surface-alt p-4 rounded-lg border border-border">
            <ol className="list-decimal list-inside space-y-2">
              <li>In your App, go to <strong>Certificates & secrets</strong>.</li>
              <li>Click <strong>New client secret</strong>.</li>
              <li>Copy the <strong>Value</strong> (not the Secret ID).</li>
            </ol>
          </div>
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
                className="pl-9"
                type="password"
                autoComplete="off"
                value={state.clientSecret} 
                onChange={(e) => updateState({ clientSecret: e.target.value })} 
                placeholder={integration?.config?.clientSecret ? '••••••••' : 'Paste Client Secret Value'} 
              />
            </div>
          </FieldWithHelp>
        </div>
      ),
    },
    {
      title: 'Test Connection',
      description: 'Testing connection to Microsoft Graph API.',
      onNext: async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
          const res = await api.post(`/admin/integrations/teams/test`, {
            tenantId: state.tenantId,
            clientId: state.clientId,
            clientSecret: state.clientSecret || (integration?.config?.clientSecret ? '••••••••' : ''),
          });
          setTestResult(res.data);
          return res.data.ok;
        } catch (e: any) {
          setTestResult({ ok: false, error: apiErrorMessage(e) });
          return false;
        } finally {
          setIsTesting(false);
        }
      },
      content: (
        <div className="flex flex-col items-center justify-center p-4">
          {testResult && (
            <div className={`p-4 rounded-lg border w-full text-center ${testResult.ok ? 'bg-green-500/10 border-green-500/20 text-green-700' : 'bg-red-500/10 border-red-500/20 text-red-700'}`}>
              {testResult.ok ? '✅ Connected Successfully! Click Finish to save.' : `❌ Connection Failed: ${testResult.error}`}
            </div>
          )}
          {!testResult && !isTesting && (
            <p className="text-text-secondary text-sm">Click Next to validate credentials.</p>
          )}
        </div>
      ),
    }
  ],
};
