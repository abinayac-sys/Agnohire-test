import { KeyRound, Briefcase } from 'lucide-react';
import { Button } from '../../../../components/ui/Button.js';
import { Input } from '../../../../components/ui/Input.js';
import { FieldWithHelp } from '../../../../components/ui/FieldWithHelp.js';
import type { IntegrationProviderDef } from './index.js';
import { api, apiErrorMessage } from '../../../../services/api.js';

export const naukriProvider: IntegrationProviderDef = {
  id: 'naukri',
  categoryId: 'job-portals',
  name: 'Naukri',
  description: 'Connect Naukri Recruiter account for job posting and sourcing.',
  icon: (
    <svg width="24" height="24" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="naukri-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7DA1F8"/>
          <stop offset="100%" stopColor="#FFFFFF"/>
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="24" fill="#2E63F6"/>
      <circle cx="52" cy="27" r="9" fill="#FFFFFF"/>
      <path d="M45 57 C 45 42, 53 34, 67 28 L 67 43 L 45 57 Z" fill="#FFFFFF"/>
      <path d="M45 57 L 67 78 L 67 58 L 52 44 Z" fill="url(#naukri-grad)"/>
    </svg>
  ),
  getDefaultState: () => ({
    clientId: '',
    clientSecret: '',
  }),
  getSavePayload: (state, integration) => {
    const config: Record<string, unknown> = {
      clientId: state.clientId,
      status: 'CONNECTED',
    };
    if (state.clientSecret) config.clientSecret = state.clientSecret;
    else if (integration?.config?.clientSecret) config.clientSecret = '••••••••';
    return config;
  },
  getWizardSteps: ({ state, updateState, integration, testResult, setTestResult, isTesting, setIsTesting }) => [
    {
      title: 'Connect Naukri',
      description: 'Integrate your Naukri Recruiter account to AgnoHire.',
      content: (
        <div className="flex flex-col items-center justify-center py-10 space-y-6">
          <div className="bg-yellow-50 text-yellow-800 p-4 rounded-lg text-sm border border-yellow-200">
            <strong>Note:</strong> Naukri API access is usually provided directly by your Naukri account manager. If you do not have API credentials, please contact Naukri support.
          </div>
          <Button onClick={() => updateState({ step: 1 })}>Start Setup</Button>
        </div>
      ),
    },
    {
      title: 'API Credentials',
      isNextDisabled: !state.clientId.trim() || (!state.clientSecret && !integration?.config?.clientSecret),
      content: (
        <div className="space-y-6">
          <FieldWithHelp 
            label="Client ID (App ID)"
            help={{
              what: 'The identifier provided by Naukri for your API access.',
              why: 'Used to identify your recruiter account.',
              where: 'From your Naukri account manager or developer dashboard.',
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

          <FieldWithHelp 
            label="Client Secret (API Key)"
            help={{
              what: 'The secret key provided by Naukri.',
              why: 'Authenticates your requests.',
              where: 'Provided securely by your Naukri account manager.',
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
                placeholder={integration?.config?.clientSecret ? '••••••••' : 'Paste Client Secret'} 
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
          const res = await api.post(`/admin/integrations/naukri/test`, {
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
