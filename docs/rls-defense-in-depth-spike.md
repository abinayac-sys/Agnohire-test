# RLS Defense-in-Depth — Spike Findings (2026-07-08)

Goal: add PostgreSQL Row-Level Security so tenant isolation is enforced by the
database itself, as a backstop to the application-level Prisma choke-point
middleware (`server/src/config/database.ts`). If a future query forgets to
scope by `tenantId`, RLS still prevents cross-tenant leakage.

## Verified: the mechanism works (proof-of-concept, run against real data, rolled back)

Inside a rolled-back transaction on the live `Candidate` table:

| Scenario | Result |
|---|---|
| Privileged role (current app user) | sees all 8 tenants — RLS bypassed |
| Restricted role scoped to one tenant via GUC | sees only that tenant's rows |
| Restricted role, explicit `WHERE tenantId = <other>` | 0 rows (DB blocks it) |
| Restricted role, no tenant GUC set | 0 rows (fails closed) |

## BLOCKER: the app connects as a privileged role

The app's `DATABASE_URL` user is `agnohire`, which is `rolsuper = t`,
`rolbypassrls = t`, **and** owns every table. RLS is bypassed for
superusers, `BYPASSRLS` roles, and (without `FORCE`) table owners — so simply
enabling RLS today would be a silent no-op. **Do not enable RLS until the app
uses a restricted role**, or isolation will appear "on" while providing nothing.

## Required work (in order)

1. **Create a restricted application role** (one-time infra):
   ```sql
   CREATE ROLE agnohire_app LOGIN PASSWORD '<secret>' NOSUPERUSER NOBYPASSRLS;
   GRANT USAGE ON SCHEMA public TO agnohire_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO agnohire_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agnohire_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agnohire_app;
   ```
   Keep `agnohire` (owner/superuser) for migrations only.

2. **Repoint `DATABASE_URL`** to `agnohire_app`. Migrations run under a separate
   owner connection (Prisma migrate uses its own URL, or run manually as owner).

3. **Thread the tenant GUC into every request's transaction.** RLS reads a
   per-connection setting; because Prisma pools connections, it must be set
   per-transaction with `SET LOCAL`. Wire it at the same choke point that
   already injects `tenantId` (`database.ts`): wrap tenant-scoped work in an
   interactive transaction and issue
   `SELECT set_config('app.tenant_id', $tenantId, true)` as the first statement.
   The platform-superadmin `bypass` path sets a sentinel / uses a role that the
   policy's `USING` clause permits.

4. **Enable RLS + policies on all tenant tables** (the `TENANT_MODELS` set in
   `database.ts`). Per table:
   ```sql
   ALTER TABLE "<T>" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "<T>" FORCE ROW LEVEL SECURITY;  -- so the owner is covered too
   CREATE POLICY tenant_isolation ON "<T>"
     USING ("tenantId" = current_setting('app.tenant_id', true))
     WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
   ```
   Carve-outs needed:
   - **Nullable `tenantId`** (public/legacy token rows): policy must allow
     `"tenantId" IS NULL` reads on the public pass-through paths, or those flows
     break.
   - **PLATFORM_SUPERADMIN / legacy SUPERADMIN bypass**: either connect those
     support operations as a `BYPASSRLS` role, or add a policy branch that
     opens up when a `app.bypass` GUC is set.

## Risk / rollout

- Staged: ship the restricted role + GUC wiring first (no behavior change while
  RLS is still off), verify the app works, THEN enable RLS table-by-table.
- Each `ENABLE ... FORCE` is instantly reversible with `DISABLE ROW LEVEL SECURITY`.
- Highest-risk step is #3 (transaction wrapping) — it touches the hot path for
  every authenticated request; needs load/latency verification.

## Execution status (2026-07-08)

- **Phase 1 DONE** — `agnohire_app` restricted role (migration
  `20260708130000_rls_phase1_restricted_role`); env split (`DATABASE_URL` = app
  role, `DIRECT_URL` = owner) via datasource `directUrl`.
- **Phase 2 DONE** — GUC-setting Prisma extension + `tenantTransaction` helper in
  `config/database.ts`; all 30 `$transaction` sites routed through it. Verified
  live: scoped reads/writes and transactions work through the restricted role.
- **Phase 3 DONE** — 31 `tenant_isolation` policies (migration
  `20260708140000_rls_phase3_policies`), inert until enabled.
- **Phase 4 DONE** — RLS ENABLED + FORCED on **all 31 TENANT_MODELS**
  (migrations `20260708150000_rls_phase4_enable_candidate` for Candidate first,
  then `20260708160000_rls_phase4_enable_remaining` for the rest). Verified live
  as `agnohire_app`: fail-closed with no GUC, own-tenant-only when scoped,
  explicit cross-tenant reads return 0, bypass sees all. Full app smoke test with
  a real login token passed: login (User RLS + pre-auth bypass), /me, candidates,
  jobs, interviews, assessments, notifications, admin/users (4 rows), offers,
  analytics/dashboard, question-banks all 200; candidate create → 201 (WITH CHECK).

