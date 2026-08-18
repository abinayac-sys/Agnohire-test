import { configService } from './configService.js';
import { logger } from '../config/logger.js';
import { CONFIG_KEYS } from '@agnohire/shared';

/** Whether Judge0 code execution is configured (endpoint + key in DB config). */
export async function isJudge0Configured(): Promise<boolean> {
  const [endpoint, key] = await Promise.all([
    configService.getString(CONFIG_KEYS.JUDGE0_ENDPOINT, ''),
    configService.getString(CONFIG_KEYS.JUDGE0_API_KEY, ''),
  ]);
  return Boolean(endpoint && key);
}

export interface CodeRunResult {
  stdout: string | null;
  stderr: string | null;
  status: string;
}

/**
 * Best-effort code execution via Judge0. Returns null when Judge0 isn't
 * configured (graceful degradation — code answers fall back to AI evaluation).
 * Real submissions only fire once an endpoint + key are set in the Admin Console.
 */
export async function runCode(
  source: string,
  languageId: number,
  stdin = '',
): Promise<CodeRunResult | null> {
  if (!(await isJudge0Configured())) return null;
  const endpoint = (await configService.getString(CONFIG_KEYS.JUDGE0_ENDPOINT, '')).replace(/\/$/, '');
  const key = await configService.getString(CONFIG_KEYS.JUDGE0_API_KEY, '');

  try {
    const res = await fetch(`${endpoint}/submissions?base64_encoded=true&wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': key },
      body: JSON.stringify({
        source_code: Buffer.from(source).toString('base64'),
        language_id: languageId,
        stdin: Buffer.from(stdin).toString('base64'),
      }),
    });
    if (!res.ok) {
      logger.warn('Judge0 submission failed', { status: res.status });
      return null;
    }
    const data = (await res.json()) as {
      stdout?: string | null;
      stderr?: string | null;
      status?: { description?: string };
    };
    return {
      stdout: data.stdout ? Buffer.from(data.stdout, 'base64').toString() : null,
      stderr: data.stderr ? Buffer.from(data.stderr, 'base64').toString() : null,
      status: data.status?.description ?? 'unknown',
    };
  } catch (err) {
    logger.warn('Judge0 request error', { err: (err as Error).message });
    return null;
  }
}
