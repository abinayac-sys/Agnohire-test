/**
 * Static per-model pricing reference, maintained by hand and updated whenever
 * a provider changes its rates. There is no reliable way to fetch this at
 * runtime, so it lives here rather than in the database.
 *
 * Rates are USD per 1,000,000 tokens, input and output priced separately
 * (output is typically 3-5x more expensive than input across providers).
 * Source: each provider's published pricing page, captured at the time this
 * file was written — re-verify before trusting it for an actual invoice.
 */
export interface ModelRate {
  inputPer1M: number;
  outputPer1M: number;
}

export const AI_MODEL_PRICING: Record<string, ModelRate> = {
  // OpenAI
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4-turbo': { inputPer1M: 10.0, outputPer1M: 30.0 },
  'gpt-3.5-turbo': { inputPer1M: 0.5, outputPer1M: 1.5 },

  // Anthropic
  'claude-3-5-sonnet-latest': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-3-5-haiku-latest': { inputPer1M: 0.8, outputPer1M: 4.0 },
  'claude-3-opus-latest': { inputPer1M: 15.0, outputPer1M: 75.0 },

  // Google Gemini (free tier default — $0 until billing is enabled on the key)
  'gemini-2.5-flash': { inputPer1M: 0.0, outputPer1M: 0.0 },
  'gemini-2.0-flash': { inputPer1M: 0.0, outputPer1M: 0.0 },
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.0 },
  'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.3 },

  // Groq (fast inference, priced per token despite the free-feeling API)
  'llama-3.3-70b-versatile': { inputPer1M: 0.59, outputPer1M: 0.79 },
  'llama-3.1-8b-instant': { inputPer1M: 0.05, outputPer1M: 0.08 },

  // Mistral
  'mistral-large-latest': { inputPer1M: 2.0, outputPer1M: 6.0 },

  // Cohere
  'command-r-plus': { inputPer1M: 2.5, outputPer1M: 10.0 },

  // Together AI
  'meta-llama/Llama-3.3-70B-Instruct-Turbo': { inputPer1M: 0.88, outputPer1M: 0.88 },

  // Local (Ollama) — no per-token cost, only infrastructure cost
  llama3: { inputPer1M: 0.0, outputPer1M: 0.0 },
  'llama3.1': { inputPer1M: 0.0, outputPer1M: 0.0 },
};

/**
 * Computes the USD cost of one call. Returns null — never a guessed $0 — when
 * the model isn't in the table above, so an unrecognized model shows up as
 * "unpriced" on the Usage Monitor instead of silently under-reporting spend.
 */
export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number | null {
  const rate = AI_MODEL_PRICING[model];
  if (!rate) return null;
  return (promptTokens / 1_000_000) * rate.inputPer1M + (completionTokens / 1_000_000) * rate.outputPer1M;
}
