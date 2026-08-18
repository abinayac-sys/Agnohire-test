import { type AIContext, type AITool } from '../toolRegistry/index.js';
import { logger } from '../../config/logger.js';
import { canAccessWorkspace } from '../../services/workspaceMembershipService.js';
import type { RoleKey } from '@agnohire/shared';

export class PermissionChecker {
  /**
   * Fail-closed: a tool must declare `permissions`, `permissionsAny`,
   * `allowedRoles`, or explicit `publicTool: true`. A tool with none of
   * those is DENIED to everyone but SUPERADMIN/ADMIN — previously this
   * defaulted to allow when a tool had no `roles` set, and none of the
   * registered tools ever set that field, so every AI tool was reachable by
   * any authenticated user regardless of their actual permissions.
   *
   * `ctx.permissions`/`ctx.role` come straight from the caller's verified
   * JWT (see authService.ts) — no extra DB round-trip needed, and no risk of
   * checking a role fetched outside tenant context.
   */
  static async isAllowed(tool: AITool, ctx: AIContext): Promise<boolean> {
    if (!ctx?.userId) {
      logger.warn(`[PermissionChecker] Missing user context for tool ${tool.name}.`);
      return false;
    }

    if (ctx.role === 'SUPERADMIN' || ctx.role === 'ADMIN') return true;

    if (tool.allowedRoles && tool.allowedRoles.length > 0 && !tool.allowedRoles.includes(ctx.role)) {
      return false;
    }

    const held = new Set(ctx.permissions ?? []);

    if (tool.permissions && tool.permissions.length > 0) {
      if (!tool.permissions.every((p) => held.has(p))) return false;
    }

    if (tool.permissionsAny && tool.permissionsAny.length > 0) {
      if (!tool.permissionsAny.some((p) => held.has(p))) return false;
    }

    const hasAnyAuthDeclared =
      (tool.permissions && tool.permissions.length > 0) ||
      (tool.permissionsAny && tool.permissionsAny.length > 0) ||
      (tool.allowedRoles && tool.allowedRoles.length > 0);

    if (!hasAnyAuthDeclared && !tool.publicTool) {
      logger.warn(`[PermissionChecker] Tool ${tool.name} declares no permissions/allowedRoles/publicTool — denying by default.`);
      return false;
    }

    return true;
  }

  /**
   * For tools flagged `scopeSensitive` — verifies a target workspace
   * (typically LLM-supplied via `args.workspaceId`) against the caller's
   * REAL membership, exactly the same check and threat model as the
   * `/api/auth/switch-workspace` endpoint: an LLM-supplied id is never
   * trusted on its own, only checked against canAccessWorkspace. Returns
   * true when no target workspace is specified at all — the tool is then
   * presumed to operate in the caller's own ambient workspace, which the
   * ToolExecutor's runWithScope() already confines correctly.
   */
  static async isAllowedForWorkspace(ctx: AIContext, targetWorkspaceId: string | null | undefined): Promise<boolean> {
    if (!targetWorkspaceId) return true;
    return canAccessWorkspace(
      { sub: ctx.userId, role: ctx.role as RoleKey, tenantId: ctx.tenantId ?? null },
      targetWorkspaceId,
    );
  }
}
