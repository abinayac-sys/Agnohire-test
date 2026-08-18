import { ExternalLink, KeyRound, Building } from 'lucide-react';
import { Button } from '../../../../components/ui/Button.js';
import { Input } from '../../../../components/ui/Input.js';
import { FieldWithHelp } from '../../../../components/ui/FieldWithHelp.js';
import type { IntegrationProviderDef } from './index.js';
import { api, apiErrorMessage } from '../../../../services/api.js';

export const indeedProvider: IntegrationProviderDef = {
  id: 'indeed',
  categoryId: 'job-portals',
  name: 'Indeed',
  description: 'Connect Indeed Employer account for job syncing and application tracking.',
  icon: (
    <svg width="64" height="24" viewBox="0 0 64 24" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="18" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="18" fill="#003A9B" letterSpacing="-0.5">indeed</text>
    </svg>
  ),
  getDefaultState: () => ({
    employerId: '',
    apiToken: '',
  }),
  getSavePayload: (state, integration) => {
    const config: Record<string, unknown> = {
      employerId: state.employerId,
      status: 'CONNECTED',
    };
    if (state.apiToken) config.apiToken = state.apiToken;
    else if (integration?.config?.apiToken) config.apiToken = '••••••••';
    return config;
  },
  getWizardSteps: ({ state, updateState, integration, testResult, setTestResult, isTesting, setIsTesting }) => [
    {
      title: 'Connect Indeed',
      description: 'Integrate your Indeed Employer account.',
      content: (
        <div className="flex flex-col items-center justify-center py-10 space-y-6">
          <div className="bg-yellow-50 text-yellow-800 p-4 rounded-lg text-sm border border-yellow-200">
            <strong>Note:</strong> API access may require an active Indeed Employer agreement. Visit Indeed's Developer resources to ensure your account qualifies.
          </div>
          <div className="pt-2">
            <a href="https://developer.indeed.com/" target="_blank" rel="noopener noreferrer">
              <Button variant="outline"><ExternalLink className="h-4 w-4 mr-2" /> Indeed Developer Portal</Button>
            </a>
          </div>
          <Button onClick={() => updateState({ step: 1 })}>Start Setup</Button>
        </div>
      ),
    },
    {
      title: 'API Credentials',
      isNextDisabled: !state.employerId.trim() || (!state.apiToken && !integration?.config?.apiToken),
      content: (
        <div className="space-y-6">
          <FieldWithHelp 
            label="Employer ID"
            help={{
              what: 'Your unique Indeed Employer ID.',
              why: 'Used to link jobs and applicants to your specific company profile.',
              where: 'Found in your Indeed Employer dashboard settings.',
            }}
          >
            <div className="relative">
              <Building className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input 
                className="pl-9"
                value={state.employerId} 
                onChange={(e) => updateState({ employerId: e.target.value })} 
              />
            </div>
          </FieldWithHelp>

          <FieldWithHelp 
            label="API Token / Client Secret"
            help={{
              what: 'The API Token generated for AgnoHire.',
              why: 'Authenticates requests to Indeed.',
              where: 'Indeed Developer Portal → Your App.',
            }}
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input 
                className="pl-9"
                type="password"
                autoComplete="off"
                value={state.apiToken} 
                onChange={(e) => updateState({ apiToken: e.target.value })} 
                placeholder={integration?.config?.apiToken ? '••••••••' : 'Paste API Token'} 
              />
            </div>
          </FieldWithHelp>
        </div>
      ),
    },
    {
      title: 'Test Connection',
      description: 'Testing configuration format.',
      onNext: async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
          const res = await api.post(`/admin/integrations/indeed/test`, {
            employerId: state.employerId,
            apiToken: state.apiToken || (integration?.config?.apiToken ? '••••••••' : ''),
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
