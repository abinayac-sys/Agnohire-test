import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { getTenantContext, runAsPlatform } from '../config/tenantContext.js';
import { configService, TENANT_EXCLUSIVE_KEYS } from '../services/configService.js';
import { recordAudit } from '../services/auditService.js';
import { broadcastThemeUpdate } from '../config/socket.js';
import { resetMailer, verifyMailer, sendMail } from '../services/mailerService.js';
import { testCalendarConnection } from '../services/calendarService.js';
import { getPublicAttachmentFile } from '../services/attachmentService.js';
import { getActiveOrUpcomingMaintenance } from '../services/maintenanceService.js';
import { logger } from '../config/logger.js';
import { ok } from '../utils/response.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/errors.js';
import { CONFIG_KEYS, CONFIG_SEEDS, THEME_PRESETS, ROLES, type ConfigKey } from '@agnohire/shared';

/**
 * Look up a theme by name, auto-creating it from the bundled presets if it
 * isn't seeded in this environment's DB yet. Lets clients activate any shipped
 * palette without a manual re-seed; throws only for genuinely unknown names.
 */
async function resolveTheme(name: string) {
  const existing = await prisma.theme.findUnique({ where: { name } });
  if (existing) return existing;
  const preset = THEME_PRESETS.find((p) => p.name === name);
  if (!preset) throw new NotFoundError(`Theme not found: ${name}`);
  return prisma.theme.upsert({
    where: { name },
    update: {},
    create: { name: preset.name, tokens: preset.tokens, isDefault: preset.isDefault ?? false },
  });
}

/**
 * Config keys whose value is an Attachment id that may be served publicly via
 * `GET /api/system/branding/:key`. Restricting the set keeps this unauthenticated
 * route from exposing arbitrary attachments referenced by other config.
 */
const PUBLIC_BRANDING_KEYS = new Set<string>([
  CONFIG_KEYS.COMPANY_LOGO,
  CONFIG_KEYS.APP_ICON,
  CONFIG_KEYS.LOGIN_BACKGROUND,
  CONFIG_KEYS.EMAIL_BRAND_LOGO,
]);

/** Public URL for a branding image config key, or null when it's unset. */
function brandingUrl(key: string, attachmentId: string): string | null {
  if (!attachmentId) return null;
  if (attachmentId.startsWith('/') || attachmentId.startsWith('http')) {
    return attachmentId;
  }
  return `/api/system/branding/${key}?v=${encodeURIComponent(attachmentId)}`;
}

/** GET /api/system/bootstrap — public app bootstrap (theme + branding). */
export async function bootstrap(_req: Request, res: Response): Promise<Response> {
  const [companyName, appIconId, companyLogoId, loginBackgroundId, defaultThemeName, themes, sidebarLogoWidth, sidebarLogoHeight] = await Promise.all([
    configService.getString(CONFIG_KEYS.COMPANY_NAME, 'AgnoHire'),
    configService.getString(CONFIG_KEYS.APP_ICON, ''),
    configService.getString(CONFIG_KEYS.COMPANY_LOGO, ''),
    configService.getString(CONFIG_KEYS.LOGIN_BACKGROUND, ''),
    configService.getString(CONFIG_KEYS.DEFAULT_THEME, 'Arctic'),
    prisma.theme.findMany({ select: { name: true, tokens: true, isDefault: true } }),
    configService.getString(CONFIG_KEYS.SIDEBAR_LOGO_WIDTH, '175'),
    configService.getString(CONFIG_KEYS.SIDEBAR_LOGO_HEIGHT, '50'),
  ]);
  const activeTheme =
    themes.find((t) => t.name === defaultThemeName) ??
    themes.find((t) => t.isDefault) ??
    themes[0] ??
    null;
  // Stable public URLs; the attachment id in the query busts the cache on replace.
  // Null when unset (clients fall back to the company initial).
  const appIcon = brandingUrl(CONFIG_KEYS.APP_ICON, appIconId);
  const companyLogo = brandingUrl(CONFIG_KEYS.COMPANY_LOGO, companyLogoId);
  const loginBackground = brandingUrl(CONFIG_KEYS.LOGIN_BACKGROUND, loginBackgroundId);
  return ok(res, { companyName, appIcon, companyLogo, loginBackground, defaultThemeName, activeTheme, themes, sidebarLogoWidth, sidebarLogoHeight });
}

