import type { Request } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../config/database.js';
import { redisProxy } from '../config/redis.js';
import { runAsPlatform, runWithTenant } from '../config/tenantContext.js';
import { configService } from '../services/configService.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from '../utils/tokenHelper.js';
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  TenantPendingApprovalError,
} from '../utils/errors.js';
import { getActiveMaintenanceWindow } from './maintenanceService.js';
import {
  resolveDefaultMembership,
  canAccessWorkspace,
  listMemberships as listMembershipsForUser,
  type ResolvedMembership,
} from './workspaceMembershipService.js';
import {
  CONFIG_KEYS,
  ROLES,
  ROLE_DISPLAY_NAMES,
  type AuthUser,
  type ProfileDetails,
  type UpdateProfileInput,
  type JwtPayload,
  type PermissionKey,
  type RoleKey,
  type WorkspaceRoleKey,
  type MembershipTree,
} from '@agnohire/shared';

const REVOKED_PREFIX = 'revoked:jti:';

type UserWithRole = Awaited<ReturnType<typeof loadUser>>;

async function loadUser(where: { id?: string; email?: string }) {
  const user = await prisma.user.findFirst({
    where,
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      tenant: { select: { slug: true, timezone: true } },
    },
  });
  return user;
}

/**
 * A user's EFFECTIVE permission keys. When the user's tenant has customized
 * their role (a TenantRolePermission row exists), that per-tenant set wins;
 * otherwise the global role defaults apply. This is what keeps one tenant's
 * role edits from leaking into another's — every token/AuthUser is built from
 * the tenant-resolved set, not the shared global Role.permissions.
 */
async function effectivePermissionKeys(user: NonNullable<UserWithRole>): Promise<PermissionKey[]> {
  const tenantId = (user as { tenantId?: string | null }).tenantId ?? null;
  if (tenantId) {
    const override = await prisma.tenantRolePermission.findUnique({
      where: { tenantId_roleId: { tenantId, roleId: user.role.id } },
      select: { permissionKeys: true },
    });
    if (override) return override.permissionKeys as PermissionKey[];
  }
  return user.role.permissions.map((rp) => rp.permission.key as PermissionKey);
}

export function toAuthUser(
  user: NonNullable<UserWithRole>,
  permissions: PermissionKey[],
  membership: ResolvedMembership | null,
): AuthUser {
  const role = user.role.name as RoleKey;
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role,
    roleDisplayName: ROLE_DISPLAY_NAMES[role] ?? user.role.displayName,
    sectorId: user.sectorId,
    permissions,
    tenantSlug: (user as { tenant?: { slug: string; timezone: string } | null }).tenant?.slug ?? null,
    tenantTimezone: (user as { tenant?: { slug: string; timezone: string } | null }).tenant?.timezone ?? null,
    organizationId: membership?.organizationId ?? null,
    organizationName: membership?.organizationName ?? null,
    workspaceId: membership?.workspaceId ?? null,
    workspaceName: membership?.workspaceName ?? null,
    workspaceRole: membership?.workspaceRole ?? null,
    canManageUsers: membership?.canManageUsers ?? false,
    // True when a platform operator (superadmin) set/knows this user's current
    // password — tenant provisioning or an admin-triggered reset — and the
    // user hasn't yet replaced it with one only they know. Every issuance path
    // (login, OAuth, refresh, switchWorkspace, and platform tenantLogin
    // impersonation) builds its AuthUser through this one function, so fixing
    // it here fixes it everywhere — there is no separate path that could skip it.
    mustChangePassword: (user as { mustChangePassword?: boolean }).mustChangePassword === true,
  };
}

function buildPayload(
  user: NonNullable<UserWithRole>,
  permissions: PermissionKey[],
  membership: ResolvedMembership | null,
): Omit<JwtPayload, 'type'> {
  return {
    sub: user.id,
    email: user.email,
    role: user.role.name as RoleKey,
    sectorId: user.sectorId,
    tenantId: (user as { tenantId?: string | null }).tenantId ?? null,
    organizationId: membership?.organizationId ?? null,
    workspaceId: membership?.workspaceId ?? null,
    workspaceRole: membership?.workspaceRole ?? null,
    permissions,
  };
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthUser;
}

/**
 * Blocks session issuance for a tenant that isn't approved, or that an
 * operator has suspended. Platform users have no tenant and are never gated.
 *
 * The exemption is passed in explicitly — it must NOT be inferred from the
 * ambient `bypass` context. Every front-door login already runs inside
 * runAsPlatform (the pre-auth user lookup resolves a globally-unique email
 * across tenants, so it has to bypass RLS), so sniffing that flag here skipped
 * the gate for *all* logins and let PENDING/REJECTED tenants sign in.
 * Only operator impersonation may skip it, so operators can still enter a
 * tenant they are reviewing.
 */
