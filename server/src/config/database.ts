import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from './logger.js';
import { getTenantContext } from './tenantContext.js';

/** Models that carry a `deletedAt` column and participate in soft deletes. */
const SOFT_DELETE_MODELS = new Set<string>([
  'User',
  'Sector',
  'Domain',
  'JobRequisition',
  'JobTemplate',
  'Candidate',
  'CandidateList',
  'Resume',
  'Interview',
  'QuestionBank',
  'Question',
  'Offer',
  'EmailTemplate',
  'JobApplication',
  'Assessment',
  'Organization',
  'Workspace',
]);

const READ_ACTIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const base = new PrismaClient({
  log: [
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

base.$on('warn' as never, (e: unknown) => logger.warn('prisma', { e }));
base.$on('error' as never, (e: unknown) => logger.error('prisma', { e }));

/**
 * RLS Phase 2 (+ Organization/Workspace extension) — per-request scope GUCs.
 *
 * Postgres Row-Level Security policies read these transaction-local settings:
 *   app.tenant_id       — the caller's tenant (empty = none)
 *   app.organization_id — the caller's current organization (empty = none)
 *   app.workspace_id    — the caller's current workspace (empty = none)
 *   app.bypass          — 'on' for SUPERADMIN operators
 *
 * `set_config(key, value, true)` is transaction-scoped (like SET LOCAL), so it
 * is safe with connection pooling. Because these settings must live on the SAME
 * connection as the query they guard, standalone operations are wrapped in a
 * two-statement transaction below, and multi-statement work must go through
 * `tenantTransaction` so the GUCs are set once at the top of that transaction.
 *
 * The organization/workspace GUCs are a strict addition to this existing
 * mechanism — they're set on every request exactly like app.tenant_id always
 * was, whether or not any workspace_isolation RLS policy reading them has
 * been enabled yet (harmless no-op until then).
 */
const inTenantTx = new AsyncLocalStorage<boolean>();

function tenantGucSql(ctx: ReturnType<typeof getTenantContext>) {
  return Prisma.sql`SELECT set_config('app.tenant_id', ${ctx?.tenantId ?? ''}, true),
                           set_config('app.organization_id', ${ctx?.organizationId ?? ''}, true),
                           set_config('app.workspace_id', ${ctx?.workspaceId ?? ''}, true),
                           set_config('app.bypass', ${ctx?.bypass ? 'on' : 'off'}, true)`;
}

export const prisma = base.$extends({
  name: 'rls-tenant-guc',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = getTenantContext();
        // No tenant context (boot, seed, workers without a stamp): run as-is.
        if (!ctx) return query(args);
        // Already inside a tenantTransaction: the GUCs are set for this tx.
        if (inTenantTx.getStore()) return query(args);
        // Standalone op: set the GUCs and run the query inside the SAME
        // interactive transaction, so both statements are guaranteed to share
        // one connection. (The array form `$transaction([execRaw, query(args)])`
        // does NOT guarantee this: `query(args)` is the extension's own
        // continuation and can be dispatched on a different pooled connection
        // before $transaction gets a chance to batch it, so the GUCs set by
        // the first statement silently do not apply to the second — the read
        // then runs on a connection with stale or empty GUCs and RLS hides
        // rows that should have been visible.)
        return base.$transaction(async (tx) => {
          await tx.$executeRaw(tenantGucSql(ctx));
          // Prisma client model properties are camelCase (`tx.user`), but the
          // extension's `model` arg is the PascalCase schema name (`User`).
          const modelKey = model ? model.charAt(0).toLowerCase() + model.slice(1) : model;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (tx as any)[modelKey][operation](args);
        });
      },
    },
  },
});

/**
 * Interactive transaction that sets the tenant GUCs once, on the transaction's
 * own connection, before running `fn`. Use this in place of
 * `prisma.$transaction(async (tx) => ...)` anywhere tenant-scoped models are
 * touched, so RLS sees the right tenant for every statement in the tx.
 */
export function tenantTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
): Promise<T> {
  return base.$transaction(async (tx) => {
    const ctx = getTenantContext();
    if (ctx) await tx.$executeRaw(tenantGucSql(ctx));
    return inTenantTx.run(true, () => fn(tx));
  }, options);
}