### Context-less access paths wired for bypass (prerequisite for User/Attachment)
- **Login / OAuth / refresh** (`auth.controller`, `passport`) — pre-auth User
  lookup by globally-unique email wrapped in `runAsPlatform`.
- **Admin user-create dedup** (`adminUserService`) — global email check bypasses.
- **Public/id-based attachment serving** (`attachmentService`
  `getPublicAttachmentFile`, `getAttachmentBytesById`) — bypass.
- Already-correct before this work: tenant provisioning, maintenance jobs,
  configService (all use `runAsPlatform`); Bull workers (`runJobInTenant`);
  public interview/assessment routes (`publicTenantScope` sets context).

## Execution plan (code-grounded, 2026-07-08)

Two facts from the codebase make this low-blast-radius:
- Every DB call imports one shared `prisma` from `config/database.ts` (55 sites)
  → the GUC wiring lives in ONE place, no call-site edits.
- Tenant context is ALREADY set on all paths: authenticated in
  `auth.middleware.ts` (`runWithTenant`), public token routes in
  `publicTenantScope.middleware.ts` (`runWithTenant` after resolving the token).
  So the ALS tenant id the DB needs is present even on the anonymous surface.

Ship in phases; each is independently reversible and RLS stays OFF until Phase 4.

### Phase 1 — Restricted DB role (infra, no app behavior change)
- Migration (run as owner) creating `agnohire_app` LOGIN NOSUPERUSER NOBYPASSRLS
  with CRUD grants + default privileges (see SQL above).
- Keep `agnohire` (superuser/owner) for running migrations only.
- Add a second env var, e.g. `DATABASE_URL` (app, = agnohire_app) and
  `DIRECT_DATABASE_URL` / `MIGRATE_DATABASE_URL` (= agnohire owner) so
  `prisma migrate` uses the owner and the running app uses the restricted role.
- Verify: app boots and works normally as `agnohire_app` with RLS still OFF.

### Phase 2 — GUC wiring in the choke point (no RLS yet, so still a no-op)
- Add a Prisma Client Extension in `config/database.ts` wrapping every op:
  ```ts
  export const prisma = base.$extends({
    query: { $allModels: { async $allOperations({ args, query }) {
      const ctx = getTenantContext();
      // no context (boot/workers) -> run unwrapped
      if (!ctx) return query(args);
      const [, result] = await base.$transaction([
        base.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
                                set_config('app.bypass', ${ctx.bypass ? 'on' : 'off'}, true)`,
        query(args),
      ]);
      return result;
    }}},
  });
  ```
  `SET LOCAL`/`set_config(..., true)` is transaction-scoped → pool-safe.
- Keep the existing `$use` soft-delete + tenancy middleware (runs inside the
  wrapped query, unchanged).
- Verify: unchanged behavior; inspect that `app.tenant_id` is set per request.

### Phase 3 — Policies defined but RLS not yet enforced
- Migration adding, for each model in `TENANT_MODELS` (database.ts:94):
  ```sql
  CREATE POLICY tenant_isolation ON "<T>" USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenantId" = current_setting('app.tenant_id', true)
    OR ("tenantId" IS NULL)               -- legacy/global rows
  ) WITH CHECK ( ... same ... );
  ```
  Note: policies are inert until RLS is enabled in Phase 4.

### Phase 4 — Enable + FORCE RLS, one table at a time
- Per table: `ALTER TABLE "<T>" ENABLE ROW LEVEL SECURITY; ... FORCE ...;`
- Roll out Candidate first, soak, then the rest. Each is instantly reversible
  with `DISABLE ROW LEVEL SECURITY`.
- Verify live per table: cross-tenant read returns 0; own-tenant works; public
  token flow (anonymous) still resolves its interview/assessment.

### Risks / watch-items
- **External transaction pooler (PgBouncer transaction mode)** breaks session
  GUCs — but `set_config(..., true)` is transaction-local so it's safe there;
  confirm prod isn't in *statement* mode. Direct Postgres (current docker) is fine.
- **Per-query transaction overhead**: each op becomes a 2-statement tx. Measure
  latency on hot endpoints; if needed, later optimize to one tx per request.
- **`bypass` GUC** must only ever be settable from server-derived context
  (it already is — ALS is set from the verified JWT, never client input).

Related: the app-level isolation and the constraint audit that motivated this —
see memory `tenant-unique-constraints`.