async function assertTenantApproved(
  user: NonNullable<UserWithRole>,
  impersonated = false,
): Promise<void> {
  if (impersonated) return;
  const tenantId = (user as { tenantId?: string | null }).tenantId ?? null;
  if (!tenantId) return;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { approvalStatus: true, status: true, deletedAt: true },
  });
  // Fail CLOSED. A user stamped with a tenantId whose row we cannot read is a
  // broken or deleted tenant, not a free pass — the old `if (tenant && ...)`
  // let exactly that case sign in.
  if (!tenant || tenant.deletedAt) throw new ForbiddenError('Workspace is unavailable');
  if (tenant.approvalStatus !== 'APPROVED') {
    throw new TenantPendingApprovalError(tenant.approvalStatus);
  }
  // Suspension is an operator action against an abusive/non-paying tenant, and
  // until now it did not touch auth at all: the gate only read approvalStatus, so
  // setTenantStatus('SUSPENDED') was invisible here and only entitlementService
  // saw it. Without this line, revoking a suspended tenant's sessions just logs
  // its users out once and lets them log straight back in.
  //
  // CANCELLED is deliberately NOT rejected: that is a churned customer, and they
  // must still be able to sign in to re-subscribe or export their data (GDPR).
  // entitlementService already makes a cancelled tenant read-only, which is the
  // right level of restriction.
  if (tenant.status === 'SUSPENDED') {
    throw new ForbiddenError('This workspace is suspended. Contact support.');
  }
}

/**
 * While a maintenance window is ACTIVE, only the platform superadmin may sign
 * in. Impersonated sessions are exempt — that's the superadmin themselves
 * entering a tenant under review, not a regular user's own login.
 */
async function assertNotUnderMaintenance(
  user: NonNullable<UserWithRole>,
  impersonated = false,
): Promise<void> {
  if (impersonated) return;
  if (user.role.name === ROLES.SUPERADMIN) return;
  const active = await getActiveMaintenanceWindow();
  if (active) {
    throw new ServiceUnavailableError('The platform is undergoing scheduled maintenance. Please try again shortly.');
  }
}

async function issueTokens(
  user: NonNullable<UserWithRole>,
  req: Request,
  opts: { impersonated?: boolean; membership?: ResolvedMembership | null } = {},
): Promise<IssuedTokens> {
  await assertNotUnderMaintenance(user, opts.impersonated);
  await assertTenantApproved(user, opts.impersonated);
  // Login/refresh run under runAsPlatform() (tenantId: null) at the controller
  // level, since the user's tenant isn't known until after loadUser() resolves
  // it by email. Without re-entering the user's own tenant context here, these
  // reads would always resolve the platform-level row and silently ignore any
  // per-tenant override a tenant admin set in their own System Config.
  const { accessTtlMin, refreshTtlDays, membership } = await runWithTenant(user.tenantId ?? null, async () => ({
    accessTtlMin: await configService.getNumber(CONFIG_KEYS.ACCESS_TOKEN_TTL_MIN, 180),
    refreshTtlDays: await configService.getNumber(CONFIG_KEYS.REFRESH_TOKEN_TTL_DAYS, 7),
    // switchWorkspace() passes the specific membership it already validated,
    // rather than falling back to the user's default one.
    membership: opts.membership !== undefined ? opts.membership : await resolveDefaultMembership(user.id, user.tenantId ?? null),
  }));

  const perms = await effectivePermissionKeys(user);
  const accessToken = signAccessToken(buildPayload(user, perms, membership), accessTtlMin);
  const refreshToken = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + refreshTtlDays * 86_400_000);

  await prisma.refreshToken.create({
    // Store only the hash — the raw token is returned to the client (cookie).
    // `impersonated` records WHY this session skipped the approval gate, so that
    // refresh() can re-apply the gate to normal sessions while still exempting an
    // operator reviewing a tenant. This is the ONLY refreshToken.create in the
    // codebase, so every issuance path — login, OAuth, impersonation, and each
    // rotation — persists the flag here, which is what makes it inherit.
    data: {
      userId: user.id,
      token: hashRefreshToken(refreshToken),
      expiresAt: refreshExpiresAt,
      impersonated: opts.impersonated === true,
    },
  });

  await prisma.userSession.create({
    data: {
      userId: user.id,
      ipAddress: req.ip ?? 'unknown',
      userAgent: req.headers['user-agent'] ?? 'unknown',
      deviceInfo: { ip: req.ip, ua: req.headers['user-agent'] ?? null },
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), loginAttempts: 0, lockedUntil: null },
  });

  // Clear any prior revocation flag on fresh login.
  await redisProxy.del(`${REVOKED_PREFIX}${user.id}`);

  return { accessToken, refreshToken, refreshExpiresAt, user: toAuthUser(user, perms, membership) };
}

