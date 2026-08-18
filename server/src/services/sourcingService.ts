import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { recordAudit } from './auditService.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import type {
  CreateSourcingChannelInput,
  UpdateSourcingChannelInput,
  ChannelFilters,
  SourcingChannelItem,
} from '@agnohire/shared';
import type { Request } from 'express';

/** External channel types that require an Admin-Console Integration credential. */
const EXTERNAL_TYPES = new Set(['LINKEDIN', 'JOB_BOARD', 'AGENCY']);

interface RawChannel {
  id: string;
  name: string;
  type: string;
  configJson: string | null;
  isActive: boolean;
  createdAt: Date;
}

function parseConfig(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Set of integration types currently enabled (for needsCredential). */
async function enabledIntegrationTypes(): Promise<Set<string>> {
  const integrations = await prisma.integration.findMany({
    where: { isEnabled: true },
    select: { type: true },
  });
  return new Set(integrations.map((i) => i.type.toUpperCase()));
}

function toItem(c: RawChannel, enabled: Set<string>): SourcingChannelItem {
  return {
    id: c.id,
    name: c.name,
    type: c.type as SourcingChannelItem['type'],
    isActive: c.isActive,
    config: parseConfig(c.configJson),
    needsCredential: EXTERNAL_TYPES.has(c.type) && !enabled.has(c.type),
    createdAt: c.createdAt.toISOString(),
  };
}

export async function listChannels(filters: ChannelFilters): Promise<SourcingChannelItem[]> {
  const where: Prisma.SourcingChannelWhereInput = {
    ...(filters.type && { type: filters.type }),
    ...(filters.isActive !== undefined && { isActive: filters.isActive }),
  };
  const [channels, enabled] = await Promise.all([
    prisma.sourcingChannel.findMany({ where, orderBy: { createdAt: 'desc' } }),
    enabledIntegrationTypes(),
  ]);
  return channels.map((c) => toItem(c, enabled));
}

export async function createChannel(data: CreateSourcingChannelInput, req: Request) {
  const channel = await prisma.sourcingChannel.create({
    data: {
      name: data.name,
      type: data.type,
      isActive: data.isActive ?? true,
      configJson: data.config ? JSON.stringify(data.config) : null,
    },
  });
  await recordAudit(req, {
    action: 'CREATE',
    entity: 'SourcingChannel',
    entityId: channel.id,
    description: `Created sourcing channel: ${channel.name}`,
  });
  const enabled = await enabledIntegrationTypes();
  return toItem(channel, enabled);
}

export async function updateChannel(
  id: string,
  data: UpdateSourcingChannelInput,
  req: Request,
) {
  const existing = await prisma.sourcingChannel.findFirst({ where: { id } });
  if (!existing) throw new NotFoundError('Sourcing channel not found');

  const channel = await prisma.sourcingChannel.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.type !== undefined && { type: data.type }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.config !== undefined && { configJson: JSON.stringify(data.config) }),
    },
  });
  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'SourcingChannel',
    entityId: id,
    description: `Updated sourcing channel: ${channel.name}`,
  });
  const enabled = await enabledIntegrationTypes();
  return toItem(channel, enabled);
}

/**
 * Triggers a pull from an external channel. External channels degrade
 * gracefully: until an Admin-Console Integration credential is configured,
 * this returns a clear "connect first" error (same pattern as the OpenAI key).
 */
export async function syncChannel(id: string): Promise<{ message: string }> {
  const channel = await prisma.sourcingChannel.findFirst({ where: { id } });
  if (!channel) throw new NotFoundError('Sourcing channel not found');
  if (!channel.isActive) throw new BadRequestError('This channel is inactive');

  if (EXTERNAL_TYPES.has(channel.type)) {
    const enabled = await enabledIntegrationTypes();
    if (!enabled.has(channel.type)) {
      throw new BadRequestError(
        `${channel.type} is not connected. Add its credentials in Admin Console → Integrations to enable sync.`,
      );
    }
    // A real provider pull would run here once Module 14 (Integrations) is built.
    throw new BadRequestError(
      `Live ${channel.type} sync is not available yet — connect the integration and it will activate.`,
    );
  }

  return { message: `${channel.type} channels are managed internally; no external sync needed.` };
}

export async function deleteChannel(id: string, req: Request) {
  const channel = await prisma.sourcingChannel.findFirst({ where: { id } });
  if (!channel) throw new NotFoundError('Sourcing channel not found');
  await prisma.sourcingChannel.delete({ where: { id } });
  await recordAudit(req, {
    action: 'DELETE',
    entity: 'SourcingChannel',
    entityId: id,
    description: `Deleted sourcing channel: ${channel.name}`,
  });
}

export async function deleteReferral(id: string, req: Request) {
  const dbId = id.includes(':') ? id.split(':')[0] : id;
  const referral = await prisma.referral.findFirst({ where: { id: dbId } });
  if (!referral) throw new NotFoundError('Referral not found');
  await prisma.referral.delete({ where: { id: dbId } });

  // If no other referrals exist for this candidate, set their source to null
  // so that ensureReferralsForSourcedCandidates doesn't automatically recreate it.
  const otherReferral = await prisma.referral.findFirst({
    where: { candidateId: referral.candidateId },
  });
  if (!otherReferral) {
    await prisma.candidate.update({
      where: { id: referral.candidateId },
      data: { source: null },
    });
  }

  await recordAudit(req, {
    action: 'DELETE',
    entity: 'Referral',
    entityId: dbId,
    description: `Deleted referral ${dbId}`,
  });
}
