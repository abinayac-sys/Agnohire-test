import { KeyRound, Briefcase, Hash } from 'lucide-react';
import { Input } from '../../../../components/ui/Input.js';
import type { IntegrationProviderDef } from './index.js';
import * as adminApi from '../../../../services/adminApi.js';
import { apiErrorMessage } from '../../../../services/api.js';

const preferencesList = [
  { key: 'interviewInvitation', label: 'Interview Invitation', description: 'Send WhatsApp when Interview Invitation is sent.' },
  { key: 'scheduleInterview', label: 'Schedule Interview', description: 'Send WhatsApp when Interview Schedule is sent.' },
  { key: 'candidatePassed', label: 'Candidate Passed', description: 'Send WhatsApp when candidate passes a round.' },
  { key: 'candidateFailed', label: 'Candidate Failed', description: 'Send WhatsApp when candidate fails a round.' },
  { key: 'tentativeOffer', label: 'Tentative Offer', description: 'Send WhatsApp for Tentative Offer.' },
  { key: 'offerLetter', label: 'Offer Letter', description: 'Send WhatsApp for Offer Letter.' },
  { key: 'documentUpload', label: 'Document Upload', description: 'Send WhatsApp requesting document upload.' },
  { key: 'offerAccepted', label: 'Offer Accepted', description: 'Send WhatsApp after Offer Acceptance.' },
  { key: 'onboarding', label: 'Onboarding', description: 'Send WhatsApp during onboarding.' },
];

