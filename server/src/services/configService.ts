import { prisma } from '../config/database.js';
import { decrypt, encrypt, isEncrypted } from '../config/encryption.js';
import { logger } from '../config/logger.js';
import { getTenantContext, runAsPlatform } from '../config/tenantContext.js';
import { CONFIG_DATA_TYPE, CONFIG_KEYS, CONFIG_SEEDS, type ConfigKey } from '@agnohire/shared';

interface CachedRow {
  value: string;
  dataType: string;
  isSecret: boolean;
}

/** AI provider identity/credentials — see resolveRow()'s no-platform-fallback
 * branch for why these (and only these) never cascade from the platform row
 * down to a tenant that hasn't configured its own. Exported so listConfig()
 * (system.controller.ts) can apply the identical exclusion to what it shows
 * a tenant admin — it reads SystemConfiguration rows directly rather than
 * through resolveRow(), so it needs its own copy of this rule. */
export const TENANT_EXCLUSIVE_KEYS = new Set<string>([
  CONFIG_KEYS.AI_PROVIDER_TYPE,
  CONFIG_KEYS.OPENAI_API_KEY,
  CONFIG_KEYS.OPENAI_BASE_URL,
  CONFIG_KEYS.OPENAI_MODEL,
]);

/**
 * Reads all application settings from the SystemConfiguration table.
 * Global rows (sectorId = null) are the base; a sector-scoped row overrides
 * the global one for that sector. Secret values are stored AES-256-GCM
 * encrypted and decrypted on read. Cached in-process with a short TTL and
 * invalidated on write.
 */
class ConfigService {
  private cache = new Map<string, CachedRow>();
  private loadedAt = 0;
  private readonly ttlMs = 30_000;

  /**
   * Sync-readable mirror of the global `security.cross_sector_visibility` flag,
   * refreshed on every reload(). Scope helpers are synchronous and run inside
   * Prisma `where` builders, so they can't await a config read — they consult
   * this cached value instead. Defaults to `false` (strict isolation) until the
   * first load (app.ts reloads config before serving requests, so the warm
   * value is what actually applies at request time). Persists across
   * invalidate() so an unrelated config write never briefly flips it.
   */
  private crossSectorVisibility = false;

  /** Dedupes concurrent reload() calls (e.g. several requests all missing the
   *  cache the instant the TTL expires) onto ONE in-flight load, so they can't
   *  race on this.cache.clear() — without this, a request's resolveRow() could
   *  land between one reload's clear() and its repopulation and see an empty
   *  cache, plus every one of those callers redundantly hits the DB. */
  private reloadPromise: Promise<void> | null = null;

