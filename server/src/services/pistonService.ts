import type { CodeLanguage } from '@agnohire/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

interface PistonRuntime {
  language: string;
  version: string;
  aliases: string[];
}

/** Candidate Piston language identifiers to try for each of our CodeLanguage values,
 *  in preference order — matched against a runtime's `language` or `aliases`. */
const LANGUAGE_CANDIDATES: Record<CodeLanguage, string[]> = {
  python: ['python3', 'python'],
  java: ['java'],
  javascript: ['node', 'javascript', 'js'],
  typescript: ['typescript', 'ts'],
  cpp: ['c++', 'cpp'],
  c: ['c'],
  csharp: ['csharp', 'csharp.net', 'mono'],
  go: ['go'],
  ruby: ['ruby'],
  sql: ['sqlite3'],
};

let runtimesCache: { at: number; runtimes: PistonRuntime[] } | null = null;
const RUNTIMES_TTL_MS = 5 * 60 * 1000;

async function getRuntimes(): Promise<PistonRuntime[]> {
  if (runtimesCache && Date.now() - runtimesCache.at < RUNTIMES_TTL_MS) {
    return runtimesCache.runtimes;
  }
  const res = await fetch(`${env.piston.url.replace(/\/$/, '')}/api/v2/runtimes`);
  if (!res.ok) throw new Error(`Piston /runtimes returned ${res.status}`);
  const runtimes = (await res.json()) as PistonRuntime[];
  runtimesCache = { at: Date.now(), runtimes };
  return runtimes;
}

async function resolveRuntime(language: CodeLanguage): Promise<{ language: string; version: string } | null> {
  const candidates = LANGUAGE_CANDIDATES[language] ?? [];
  const runtimes = await getRuntimes();
  for (const candidate of candidates) {
    const match = runtimes.find(
      (r) => r.language === candidate || r.aliases?.includes(candidate),
    );
    if (match) return { language: match.language, version: match.version };
  }
  return null;
}

export interface PistonRunResult {
  stdout: string;
  stderr: string;
  error?: string;
}

/**
 * Executes code on the self-hosted Piston instance. Never throws — network errors,
 * unresolvable languages, and compile failures all come back as a typed result so
 * callers (the public interview execute/run-tests endpoints) can render them directly.
 */
export async function runOnPiston(
  language: CodeLanguage,
  code: string,
  stdin = '',
): Promise<PistonRunResult> {
  if (!env.piston.enabled) {
    return { stdout: '', stderr: '', error: 'Code execution is not configured on this server.' };
  }

  let runtime: { language: string; version: string } | null;
  try {
    runtime = await resolveRuntime(language);
  } catch (err) {
    logger.warn('piston runtimes lookup failed', { err: (err as Error).message });
    return { stdout: '', stderr: '', error: 'Execution service unavailable.' };
  }
  if (!runtime) {
    return { stdout: '', stderr: '', error: `${language} is not available on this execution server.` };
  }

  const runTimeoutMs = env.piston.timeoutSeconds * 1000;
  try {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), runTimeoutMs + 5000);
    const doExecute = (includeRunTimeout: boolean) =>
      fetch(`${env.piston.url.replace(/\/$/, '')}/api/v2/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: runtime.language,
          version: runtime.version,
          files: [{ content: code }],
          stdin,
          ...(includeRunTimeout ? { run_timeout: runTimeoutMs } : {}),
        }),
        signal: controller.signal,
      });

    let res: Response;
    try {
      res = await doExecute(true);
      // Our configured PISTON_TIMEOUT_SECONDS may exceed this instance's own
      // configured max run_timeout — retry once letting Piston use its default.
      if (res.status === 400) {
        const body = (await res.clone().json().catch(() => null)) as { message?: string } | null;
        if (body?.message?.includes('run_timeout')) {
          res = await doExecute(false);
        }
      }
    } finally {
      clearTimeout(abortTimer);
    }

    if (!res.ok) {
      logger.warn('piston execute failed', { status: res.status });
      return { stdout: '', stderr: '', error: 'Execution service returned an error.' };
    }

    const data = (await res.json()) as {
      compile?: { stdout: string; stderr: string; code: number | null; signal: string | null };
      run?: { stdout: string; stderr: string; code: number | null; signal: string | null };
    };

    if (data.compile && data.compile.code !== 0) {
      return { stdout: '', stderr: data.compile.stderr || 'Compilation failed.' };
    }

    return {
      stdout: data.run?.stdout ?? '',
      stderr: data.run?.stderr ?? '',
    };
  } catch (err) {
    logger.warn('piston request error', { err: (err as Error).message });
    return { stdout: '', stderr: '', error: 'Execution service unavailable or timed out.' };
  }
}
