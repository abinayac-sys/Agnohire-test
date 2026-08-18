import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Save, Sparkles, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { CONFIG_KEYS } from '@agnohire/shared';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Select } from '../../components/ui/Select.js';
import { Badge } from '../../components/ui/Badge.js';
import * as adminApi from '../../services/adminApi.js';
import type { ConfigItem } from '../../services/adminApi.js';
import { apiErrorMessage } from '../../services/api.js';

/**
 * Preset providers. Picking one auto-fills the API base URL and a sensible
 * default model. All of these speak the OpenAI-compatible Chat Completions API
 * (the engine posts to `<baseUrl>/chat/completions` with a Bearer key), so the
 * live AI starts using a new provider the moment you save — no restart.
 */
const PROVIDERS: { value: string; label: string; baseUrl: string; model: string; note?: string }[] = [
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { value: 'azure', label: 'Azure OpenAI', baseUrl: '', model: 'gpt-4o', note: 'Paste your Azure resource endpoint (…/openai/deployments/<name>).' },
  { value: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest' },
  { value: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { value: 'vertex', label: 'Google Vertex AI', baseUrl: '', model: 'gemini-1.5-pro', note: 'Paste your Vertex OpenAI-compatible endpoint.' },
  { value: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  { value: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { value: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' },
  { value: 'cohere', label: 'Cohere', baseUrl: 'https://api.cohere.ai/compatibility/v1', model: 'command-r-plus' },
  { value: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { value: 'compatible', label: 'OpenAI Compatible', baseUrl: '', model: '', note: 'Any OpenAI-compatible gateway. Enter the base URL and model manually.' },
];

/** Config keys this card owns — the generic list hides these to avoid duplication. */
export const AI_PROVIDER_KEYS: string[] = [
  CONFIG_KEYS.AI_PROVIDER_TYPE,
  CONFIG_KEYS.AI_ENABLED,
  CONFIG_KEYS.AI_TEMPERATURE,
  CONFIG_KEYS.AI_MAX_TOKENS,
  CONFIG_KEYS.OPENAI_API_KEY,
  CONFIG_KEYS.OPENAI_BASE_URL,
  CONFIG_KEYS.OPENAI_MODEL,
];

function valueOf(items: ConfigItem[], key: string): string {
  return items.find((c) => c.key === key)?.value ?? '';
}
function hasValueOf(items: ConfigItem[], key: string): boolean {
  return Boolean(items.find((c) => c.key === key)?.hasValue);
}

/**
 * Friendly, single-active-provider editor for the AI integration. Writes to the
 * same `ai.*` config keys the engine reads, so saving switches the live model.
 */
export function AiProviderCard({ items }: { items: ConfigItem[] }) {
  const qc = useQueryClient();
  const keyIsSet = hasValueOf(items, CONFIG_KEYS.OPENAI_API_KEY);

  const [provider, setProvider] = useState(() => valueOf(items, CONFIG_KEYS.AI_PROVIDER_TYPE) || 'openai');
  const [enabled, setEnabled] = useState(() => (valueOf(items, CONFIG_KEYS.AI_ENABLED) || 'true') === 'true');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(() => valueOf(items, CONFIG_KEYS.OPENAI_BASE_URL));
  const [model, setModel] = useState(() => valueOf(items, CONFIG_KEYS.OPENAI_MODEL));
  const [temperature, setTemperature] = useState(() => valueOf(items, CONFIG_KEYS.AI_TEMPERATURE) || '0.4');
  const [maxTokens, setMaxTokens] = useState(() => valueOf(items, CONFIG_KEYS.AI_MAX_TOKENS) || '1600');

  const preset = useMemo(() => PROVIDERS.find((p) => p.value === provider), [provider]);

  // Selecting a provider auto-fills the base URL + default model (only when the
  // preset has them) so the common path is one click + paste key + save.
  const onProvider = (value: string) => {
    setProvider(value);
    const p = PROVIDERS.find((x) => x.value === value);
    if (p) {
      if (p.baseUrl) setBaseUrl(p.baseUrl);
      if (p.model) setModel(p.model);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      // Only send the API key when the admin actually typed one; blank keeps the
      // existing (encrypted) secret untouched.
      const writes: Promise<unknown>[] = [
        adminApi.updateConfig(CONFIG_KEYS.AI_PROVIDER_TYPE, provider),
        adminApi.updateConfig(CONFIG_KEYS.AI_ENABLED, String(enabled)),
        adminApi.updateConfig(CONFIG_KEYS.OPENAI_BASE_URL, baseUrl.trim()),
        adminApi.updateConfig(CONFIG_KEYS.OPENAI_MODEL, model.trim()),
        adminApi.updateConfig(CONFIG_KEYS.AI_TEMPERATURE, temperature.trim() || '0.4'),
        adminApi.updateConfig(CONFIG_KEYS.AI_MAX_TOKENS, maxTokens.trim() || '1600'),
      ];
      if (apiKey.trim()) writes.push(adminApi.updateConfig(CONFIG_KEYS.OPENAI_API_KEY, apiKey.trim()));
      await Promise.all(writes);
    },
    onSuccess: () => {
      toast.success('AI provider saved');
      setApiKey('');
      qc.invalidateQueries({ queryKey: ['system-config'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save AI provider')),
  });

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-elev-1">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-heading text-base font-semibold text-text-primary">AI Provider</h3>
            <p className="text-xs text-text-muted">
              Powers JD generation, resume screening, interviews and the chatbot. Switching here takes effect immediately.
            </p>
          </div>
        </div>
        <Badge variant={enabled ? 'success' : 'muted'}>{enabled ? 'Enabled' : 'Disabled'}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Provider Type" required>
          <Select value={provider} options={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))} onChange={(e) => onProvider(e.target.value)} />
          {preset?.note && <p className="mt-1 text-xs text-text-muted">{preset.note}</p>}
        </Field>

        <Field label="API Key">
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <Input
              className="pl-9"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyIsSet ? '•••••••• (leave blank to keep existing)' : 'Paste provider API key'}
            />
          </div>
          {keyIsSet && <p className="mt-1 text-xs text-success">A key is currently set. Leave blank to keep it.</p>}
        </Field>

        <Field label="API Base URL">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Auto-filled based on provider type" />
        </Field>

        <Field label="Default Model">
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. gpt-4o" />
        </Field>

        <Field label="Temperature">
          <Input type="number" step="0.1" min="0" max="2" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="0.4" />
        </Field>

        <Field label="Max Tokens">
          <Input type="number" min="1" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="1600" />
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" className="h-4 w-4 accent-accent" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="flex items-center gap-1.5"><Bot className="h-4 w-4" /> AI features enabled</span>
        </label>
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          <Save className="h-4 w-4" /> Save Provider
        </Button>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text-secondary">
        {label}{required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}
