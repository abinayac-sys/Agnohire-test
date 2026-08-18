import { configService } from './configService.js';
import { logger } from '../config/logger.js';
import { BadRequestError } from '../utils/errors.js';
import { CONFIG_KEYS } from '@agnohire/shared';
import { getTenantContext } from '../config/tenantContext.js';
import { logAiUsage } from './aiUsageLogger.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile, readFile, unlink } from 'node:fs/promises';

const execAsync = promisify(exec);

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AgentChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Force the model to return a JSON object. */
  json?: boolean;
  sectorId?: string | null;
  /** Attribution tag for the AI Usage Monitor, e.g. "job.generateRequisition".
   *  Defaults to "unspecified" — every call is logged regardless, tagging
   *  just determines how it rolls up on the by-feature breakdown. */
  feature?: string;
  agentName?: string;
}

export interface AgentChatOptions extends ChatOptions {
  tools?: any[];
  tool_choice?: 'auto' | 'none' | any;
}

/** Normalizes each provider's usage{} shape to one common set of fields. */
function normalizeUsage(provider: string, raw: any): { promptTokens: number; completionTokens: number; totalTokens: number } {
  if (!raw) return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  if (provider === 'anthropic') {
    const input = raw.input_tokens ?? 0;
    const output = raw.output_tokens ?? 0;
    return { promptTokens: input, completionTokens: output, totalTokens: input + output };
  }
  const promptTokens = raw.prompt_tokens ?? 0;
  const completionTokens = raw.completion_tokens ?? 0;
  return { promptTokens, completionTokens, totalTokens: raw.total_tokens ?? promptTokens + completionTokens };
}

/** Captures the current request's attribution (tenant/user/session) once, synchronously,
 *  so fire-and-forget usage logging never depends on ambient async context later. */
function captureAttribution(opts: ChatOptions) {
  const ctx = getTenantContext();
  return {
    tenantId: ctx?.tenantId ?? null,
    // Neither field is on the ambient ScopeContext today (see tenantContext.ts) —
    // by-tenant/by-feature attribution (what the Usage Monitor actually shows)
    // works fine without them; left null rather than threading req.user.id
    // through every AI call site for a dimension nothing renders yet.
    userId: null as string | null,
    sessionId: null as string | null,
    feature: opts.feature ?? 'unspecified',
    agentName: opts.agentName ?? null,
  };
}

/**
 * Returns the configured OpenAI API key, or throws a friendly error pointing the
 * admin to the System Config screen. Keys live in the DB, never in env.
 */
export async function getOpenAiKey(sectorId: string | null = null): Promise<string> {
  const apiKey = await configService.getString(CONFIG_KEYS.OPENAI_API_KEY, '', sectorId);
  if (!apiKey) {
    throw new BadRequestError(
      'OpenAI API key is not configured. Go to Admin Console → System Config → AI to add it.',
    );
  }
  return apiKey;
}

