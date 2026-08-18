import { KeyRound, Globe, Building, Briefcase } from 'lucide-react';
import { Input } from '../../../../components/ui/Input.js';
import { FieldWithHelp } from '../../../../components/ui/FieldWithHelp.js';
import type { IntegrationProviderDef } from './index.js';
import { api, apiErrorMessage } from '../../../../services/api.js';

export const enhanceProvider: IntegrationProviderDef = {
  id: 'enhance',
  categoryId: 'partner-solutions',
  name: 'Enhance',
  description: 'Connect Enhance HRMS for employee synchronization and lifecycle management.',
  icon: (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 object-contain">
      <path d="M 45,30 L 75,30 L 75,60" stroke="#002A4A" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 25,50 L 55,50 L 55,80" stroke="#FF6B00" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  getDefaultState: () => ({
    apiBaseUrl: 'https://enhance.genagno.ai',
    apiKey: '',
    clientId: '',
    clientSecret: '',
    tenantId: '',
  }),
  getSavePayload: (state, integration) => {
    const config: Record<string, unknown> = {
      apiBaseUrl: state.apiBaseUrl,
      clientId: state.clientId,
      tenantId: state.tenantId,
      status: 'CONNECTED',
    };
    if (state.apiKey) config.apiKey = state.apiKey;
    else if (integration?.config?.apiKey) config.apiKey = '••••••••';

    if (state.clientSecret) config.clientSecret = state.clientSecret;
    else if (integration?.config?.clientSecret) config.clientSecret = '••••••••';

    return config;
  },
  getWizardSteps: ({ state, updateState, integration, testResult, setTestResult, setIsTesting }) => [
    {
      title: 'Enhance Configuration',
      description: 'Enter your Enhance credentials.',
      isNextDisabled: !state.apiBaseUrl.trim() || !state.tenantId.trim() || (!state.apiKey && !integration?.config?.apiKey && !state.clientId),
      onNext: async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
          const res = await api.post(`/admin/integrations/enhance/test`, {
            apiBaseUrl: state.apiBaseUrl,
            tenantId: state.tenantId,
            clientId: state.clientId,
            apiKey: state.apiKey || (integration?.config?.apiKey ? '••••••••' : ''),
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
            label="API Base URL"
            help={{
              what: 'The base URL for your Enhance instance.',
              why: 'Routes API requests correctly.',
              where: 'Example: https://enhance.genagno.ai',
            }}
          >
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input
                className="pl-9"
                value={state.apiBaseUrl}
                onChange={(e) => updateState({ apiBaseUrl: e.target.value })}
                placeholder="e.g. https://enhance.genagno.ai"
              />
            </div>
          </FieldWithHelp>

          <FieldWithHelp
            label="Workspace / Tenant ID"
            help={{
              what: 'Your Enhance Workspace ID.',
              why: 'Identifies your organization in the Enhance ecosystem.',
              where: 'Enhance Admin Console → Settings',
            }}
          >
            <div className="relative">
              <Building className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input
                className="pl-9"
                value={state.tenantId}
                onChange={(e) => updateState({ tenantId: e.target.value })}
                placeholder="e.g. wks-12345"
              />
            </div>
          </FieldWithHelp>

          <FieldWithHelp
            label="API Key / Token"
            help={{
              what: 'Your Enhance API Token.',
              why: 'Authenticates AgnoHire requests securely.',
              where: 'Enhance Admin Console → Developers',
            }}
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input
                className="pl-9"
                type="password"
                autoComplete="new-password"
                value={state.apiKey}
                onChange={(e) => updateState({ apiKey: e.target.value })}
                placeholder={integration?.config?.apiKey ? '••••••••' : 'Paste API Key'}
              />
            </div>
          </FieldWithHelp>

          <div className="pt-4 border-t border-border/50">
            <h4 className="text-sm font-medium mb-4 text-text-primary">OAuth Configuration (Optional)</h4>

            <FieldWithHelp
              label="Client ID"
              help={{
                what: 'OAuth Client ID.',
                why: 'For advanced integrations.',
                where: 'Enhance Admin Console → Developers → OAuth Apps',
              }}
            >
              <div className="relative mb-4">
                <Briefcase className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                <Input
                  className="pl-9"
                  value={state.clientId}
                  onChange={(e) => updateState({ clientId: e.target.value })}
                />
              </div>
            </FieldWithHelp>

            <FieldWithHelp
              label="Client Secret"
              help={{
                what: 'OAuth Client Secret.',
                why: 'For advanced integrations.',
                where: 'Enhance Admin Console → Developers → OAuth Apps',
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
          </div>

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