/** GET /api/system/branding/:key — public branding image (e.g. company logo). */
export async function brandingImage(req: Request, res: Response): Promise<Response | void> {
  const key = req.params.key;
  if (!PUBLIC_BRANDING_KEYS.has(key)) throw new NotFoundError('Not found');
  const attachmentId = (req.query.v as string) || await configService.getString(key as ConfigKey, '');
  if (!attachmentId) throw new NotFoundError('Not found');

  const { fileName, mimeType, buffer } = await getPublicAttachmentFile(attachmentId);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
  // Immutable: the URL carries the attachment id, so a new logo gets a new URL.
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buffer);
}

/** GET /api/system/maintenance-active — current/upcoming maintenance window, if any. Any authenticated user. */
export async function maintenanceActive(_req: Request, res: Response): Promise<Response> {
  return ok(res, await getActiveOrUpcomingMaintenance());
}

/** GET /api/system/config — list non-secret config (secrets masked). Admin only. */
export async function listConfig(req: Request, res: Response): Promise<Response> {
  // Config is layered: platform defaults (tenantId NULL) + per-tenant overrides.
  // A raw tenant-scoped query would return only this tenant's own override rows
  // (none for a fresh tenant), so the page looked empty for tenant admins. Read
  // all rows cross-tenant, then resolve the EFFECTIVE row per (key, sectorId)
  // for the caller's tenant: their override if present, else the platform
  // default. Other tenants' overrides are never exposed.
  const tenantId = getTenantContext()?.tenantId ?? null;
  // Must await INSIDE runAsPlatform so the query executes while the bypass
  // context is active — a lazily-returned PrismaPromise would otherwise run
  // back under the caller's tenant scope and return nothing for a fresh tenant.
  const all = await runAsPlatform(async () =>
    prisma.systemConfiguration.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] }),
  );
  const effective = new Map<string, (typeof all)[number]>();
  for (const r of all) {
    const isGlobalSetting =
      r.key === 'general.app_icon' ||
      r.key === 'general.company_logo' ||
      r.key === 'general.sidebar_logo_width' ||
      r.key === 'general.sidebar_logo_height' ||
      r.key === 'general.login_background' ||
      r.key.startsWith('security.');
    const targetTenantId = isGlobalSetting ? null : tenantId;
    const rTenant = (r as { tenantId?: string | null }).tenantId ?? null;
    if (rTenant !== null && rTenant !== targetTenantId) continue;
    // AI provider credentials never cascade from the platform's own row to a
    // real tenant that hasn't configured its own (see configService.ts's
    // resolveRow()) — the same exclusion applies here, since this endpoint
    // reads SystemConfiguration directly rather than through resolveRow().
    // A caller with no tenant at all (the superadmin at the platform level)
    // still sees the platform row normally — that's their own config.
    if (TENANT_EXCLUSIVE_KEYS.has(r.key) && tenantId && rTenant === null) continue;
    const k = `${r.key}|${r.sectorId ?? ''}`;
    const cur = effective.get(k);
    if (!cur || (rTenant === targetTenantId && ((cur as { tenantId?: string | null }).tenantId ?? null) === null)) {
      effective.set(k, r);
    }
  }
  const rows = [...effective.values()];
  const isPlatformSuperAdmin = req.user?.role === ROLES.SUPERADMIN;
  const filteredRows = rows.filter((r) => {
    // Security and rate-limit settings are restricted to platform superadmins;
    // general branding is editable per tenant. Rate limits stay tenant-scoped
    // (each tenant can still have its own override for mass-hiring tuning) —
    // this only gates who can see/change them, not who they apply to.
    if ((r.category === 'SECURITY' || r.category === 'RATE_LIMIT') && !isPlatformSuperAdmin) return false;
    // Onboarding required-docs list and the offer expiry reminder threshold
    // are platform-operator-only knobs — hide the rows entirely rather than
    // relying on the client to not render them.
    if (
      (r.key === CONFIG_KEYS.ONBOARDING_REQUIRED_DOCUMENTS || r.key === CONFIG_KEYS.OFFER_REMINDER_DAYS_BEFORE) &&
      !isPlatformSuperAdmin
    ) return false;
    return true;
  });
  const sanitized = filteredRows.map((r) => ({
    id: r.id,
    key: r.key,
    category: r.category,
    label: r.label,
    description: r.description,
    dataType: r.dataType,
    isSecret: r.isSecret,
    sectorId: r.sectorId,
    // Never return secret plaintext; signal whether a value is set.
    value: r.isSecret ? (r.value ? '••••••••' : '') : r.value,
    hasValue: Boolean(r.value),
    updatedAt: r.updatedAt,
  }));
  return ok(res, { config: sanitized });
}