/** Dev email/password login (used when Google OAuth is unconfigured). */
export async function devLogin(
  email: string,
  password: string,
  req: Request,
): Promise<IssuedTokens> {
  const user = await loadUser({ email: email.toLowerCase() });
  if (!user || !user.passwordHash) {
    throw new UnauthorizedError('Invalid email or password');
  }
  if (!user.isActive) throw new ForbiddenError('Account is disabled');

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ForbiddenError('Account temporarily locked. Try again later.');
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    await registerFailedAttempt(user.id, user.loginAttempts);
    throw new UnauthorizedError('Invalid email or password');
  }

  // SaaS: self-registered accounts must verify their email before first login.
  // Enforced only when SMTP is configured (so the email could actually be
  // delivered); legacy users were marked verified by the migration.
  const emailVerifiedAt = (user as { emailVerifiedAt?: Date | null }).emailVerifiedAt;
  if (emailVerifiedAt === null) {
    const { isMailConfigured } = await import('./mailerService.js');
    if (await isMailConfigured()) {
      throw new ForbiddenError('Please verify your email address before signing in.');
    }
  }

  return issueTokens(user, req);
}

async function registerFailedAttempt(userId: string, current: number): Promise<void> {
  const maxAttempts = await configService.getNumber(CONFIG_KEYS.LOGIN_MAX_ATTEMPTS, 5);
  const lockMinutes = await configService.getNumber(CONFIG_KEYS.LOGIN_LOCK_MINUTES, 15);
  const attempts = current + 1;
  const data: { loginAttempts: number; lockedUntil?: Date } = { loginAttempts: attempts };
  if (attempts >= maxAttempts) {
    data.lockedUntil = new Date(Date.now() + lockMinutes * 60_000);
  }
  await prisma.user.update({ where: { id: userId }, data });
}

/**
 * Issue tokens for a user id. Used by the OAuth callback (gated like any other
 * front-door login) and by operator impersonation, which passes `impersonated`
 * so an operator can enter a tenant they are reviewing. That flag is
 * persisted on the refresh token, so the exemption survives rotation.
 */
export async function loginByUserId(
  userId: string,
  req: Request,
  opts: { impersonated?: boolean } = {},
): Promise<IssuedTokens> {
  const user = await loadUser({ id: userId });
  if (!user) throw new UnauthorizedError('User not found');
  if (!user.isActive) throw new ForbiddenError('Account is disabled');
  return issueTokens(user, req, opts);
}

/** The full org->workspace tree the caller can switch into — always freshly read, never baked into the token. */
export async function listMemberships(caller: JwtPayload): Promise<MembershipTree> {
  return runWithTenant(caller.tenantId ?? null, () =>
    listMembershipsForUser({ sub: caller.sub, role: caller.role, tenantId: caller.tenantId ?? null }),
  );
}

/**
 * Switch the caller's current Workspace. NEVER trusts the client-supplied
 * `workspaceId` on its own — re-validates membership server-side
 * (canAccessWorkspace, scoped to the caller's OWN tenantId from the verified
 * JWT, so this is intra-tenant switching only) before re-issuing a token pair
 * through the exact same issueTokens mechanism login/refresh already use,
 * just re-entered with the target membership instead of the default one.
 */
export async function switchWorkspace(caller: JwtPayload, workspaceId: string, req: Request): Promise<IssuedTokens> {
  const callerScope = { sub: caller.sub, role: caller.role, tenantId: caller.tenantId ?? null };
  if (!(await runWithTenant(caller.tenantId ?? null, () => canAccessWorkspace(callerScope, workspaceId)))) {
    throw new ForbiddenError('You are not a member of this workspace');
  }

  const workspace = await runWithTenant(caller.tenantId ?? null, () =>
    prisma.workspace.findFirst({ where: { id: workspaceId }, include: { organization: true } }),
  );
  if (!workspace) throw new NotFoundError('Workspace not found');

  const user = await loadUser({ id: caller.sub });
  if (!user) throw new UnauthorizedError('User not found');
  if (!user.isActive) throw new ForbiddenError('Account is disabled');

  // Admin-tier roles may access a workspace by role without an actual
  // WorkspaceMember row (see workspaceMembershipService.canAccessWorkspace) —
  // the token still needs a container role, so default them to admin.
  // findFirst by plain fields, not findUnique-by-compound-key — see
  // workspaceMembershipService.canAccessWorkspace's comment for why.
  const membershipRow = await runWithTenant(caller.tenantId ?? null, () =>
    prisma.workspaceMember.findFirst({ where: { workspaceId, userId: caller.sub } }),
  );
  const membership: ResolvedMembership = {
    organizationId: workspace.organizationId,
    organizationName: workspace.organization.name,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceRole: (membershipRow?.role as WorkspaceRoleKey | undefined) ?? 'WORKSPACE_ADMIN',
    canManageUsers: membershipRow?.canManageUsers ?? false,
  };

  return issueTokens(user, req, { membership });
}