/**
 * Global soft-delete middleware:
 *  - `delete`      → `update` setting deletedAt
 *  - `deleteMany`  → `updateMany` setting deletedAt
 *  - read actions  → inject `deletedAt: null` filter
 *
 * Pass `where: { deletedAt: { not: null } }` (or set it explicitly) to opt out
 * and read soft-deleted rows.
 */
base.$use(async (params: Prisma.MiddlewareParams, next) => {
  const model = params.model;
  if (!model || !SOFT_DELETE_MODELS.has(model)) {
    return next(params);
  }

  if (params.action === 'delete') {
    params.action = 'update';
    params.args = params.args ?? {};
    params.args.data = { deletedAt: new Date() };
  } else if (params.action === 'deleteMany') {
    params.action = 'updateMany';
    params.args = params.args ?? {};
    params.args.data = { ...(params.args.data ?? {}), deletedAt: new Date() };
  } else if (READ_ACTIONS.has(params.action)) {
    params.args = params.args ?? {};
    // findUnique/findUniqueOrThrow can't take non-unique filters → downgrade.
    if (params.action === 'findUnique') params.action = 'findFirst';
    if (params.action === 'findUniqueOrThrow') params.action = 'findFirstOrThrow';

    const where = params.args.where ?? {};
    if (where.deletedAt === undefined) {
      params.args.where = { ...where, deletedAt: null };
    }
  }

  return next(params);
});

/**
 * Multi-tenant choke point. Models that carry a `tenantId` column and whose
 * rows belong to exactly one tenant. When a tenant context is present (every
 * authenticated request — set by auth.middleware), reads are filtered and
 * creates are stamped with that tenantId, so isolation cannot be forgotten in
 * individual services. Requests with NO context (public token routes, boot
 * code, workers) pass through unchanged — those paths authenticate via
 * unguessable per-entity tokens, preserving pre-SaaS behaviour exactly.
 * SUPERADMIN requests set `bypass` for
 * cross-tenant support operations.
 */
const TENANT_MODELS = new Set<string>([
  'User',
  'Sector',
  'Domain',
  'JobRequisition',
  'JobTemplate',
  'Candidate',
  'JobApplication',
  'CandidateList',
  'CandidateAssignment',
  'Resume',
  'Interview',
  'InterviewSchedule',
  'QuestionBank',
  'Question',
  'Assessment',
  'AssessmentAssignment',
  'PipelineNote',
  'SourcingChannel',
  'Referral',
  'Offer',
  'AiChatHistory',
  'Notification',
  'AdminNotificationState',
  'EmailTemplate',
  'EmailLog',
  'Integration',
  'WebhookLog',
  'AuditLog',
  'GdprRequest',
  'SystemConfiguration',
  'AnalyticsSnapshot',
  'Attachment',
  'Organization',
  'Workspace',
  'OrganizationMember',
  'WorkspaceMember',
  // Team communication / calling / AI-summarization / light workflow-automation
  // module (2026-08) — tenantId-only scoping, entirely independent of the
  // Organization/Workspace hierarchy above (see schema.prisma's "TEAM
  // COMMUNICATION ..." section). AutomationRule and AutomationAction are
  // deliberately NOT listed here: unlike every other table in this module,
  // they carry no tenantId column of their own — they're scoped transitively
  // through their parent AutomationWorkflow (which IS listed below).
  'CommunicationHub',
  'CommunicationChannel',
  'CommunicationChannelMember',
  'CommunicationMessage',
  'CommunicationReaction',
  'CommunicationThread',
  'CommunicationCall',
  'CommunicationCallParticipant',
  'CommunicationPresence',
  'CommunicationDevice',
  'CommunicationMessageStatus',
  'CommunicationAiSummary',
  'CommunicationMeeting',
  'CommunicationNote',
  'CommunicationTask',
  'CommunicationSettings',
  'CandidateTimelineEvent',
  'AutomationWorkflow',
  'AutomationLog',
]);

const WRITE_MANY_ACTIONS = new Set(['updateMany', 'deleteMany']);
const CREATE_ACTIONS = new Set(['create', 'createMany']);

