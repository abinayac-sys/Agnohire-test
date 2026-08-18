import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { paginate } from '../utils/response.js';
import { NotFoundError } from '../utils/errors.js';
import {
  ROLES,
  type AuditFilters,
  type AuditExportInput,
  type AuditLogItem,
  type AuditLogDetail,
  type AuditFacets,
} from '@agnohire/shared';

interface AuditInput {
  action: string;
  entity?: string;
  entityId?: string;
  description: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface AuditContext {
  userId: string;
  role: string;
  sectorId?: string | null;
}

function deviceInfo(req: Request) {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

/** Writes an audit record. Never throws into the request path. */
export async function recordAudit(req: Request, input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.sub ?? null,
        role: req.user?.role ?? null,
        sectorId: req.user?.sectorId ?? null,
        action: input.action,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        description: input.description,
        oldValue: (input.oldValue as object) ?? undefined,
        newValue: (input.newValue as object) ?? undefined,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        deviceInfo: deviceInfo(req),
      },
    });
  } catch (err) {
    logger.error('Failed to write audit log', { err: (err as Error).message });
  }
}

// ─── VIEWER (AUDIT_LOG_VIEW) ─────────────────────────────────────────────────

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/** Audit rows are scoped by the actor's recorded sector (fail-closed). */
function auditScope(ctx: AuditContext): Prisma.AuditLogWhereInput {
  if (isSuperOrAdmin(ctx.role)) return {};
  if (ctx.sectorId) return { sectorId: ctx.sectorId };
  return {};
}

/** Roles considered cross-tenant platform operators for the audit split. */
const PLATFORM_ACTOR_ROLES = [ROLES.SUPERADMIN];

function isPlatformOperator(role: string) {
  return role === ROLES.SUPERADMIN;
}

/**
 * Audit view split. The 'platform' tab (cross-tenant operator actions) is only
 * honoured for platform operators; everyone else is forced to 'tenant' so a
 * tenant user can never see platform-operator activity by passing scope.
 */
function scopeFilter(ctx: AuditContext, scope: 'tenant' | 'platform' | undefined): Prisma.AuditLogWhereInput {
  const effective = scope === 'platform' && isPlatformOperator(ctx.role) ? 'platform' : 'tenant';
  if (effective === 'platform') return { role: { in: PLATFORM_ACTOR_ROLES } };
  return { OR: [{ role: { notIn: PLATFORM_ACTOR_ROLES } }, { role: null }] };
}

function buildWhere(ctx: AuditContext, f: AuditFilters | AuditExportInput): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [auditScope(ctx), scopeFilter(ctx, f.scope)];
  if (f.action) and.push({ action: f.action });
  if (f.entity) and.push({ entity: f.entity });
  if (f.userId) and.push({ userId: f.userId });
  if (f.from || f.to) {
    // A date-only `to` coerces to midnight; treat it as inclusive of the whole
    // day so entries logged later that day aren't silently dropped.
    let to: Date | undefined;
    if (f.to) {
      to = new Date(f.to);
      if (to.getUTCHours() === 0 && to.getUTCMinutes() === 0 && to.getUTCSeconds() === 0 && to.getUTCMilliseconds() === 0) {
        to = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1);
      }
    }
    and.push({ createdAt: { ...(f.from ? { gte: f.from } : {}), ...(to ? { lte: to } : {}) } });
  }
  if (f.search) {
    and.push({
      OR: [
        { description: { contains: f.search, mode: 'insensitive' } },
        { entityId: { contains: f.search, mode: 'insensitive' } },
        { ipAddress: { contains: f.search, mode: 'insensitive' } },
      ],
    });
  }
  return { AND: and };
}

const LIST_SELECT = {
  id: true, action: true, entity: true, entityId: true, description: true,
  userId: true, role: true, ipAddress: true, sectorId: true, createdAt: true,
  user: { select: { fullName: true } },
} satisfies Prisma.AuditLogSelect;

