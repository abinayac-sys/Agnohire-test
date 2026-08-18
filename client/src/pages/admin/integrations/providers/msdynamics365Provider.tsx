import { Building, KeyRound } from 'lucide-react';
import { Input } from '../../../../components/ui/Input.js';
import { FieldWithHelp } from '../../../../components/ui/FieldWithHelp.js';
import type { IntegrationProviderDef } from './index.js';
import { api, apiErrorMessage } from '../../../../services/api.js';

export const msdynamics365Provider: IntegrationProviderDef = {
  id: 'msdynamics365',
  categoryId: 'crm',
  name: 'Microsoft Dynamics 365 CRM',
  description: 'Microsoft Dynamics 365 CRM Integration.',
  icon: <img src="https://www.google.com/s2/favicons?domain=microsoft.com&sz=64" alt="Microsoft Dynamics 365 CRM Logo" className="w-8 h-8 object-contain rounded-md" />,
  getDefaultState: () => ({
    tenantId: '',
    clientId: '',
    clientSecret: '',
  }),
  getSavePayload: (state, integration) => {
    const config: Record<string, unknown> = {
      tenantId: state.tenantId,
      status: 'CONNECTED',
    };
    if (state.clientId) config.clientId = state.clientId;
    else if (integration?.config?.clientId) config.clientId = '••••••••';

    if (state.clientSecret) config.clientSecret = state.clientSecret;
    else if (integration?.config?.clientSecret) config.clientSecret = '••••••••';

    return config;
  },
  getWizardSteps: ({ state, updateState, integration, testResult, setTestResult, setIsTesting }) => [
    {
      title: 'Microsoft Dynamics 365 CRM Credentials',
      description: 'Enter your API credentials to connect.',
      isNextDisabled: !state.tenantId.trim() || (!state.clientId && !integration?.config?.clientId) || (!state.clientSecret && !integration?.config?.clientSecret),
      onNext: async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
          const res = await api.post(`/admin/integrations/msdynamics365/test`, {
            tenantId: state.tenantId,
            clientId: state.clientId || (integration?.config?.clientId ? '••••••••' : ''),
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
          <FieldWithHelp label="Tenant ID / Domain">
            <div className="relative">
              <Building className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input className="pl-9" value={state.tenantId} onChange={(e) => updateState({ tenantId: e.target.value })} placeholder="e.g. acme-corp" />
            </div>
          </FieldWithHelp>
          <FieldWithHelp label="Client ID">
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input className="pl-9" value={state.clientId} onChange={(e) => updateState({ clientId: e.target.value })} placeholder={integration?.config?.clientId ? '••••••••' : 'Client ID'} />
            </div>
          </FieldWithHelp>
          <FieldWithHelp label="Client Secret">
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input className="pl-9" type="password" value={state.clientSecret} onChange={(e) => updateState({ clientSecret: e.target.value })} placeholder={integration?.config?.clientSecret ? '••••••••' : 'Client Secret'} />
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