base.$use(async (params: Prisma.MiddlewareParams, next) => {
  const model = params.model;
  if (!model || !TENANT_MODELS.has(model)) return next(params);

  const ctx = getTenantContext();
  if (!ctx) return next(params); // no context (boot, workers without stamp, public pass-through)

  // Platform operators read/write cross-tenant, but their CREATES still get
  // stamped with their own tenant (when known) so NOT NULL columns are
  // satisfied and rows are never born orphaned.
  if (ctx.bypass) {
    if (ctx.tenantId && CREATE_ACTIONS.has(params.action)) {
      params.args = params.args ?? {};
      if (params.action === 'create') {
        params.args.data = { ...(params.args.data ?? {}), tenantId: params.args.data?.tenantId ?? ctx.tenantId };
      } else if (Array.isArray(params.args.data)) {
        params.args.data = params.args.data.map((d: Record<string, unknown>) => ({ tenantId: ctx.tenantId, ...d }));
      }
    }
    return next(params);
  }

  // Fail closed: an authenticated principal without a tenant sees nothing.
  const tenantId = ctx.tenantId ?? '__none__';
  params.args = params.args ?? {};

  if (CREATE_ACTIONS.has(params.action)) {
    if (params.action === 'create') {
      params.args.data = { ...(params.args.data ?? {}), tenantId: params.args.data?.tenantId ?? ctx.tenantId };
    } else if (Array.isArray(params.args.data)) {
      params.args.data = params.args.data.map((d: Record<string, unknown>) => ({
        tenantId: ctx.tenantId,
        ...d,
      }));
    }
    return next(params);
  }

  if (params.action === 'upsert') {
    params.args.create = { ...(params.args.create ?? {}), tenantId: params.args.create?.tenantId ?? ctx.tenantId };
    return next(params);
  }

  if (READ_ACTIONS.has(params.action) || WRITE_MANY_ACTIONS.has(params.action)) {
    // findUnique can't take non-unique filters → downgrade (mirrors soft delete).
    if (params.action === 'findUnique') params.action = 'findFirst';
    if (params.action === 'findUniqueOrThrow') params.action = 'findFirstOrThrow';
    const where = params.args.where ?? {};
    if (where.tenantId === undefined) {
      params.args.where = { ...where, tenantId };
    }
    return next(params);
  }

  // update/delete on a unique selector: Prisma's generated WhereUniqueInput
  // accepts additive non-unique scalar filters alongside the unique one (e.g.
  // `{ id, tenantId }`), so tenantId can be merged directly into the same
  // query — same as the read branch above — and Prisma's own "record not
  // found" (P2025) on update/delete does the enforcement natively.
  //
  // This used to run a separate existence check via a plain `findFirst` on
  // the base client before proceeding. That query is NOT part of the current
  // interactive transaction (`prisma.$transaction(async (tx) => ...)`), so
  // under READ COMMITTED it can't see a row the same transaction just
  // created — every create-then-update-by-id sequence (e.g. resume upload:
  // create, then update to set fileUrl) failed with a false "not found" for
  // every real tenant. Merging the filter into the same in-transaction query
  // avoids the extra out-of-band read entirely.
  if (params.action === 'update' || params.action === 'delete') {
    const where = params.args.where ?? {};
    if (where.tenantId === undefined) {
      params.args.where = { ...where, tenantId };
    }
  }

  return next(params);
});

/**
 * Organization/Workspace choke point — a strict addition alongside the
 * tenant one above, not a replacement. Two independent groups:
 *
 *  - STAMP_MODELS: every table denormalizing organizationId/workspaceId from
 *    its own Sector (see schema.prisma). Auto-stamped on create exactly like
 *    tenantId, but NEVER auto-filtered on read — most of these columns are
 *    permanently nullable (their sectorId is itself optional), so filtering
 *    on them the way tenantId is filtered would silently hide legitimately
 *    unassigned rows. Callers that need workspace-scoped reads add their own
 *    `where: { workspaceId }`, the same way they already do for `sectorId`.
 *
 *  - FILTER_MODELS (Sector, JobRequisition only): the two tables where
 *    organizationId/workspaceId are NOT NULL. These get the same
 *    auto-filter-on-read treatment as tenantId, EXCEPT they do not fail
 *    closed when ctx.organizationId/workspaceId is unset — an authenticated
 *    request with a tenant but no resolved workspace (a token minted before
 *    this rollout, mid-migration) is a legitimate, expected transitional
 *    state, not a denial: the tenantId filter above already fully protects
 *    cross-tenant isolation, so this layer simply skips filtering rather than
 *    hiding every row.
 *
 * G3 tables (Notification, WebhookLog, GdprRequest, AiChatHistory,
 * AdminNotificationState) are deliberately excluded from both groups — their
 * organizationId/workspaceId has to be copied from a DIFFERENT row (e.g. a
 * Notification's from its recipient, not its creator's ambient context), so
 * the generic middleware can't stamp them correctly; each write site sets
 * them explicitly where it matters.
 */