/** PUT /api/system/config/:key — update a config value. Admin only. */
export async function updateConfig(req: Request, res: Response): Promise<Response> {
  const key = req.params.key as ConfigKey;
  const { value } = req.body as { value: string };
  // Validate against the platform-default row (tenantId NULL), read cross-tenant.
  // A tenant-scoped lookup would 404 for any tenant that has not yet created an
  // override, so tenant admins could never save. configService.set() then
  // writes/updates the caller tenant's own override row.
  const existingRow = await runAsPlatform(async () =>
    prisma.systemConfiguration.findFirst({ where: { key, sectorId: null, tenantId: null } }),
  );
  // A key can be added to CONFIG_SEEDS after this environment's database was
  // last seeded (`npm run db:seed` only runs once, not on every deploy),
  // leaving no platform-default row for it yet — configService.set() below
  // self-heals that row on write, but this validation ran BEFORE that self-heal
  // ever got a chance to fire, so a legitimately known key would 404 forever.
  // Fall back to CONFIG_SEEDS itself so this check can't outlive the DB.
  const seed = CONFIG_SEEDS.find((s) => s.key === key);
  if (!existingRow && !seed) throw new NotFoundError(`Unknown config key: ${key}`);
  const existing = existingRow ?? seed!;

  const isGlobalSetting =
    key === 'general.app_icon' ||
    key === 'general.company_logo' ||
    key === 'general.sidebar_logo_width' ||
    key === 'general.sidebar_logo_height' ||
    key === 'general.login_background' ||
    key.startsWith('security.');

  // Rate limits are restricted to SUPERADMIN too, but — unlike the global
  // settings above — they stay tenant-scoped: configService.set() below still
  // writes to the caller's own tenant override row (or the platform default,
  // when a SUPERADMIN edits without impersonating a tenant). Only the ROLE
  // gate changes; per-tenant rate-limit tuning for mass-hiring drives is
  // preserved.
  // Same pattern as RATE_LIMIT: stays tenant-scoped in storage, but only a
  // platform SUPERADMIN may view/edit it (client hides these two rows from
  // everyone else — this is the enforcement backing that UI restriction).
  const isSuperAdminOnly =
    isGlobalSetting ||
    existing.category === 'RATE_LIMIT' ||
    key === CONFIG_KEYS.ONBOARDING_REQUIRED_DOCUMENTS ||
    key === CONFIG_KEYS.OFFER_REMINDER_DAYS_BEFORE;

  if (isSuperAdminOnly && req.user!.role !== ROLES.SUPERADMIN) {
    throw new BadRequestError(`Editing ${key} is restricted to platform super administrators.`);
  }

  await configService.set(key, String(value ?? ''), { updatedById: req.user!.sub });
  // Rebuild the cached SMTP transporter when any email setting changes.
  if (key.startsWith('email.')) resetMailer();
  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'SystemConfiguration',
    // `existing` may be a CONFIG_SEEDS entry (no real row/id yet) the first
    // time a newly-added key is saved — configService.set() just created the
    // row above, but its generated id isn't available here without a second
    // lookup, so fall back to the key itself as the audit reference.
    entityId: 'id' in existing ? existing.id : key,
    description: `Updated config ${key}`,
    oldValue: existing.isSecret ? '••••' : existing.value,
    newValue: existing.isSecret ? '••••' : value,
  });
  return ok(res, { updated: true });
}

/** POST /api/system/email/test — verify SMTP and optionally send a test email. Admin only. */
export async function testEmail(req: Request, res: Response): Promise<Response> {
  const { to } = (req.body ?? {}) as { to?: string };
  const verify = await verifyMailer();
  if (verify.skipped === 'not-configured') {
    throw new BadRequestError('SMTP is not configured. Set the email.* settings first.');
  }
  if (!verify.sent) {
    return ok(res, { verified: false, error: verify.error });
  }
  if (!to) return ok(res, { verified: true, sent: false });

  const result = await sendMail({
    to,
    subject: 'AgnoHire SMTP test',
    html: '<p>This is a test email from AgnoHire. Your SMTP configuration is working. ✅</p>',
  });
  await recordAudit(req, {
    action: 'CREATE',
    entity: 'SystemConfiguration',
    entityId: 'email.test',
    description: `Sent SMTP test email to ${to}`,
  });
  return ok(res, { verified: true, sent: result.sent, error: result.error });
}