/**
 * Flag a user's access tokens as revoked (until they expire) and kill all their
 * refresh tokens. Used by logout AND by admin deactivate/role-change so those
 * take effect immediately instead of lingering until the access token expires.
 * The revocation flag TTL is derived from the configured access-token lifetime
 * (+60s buffer) so it can never expire before the token it's revoking.
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  // Resolve the TTL under the target user's own tenant (not the caller's —
  // this may be called cross-tenant, e.g. a superadmin deactivating a user in
  // a different tenant), so the buffer matches whatever TTL that user's
  // tokens were actually issued with.
  const targetUser = await runAsPlatform(() =>
    prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true } }),
  );
  const accessTtlMin = await runWithTenant(targetUser?.tenantId ?? null, () =>
    configService.getNumber(CONFIG_KEYS.ACCESS_TOKEN_TTL_MIN, 180),
  );
  await redisProxy.set(`${REVOKED_PREFIX}${userId}`, '1', 'EX', accessTtlMin * 60 + 60);
}

/** Rotate a refresh token: revoke the old, issue a new pair. */
export async function refresh(token: string, req: Request): Promise<IssuedTokens> {
  if (!token) throw new UnauthorizedError('Missing refresh token');
  const stored = await prisma.refreshToken.findUnique({ where: { token: hashRefreshToken(token) } });
  if (!stored) throw new UnauthorizedError('Invalid or expired refresh token');
  if (stored.revokedAt) {
    // A revoked token replayed shortly after rotation is almost always a benign
    // race (multiple tabs, a quick retry, or a server restart) rather than theft.
    // Tolerate it within a short grace window by issuing a fresh pair instead of
    // nuking every session — which would otherwise lock the user out entirely.
    const ROTATION_GRACE_MS = 30_000;
    if (Date.now() - stored.revokedAt.getTime() <= ROTATION_GRACE_MS) {
      const graceUser = await loadUser({ id: stored.userId });
      if (!graceUser || !graceUser.isActive) throw new UnauthorizedError('User not found');
      // Inherit this session's own provenance — do NOT blanket-skip the gate.
      // This branch used to hard-code `true`, which made the 30s grace window a
      // standing bypass for normal sessions too.
      return issueTokens(graceUser, req, { impersonated: stored.impersonated });
    }
    // An older revoked token is being replayed → likely theft. Revoke the whole
    // token family so neither party can keep using it.
    await revokeUserSessions(stored.userId);
    throw new UnauthorizedError('Refresh token already used');
  }
  if (stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });
  const user = await loadUser({ id: stored.userId });
  if (!user || !user.isActive) throw new UnauthorizedError('User not found');
  // Rotation RE-RUNS the approval gate for normal sessions. A refresh token lives
  // for 7 days, so without this the gate is a login-only check and a tenant
  // that is later rejected or suspended keeps renewing itself until the token
  // expires. Impersonated sessions keep skipping it — the operator is deliberately
  // inside a tenant under review, and that flow re-bootstraps the SPA through
  // /refresh. issueTokens writes the flag onto the NEW token, so the exemption
  // survives an unbounded rotation chain.
  return issueTokens(user, req, { impersonated: stored.impersonated });
}

/** Revoke refresh token + flag access tokens as revoked for the user. */
export async function logout(userId: string, refreshToken?: string): Promise<void> {
  if (refreshToken) {
    await prisma.refreshToken.updateMany({
      where: { token: hashRefreshToken(refreshToken), userId },
      data: { revokedAt: new Date() },
    });
  }
  await prisma.userSession.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false, logoutAt: new Date() },
  });
  await revokeUserSessions(userId);
}

