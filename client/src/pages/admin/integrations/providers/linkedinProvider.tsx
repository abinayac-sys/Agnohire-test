import { ExternalLink, KeyRound, Briefcase } from 'lucide-react';
import { Button } from '../../../../components/ui/Button.js';
import { Input } from '../../../../components/ui/Input.js';
import { FieldWithHelp } from '../../../../components/ui/FieldWithHelp.js';
import type { IntegrationProviderDef } from './index.js';
import { api, apiErrorMessage } from '../../../../services/api.js';

export const linkedinProvider: IntegrationProviderDef = {
  id: 'linkedin',
  categoryId: 'job-portals',
  name: 'LinkedIn',
  description: 'Connect LinkedIn for job posting and applicant import (Partner approval required).',
  icon: (
    <svg className="text-[#0A66C2]" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
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
      title: 'Connect LinkedIn',
      description: 'Post jobs to LinkedIn and import applicants automatically.',
      content: (
        <div className="flex flex-col items-center justify-center py-10 space-y-6">
          <div className="bg-blue-50 text-blue-800 p-4 rounded-lg text-sm border border-blue-200">
            <strong>Note:</strong> Some LinkedIn APIs require you to be an approved LinkedIn Talent Solutions Partner. Ensure your developer account has the required access before proceeding.
          </div>
          <Button onClick={() => updateState({ step: 1 })}>Start Setup</Button>
        </div>
      ),
    },
    {
      title: 'Create LinkedIn App',
      description: 'Create an app in the LinkedIn Developer Portal.',
      content: (
        <div className="space-y-4 text-sm text-text-secondary">
          <ol className="list-decimal list-inside space-y-3 bg-surface-alt p-4 rounded-lg border border-border">
            <li>Open the <strong>LinkedIn Developer Portal</strong>.</li>
            <li>Click <strong>Create app</strong>.</li>
            <li>Fill in your app details and verify your company page.</li>
            <li>Go to the <strong>Products</strong> tab and request access to Talent Solutions (if applicable).</li>
          </ol>
          <div className="pt-4">
            <a href="https://developer.linkedin.com/" target="_blank" rel="noopener noreferrer">
              <Button variant="outline"><ExternalLink className="h-4 w-4 mr-2" /> Open LinkedIn Developer Portal</Button>
            </a>
          </div>
        </div>
      ),
    },
    {
      title: 'API Credentials',
      isNextDisabled: !state.clientId.trim() || (!state.clientSecret && !integration?.config?.clientSecret),
      content: (
        <div className="space-y-6">
          <FieldWithHelp 
            label="Client ID"
            help={{
              what: 'The public identifier for your LinkedIn app.',
              why: 'Used during the OAuth flow.',
              where: 'LinkedIn Developer Portal → Your App → Auth tab',
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
            label="Client Secret"
            help={{
              what: 'The private key for your LinkedIn app.',
              why: 'Used to securely exchange authorization codes for access tokens.',
              where: 'LinkedIn Developer Portal → Your App → Auth tab',
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
          const res = await api.post(`/admin/integrations/linkedin/test`, {
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
