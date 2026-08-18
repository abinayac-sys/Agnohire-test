import { CodeLanguage } from '@agnohire/shared';
import { runOnPiston } from './pistonService.js';

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  error?: string;
}

/** Executes candidate code via the self-hosted Piston engine. */
export async function executeCode(language: CodeLanguage, code: string, stdin = ''): Promise<ExecuteResult> {
  if (!code || !code.trim()) {
    return { stdout: '', stderr: 'Error: No code provided to execute.' };
  }
  return runOnPiston(language, code, stdin);
}
