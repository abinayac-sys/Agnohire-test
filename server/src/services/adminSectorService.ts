import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../config/database.js';
import { requireTenantId, requireOrganizationId, requireWorkspaceId } from '../config/tenantContext.js';
import { recordAudit } from './auditService.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import {
  type CreateSectorInput,
  type UpdateSectorInput,
  type CreateDomainInput,
  type UpdateDomainInput,
  type SectorItem,
  type DomainItem,
} from '@agnohire/shared';

/** Validates a referenced sector exists (null/undefined is allowed — "no sector"). */
export async function assertSectorExists(sectorId: string | null | undefined): Promise<void> {
  if (!sectorId) return;
  const exists = await prisma.sector.findUnique({ where: { id: sectorId }, select: { id: true } });
  if (!exists) throw new BadRequestError('Unknown sector');
}

// ─── SECTORS ─────────────────────────────────────────────────────────────────

const SECTOR_SELECT = {
  id: true, name: true, type: true, isActive: true, createdAt: true,
  _count: { select: { users: true, domains: true } },
} satisfies Prisma.SectorSelect;

function toSector(s: { id: string; name: string; type: string; isActive: boolean; createdAt: Date; _count: { users: number; domains: number } }): SectorItem {
  return { id: s.id, name: s.name, type: s.type, isActive: s.isActive, userCount: s._count.users, domainCount: s._count.domains, createdAt: s.createdAt.toISOString() };
}

export async function listSectors(): Promise<SectorItem[]> {
  const rows = await prisma.sector.findMany({ orderBy: { name: 'asc' }, select: SECTOR_SELECT });
  return rows.map(toSector);
}