/** POST /api/system/calendar/test — verify Google Calendar credentials. Admin only. */
export async function testCalendar(req: Request, res: Response): Promise<Response> {
  const result = await testCalendarConnection(req.user!.sectorId ?? null);
  await recordAudit(req, {
    action: 'CREATE',
    entity: 'SystemConfiguration',
    entityId: 'integrations.google_calendar.test',
    description: `Tested Google Calendar connection (${result.ok ? 'ok' : 'failed'})`,
  });
  return ok(res, result);
}

/** GET /api/system/themes — list themes. */
export async function listThemes(_req: Request, res: Response): Promise<Response> {
  const themes = await prisma.theme.findMany();
  return ok(res, { themes });
}

/** PUT /api/system/themes/:name — update tokens and broadcast live. Admin only. */
export async function updateTheme(req: Request, res: Response): Promise<Response> {
  const { name } = req.params;
  const { tokens } = req.body as { tokens: Record<string, string> };
  const theme = await resolveTheme(name);

  const updated = await prisma.theme.update({
    where: { name },
    data: { tokens },
  });
  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'Theme',
    entityId: theme.id,
    description: `Updated theme ${name}`,
  });

  // If this is the active default theme, push live to all clients.
  const defaultThemeName = await configService.getString(CONFIG_KEYS.DEFAULT_THEME, 'Lumen');
  if (name === defaultThemeName) {
    broadcastThemeUpdate(tokens);
  }
  return ok(res, { theme: updated });
}

/** PUT /api/system/active-theme — set the default theme and broadcast. Admin only. */
export async function setActiveTheme(req: Request, res: Response): Promise<Response> {
  const { name } = req.body as { name?: unknown };
  if (typeof name !== 'string' || name.trim() === '') {
    throw new BadRequestError('A theme name is required.');
  }
  const theme = await resolveTheme(name);

  await configService.set(CONFIG_KEYS.DEFAULT_THEME, name, { updatedById: req.user!.sub });
  broadcastThemeUpdate(theme.tokens as Record<string, string>);
  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'Theme',
    entityId: theme.id,
    description: `Set active theme to ${name}`,
  });
  return ok(res, { activeTheme: name });
}

// ─── Connection info (read-only, SUPERADMIN only) ─────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src/controllers -> repo root is three levels up.
const COMPOSE_PATH = path.resolve(__dirname, '../../../docker-compose.yml');

/**
 * Pulls `KEY: "value"` (or unquoted) out of a docker-compose.yml service block
 * by name. Uses index-based slicing rather than a single lookahead regex —
 * `$` combined with the `m` flag matches end-of-*line*, not end-of-string, so
 * a `(?=\r?\n  \S|$)`-style lookahead terminates the block after the very
 * first line instead of at the next top-level key. Handles CRLF (this repo's
 * docker-compose.yml is Windows line-ended). Verified against the real file.
 */
function extractComposeEnv(composeText: string, serviceName: string, envKey: string): string | null {
  const startRe = new RegExp('(^|\\r?\\n)  ' + serviceName + ':\\r?\\n');
  const startMatch = composeText.match(startRe);
  if (!startMatch) return null;
  const blockStart = startMatch.index! + startMatch[0].length;
  const rest = composeText.slice(blockStart);
  const nextTopLevelKeyRe = /\r?\n {2}\S/;
  const nextMatch = rest.match(nextTopLevelKeyRe);
  const block = nextMatch ? rest.slice(0, nextMatch.index) : rest;
  const envRe = new RegExp(envKey + ':\\s*"?([^"\\r\\n]+)"?');
  const m = block.match(envRe);
  return m ? m[1].trim() : null;
}

function extractPostgresCommandArg(composeText: string, flag: string): string | null {
  const flagRe = new RegExp('"-c",\\s*"' + flag + '=([^"]+)"');
  const m = composeText.match(flagRe);
  return m ? m[1] : null;
}