/**
 * Thin wrapper over the OpenAI chat completions API. Reads the key/model from
 * config. Used by JD generation, resume parsing, and fit scoring.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  // SaaS plan gate: 402 when the tenant's plan lacks AI (only when a tenant
  // request context is present; workers/system calls pass through).
  {
    const { getTenantContext } = await import('../config/tenantContext.js');
    const tenantId = getTenantContext()?.tenantId;
    if (tenantId) {
      const { assertFeature } = await import('./entitlementService.js');
      await assertFeature(tenantId, 'aiEnabled');
    }
  }
  // Master switch — admins can disable all AI from System Config without
  // removing the key. Per-feature calls then surface a friendly message.
  const config = await configService.getAIConfiguration(opts.sectorId ?? null);
  if (!config.enabled) {
    throw new BadRequestError(
      'AI features are turned off. Enable them in Admin Console → System Config → AI Provider.',
    );
  }
  if (!config.apiKey) {
    throw new BadRequestError(
      'AI Provider API key is not configured. Go to Admin Console → System Config → AI to add it.',
    );
  }

  const model = opts.model ?? config.model;
  let endpoint = `${config.baseUrl}/chat/completions`;
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  
  const payload: any = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? config.maxTokens,
    temperature: opts.temperature ?? config.temperature,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  };

  if (config.provider === 'azure' || config.provider === 'azure_openai') {
    headers['api-key'] = config.apiKey;
  } else if (config.provider === 'anthropic') {
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    endpoint = config.baseUrl.includes('/v1/messages') ? config.baseUrl : `${config.baseUrl}/messages`;
  } else {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
    if (config.provider.includes('gemini') || /gemini-2\.5/i.test(model)) {
      payload.reasoning_effort = 'none';
    }
  }

  const body = JSON.stringify(payload);
  const attribution = captureAttribution(opts);
  const startedAt = Date.now();

  // Retry transient rate-limit / overload responses (429/503) with backoff so
  // free-tier bursts self-heal instead of erroring mid-flow. Honor the
  // provider's suggested retry delay when present (Gemini sends one).
  const MAX_RETRIES = 4;
  let lastErr: { message?: string } | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(endpoint, { method: 'POST', headers, body });

    if (response.ok) {
      const result = (await response.json()) as { choices: { message: { content: string } }[]; usage?: any };
      const usage = normalizeUsage(config.provider, result.usage);
      void logAiUsage({ ...attribution, provider: config.provider, model, ...usage, success: true, durationMs: Date.now() - startedAt });
      return result.choices[0]?.message?.content?.trim() ?? '';
    }

    const errBody = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    // Some providers nest the error under an array; normalize to a message.
    lastErr = Array.isArray(errBody) ? errBody[0]?.error : errBody.error;

    // A per-DAY quota won't recover for hours — retrying just hangs the request.
    // Fail fast with an actionable message and only back off for short bursts.
    const raw = JSON.stringify(errBody);
    const isDailyQuota = response.status === 429 && /PerDay|per day|RequestsPerDay/i.test(raw);
    if (isDailyQuota) {
      logger.error('AI daily quota exhausted', { status: response.status });
      void logAiUsage({
        ...attribution, provider: config.provider, model, promptTokens: 0, completionTokens: 0, totalTokens: 0,
        success: false, errorMsg: 'Daily quota exhausted', durationMs: Date.now() - startedAt,
      });
      throw new BadRequestError(
        'AI daily quota exhausted (Gemini free-tier allows ~20 requests/day per project). ' +
          'Enable billing on your Google AI key, or use a key from a different project, to continue.',
      );
    }

    const retriable = response.status === 429 || response.status === 503;
    if (retriable && attempt < MAX_RETRIES) {
      const suggested = parseRetryDelayMs(lastErr?.message);
      const wait = suggested ?? Math.min(2000 * 2 ** attempt, 20000);
      logger.warn('AI rate-limited; backing off', { status: response.status, attempt, waitMs: wait });
      await sleep(wait);
      continue;
    }

    logger.error('OpenAI API error', { status: response.status, err: errBody });
    void logAiUsage({
      ...attribution, provider: config.provider, model, promptTokens: 0, completionTokens: 0, totalTokens: 0,
      success: false, errorMsg: lastErr?.message ?? 'Unknown error', durationMs: Date.now() - startedAt,
    });
    throw new BadRequestError(`OpenAI error: ${lastErr?.message ?? 'Unknown error'}`);
  }
  void logAiUsage({
    ...attribution, provider: config.provider, model, promptTokens: 0, completionTokens: 0, totalTokens: 0,
    success: false, errorMsg: lastErr?.message ?? 'rate limited', durationMs: Date.now() - startedAt,
  });
  throw new BadRequestError(`OpenAI error: ${lastErr?.message ?? 'rate limited'}`);
}

export async function agentCompletion(
  messages: AgentChatMessage[],
  opts: AgentChatOptions = {},
): Promise<{ content: string | null; tool_calls?: any[] }> {
  const config = await configService.getAIConfiguration(opts.sectorId ?? null);
  if (!config.enabled) {
    throw new BadRequestError('AI features are turned off. Enable them in Admin Console → System Config → AI Provider.');
  }
  if (!config.apiKey) {
    throw new BadRequestError('AI Provider API key is not configured. Go to Admin Console → System Config → AI to add it.');
  }

  const model = opts.model ?? config.model;
  let endpoint = `${config.baseUrl}/chat/completions`;
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  
  // Build the payload
  const payload: any = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? config.maxTokens,
    temperature: opts.temperature ?? config.temperature,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: opts.tool_choice ?? 'auto' } : {}),
  };

  if (config.provider === 'azure' || config.provider === 'azure_openai') {
    headers['api-key'] = config.apiKey;
  } else if (config.provider === 'anthropic') {
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    endpoint = config.baseUrl.includes('/v1/messages') ? config.baseUrl : `${config.baseUrl}/messages`;
  } else {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
    if (config.provider.includes('gemini') || /gemini-2\.5/i.test(model)) {
      payload.reasoning_effort = 'none';
    }
  }

  const body = JSON.stringify(payload);
  const attribution = captureAttribution(opts);
  const startedAt = Date.now();

  const MAX_RETRIES = 4;
  let lastErr: { message?: string } | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(endpoint, { method: 'POST', headers, body });

    if (response.ok) {
      const result = (await response.json()) as { choices: { message: { content: string | null; tool_calls?: any[] } }[]; usage?: any };
      const msg = result.choices[0]?.message;
      const usage = normalizeUsage(config.provider, result.usage);
      void logAiUsage({
        ...attribution, provider: config.provider, model, ...usage, success: true, durationMs: Date.now() - startedAt,
        toolName: msg?.tool_calls?.[0]?.function?.name ?? null,
      });
      return { content: msg?.content ?? null, tool_calls: msg?.tool_calls };
    }

    const errBody = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    lastErr = Array.isArray(errBody) ? errBody[0]?.error : errBody.error;

    const raw = JSON.stringify(errBody);
    const isDailyQuota = response.status === 429 && /PerDay|per day|RequestsPerDay/i.test(raw);
    if (isDailyQuota) {
      logger.error('AI daily quota exhausted', { status: response.status });
      void logAiUsage({
        ...attribution, provider: config.provider, model, promptTokens: 0, completionTokens: 0, totalTokens: 0,
        success: false, errorMsg: 'Daily quota exhausted', durationMs: Date.now() - startedAt,
      });
      throw new BadRequestError('AI daily quota exhausted.');
    }

    const retriable = response.status === 429 || response.status === 503 || response.status === 500 || response.status === 502;
    if (retriable && attempt < MAX_RETRIES) {
      const suggested = parseRetryDelayMs(lastErr?.message);
      const wait = suggested ?? Math.min(2000 * 2 ** attempt, 20000);
      await sleep(wait);
      continue;
    }

    logger.error('OpenAI API error', { status: response.status, err: errBody });
    void logAiUsage({
      ...attribution, provider: config.provider, model, promptTokens: 0, completionTokens: 0, totalTokens: 0,
      success: false, errorMsg: lastErr?.message ?? 'Unknown error', durationMs: Date.now() - startedAt,
    });
    throw new BadRequestError(`OpenAI error: ${lastErr?.message ?? 'Unknown error'}`);
  }
  void logAiUsage({
    ...attribution, provider: config.provider, model, promptTokens: 0, completionTokens: 0, totalTokens: 0,
    success: false, errorMsg: lastErr?.message ?? 'rate limited', durationMs: Date.now() - startedAt,
  });
  throw new BadRequestError(`OpenAI error: ${lastErr?.message ?? 'rate limited'}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Extract a retry delay (ms) from a provider error message like "retry in 26.7s". */