  private cacheKey(key: string, sectorId: string | null, tenantId: string | null = null): string {
    return `${key}::${tenantId ?? 'platform'}::${sectorId ?? 'global'}`;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.cache.size && Date.now() - this.loadedAt < this.ttlMs) return;
    await this.reload();
  }

  async reload(): Promise<void> {
    if (this.reloadPromise) return this.reloadPromise;

    this.reloadPromise = (async () => {
      try {
        // Load ALL rows (platform defaults + every tenant's overrides) outside any
        // tenant scope; resolution picks the right layer per read.
        const rows = await runAsPlatform(async () => await prisma.systemConfiguration.findMany());
        this.cache.clear();
        for (const r of rows) {
          const tenantId = (r as { tenantId?: string | null }).tenantId ?? null;
          this.cache.set(this.cacheKey(r.key, r.sectorId, tenantId), {
            value: r.value,
            dataType: r.dataType,
            isSecret: r.isSecret,
          });
        }
        this.loadedAt = Date.now();
        // Refresh the sync-readable access flag from the freshly loaded cache.
        const row = this.resolveRow(CONFIG_KEYS.CROSS_SECTOR_VISIBILITY, null);
        this.crossSectorVisibility = row ? row.value === 'true' || row.value === '1' : false;
        logger.debug(`ConfigService loaded ${rows.length} settings`);
      } finally {
        this.reloadPromise = null;
      }
    })();

    await this.reloadPromise;
  }

  /**
   * Synchronous read of the cross-sector-visibility flag (see field doc).
   * When true, every authenticated staff user sees all data regardless of
   * sector; when false, per-sector isolation applies.
   */
  crossSectorVisibilityEnabled(): boolean {
    return this.crossSectorVisibility;
  }

  invalidate(): void {
    this.loadedAt = 0;
    this.cache.clear();
  }

  private resolveRow(
    key: string,
    sectorId: string | null,
  ): CachedRow | undefined {
    // Effective config = merge(platform defaults, tenant overrides, sector
    // overrides): tenant+sector → tenant global → platform sector → platform.
    const isGlobalSetting =
      key === 'general.app_icon' ||
      key === 'general.company_logo' ||
      key === 'general.sidebar_logo_width' ||
      key === 'general.sidebar_logo_height' ||
      key === 'general.login_background' ||
      key.startsWith('security.') ||
      // Rate limiting is enforced by middleware mounted BEFORE tenant context
      // is established (auth.middleware sets it later, per-route), so a
      // per-tenant override could never actually be read at enforcement time —
      // it would silently write a dead row instead of taking effect. Force
      // every rate_limit.* read/write to the one platform-default row that's
      // actually enforced, so there's no illusion of a working per-tenant knob.
      key.startsWith('rate_limit.');
    const tenantId = isGlobalSetting ? null : (getTenantContext()?.tenantId ?? null);
    if (tenantId) {
      if (sectorId) {
        const ts = this.cache.get(this.cacheKey(key, sectorId, tenantId));
        if (ts) return ts;
      }
      const t = this.cache.get(this.cacheKey(key, null, tenantId));
      if (t) return t;
      // AI provider credentials are the tenant's own — the platform's own
      // key/base URL/model is never an implicit fallback for a real tenant
      // (unlike every other setting's platform-default cascade). Without
      // this, a brand-new tenant with no key of its own would silently read
      // — and its AI calls would silently run under — whatever the platform
      // superadmin has configured for themselves, and AgnoHire would be on
      // the hook for usage that's really the tenant's own provider account.
      // A caller with NO tenant context at all (the superadmin operating at
      // the platform level, not impersonating any tenant) still reads/writes
      // the platform row normally — that's their own config, not a fallback.
      if (TENANT_EXCLUSIVE_KEYS.has(key)) return undefined;
    }
    if (sectorId) {
      const scoped = this.cache.get(this.cacheKey(key, sectorId, null));
      if (scoped) return scoped;
    }
    return this.cache.get(this.cacheKey(key, null, null));
  }

  /** Raw string value (secrets decrypted). Returns undefined if unset. */
  async getRaw(
    key: ConfigKey,
    sectorId: string | null = null,
  ): Promise<string | undefined> {
    await this.ensureLoaded();
    const row = this.resolveRow(key, sectorId);
    if (!row) return undefined;
    if (row.isSecret && row.value && isEncrypted(row.value)) {
      try {
        return decrypt(row.value);
      } catch (err) {
        logger.error(`Failed to decrypt config ${key}`, { err });
        return undefined;
      }
    }
    return row.value;
  }

  async getString(
    key: ConfigKey,
    fallback = '',
    sectorId: string | null = null,
  ): Promise<string> {
    const v = await this.getRaw(key, sectorId);
    return v === undefined || v === '' ? fallback : v;
  }

  async getNumber(
    key: ConfigKey,
    fallback = 0,
    sectorId: string | null = null,
  ): Promise<number> {
    const v = await this.getRaw(key, sectorId);
    if (v === undefined || v === '') return fallback;
    const n = Number(v);
    return Number.isNaN(n) ? fallback : n;
  }

  async getBool(
    key: ConfigKey,
    fallback = false,
    sectorId: string | null = null,
  ): Promise<boolean> {
    const v = await this.getRaw(key, sectorId);
    if (v === undefined || v === '') return fallback;
    return v === 'true' || v === '1';
  }

  async getJson<T>(
    key: ConfigKey,
    fallback: T,
    sectorId: string | null = null,
  ): Promise<T> {
    const v = await this.getRaw(key, sectorId);
    if (v === undefined || v === '') return fallback;
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Upsert a config value. Secret values are encrypted before storage.
   * Handles the nullable-compound-unique limitation manually.
   */
  async set(
    key: ConfigKey,
    value: string,
    opts: { sectorId?: string | null; updatedById?: string } = {},
  ): Promise<void> {
    const sectorId = opts.sectorId ?? null;
    const isGlobalSetting =
      key === 'general.app_icon' ||
      key === 'general.company_logo' ||
      key === 'general.sidebar_logo_width' ||
      key === 'general.sidebar_logo_height' ||
      key === 'general.login_background' ||
      key.startsWith('security.') ||
      // Rate limiting is enforced by middleware mounted BEFORE tenant context
      // is established (auth.middleware sets it later, per-route), so a
      // per-tenant override could never actually be read at enforcement time —
      // it would silently write a dead row instead of taking effect. Force
      // every rate_limit.* read/write to the one platform-default row that's
      // actually enforced, so there's no illusion of a working per-tenant knob.
      key.startsWith('rate_limit.');
    const tenantId = isGlobalSetting ? null : (getTenantContext()?.tenantId ?? null);

    // Look for this tenant's override first, then the platform-default row
    // (tenantId NULL) which supplies the metadata (isSecret/dataType/label).
    const { existing, template } = await runAsPlatform(async () => {
      let existing = await prisma.systemConfiguration.findFirst({
        where: { key, sectorId, tenantId },
      });
      let template =
        existing ??
        (await prisma.systemConfiguration.findFirst({ where: { key, sectorId: null, tenantId: null } }));

      // A key can be added to CONFIG_SEEDS after this environment's database
      // was last seeded (`npm run db:seed` only runs once, not on every
      // deploy), leaving no platform-default row for it. Self-heal instead of
      // permanently rejecting every write to a key the code knows about: seed
      // the missing platform-default row from CONFIG_SEEDS on first use.
      if (!template) {
        const seed = CONFIG_SEEDS.find((s) => s.key === key);
        if (seed) {
          template = await prisma.systemConfiguration.create({
            data: {
              key: seed.key,
              value: seed.value,
              category: seed.category,
              label: seed.label,
              description: seed.description,
              dataType: seed.dataType,
              isSecret: seed.isSecret ?? false,
              sectorId: null,
              tenantId: null,
            },
          });
          // The row we just seeded IS the requested (sectorId, tenantId)
          // identity when this write targets the global default — treat it
          // as the existing row so the update path below doesn't try to
          // insert a second, colliding row for the same identity.
          if (sectorId === null && tenantId === null) existing = template;
        }
      }
      return { existing, template };
    });
    if (!template) {
      throw new Error(`Unknown configuration key: ${key}`);
    }
    const stored = template.isSecret && value ? encrypt(value) : value;
    await runAsPlatform(async () => {
      if (existing) {
        await prisma.systemConfiguration.update({
          where: { id: existing.id },
          data: { value: stored, updatedById: opts.updatedById ?? null },
        });
      } else {
        // First write for this tenant/sector → create the override row.
        await prisma.systemConfiguration.create({
          data: {
            key,
            value: stored,
            category: template.category,
            label: template.label,
            description: template.description,
            dataType: template.dataType,
            isSecret: template.isSecret,
            sectorId,
            tenantId,
            updatedById: opts.updatedById ?? null,
          },
        });
      }
    });
    this.invalidate();
  }

  /** Whether a feature backed by a secret key is configured (non-empty). */
  async isConfigured(key: ConfigKey, sectorId: string | null = null): Promise<boolean> {
    const v = await this.getRaw(key, sectorId);
    return Boolean(v && v.length);
  }

  /** Gets the provider-agnostic AI configuration. */
  async getAIConfiguration(sectorId: string | null = null) {
    const [enabled, provider, apiKey, baseUrlRaw, model, temperature, maxTokens] = await Promise.all([
      this.getBool(CONFIG_KEYS.AI_ENABLED, true, sectorId),
      this.getString(CONFIG_KEYS.AI_PROVIDER_TYPE, 'openai', sectorId),
      this.getString(CONFIG_KEYS.OPENAI_API_KEY, '', sectorId), // we use this as the generic API key field
      this.getString(CONFIG_KEYS.OPENAI_BASE_URL, 'https://api.openai.com/v1', sectorId),
      this.getString(CONFIG_KEYS.OPENAI_MODEL, 'gpt-4o-mini', sectorId),
      this.getNumber(CONFIG_KEYS.AI_TEMPERATURE, 0.4, sectorId),
      this.getNumber(CONFIG_KEYS.AI_MAX_TOKENS, 1600, sectorId),
    ]);
    return {
      enabled,
      provider: provider.toLowerCase(),
      apiKey,
      baseUrl: baseUrlRaw.replace(/\/+$/, ''),
      model,
      temperature,
      maxTokens,
    };
  }
}

export const configService = new ConfigService();
export { CONFIG_DATA_TYPE };
