import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Wizard } from '../../../components/ui/Wizard.js';
import * as adminApi from '../../../services/adminApi.js';
import type { IntegrationItem } from '@agnohire/shared';
import { apiErrorMessage } from '../../../services/api.js';
import type { IntegrationProviderDef, ProviderState } from './providers/index.js';

export function IntegrationWizardWrapper({
  provider,
  integration,
  onClose,
}: {
  provider: IntegrationProviderDef;
  integration?: IntegrationItem;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [activeIntegration, setActiveIntegration] = useState<IntegrationItem | undefined>(integration);
  const [state, setState] = useState<ProviderState>(() => {
    const defaultState = provider.getDefaultState();
    if (integration?.config) {
      const prefilled: Record<string, any> = {};
      for (const [k, v] of Object.entries(integration.config)) {
        if (v === '••••••••' && provider.id === 'whatsapp') {
          prefilled[k] = '**************';
        } else if (v !== '••••••••') {
          prefilled[k] = v;
        }
      }
      if (integration.config.preferences && defaultState.preferences) {
        prefilled.preferences = {
          ...defaultState.preferences,
          ...integration.config.preferences,
        };
      }
      // Providers with their own "enabled" checkbox (state.enabled) get it
      // seeded from the existing row's isEnabled, so re-opening an already
      // disabled integration shows it unchecked instead of resetting to the
      // default-state value.
      if (typeof defaultState.enabled === 'boolean') {
        prefilled.enabled = integration.isEnabled;
      }
      return { step: 0, ...defaultState, ...prefilled };
    }
    return { step: 0, ...defaultState };
  });

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const updateState = (update: Partial<ProviderState>) => {
    setState((s) => ({ ...s, ...update }));
  };

  const save = async (customConfig?: any) => {
    const config = customConfig || provider.getSavePayload(state, activeIntegration);
    const name = activeIntegration?.name || provider.name;
    // Providers that expose their own "enabled" checkbox (state.enabled) control
    // isEnabled directly; providers that don't set it default to true, matching
    // every existing provider's prior always-enabled-on-save behavior.
    const isEnabled = typeof state.enabled === 'boolean' ? state.enabled : true;
    let saved: IntegrationItem;
    if (activeIntegration?.id) {
      saved = await adminApi.updateIntegration(activeIntegration.id, { name, isEnabled, config });
    } else {
      saved = await adminApi.createIntegration({ name, type: provider.id, isEnabled, config });
    }
    setActiveIntegration(saved);
    qc.invalidateQueries({ queryKey: ['admin-integrations'] });
    return saved;
  };

  const saveIntegration = useMutation({
    mutationFn: () => save(),
    onSuccess: () => {
      const successMessage = provider.id === 'whatsapp'
        ? 'WhatsApp communication preferences saved successfully.'
        : `${provider.name} integration saved successfully!`;
      toast.success(successMessage);
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to save integration')),
  });

  const steps = provider.getWizardSteps({
    state,
    updateState,
    integration: activeIntegration,
    testResult,
    setTestResult,
    isTesting,
    setIsTesting,
    save,
  });

  const validStep = Math.min(state.step || 0, Math.max(0, steps.length - 1));

  return (
    <Wizard
      title={`${provider.name} Setup`}
      steps={steps}
      currentStep={validStep}
      onStepChange={(step) => updateState({ step })}
      onCancel={onClose}
      onComplete={() => saveIntegration.mutate()}
      isSubmitting={isTesting || saveIntegration.isPending}
      completeButtonText={provider.id === 'whatsapp' ? 'Save Preferences' : undefined}
    />
  );
}
