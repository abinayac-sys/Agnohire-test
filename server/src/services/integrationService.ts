import type { Request } from 'express';
import { prisma } from '../config/database.js';
import { recordAudit } from './auditService.js';
import { assertSectorExists } from './adminSectorService.js';
import { encrypt, decrypt, isEncrypted } from '../config/encryption.js';
import { logger } from '../config/logger.js';
import { NotFoundError } from '../utils/errors.js';
import {
  type CreateIntegrationInput,
  type UpdateIntegrationInput,
  type IntegrationItem,
} from '@agnohire/shared';

const MASK = '••••••••';
// A config key is treated as secret when one of its segments (split on _ - . or
// camelCase) is a sensitive term — avoids false positives like "publicId" or
// "monkey" while still catching apiKey / client_secret / accessToken / password.
const SECRET_TERMS = new Set(['key', 'apikey', 'secret', 'token', 'password', 'passwd', 'credential', 'credentials', 'privatekey']);

function isSecretKey(k: string): boolean {
  const segments = k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // split camelCase
    .split(/[\s_\-.]+/)
    .map((s) => s.toLowerCase())
    .filter(Boolean);
  return segments.some((s) => SECRET_TERMS.has(s));
}

/** Stored configJson is an encrypted JSON string. Decrypt → object. */
function readConfig(configJson: string | null): Record<string, unknown> {
  if (!configJson) return {};
  try {
    const raw = isEncrypted(configJson) ? decrypt(configJson) : configJson;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    logger.error('Failed to read integration config', { err: (err as Error).message });
    return {};
  }
}

/** Mask secret-looking values before sending config to a client. */
function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) out[k] = isSecretKey(k) && v ? MASK : v;
  return out;
}

/**
 * Merge an incoming config patch over the stored one. A value left at the mask
 * sentinel means "keep the existing secret" rather than overwrite it with the mask.
 */
function mergeConfig(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (isSecretKey(k) && v === MASK) continue; // unchanged secret
    merged[k] = v;
  }
  return merged;
}

function toItem(row: {
  id: string; name: string; type: string; isEnabled: boolean; configJson: string | null;
  webhookUrl: string | null; sectorId: string | null; lastSyncAt: Date | null; createdAt: Date; updatedAt: Date;
}): IntegrationItem {
  return {
    id: row.id, name: row.name, type: row.type, isEnabled: row.isEnabled,
    config: maskConfig(readConfig(row.configJson)),
    webhookUrl: row.webhookUrl, sectorId: row.sectorId,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listIntegrations(): Promise<IntegrationItem[]> {
  const rows = await prisma.integration.findMany({ orderBy: { name: 'asc' } });
  return rows.map(toItem);
}

/**
 * Server-side accessor for an enabled integration's *decrypted* config, for
 * internal callers that actually talk to the provider (e.g. calendar sync).
 * Prefers a sector-specific integration, falling back to a global one. Returns
 * null when no enabled integration of the given type(s) exists. Never masks —
 * callers need the real secrets to authenticate.
 */
export async function getEnabledIntegrationConfig(
  types: string[],
  sectorId: string | null = null,
): Promise<{ id: string; config: Record<string, unknown> } | null> {
  const wanted = new Set(types.map((t) => t.toUpperCase()));
  const rows = await prisma.integration.findMany({
    where: { isEnabled: true, ...(sectorId ? { OR: [{ sectorId }, { sectorId: null }] } : {}) },
    select: { id: true, type: true, configJson: true, sectorId: true },
  });
  const matches = rows.filter((r) => wanted.has(r.type.toUpperCase()));
  if (matches.length === 0) return null;
  // Prefer a sector-specific match over a global (null-sector) one.
  const chosen = matches.find((r) => r.sectorId === sectorId) ?? matches[0];
  return { id: chosen.id, config: readConfig(chosen.configJson) };
}

export async function createIntegration(data: CreateIntegrationInput, req: Request): Promise<IntegrationItem> {
  await assertSectorExists(data.sectorId);
  const configJson = data.config ? encrypt(JSON.stringify(data.config)) : null;
  const row = await prisma.integration.create({
    data: {
      name: data.name, type: data.type, isEnabled: data.isEnabled ?? false,
      configJson, webhookUrl: data.webhookUrl ?? null, sectorId: data.sectorId ?? null,
    },
  });
  await recordAudit(req, { action: 'CREATE', entity: 'Integration', entityId: row.id, description: `Created integration ${data.name} (${data.type})` });
  return toItem(row);
}

export async function updateIntegration(id: string, data: UpdateIntegrationInput, req: Request): Promise<IntegrationItem> {
  const existing = await prisma.integration.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Integration not found');
  if (data.sectorId !== undefined) await assertSectorExists(data.sectorId);

  let configJson = existing.configJson;
  if (data.config !== undefined) {
    const merged = mergeConfig(readConfig(existing.configJson), data.config);
    configJson = encrypt(JSON.stringify(merged));
  }

  const row = await prisma.integration.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.isEnabled !== undefined && { isEnabled: data.isEnabled }),
      ...(data.webhookUrl !== undefined && { webhookUrl: data.webhookUrl }),
      ...(data.sectorId !== undefined && { sectorId: data.sectorId }),
      configJson,
    },
  });
  await recordAudit(req, { action: 'UPDATE', entity: 'Integration', entityId: id, description: `Updated integration ${row.name}` });
  return toItem(row);
}

export async function deleteIntegration(id: string, req: Request): Promise<void> {
  const existing = await prisma.integration.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!existing) throw new NotFoundError('Integration not found');
  // Integration is not a soft-delete model — hard delete.
  await prisma.integration.delete({ where: { id } });
  await recordAudit(req, { action: 'DELETE', entity: 'Integration', entityId: id, description: `Deleted integration ${existing.name}` });
}