/** Parses connection_limit / pool_timeout query params off this process's own DATABASE_URL. */
function parseAppPoolParams(databaseUrl: string): { connectionLimit: string | null; poolTimeout: string | null } {
  try {
    const u = new URL(databaseUrl);
    return {
      connectionLimit: u.searchParams.get('connection_limit'),
      poolTimeout: u.searchParams.get('pool_timeout'),
    };
  } catch {
    return { connectionLimit: null, poolTimeout: null };
  }
}

/**
 * GET /api/system/connection-info — read-only visibility into DB connection
 * capacity (Postgres + PgBouncer + this app's own pool). SUPERADMIN only.
 *
 * Deliberately read-only: changing any of this requires editing
 * docker-compose.yml/.env and restarting the Postgres/PgBouncer containers —
 * a deploy-time infra action, not something a web request should ever trigger.
 * "live" values are queried from the running Postgres server right now;
 * "configured" values are read from docker-compose.yml on disk and reflect
 * what's checked into the repo, which may differ from a live server if it
 * hasn't been restarted since the file last changed.
 */
export async function connectionInfo(req: Request, res: Response): Promise<Response> {
  if (req.user!.role !== ROLES.SUPERADMIN) {
    throw new ForbiddenError('Connection settings are visible to platform super administrators only.');
  }

  // current_setting() over SHOW/pg_settings.setting: SHOW's result column is
  // named after the GUC itself (would need hardcoding per setting), and
  // pg_settings.setting returns shared_buffers in raw 8kB-page units (e.g.
  // "32768") rather than the human-readable "256MB" everything else displays.
  // current_setting() returns the same formatted string SHOW prints.
  const [liveRow] = await prisma.$queryRaw<{ max_connections: string; shared_buffers: string }[]>`
    SELECT current_setting('max_connections') AS max_connections, current_setting('shared_buffers') AS shared_buffers
  `;

  let compose: {
    postgresMaxConnections: string | null;
    postgresSharedBuffers: string | null;
    pgbouncerDefaultPoolSize: string | null;
    pgbouncerReservePoolSize: string | null;
    pgbouncerReservePoolTimeout: string | null;
    pgbouncerMaxClientConn: string | null;
    pgbouncerQueryWaitTimeout: string | null;
    pgbouncerServerIdleTimeout: string | null;
    pgbouncerServerLifetime: string | null;
  } | null = null;
  try {
    const composeText = fs.readFileSync(COMPOSE_PATH, 'utf-8');
    compose = {
      postgresMaxConnections: extractPostgresCommandArg(composeText, 'max_connections'),
      postgresSharedBuffers: extractPostgresCommandArg(composeText, 'shared_buffers'),
      pgbouncerDefaultPoolSize: extractComposeEnv(composeText, 'pgbouncer', 'DEFAULT_POOL_SIZE'),
      pgbouncerReservePoolSize: extractComposeEnv(composeText, 'pgbouncer', 'RESERVE_POOL_SIZE'),
      pgbouncerReservePoolTimeout: extractComposeEnv(composeText, 'pgbouncer', 'RESERVE_POOL_TIMEOUT'),
      pgbouncerMaxClientConn: extractComposeEnv(composeText, 'pgbouncer', 'MAX_CLIENT_CONN'),
      pgbouncerQueryWaitTimeout: extractComposeEnv(composeText, 'pgbouncer', 'QUERY_WAIT_TIMEOUT'),
      pgbouncerServerIdleTimeout: extractComposeEnv(composeText, 'pgbouncer', 'SERVER_IDLE_TIMEOUT'),
      pgbouncerServerLifetime: extractComposeEnv(composeText, 'pgbouncer', 'SERVER_LIFETIME'),
    };
  } catch (err) {
    // Not fatal — e.g. a production deploy that doesn't ship docker-compose.yml
    // alongside the running container. Live Postgres values above still work.
    logger.warn('connectionInfo: could not read docker-compose.yml for configured PgBouncer values', {
      err: (err as Error).message,
    });
  }

  const appPool = parseAppPoolParams(env.databaseUrl);

  return ok(res, {
    live: {
      postgresMaxConnections: liveRow?.max_connections ?? null,
      postgresSharedBuffers: liveRow?.shared_buffers ?? null,
    },
    configured: compose,
    appPool,
    note: 'Read-only. Changing these requires editing docker-compose.yml/.env and restarting the Postgres/PgBouncer containers.',
  });
}