export const whatsappProvider: IntegrationProviderDef = {
  id: 'whatsapp',
  categoryId: 'communication',
  name: 'WhatsApp Business',
  description: 'Connect your WhatsApp Business account to communicate with candidates.',
  icon: <img src="https://www.google.com/s2/favicons?domain=whatsapp.com&sz=64" alt="Logo" className="w-8 h-8 object-contain rounded-md" />,
  getDefaultState: () => ({
    phoneNumberId: '',
    appId: '',
    accessToken: '',
    wabaId: '',
    lastVerifiedConfig: null,
    preferences: {
      interviewInvitation: false,
      scheduleInterview: false,
      candidatePassed: false,
      candidateFailed: false,
      tentativeOffer: false,
      offerLetter: false,
      documentUpload: false,
      offerAccepted: false,
      onboarding: false,
    }
  }),
  getSavePayload: (state, integration) => {
    const config: Record<string, unknown> = {
      provider: 'whatsapp',
      phoneNumberId: state.phoneNumberId,
      appId: state.appId,
      apiVersion: 'v23.0',
      status: 'CONNECTED',
      preferences: state.preferences || {},
    };
    
    const hasStoredAccessToken = !!integration?.config?.accessToken;
    const hasStoredWabaId = !!integration?.config?.wabaId;

    if (state.accessToken && state.accessToken !== '**************' && state.accessToken !== '••••••••') {
      config.accessToken = state.accessToken;
    } else if (hasStoredAccessToken) {
      config.accessToken = '••••••••';
    }
    
    if (state.wabaId) config.wabaId = state.wabaId;
    else if (hasStoredWabaId) config.wabaId = '••••••••';

    return config;
  },
  getWizardSteps: ({ state, updateState, integration, testResult, setTestResult, setIsTesting, save }) => [
    {
      title: 'WhatsApp Business Credentials',
      description: 'Enter your Meta WhatsApp Business API credentials.',
      isNextDisabled: !state.phoneNumberId.trim() || !state.appId.trim() || !state.wabaId.trim() || (!state.accessToken && !integration?.config?.accessToken),
      onNext: async () => {
        // Change detection check:
        // 1. Has any field changed compared to lastVerifiedConfig?
        const isSameAsLastVerified = state.lastVerifiedConfig &&
          state.phoneNumberId === state.lastVerifiedConfig.phoneNumberId &&
          state.appId === state.lastVerifiedConfig.appId &&
          state.accessToken === state.lastVerifiedConfig.accessToken &&
          state.wabaId === state.lastVerifiedConfig.wabaId;

        // 2. Has any field changed compared to original integration config?
        const tokenUnchanged = !state.accessToken || state.accessToken === '**************' || state.accessToken === '••••••••';
        const isSameAsSaved = integration?.config &&
          state.phoneNumberId === integration.config.phoneNumberId &&
          state.appId === integration.config.appId &&
          tokenUnchanged &&
          state.wabaId === integration.config.wabaId;

        if (isSameAsLastVerified || isSameAsSaved) {
          // Skip verification and saving
          return true;
        }

        setIsTesting(true);
        setTestResult(null);
        try {
          const useStoredAccessToken = tokenUnchanged && !!integration?.config?.accessToken;
          const testToken = useStoredAccessToken ? '' : state.accessToken;

          const res = await adminApi.testWhatsAppConnection({
            phoneNumberId: state.phoneNumberId,
            accessToken: testToken,
            apiVersion: 'v23.0',
            useStoredAccessToken
          });
          setTestResult(res);
          if (!res.ok) return false;

          // If connection is verified, save credentials first
          if (save) {
            const configPayload: Record<string, any> = {
              provider: 'whatsapp',
              phoneNumberId: state.phoneNumberId,
              appId: state.appId,
              apiVersion: 'v23.0',
              status: 'CONNECTED',
              preferences: state.preferences || {},
            };
            
            if (tokenUnchanged && integration?.config?.accessToken) {
              configPayload.accessToken = '••••••••';
            } else {
              configPayload.accessToken = state.accessToken;
            }

            if (state.wabaId) configPayload.wabaId = state.wabaId;
            else if (integration?.config?.wabaId) configPayload.wabaId = '••••••••';

            await save(configPayload);
          }

          // Remember last verified configuration
          updateState({
            lastVerifiedConfig: {
              phoneNumberId: state.phoneNumberId,
              appId: state.appId,
              accessToken: state.accessToken,
              wabaId: state.wabaId,
            }
          });

          return true;
        } catch (e: any) {
          setTestResult({ ok: false, error: apiErrorMessage(e) });
          return false;
        } finally {
          setIsTesting(false);
        }
      },
      content: (
        <div className="space-y-6">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Phone Number ID</label>
            <div className="relative">
              <Hash className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input 
                className="pl-9"
                value={state.phoneNumberId} 
                onChange={(e) => {
                  updateState({ phoneNumberId: e.target.value });
                  setTestResult(null);
                }} 
                placeholder="e.g. 101234567890123" 
              />
            </div>
            {state.phoneNumberId && !/^\d+$/.test(state.phoneNumberId) && (
              <p className="text-danger text-xs mt-1">Must contain only numbers.</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">App ID</label>
            <div className="relative">
              <Briefcase className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input 
                className="pl-9"
                value={state.appId} 
                onChange={(e) => {
                  updateState({ appId: e.target.value });
                  setTestResult(null);
                }} 
                placeholder="e.g. 101234567890123" 
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">Permanent Access Token</label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input 
                className="pl-9"
                type="password"
                autoComplete="new-password"
                value={state.accessToken} 
                onChange={(e) => {
                  updateState({ accessToken: e.target.value });
                  setTestResult(null);
                }} 
                placeholder={integration?.config?.accessToken ? '**************' : 'Paste Access Token (EAA...)'} 
              />
            </div>
            {!!integration?.config?.accessToken && (
              <p className="text-xs text-text-muted mt-1">Stored securely</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">WABA ID</label>
            <div className="relative">
              <Briefcase className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input 
                className="pl-9"
                value={state.wabaId} 
                onChange={(e) => {
                  updateState({ wabaId: e.target.value });
                  setTestResult(null);
                }} 
                placeholder="e.g. 101234567890123" 
              />
            </div>
          </div>

          {testResult && (
            <div className={`p-4 rounded-lg border w-full text-center ${testResult.ok ? 'bg-green-500/10 border-green-500/20 text-green-700' : 'bg-red-500/10 border-red-500/20 text-red-700'}`}>
              {testResult.ok ? '✅ Connected Successfully!' : `❌ Connection Failed: ${testResult.error}`}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'WhatsApp Communication Preferences',
      description: 'Choose which recruitment events should automatically send WhatsApp messages. These settings affect ONLY WhatsApp and will not affect Email notifications.',
      content: (
        <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
          {preferencesList.map((pref) => {
            const isChecked = !!state.preferences?.[pref.key];
            return (
              <label 
                key={pref.key} 
                className="flex items-start gap-3 p-3 rounded-lg border border-border bg-surface-alt hover:bg-hover cursor-pointer transition-colors"
              >
                <input 
                  type="checkbox" 
                  className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-accent" 
                  checked={isChecked}
                  onChange={(e) => {
                    const currentPrefs = state.preferences || {};
                    updateState({
                      preferences: {
                        ...currentPrefs,
                        [pref.key]: e.target.checked
                      }
                    });
                  }}
                />
                <div>
                  <span className="block text-sm font-semibold text-text-primary">{pref.label}</span>
                  <span className="block text-xs text-text-muted mt-0.5">{pref.description}</span>
                </div>
              </label>
            );
          })}
        </div>
      )
    }
  ],
};