export async function getAuthUser(userId: string): Promise<AuthUser> {
  const user = await loadUser({ id: userId });
  if (!user) throw new UnauthorizedError('User not found');
  const membership = await runWithTenant(user.tenantId ?? null, () => resolveDefaultMembership(user.id, user.tenantId ?? null));
  return toAuthUser(user, await effectivePermissionKeys(user), membership);
}

const profileInclude = {
  role: { include: { permissions: { include: { permission: true } } } },
  sector: true,
  tenant: { select: { slug: true, timezone: true } },
} as const;

type ProfileRow = NonNullable<UserWithRole> & {
  phone: string | null;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  bio: string | null;
  address: string | null;
  sector: { name: string } | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

function toProfile(user: ProfileRow, permissions: PermissionKey[], membership: ResolvedMembership | null): ProfileDetails {
  return {
    ...toAuthUser(user, permissions, membership),
    phone: user.phone,
    jobTitle: user.jobTitle,
    department: user.department,
    location: user.location,
    dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
    gender: user.gender,
    bio: user.bio,
    address: user.address,
    sectorName: user.sector?.name ?? null,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Richer self-profile for the profile page (account + personal fields). */
export async function getProfile(userId: string): Promise<ProfileDetails> {
  const user = await prisma.user.findFirst({ where: { id: userId }, include: profileInclude });
  if (!user) throw new UnauthorizedError('User not found');
  const membership = await runWithTenant(user.tenantId ?? null, () => resolveDefaultMembership(user.id, user.tenantId ?? null));
  return toProfile(user as ProfileRow, await effectivePermissionKeys(user as ProfileRow), membership);
}

/** Maps an empty string to null (clear field), leaves undefined untouched. */
const clearable = (v: string | undefined): string | null | undefined =>
  v === undefined ? undefined : v === '' ? null : v;

/** Self-service profile update (the signed-in user edits their own details). */
export async function updateProfile(
  userId: string,
  data: UpdateProfileInput,
): Promise<ProfileDetails> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.fullName !== undefined && { fullName: data.fullName }),
      phone: clearable(data.phone),
      jobTitle: clearable(data.jobTitle),
      department: clearable(data.department),
      location: clearable(data.location),
      gender: clearable(data.gender),
      bio: clearable(data.bio),
      address: clearable(data.address),
      dateOfBirth:
        data.dateOfBirth === undefined
          ? undefined
          : data.dateOfBirth === ''
            ? null
            : new Date(`${data.dateOfBirth}T00:00:00.000Z`),
    },
    include: profileInclude,
  });
  const membership = await runWithTenant(user.tenantId ?? null, () => resolveDefaultMembership(user.id, user.tenantId ?? null));
  return toProfile(user as ProfileRow, await effectivePermissionKeys(user as ProfileRow), membership);
}

/** Sets (or clears, with null) the signed-in user's avatar URL. */
export async function setAvatarUrl(userId: string, avatarUrl: string | null): Promise<ProfileDetails> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl },
    include: profileInclude,
  });
  const membership = await runWithTenant(user.tenantId ?? null, () => resolveDefaultMembership(user.id, user.tenantId ?? null));
  return toProfile(user as ProfileRow, await effectivePermissionKeys(user as ProfileRow), membership);
}

/** Dev helper to set a password (used by reset flow placeholder). */
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 8) throw new BadRequestError('Password too short');
  return bcrypt.hash(plain, 12);
}

/**
 * Authenticated self-service password change. Used both for the voluntary
 * "change my password" action and — critically — the forced first-login
 * reset for superadmin-provisioned tenant accounts: createTenantByAdmin and
 * resetOwnerPassword set `mustChangePassword: true` precisely because the
 * platform operator who ran them knows the password they just set. This is
 * the only path that clears that flag, and it can only be reached by someone
 * who already knows the CURRENT password — proving they're the account
 * holder, not just anyone with the row's id.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user?.passwordHash) throw new UnauthorizedError('Unable to verify current password');

  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) throw new UnauthorizedError('Current password is incorrect');

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false, loginAttempts: 0, lockedUntil: null },
  });

  // Revoke every other outstanding refresh token, so a session someone else
  // captured under the old (superadmin-known) password can't silently keep
  // renewing forever. Deliberately does NOT go through revokeUserSessions():
  // that also flips a Redis flag keyed by userId (not per-token) that
  // blacklists EVERY access token for this user for the rest of its TTL —
  // including the one this very request's caller keeps using right after
  // this call returns, which would lock them straight back out of the
  // account they just unlocked. Revoking only the DB-side refresh tokens
  // still closes the real gap: the current access token keeps working until
  // its own natural expiry, and after that a fresh login needs the new
  // password.
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
