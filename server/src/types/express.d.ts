import type { JwtPayload, InterviewTokenPayload } from '@agnohire/shared';

declare global {
  namespace Express {
    /**
     * Authenticated principal attached by auth.middleware. We model passport's
     * `Express.User` as our access-token payload so `req.user` is strongly typed
     * across the app. (OAuth strategy briefly returns `{ userId }`, cast locally.)
     */
    interface User extends JwtPayload {}

    interface Request {
      /** Populated by interviewAuth.middleware for the public interview route. */
      interview?: InterviewTokenPayload;
      /** Captured by audit.middleware for mutation logging. */
      auditContext?: {
        action: string;
        entity?: string;
        entityId?: string;
        oldValue?: unknown;
      };
      publicOfferToken?: string;
      /** Tenant slug parsed from the request Host (tenantHost.middleware). */
      tenantSlug?: string;
      /** Tenant id resolved from the Host subdomain, if any (isolation guard). */
      hostTenantId?: string | null;
      /** Resolved by publicCareersScope.middleware for the public careers-page routes. */
      careersTenant?: { id: string; name: string; slug: string };
      /**
       * Set by rbac.middleware's requireUserManage when the caller reached
       * /api/admin/users WITHOUT the global `user.manage` permission, solely
       * via a workspace-scoped WorkspaceMember.canManageUsers grant. Read by
       * adminUserService to confine every operation (list/create/update/
       * delete) to that one workspace and to cap which roles can be assigned.
       */
      workspaceScopedUserManage?: boolean;
    }
  }
}

export {};
