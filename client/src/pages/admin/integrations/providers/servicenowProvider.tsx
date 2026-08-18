import { KeyRound, Globe } from 'lucide-react';
import { Input } from '../../../../components/ui/Input.js';
import { FieldWithHelp } from '../../../../components/ui/FieldWithHelp.js';
import type { IntegrationProviderDef } from './index.js';
import { api, apiErrorMessage } from '../../../../services/api.js';

export const servicenowProvider: IntegrationProviderDef = {
  id: 'servicenow',
  categoryId: 'enterprise',
  name: 'ServiceNow',
  description: 'Connect ServiceNow for ITSM workflows and enterprise provisioning.',
  icon: <img src="https://www.google.com/s2/favicons?domain=servicenow.com&sz=64" alt="ServiceNow Logo" className="w-8 h-8 object-contain rounded-md" />,
  getDefaultState: () => ({
    instanceUrl: '',
    clientId: '',
    clientSecret: '',
  }),
  getSavePayload: (state, integration) => {
    const config: Record<string, unknown> = {
      instanceUrl: state.instanceUrl,
      clientId: state.clientId,
      status: 'CONNECTED',
    };
    if (state.clientSecret) config.clientSecret = state.clientSecret;
    else if (integration?.config?.clientSecret) config.clientSecret = '••••••••';
    return config;
  },
  getWizardSteps: ({ state, updateState, integration, testResult, setTestResult, setIsTesting }) => [
    {
      title: 'ServiceNow Credentials',
      description: 'Enter your ServiceNow instance and API credentials.',
      isNextDisabled: !state.instanceUrl.trim() || !state.clientId.trim() || (!state.clientSecret && !integration?.config?.clientSecret),
      onNext: async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
          const res = await api.post(`/admin/integrations/servicenow/test`, {
            instanceUrl: state.instanceUrl,
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
        <div className="space-y-6">
          <FieldWithHelp
            label="Instance URL"
            help={{
              what: 'The base URL for your ServiceNow instance.',
              why: 'Required to route API requests correctly.',
              where: 'Example: https://dev12345.service-now.com',
            }}
          >
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input
                className="pl-9"
                value={state.instanceUrl}
                onChange={(e) => updateState({ instanceUrl: e.target.value })}
                placeholder="e.g. https://dev12345.service-now.com"
              />
            </div>
          </FieldWithHelp>

          <FieldWithHelp
            label="Client ID"
            help={{
              what: 'Your ServiceNow OAuth Client ID.',
              why: 'Identifies the API integration.',
              where: 'ServiceNow → Application Registry',
            }}
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input
                className="pl-9"
                value={state.clientId}
                onChange={(e) => updateState({ clientId: e.target.value })}
                placeholder="e.g. 8f9b..."
              />
            </div>
          </FieldWithHelp>

          <FieldWithHelp
            label="Client Secret"
            help={{
              what: 'Your ServiceNow OAuth Client Secret.',
              why: 'Authenticates AgnoHire requests securely.',
              where: 'ServiceNow → Application Registry',
            }}
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input
                className="pl-9"
                type="password"
                autoComplete="new-password"
                value={state.clientSecret}
                onChange={(e) => updateState({ clientSecret: e.target.value })}
                placeholder={integration?.config?.clientSecret ? '••••••••' : 'Paste Client Secret'}
              />
            </div>
          </FieldWithHelp>

          {testResult && (
            <div className={`p-4 rounded-lg border w-full text-center ${testResult.ok ? 'bg-green-500/10 border-green-500/20 text-green-700' : 'bg-red-500/10 border-red-500/20 text-red-700'}`}>
              {testResult.ok ? '✅ Connected Successfully!' : `❌ Connection Failed: ${testResult.error}`}
            </div>
          )}
        </div>
      ),
    }
  ],
};