function parseRetryDelayMs(message?: string): number | null {
  if (!message) return null;
  const m = message.match(/retry(?:\s+in|Delay[":\s]+)?\s*"?(\d+(?:\.\d+)?)s/i);
  if (!m) return null;
  // Add a small buffer so we clear the window, and cap so we never hang too long.
  return Math.min(Math.ceil(parseFloat(m[1]) * 1000) + 500, 30000);
}

async function convertAudioToMp3(inputBuffer: Buffer): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  const tempId = randomUUID();
  const inputPath = join(tmpdir(), `${tempId}.input`);
  const outputPath = join(tmpdir(), `${tempId}.mp3`);
  
  try {
    await writeFile(inputPath, inputBuffer);
    await execAsync(`ffmpeg -i "${inputPath}" -vn -ar 44100 -ac 2 -b:a 192k "${outputPath}" -y`);
    const outputBuffer = await readFile(outputPath);
    return { buffer: outputBuffer, mimeType: 'audio/mpeg', fileName: 'audio.mp3' };
  } catch (err) {
    logger.warn('FFmpeg conversion failed, falling back to original audio', { err: (err as Error).message });
    return { buffer: inputBuffer, mimeType: 'audio/webm', fileName: 'audio.webm' }; // Fallback
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

/**
 * Transcribes an audio recording via the provider's Whisper-compatible
 * `/audio/transcriptions` endpoint. Reads the key, base URL, and model from
 * config so any OpenAI-compatible provider works. Returns the plain transcript.
 */
export async function transcribeAudio(
  audio: { buffer: Buffer; fileName: string; mimeType: string },
  sectorId: string | null = null,
  feature = 'interview.transcribe',
): Promise<string> {
  const enabled = await configService.getBool(CONFIG_KEYS.AI_ENABLED, true, sectorId);
  if (!enabled) {
    throw new BadRequestError(
      'AI features are turned off. Enable them in Admin Console → System Config → AI Provider.',
    );
  }
  const apiKey = await getOpenAiKey(sectorId);
  const model = await configService.getString(CONFIG_KEYS.OPENAI_WHISPER_MODEL, 'whisper-1');
  const baseUrl = (
    await configService.getString(CONFIG_KEYS.OPENAI_BASE_URL, 'https://api.openai.com/v1')
  ).replace(/\/+$/, '');
  const attribution = captureAttribution({ sectorId, feature });
  const startedAt = Date.now();

  // Convert to MP3 before sending to Whisper to fix recognition inaccuracies and webm issues
  const processedAudio = await convertAudioToMp3(audio.buffer);

  // Node 20 ships global FormData/Blob/fetch — build a multipart body.
  const form = new FormData();
  const blob = new Blob([new Uint8Array(processedAudio.buffer)], { type: processedAudio.mimeType });
  form.append('file', blob, processedAudio.fileName);
  form.append('model', model);
  form.append('response_format', 'text');

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    const message = Array.isArray(errBody)
      ? errBody[0]?.error?.message
      : errBody.error?.message;
    logger.error('Audio transcription failed', { status: response.status, err: errBody });
    // Whisper's response_format=text never reports usage — token counts are
    // always 0 here (and estimateCostUsd will correctly show this model as
    // unpriced rather than guess a cost from tokens that were never counted).
    void logAiUsage({
      ...attribution, provider: 'openai', model, promptTokens: 0, completionTokens: 0, totalTokens: 0,
      success: false, errorMsg: message ?? 'Unknown error', durationMs: Date.now() - startedAt,
    });
    if (response.status === 404) {
      throw new BadRequestError(
        'The configured AI provider does not expose an audio transcription endpoint. ' +
          'Use an OpenAI key (Whisper), or paste the transcript manually.',
      );
    }
    throw new BadRequestError(`Transcription error: ${message ?? 'Unknown error'}`);
  }

  void logAiUsage({
    ...attribution, provider: 'openai', model, promptTokens: 0, completionTokens: 0, totalTokens: 0,
    success: true, durationMs: Date.now() - startedAt,
  });
  // response_format=text returns the raw transcript string.
  return (await response.text()).trim();
}

export interface SpeakerAnalysis {
  speakerCount: number;
  otherVoiceDetected: boolean;
  summary: string;
}

/**
 * Post-hoc microphone analysis — sends the interview audio to a multimodal
 * model (OpenAI gpt-4o-audio / Gemini via its OpenAI-compatible endpoint, both
 * accept an `input_audio` content part) and asks how many distinct human voices
 * are present. Used to flag a candidate being coached or someone else speaking.
 *
 * Returns null (rather than throwing) when AI is disabled, unconfigured, or the
 * provider/model can't accept audio — the interview must never depend on this.
 */
export async function analyzeAudioSpeakers(
  audio: { base64: string; format: string },
  sectorId: string | null = null,
  feature = 'interview.voiceAnalysis',
): Promise<SpeakerAnalysis | null> {
  try {
    const enabled = await configService.getBool(CONFIG_KEYS.AI_ENABLED, true, sectorId);
    if (!enabled) return null;
    const apiKey = await configService.getString(CONFIG_KEYS.OPENAI_API_KEY, '', sectorId);
    if (!apiKey) return null;
    const model = await configService.getString(CONFIG_KEYS.OPENAI_AUDIO_MODEL, '', sectorId);
    if (!model) return null; // no audio-capable model configured → skip silently
    const baseUrl = (
      await configService.getString(CONFIG_KEYS.OPENAI_BASE_URL, 'https://api.openai.com/v1')
    ).replace(/\/+$/, '');

    const body = JSON.stringify({
      model,
      temperature: 0,
      ...(/gemini-2\.5/i.test(model) ? { reasoning_effort: 'none' } : {}),
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a proctoring audio analyst. You receive the microphone recording of a ' +
            'single candidate taking a remote interview. Determine how many DISTINCT human ' +
            'voices speak in the recording. The candidate is the primary speaker; any other ' +
            'distinct voice (someone coaching them, a person in the room, a voice over a call) ' +
            'is a violation. Ignore the candidate\'s own voice variations, silence, typing, and ' +
            'background noise. Respond ONLY with JSON: {"speakerCount": <int>, ' +
            '"otherVoiceDetected": <bool>, "summary": "<one sentence>"}.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this interview microphone recording.' },
            { type: 'input_audio', input_audio: { data: audio.base64, format: audio.format } },
          ],
        },
      ],
    });

    const attribution = captureAttribution({ sectorId, feature });
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
    });
    if (!response.ok) {
      logger.warn('Voice analysis request failed', { status: response.status });
      void logAiUsage({
        ...attribution, provider: 'openai', model, promptTokens: 0, completionTokens: 0, totalTokens: 0,
        success: false, errorMsg: `HTTP ${response.status}`, durationMs: Date.now() - startedAt,
      });
      return null;
    }
    const result = (await response.json()) as { choices?: { message?: { content?: string } }[]; usage?: any };
    const usage = normalizeUsage('openai', result.usage);
    void logAiUsage({ ...attribution, provider: 'openai', model, ...usage, success: true, durationMs: Date.now() - startedAt });
    const raw = result.choices?.[0]?.message?.content?.trim() ?? '';
    const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<SpeakerAnalysis>;
    const speakerCount = Math.max(0, Math.round(Number(parsed.speakerCount ?? 0)));
    return {
      speakerCount,
      otherVoiceDetected: Boolean(parsed.otherVoiceDetected) || speakerCount > 1,
      summary: String(parsed.summary ?? '').slice(0, 500),
    };
  } catch (err) {
    logger.warn('Voice analysis skipped', { err: (err as Error).message });
    return null;
  }
}

/** chatCompletion that parses a JSON object response, with a safe fallback. */
export async function chatJson<T>(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<T> {
  const raw = await chatCompletion(messages, { ...opts, json: true });
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Some models wrap JSON in fences; strip and retry once.
    const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned) as T;
  }
}
