import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request scope context, set by auth.middleware from the verified JWT
 * (NEVER from client-supplied headers/body) and read by the Prisma scoping
 * choke point in config/database.ts.
 *
 * `bypass: true` is reserved for SUPERADMIN
 * operators and explicit system jobs (workers acting on a specific tenant
 * should instead run inside runWithTenant(tenantId, ...) / runWithScope(...)).
 *
 * organizationId/workspaceId are optional even when tenantId is set: a
 * request authenticated with a pre-Organization/Workspace-rollout token (or
 * one hitting a path that only ever resolves tenantId, e.g. some system jobs)
 * simply has no workspace scope — this is treated as "no filter", identical
 * to how every tenant behaved before Organization/Workspace existed.
 */
export interface ScopeContext {
  tenantId: string | null;
  organizationId: string | null;
  workspaceId: string | null;
  bypass: boolean;
}

/** @deprecated Alias of ScopeContext, kept so existing call sites reading `TenantContext` keep compiling unchanged. */
export type TenantContext = ScopeContext;

const als = new AsyncLocalStorage<ScopeContext>();

export function getTenantContext(): ScopeContext | undefined {
  return als.getStore();
}

/**
 * Both helpers below await `fn` INSIDE the `als.run` callback rather than
 * just returning `fn()`. Prisma Client methods return lazy promises whose
 * actual query dispatch happens at `.then()`/`await` time, not at the moment
 * the method is called. If we returned `fn()` directly, `als.run`'s
 * synchronous callback would return before that dispatch ever happens, the
 * AsyncLocalStorage context would already have unwound to the caller's
 * ambient context, and the query would run with the WRONG tenant/bypass
 * setting — invisibly, since nothing throws. Awaiting inside the callback
 * keeps the dispatch (and its continuation) tied to this context.
 */
export function runWithScope<T>(
  scope: { tenantId: string | null; organizationId?: string | null; workspaceId?: string | null },
  fn: () => T | Promise<T>,
  bypass = false,
): Promise<T> {
  return als.run(
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId ?? null,
      workspaceId: scope.workspaceId ?? null,
      bypass,
    },
    async () => await fn(),
  );
}

/**
 * Thin backward-compatible wrapper: every existing call site (auth.middleware
 * before this rollout, workers, both isolation test suites) keeps compiling
 * and behaving identically — organization/workspace simply default to null,
 * i.e. "no workspace scope," which is exactly the pre-rollout behavior.
 */
export function runWithTenant<T>(tenantId: string | null, fn: () => T | Promise<T>, bypass = false): Promise<T> {
  return runWithScope({ tenantId }, fn, bypass);
}

/** Run as a cross-tenant platform operator / system job. Use sparingly. */
export function runAsPlatform<T>(fn: () => T | Promise<T>): Promise<T> {
  return runWithScope({ tenantId: null }, fn, true);
}

/**
 * The current tenant id, required. Used at create sites for models whose
 * tenantId column is NOT NULL — every such path runs inside an authenticated
 * request (auth.middleware always sets the context), so a missing tenant here
 * is a programming error, not a user error.
 */
export function requireTenantId(): string {
  const tenantId = als.getStore()?.tenantId;
  if (!tenantId) {
    throw new Error('Tenant context required but not set — this write path must run inside an authenticated request or runWithTenant()/runWithScope()');
  }
  return tenantId;
}

/** The current organization id, required. Used at create sites for models whose organizationId column is NOT NULL (Sector, JobRequisition). */
export function requireOrganizationId(): string {
  const organizationId = als.getStore()?.organizationId;
  if (!organizationId) {
    throw new Error('Organization context required but not set — this write path must run inside a request whose token/context carries a resolved workspace, or explicitly via runWithScope()');
  }
  return organizationId;
}

/** The current workspace id, required. Used at create sites for models whose workspaceId column is NOT NULL (Sector, JobRequisition). */
export function requireWorkspaceId(): string {
  const workspaceId = als.getStore()?.workspaceId;
  if (!workspaceId) {
    throw new Error('Workspace context required but not set — this write path must run inside a request whose token/context carries a resolved workspace, or explicitly via runWithScope()');
  }
  return workspaceId;
}