function toItem(r: {
  id: string; action: string; entity: string | null; entityId: string | null;
  description: string; userId: string | null; role: string | null;
  ipAddress: string | null; sectorId: string | null; createdAt: Date;
  user: { fullName: string } | null;
}): AuditLogItem {
  return {
    id: r.id, action: r.action, entity: r.entity, entityId: r.entityId,
    description: r.description, userId: r.userId, userName: r.user?.fullName ?? null,
    role: r.role, ipAddress: r.ipAddress, sectorId: r.sectorId,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listAuditLogs(ctx: AuditContext, filters: AuditFilters) {
  const where = buildWhere(ctx, filters);
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where, select: LIST_SELECT,
      orderBy: { createdAt: filters.sortOrder },
      skip: (filters.page - 1) * filters.limit, take: filters.limit,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return paginate(rows.map(toItem), total, filters.page, filters.limit);
}

export async function getAuditLog(ctx: AuditContext, id: string): Promise<AuditLogDetail> {
  const r = await prisma.auditLog.findFirst({
    where: { AND: [{ id }, auditScope(ctx)] },
    select: {
      ...LIST_SELECT,
      userAgent: true, deviceInfo: true, oldValue: true, newValue: true,
    },
  });
  if (!r) throw new NotFoundError('Audit log not found');
  return {
    ...toItem(r),
    userAgent: r.userAgent,
    deviceInfo: r.deviceInfo ?? null,
    oldValue: r.oldValue ?? null,
    newValue: r.newValue ?? null,
  };
}

/** Distinct actions + entities (scoped) to populate filter dropdowns. */
export async function getAuditFacets(ctx: AuditContext): Promise<AuditFacets> {
  const scope = auditScope(ctx);
  const [actions, entities] = await Promise.all([
    prisma.auditLog.findMany({ where: scope, distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    prisma.auditLog.findMany({ where: { AND: [scope, { entity: { not: null } }] }, distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
  ]);
  return {
    actions: actions.map((a) => a.action),
    entities: entities.map((e) => e.entity!).filter(Boolean),
  };
}

// ─── EXCEL EXPORT ──────────────────────────────────────────────────────────────

import { EnterpriseExcelBuilder, formatEnterpriseDate } from '../utils/excelReportGenerator.js';

export async function exportAuditLogs(ctx: AuditContext, input: AuditExportInput): Promise<{ filename: string; buffer: Buffer }> {
  const rows = await prisma.auditLog.findMany({
    where: buildWhere(ctx, input),
    select: LIST_SELECT,
    orderBy: { createdAt: input.sortOrder },
    take: input.limit,
  });

  const filterNames: Record<string, string> = {
    scope: 'Scope',
    action: 'Action',
    entity: 'Entity',
    userId: 'User ID',
    from: 'Start Date',
    to: 'End Date',
    search: 'Search Keyword'
  };

  const buffer = await EnterpriseExcelBuilder.generate({
    title: 'Audit Logs Report',
    description: 'Detailed log of all privileged actions and system changes.',
    generatedBy: ctx.userId || 'System',
    environment: process.env.NODE_ENV === 'production' ? 'Production' : 'Development/UAT',
    totalRecords: rows.length,
    filters: input,
    filterNames,
    summary: {
      'Total Audit Events': rows.length
    },
    data: rows.map(r => toItem(r)),
    columns: [
      { header: 'Timestamp', key: (row) => formatEnterpriseDate(row.createdAt) },
      { header: 'Action', key: 'action' },
      { header: 'Entity', key: 'entity' },
      { header: 'Entity ID', key: 'entityId' },
      { header: 'Description', key: 'description' },
      { header: 'User Name', key: 'userName' },
      { header: 'User ID', key: 'userId' },
      { header: 'Role', key: 'role' },
      { header: 'IP Address', key: 'ipAddress' }
    ]
  });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return { filename: `agnohire-audit-${stamp}.xlsx`, buffer };
}

export async function deleteAuditLog(ctx: AuditContext, id: string): Promise<void> {
  const scope = auditScope(ctx);
  const existing = await prisma.auditLog.findFirst({
    where: { id, ...scope },
  });
  if (!existing) throw new NotFoundError('Audit log entry not found');

  await prisma.auditLog.delete({
    where: { id },
  });
}

export async function deleteAuditLogsBulk(ctx: AuditContext, ids: string[]): Promise<void> {
  const scope = auditScope(ctx);
  await prisma.auditLog.deleteMany({
    where: {
      id: { in: ids },
      ...scope,
    },
  });
}