export async function createSector(data: CreateSectorInput, req: Request): Promise<SectorItem> {
  const tenantId = requireTenantId();
  const existing = await prisma.sector.findFirst({
    where: { tenantId, deletedAt: null, name: { equals: data.name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) throw new BadRequestError(`A sector named "${data.name}" already exists.`);

  let s;
  try {
    s = await prisma.sector.create({
      data: {
        name: data.name,
        type: data.type,
        isActive: data.isActive ?? true,
        tenantId,
        organizationId: requireOrganizationId(),
        workspaceId: requireWorkspaceId(),
      },
      select: SECTOR_SELECT,
    });
  } catch (err) {
    // findFirst above is check-then-act; the partial unique index is the real
    // guard against a race between two concurrent creates of the same name.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new BadRequestError(`A sector named "${data.name}" already exists.`);
    }
    throw err;
  }
  await recordAudit(req, { action: 'CREATE', entity: 'Sector', entityId: s.id, description: `Created sector ${data.name}` });
  return toSector(s);
}

export async function updateSector(id: string, data: UpdateSectorInput, req: Request): Promise<SectorItem> {
  const existing = await prisma.sector.findUnique({ where: { id }, select: { id: true, tenantId: true } });
  if (!existing) throw new NotFoundError('Sector not found');

  if (data.name !== undefined) {
    const dupe = await prisma.sector.findFirst({
      where: { tenantId: existing.tenantId, deletedAt: null, id: { not: id }, name: { equals: data.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (dupe) throw new BadRequestError(`A sector named "${data.name}" already exists.`);
  }

  let s;
  try {
    s = await prisma.sector.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
      select: SECTOR_SELECT,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new BadRequestError(`A sector named "${data.name}" already exists.`);
    }
    throw err;
  }
  await recordAudit(req, { action: 'UPDATE', entity: 'Sector', entityId: id, description: `Updated sector ${s.name}` });
  return toSector(s);
}

export async function deleteSector(id: string, req: Request): Promise<void> {
  const s = await prisma.sector.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!s) throw new NotFoundError('Sector not found');
  // Don't orphan active records: block archiving a sector that still owns users
  // or candidates (both exclude soft-deleted via the middleware).
  const [users, candidates] = await Promise.all([
    prisma.user.count({ where: { sectorId: id } }),
    prisma.candidate.count({ where: { sectorId: id } }),
  ]);
  if (users > 0 || candidates > 0) {
    throw new BadRequestError(`Cannot archive sector "${s.name}" — it still has ${users} user(s) and ${candidates} candidate(s). Reassign them first.`);
  }
  await prisma.sector.delete({ where: { id } }); // soft delete via middleware
  await recordAudit(req, { action: 'DELETE', entity: 'Sector', entityId: id, description: `Archived sector ${s.name}` });
}

// ─── DOMAINS ─────────────────────────────────────────────────────────────────

const DOMAIN_SELECT = {
  id: true, name: true, sectorId: true, parentId: true, isActive: true, createdAt: true,
  sector: { select: { name: true } },
} satisfies Prisma.DomainSelect;

function toDomain(d: { id: string; name: string; sectorId: string | null; parentId: string | null; isActive: boolean; createdAt: Date; sector: { name: string } | null }): DomainItem {
  return { id: d.id, name: d.name, sectorId: d.sectorId, sectorName: d.sector?.name ?? null, parentId: d.parentId, isActive: d.isActive, createdAt: d.createdAt.toISOString() };
}

export async function listDomains(sectorId?: string): Promise<DomainItem[]> {
  const rows = await prisma.domain.findMany({
    where: sectorId ? { sectorId } : {},
    orderBy: { name: 'asc' },
    select: DOMAIN_SELECT,
  });
  return rows.map(toDomain);
}

export async function createDomain(data: CreateDomainInput, req: Request): Promise<DomainItem> {
  await assertSectorExists(data.sectorId);
  const tenantId = requireTenantId();
  const sectorId = data.sectorId ?? null;

  const existing = await prisma.domain.findFirst({
    where: { tenantId, sectorId, deletedAt: null, name: { equals: data.name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) throw new BadRequestError(`A domain named "${data.name}" already exists in this sector.`);

  let d;
  try {
    d = await prisma.domain.create({
      data: { name: data.name, sectorId, parentId: data.parentId ?? null, isActive: data.isActive ?? true, tenantId },
      select: DOMAIN_SELECT,
    });
  } catch (err) {
    // findFirst above is check-then-act; the partial unique index is the real
    // guard against a race between two concurrent creates of the same name.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new BadRequestError(`A domain named "${data.name}" already exists in this sector.`);
    }
    throw err;
  }
  await recordAudit(req, { action: 'CREATE', entity: 'Domain', entityId: d.id, description: `Created domain ${data.name}` });
  return toDomain(d);
}

export async function updateDomain(id: string, data: UpdateDomainInput, req: Request): Promise<DomainItem> {
  const existingDomain = await prisma.domain.findUnique({ where: { id }, select: { id: true, tenantId: true, sectorId: true } });
  if (!existingDomain) throw new NotFoundError('Domain not found');
  await assertSectorExists(data.sectorId);

  if (data.name !== undefined) {
    const targetSectorId = data.sectorId !== undefined ? data.sectorId : existingDomain.sectorId;
    const dupe = await prisma.domain.findFirst({
      where: { tenantId: existingDomain.tenantId, sectorId: targetSectorId, deletedAt: null, id: { not: id }, name: { equals: data.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (dupe) throw new BadRequestError(`A domain named "${data.name}" already exists in this sector.`);
  }

  let d;
  try {
    d = await prisma.domain.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.sectorId !== undefined && { sectorId: data.sectorId }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
      select: DOMAIN_SELECT,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new BadRequestError(`A domain named "${data.name}" already exists in this sector.`);
    }
    throw err;
  }
  await recordAudit(req, { action: 'UPDATE', entity: 'Domain', entityId: id, description: `Updated domain ${d.name}` });
  return toDomain(d);
}

export async function deleteDomain(id: string, req: Request): Promise<void> {
  const d = await prisma.domain.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!d) throw new NotFoundError('Domain not found');
  const candidates = await prisma.candidate.count({ where: { domainId: id } });
  if (candidates > 0) {
    throw new BadRequestError(`Cannot archive domain "${d.name}" — it still has ${candidates} candidate(s). Reassign them first.`);
  }
  await prisma.domain.delete({ where: { id } }); // soft delete via middleware
  await recordAudit(req, { action: 'DELETE', entity: 'Domain', entityId: id, description: `Archived domain ${d.name}` });
}