const ORG_WORKSPACE_STAMP_MODELS = new Set<string>([
  'JobRequisition',
  'Domain',
  'Candidate',
  'User',
  'Integration',
  'SystemConfiguration',
  'QuestionBank',
  'Assessment',
  'JobTemplate',
  'CandidateList',
  'EmailTemplate',
  'AuditLog',
  'AnalyticsSnapshot',
]);

const ORG_WORKSPACE_FILTER_MODELS = new Set<string>(['Sector', 'JobRequisition']);

base.$use(async (params: Prisma.MiddlewareParams, next) => {
  const model = params.model;
  // Must pass through for EITHER group, not just STAMP_MODELS — Sector and
  // JobRequisition are FILTER_MODELS-only (never STAMP_MODELS, since their
  // organizationId/workspaceId are set explicitly by the service layer via
  // requireOrganizationId()/requireWorkspaceId(), not auto-stamped). Gating
  // on STAMP_MODELS alone silently skipped the read-filtering logic below
  // for exactly the two tables it exists to protect.
  if (!model || (!ORG_WORKSPACE_STAMP_MODELS.has(model) && !ORG_WORKSPACE_FILTER_MODELS.has(model))) return next(params);

  const ctx = getTenantContext();
  if (!ctx || ctx.bypass) return next(params); // no context, or a platform operator — never auto-assigned an org/workspace

  const { organizationId, workspaceId } = ctx;
  params.args = params.args ?? {};

  if (CREATE_ACTIONS.has(params.action)) {
    if (params.action === 'create') {
      params.args.data = {
        ...(params.args.data ?? {}),
        ...(organizationId && params.args.data?.organizationId === undefined ? { organizationId } : {}),
        ...(workspaceId && params.args.data?.workspaceId === undefined ? { workspaceId } : {}),
      };
    } else if (Array.isArray(params.args.data)) {
      params.args.data = params.args.data.map((d: Record<string, unknown>) => ({
        ...(organizationId ? { organizationId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...d,
      }));
    }
    return next(params);
  }

  if (params.action === 'upsert') {
    params.args.create = {
      ...(params.args.create ?? {}),
      ...(organizationId && params.args.create?.organizationId === undefined ? { organizationId } : {}),
      ...(workspaceId && params.args.create?.workspaceId === undefined ? { workspaceId } : {}),
    };
    return next(params);
  }

  if (!ORG_WORKSPACE_FILTER_MODELS.has(model) || (!organizationId && !workspaceId)) {
    return next(params); // stamp-only model, or nothing resolved yet to filter by
  }

  if (READ_ACTIONS.has(params.action) || WRITE_MANY_ACTIONS.has(params.action)) {
    if (params.action === 'findUnique') params.action = 'findFirst';
    if (params.action === 'findUniqueOrThrow') params.action = 'findFirstOrThrow';
    const where = params.args.where ?? {};
    if (workspaceId && where.workspaceId === undefined) {
      params.args.where = { ...where, workspaceId };
    }
    return next(params);
  }

  if (params.action === 'update' || params.action === 'delete') {
    const where = params.args.where ?? {};
    if (workspaceId && where.workspaceId === undefined) {
      params.args.where = { ...where, workspaceId };
    }
  }

  return next(params);
});

export async function connectDatabase(): Promise<void> {
  await base.$connect();
  logger.info('Database connected');
}

export async function disconnectDatabase(): Promise<void> {
  await base.$disconnect();
}
