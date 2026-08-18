import { randomUUID, createHash } from 'node:crypto';
import { redisProxy } from '../../config/redis.js';

/**
 * Backs the two-turn confirmation gate for destructive tools
 * (`AITool.requiresConfirmation`). A tool that needs confirmation is never
 * executed on the model's first call — instead a single-use token is minted
 * here, bound to exactly {userId, toolName, hash(args)}, and the caller must
 * round-trip it back via a second /ai/run request before the tool actually
 * runs. Binding the args hash matters: without it, a token minted for a
 * harmless preview could be replayed against different (more dangerous)
 * arguments.
 */
const TTL_SECONDS = 300;

export interface PendingConfirmation {
  userId: string;
  toolName: string;
  argsHash: string;
  args: unknown;
}

function hashArgs(args: unknown): string {
  return createHash('sha256').update(JSON.stringify(args ?? {})).digest('hex');
}

export async function createConfirmationToken(userId: string, toolName: string, args: unknown): Promise<string> {
  const token = randomUUID();
  const payload: PendingConfirmation = { userId, toolName, argsHash: hashArgs(args), args };
  await redisProxy.set(`ai:confirm:${token}`, JSON.stringify(payload), 'EX', TTL_SECONDS);
  return token;
}

/** Single-use: the token is deleted whether or not it resolves, so a replay
 * (accidental double-click, or a stolen token) can never execute twice. */
export async function consumeConfirmationToken(token: string, userId: string): Promise<PendingConfirmation | null> {
  const raw = await redisProxy.get(`ai:confirm:${token}`);
  await redisProxy.del(`ai:confirm:${token}`);
  if (!raw) return null;
  const payload = JSON.parse(raw) as PendingConfirmation;
  if (payload.userId !== userId) return null;
  if (payload.argsHash !== hashArgs(payload.args)) return null; // corrupted record — refuse
  return payload;
}
