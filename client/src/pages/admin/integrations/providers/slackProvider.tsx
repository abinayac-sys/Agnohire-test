import { ExternalLink, KeyRound, Building, Hash } from 'lucide-react';
import { Button } from '../../../../components/ui/Button.js';
import { Input } from '../../../../components/ui/Input.js';
import { FieldWithHelp } from '../../../../components/ui/FieldWithHelp.js';
import type { IntegrationProviderDef } from './index.js';
import { api, apiErrorMessage } from '../../../../services/api.js';

export const slackProvider: IntegrationProviderDef = {
  id: 'slack',
  categoryId: 'communication',
  name: 'Slack',
  description: 'Connect Slack to receive recruiter notifications in a specific channel.',
  icon: (
    <svg className="text-[#E01E5A]" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.523-2.522v-2.522h2.523zM15.165 17.688a2.527 2.527 0 0 1-2.523-2.523 2.526 2.526 0 0 1 2.523-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522-2.52H15.165z"/>
    </svg>
  ),
  getDefaultState: () => ({
    workspaceName: '',
    botToken: '',
    signingSecret: '',
    channelId: '',
  }),
  getSavePayload: (state, integration) => {
    const config: Record<string, unknown> = {
      workspaceName: state.workspaceName,
      channelId: state.channelId,
      status: 'CONNECTED',
    };
    if (state.botToken) config.botToken = state.botToken;
    else if (integration?.config?.botToken) config.botToken = '••••••••';
    
    if (state.signingSecret) config.signingSecret = state.signingSecret;
    else if (integration?.config?.signingSecret) config.signingSecret = '••••••••';
    
    return config;
  },
  getWizardSteps: ({ state, updateState, integration, testResult, setTestResult, isTesting, setIsTesting }) => [
    {
      title: 'Connect Slack',
      description: 'Send notifications to your team in Slack.',
      content: (
        <div className="flex flex-col items-center justify-center py-10">
          <Button onClick={() => updateState({ step: 1 })}>Start Setup</Button>
        </div>
      ),
    },
    {
      title: 'Create Slack App',
      description: 'You need to create a Slack App and install it to your workspace.',
      content: (
        <div className="space-y-4 text-sm text-text-secondary">
          <ol className="list-decimal list-inside space-y-3 bg-surface-alt p-4 rounded-lg border border-border">
            <li>Open the <strong>Slack API Dashboard</strong>.</li>
            <li>Click <strong>Create New App</strong> → <strong>From scratch</strong>.</li>
            <li>Enable OAuth Permissions: <code>chat:write</code>.</li>
            <li>Click <strong>Install to Workspace</strong>.</li>
          </ol>
          <div className="pt-4">
            <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">
              <Button variant="outline"><ExternalLink className="h-4 w-4 mr-2" /> Open Slack API Dashboard</Button>
            </a>
          </div>
        </div>
      ),
    },
    {
      title: 'Workspace Details',
      isNextDisabled: !state.workspaceName.trim() || !state.channelId.trim(),
      content: (
        <div className="space-y-6">
          <FieldWithHelp 
            label="Workspace Name"
            help={{
              what: 'The display name of your Slack Workspace.',
              why: 'Used only for display purposes in AgnoHire.',
              where: 'Top left of your Slack desktop app.',
            }}
          >
            <div className="relative">
              <Building className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input 
                className="pl-9"
                value={state.workspaceName} 
                onChange={(e) => updateState({ workspaceName: e.target.value })} 
                placeholder="e.g. Acme Corp"
              />
            </div>
          </FieldWithHelp>
          
          <FieldWithHelp 
            label="Channel ID"
            help={{
              what: 'The ID of the channel where notifications should be sent.',
              why: 'Slack API requires the channel ID, not the name.',
              where: 'Right-click the channel in Slack → Copy link. The ID is the last part of the URL (e.g. C01234567).',
              example: 'C01234567',
            }}
          >
            <div className="relative">
              <Hash className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input 
                className="pl-9"
                value={state.channelId} 
                onChange={(e) => updateState({ channelId: e.target.value })} 
                placeholder="e.g. C01234567"
              />
            </div>
          </FieldWithHelp>
        </div>
      ),
    },
    {
      title: 'API Credentials',
      isNextDisabled: (!state.botToken && !integration?.config?.botToken) || (!state.signingSecret && !integration?.config?.signingSecret),
      content: (
        <div className="space-y-6">
          <FieldWithHelp 
            label="Bot User OAuth Token"
            help={{
              what: 'The token used to authenticate API requests.',
              why: 'Required to send messages as the bot.',
              where: 'Slack API → Your App → OAuth & Permissions',
            }}
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input 
                className="pl-9"
                type="password"
                autoComplete="off"
                value={state.botToken} 
                onChange={(e) => updateState({ botToken: e.target.value })} 
                placeholder={integration?.config?.botToken ? '••••••••' : 'xoxb-...'} 
              />
            </div>
          </FieldWithHelp>

          <FieldWithHelp 
            label="Signing Secret"
            help={{
              what: 'A secret used to verify webhook requests from Slack.',
              why: 'Ensures requests actually come from Slack.',
              where: 'Slack API → Your App → Basic Information',
            }}
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input 
                className="pl-9"
                type="password"
                autoComplete="off"
                value={state.signingSecret} 
                onChange={(e) => updateState({ signingSecret: e.target.value })} 
                placeholder={integration?.config?.signingSecret ? '••••••••' : 'Paste Signing Secret'} 
              />
            </div>
          </FieldWithHelp>
        </div>
      ),
    },
    {
      title: 'Test Connection',
      description: 'Testing connection to Slack API.',
      onNext: async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
          const res = await api.post(`/admin/integrations/slack/test`, {
            workspaceName: state.workspaceName,
            channelId: state.channelId,
            botToken: state.botToken || (integration?.config?.botToken ? '••••••••' : ''),
            signingSecret: state.signingSecret || (integration?.config?.signingSecret ? '••••••••' : ''),
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
