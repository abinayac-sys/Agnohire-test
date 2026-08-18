import bcrypt from 'bcrypt';
import {
  ROLES,
  ROLE_DISPLAY_NAMES,
  ALL_ROLES,
  PERMISSION_DEFS,
  DEFAULT_ROLE_PERMISSIONS,
  CONFIG_SEEDS,
  CONFIG_KEYS,
  THEME_PRESETS,
} from '@agnohire/shared';
import { encrypt } from '../src/config/encryption.js';
import { prisma } from '../src/config/database.js';
import { runAsPlatform } from '../src/config/tenantContext.js';

async function seedPermissions() {
  for (const def of PERMISSION_DEFS) {
    await prisma.permission.upsert({
      where: { key: def.key },
      update: { label: def.label, group: def.group },
      create: { key: def.key, label: def.label, group: def.group },
    });
  }
  console.log(`✓ ${PERMISSION_DEFS.length} permissions`);
}

async function seedRoles() {
  for (const name of ALL_ROLES) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { displayName: ROLE_DISPLAY_NAMES[name] },
      create: { name, displayName: ROLE_DISPLAY_NAMES[name] },
    });

    const permKeys = DEFAULT_ROLE_PERMISSIONS[name];
    const perms = await prisma.permission.findMany({
      where: { key: { in: permKeys } },
      select: { id: true },
    });

    // Reset to declared default set (idempotent).
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (perms.length) {
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
  }
  console.log(`✓ ${ALL_ROLES.length} roles with permissions`);
}

async function seedThemes() {
  for (const preset of THEME_PRESETS) {
    await prisma.theme.upsert({
      where: { name: preset.name },
      update: { tokens: preset.tokens, isDefault: preset.isDefault ?? false },
      create: {
        name: preset.name,
        tokens: preset.tokens,
        isDefault: preset.isDefault ?? false,
      },
    });
  }
  console.log(`✓ ${THEME_PRESETS.length} theme presets`);
}

async function seedConfig() {
  // Global config rows have sectorId = null. The @@unique([key, sectorId])
  // compound cannot be used with upsert when sectorId is null, so we
  // findFirst-then-create manually.
  for (const c of CONFIG_SEEDS) {
    const existing = await prisma.systemConfiguration.findFirst({
      where: { key: c.key, sectorId: null },
    });
    if (existing) {
      if (c.key === CONFIG_KEYS.DEFAULT_THEME && existing.value === 'Lumen') {
        await prisma.systemConfiguration.update({
          where: { id: existing.id },
          data: { value: c.value },
        });
      }
      // Rate-limit ceilings: refresh existing rows to the current seed value so
      // mass-hiring capacity changes actually land on already-deployed installs
      // (older installs were seeded at 300 and would otherwise stay there).
      // WINDOW_MS included alongside MAX/INTERVIEW_MAX: a stale low window
      // paired with a freshly-raised max still throttles too aggressively, and
      // unlike `limit` (read live per-request), the window is only re-read
      // when the limiter itself rebuilds — see rateLimiter.middleware.ts.
      if (
        c.key === CONFIG_KEYS.RATE_LIMIT_MAX ||
        c.key === CONFIG_KEYS.RATE_LIMIT_INTERVIEW_MAX ||
        c.key === CONFIG_KEYS.RATE_LIMIT_WINDOW_MS
      ) {
        await prisma.systemConfiguration.update({
          where: { id: existing.id },
          data: { value: c.value },
        });
      }
      // The access-token TTL default was bumped 15 -> 180 minutes, but a
      // pre-existing row keeps its old value forever (this loop only writes
      // `value` on create). Every already-deployed install was seeded at 15,
      // so re-seeding never picked up the new default — users kept getting
      // logged out every 15 minutes. Only refresh rows still sitting at the
      // stale 15 default so a deliberate admin override survives.
      if (c.key === CONFIG_KEYS.ACCESS_TOKEN_TTL_MIN && existing.value === '15') {
        await prisma.systemConfiguration.update({
          where: { id: existing.id },
          data: { value: c.value },
        });
      }
      // Category is metadata, not user data — always safe to refresh, unlike
      // `value` above. Needed for EMAIL_BRAND_* keys moving EMAIL ->
      // EMAIL_BRANDING so already-deployed installs stop showing them
      // duplicated in both the System Config page and the Email Customizer.
      //
      // Fixed on EVERY row for this key, not just the arbitrary one `findFirst`
      // happened to match: a tenant that had already customized one of these
      // values (e.g. via the Email Customizer) owns its own per-tenant
      // override row with the stale category baked in, and listConfig()'s
      // effective-value merge lets that override win over the platform
      // default — so this can't be gated on whether the `existing` row (which
      // could be either the already-fixed platform row or a still-stale
      // tenant row) individually needs it; just always sync every row.
      await prisma.systemConfiguration.updateMany({
        where: { key: c.key, category: { not: c.category } },
        data: { category: c.category },
      });
      continue;
    }
    await prisma.systemConfiguration.create({
      data: {
        key: c.key,
        value: c.value,
        category: c.category,
        label: c.label,
        description: c.description ?? null,
        dataType: c.dataType,
        isSecret: c.isSecret ?? false,
      },
    });
  }
  console.log(`✓ ${CONFIG_SEEDS.length} system configuration defaults`);
}

/**
 * Every seeded principal must belong to a tenant — the fail-closed tenant
 * scoping middleware (config/database.ts) treats a non-bypass principal with
 * tenantId=null as seeing NOTHING. Reuses the canonical Default Tenant created
 * by the SaaS migration backfill (slug 'default'); creates it if this is a
 * from-scratch database that never ran that migration's INSERT.
 */
/**
 * Public plan catalogue (FREE/STARTER/PRO/ENTERPRISE) shown on the
 * registration and billing pages. Separate from the LEGACY_ENTERPRISE plan
 * created below for the pre-SaaS Default Tenant. Internal-only upsert — does
 * NOT create matching Razorpay plans; run
 * `CREATE_RAZORPAY_PLANS=true npm run bootstrap:plans` for that.
 */
async function seedPlanCatalogue() {
  // featuresJson holds short marketing bullets shown on the plan-selection
  // page, layered on top of the structured limits (maxUsers, storageMb, etc.)
  // which remain the source of truth for entitlement enforcement.
  const CATALOGUE = [
    {
      code: 'FREE', name: 'Free', priceMonthly: 0, priceYearly: 0,
      maxUsers: 3, maxInterviewedCandidates: 10, maxActiveJobs: 2, storageMb: 512,
      maxOrganizations: 1, maxWorkspaces: 1,
      aiEnabled: false, proctoringEnabled: false,
      featuresJson: ['Community support'],
    },
    {
      code: 'STARTER', name: 'Starter', priceMonthly: 2999, priceYearly: 29990,
      maxUsers: 10, maxInterviewedCandidates: 100, maxActiveJobs: 10, storageMb: 5120,
      maxOrganizations: 1, maxWorkspaces: 3,
      aiEnabled: true, proctoringEnabled: false,
      featuresJson: ['AI-powered resume scoring', 'Email support'],
    },
    {
      code: 'PRO', name: 'Pro', priceMonthly: 7999, priceYearly: 79990,
      maxUsers: 50, maxInterviewedCandidates: 500, maxActiveJobs: 50, storageMb: 20480,
      maxOrganizations: 3, maxWorkspaces: 10,
      aiEnabled: true, proctoringEnabled: true,
      featuresJson: ['AI-powered resume scoring', 'Proctored interviews', 'Priority support'],
    },
    {
      code: 'ENTERPRISE', name: 'Enterprise', priceMonthly: 24999, priceYearly: 249990,
      maxUsers: null, maxInterviewedCandidates: null, maxActiveJobs: null, storageMb: null,
      maxOrganizations: null, maxWorkspaces: null,
      aiEnabled: true, proctoringEnabled: true,
      featuresJson: ['AI-powered resume scoring', 'Proctored interviews', 'Dedicated account manager', 'Custom integrations'],
    },
  ];

  for (const p of CATALOGUE) {
    await prisma.plan.upsert({ where: { code: p.code }, create: p, update: p });
  }
  console.log(`✓ ${CATALOGUE.length} public plans (FREE/STARTER/PRO/ENTERPRISE)`);
}

async function seedDefaultTenant() {
  let tenant = await prisma.tenant.findUnique({ where: { slug: 'default' } });
  if (!tenant) {
    let plan = await prisma.plan.findUnique({ where: { code: 'LEGACY_ENTERPRISE' } });
    if (!plan) {
      plan = await prisma.plan.create({
        data: { code: 'LEGACY_ENTERPRISE', name: 'Legacy Enterprise (unlimited)', isActive: false },
      });
    }
    tenant = await prisma.tenant.create({
      data: { name: 'Default Tenant', slug: 'default', status: 'ACTIVE', planId: plan.id },
    });
    await prisma.subscription.upsert({
      where: { tenantId: tenant.id },
      update: {},
      create: { tenantId: tenant.id, planId: plan.id, status: 'ACTIVE', provider: 'internal', currentPeriodStart: new Date() },
    });
  }
  console.log(`✓ default tenant (${tenant.slug})`);
  return tenant;
}

async function seedSectorAndDomains(tenantId: string) {
  let org = await prisma.organization.findFirst({ where: { tenantId, slug: 'default' } });
  if (!org) {
    org = await prisma.organization.create({
      data: { tenantId, name: 'Default Organization', slug: 'default' },
    });
  }

  let workspace = await prisma.workspace.findFirst({ where: { tenantId, slug: 'default' } });
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: { tenantId, organizationId: org.id, name: 'Default Workspace', slug: 'default' },
    });
  }

  let sector = await prisma.sector.findFirst({ where: { name: 'Default', tenantId } });
  if (!sector) {
    sector = await prisma.sector.create({
      data: { name: 'Default', type: 'GENERAL', tenantId, organizationId: org.id, workspaceId: workspace.id },
    });
  } else if (!sector.tenantId || !sector.organizationId || !sector.workspaceId) {
    sector = await prisma.sector.update({ where: { id: sector.id }, data: { tenantId, organizationId: org.id, workspaceId: workspace.id } });
  }

  const domainNames = ['Engineering', 'Product', 'Design', 'Data', 'Sales'];
  for (const name of domainNames) {
    const exists = await prisma.domain.findFirst({
      where: { name, sectorId: sector.id },
    });
    if (!exists) {
      await prisma.domain.create({ data: { name, sectorId: sector.id, tenantId, organizationId: org.id, workspaceId: workspace.id } });
    }
  }
  console.log(`✓ default sector + ${domainNames.length} domains`);
  return { sector, orgId: org.id, workspaceId: workspace.id };
}

/**
 * Idempotently seed a user by email, reviving a soft-deleted row if one holds it.
 *
 * `upsert` cannot be used any more: User.email is no longer @unique (it is a
 * partial index over live rows — see the User model), so it is not a valid
 * WhereUniqueInput. That is a good thing, because upsert was ALSO wrong here —
 * the soft-delete middleware does not touch upsert, so a re-seed over a
 * soft-deleted admin would have silently resurrected it through the back door.
 *
 * Look for a live row first, then explicitly for a tombstone (the documented
 * middleware opt-out, `deletedAt: { not: null }`), newest first — the partial
 * index now permits several tombstones to share one email.
 */
async function upsertUserByEmail(
  email: string,
  data: { fullName: string; passwordHash: string; roleId: string; sectorId: string; tenantId: string },
) {
  const live = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  const target =
    live ??
    (await prisma.user.findFirst({
      where: { email, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: { id: true },
    }));

  if (target) {
    return prisma.user.update({
      where: { id: target.id },
      data: { ...data, isActive: true, deletedAt: null },
    });
  }
  return prisma.user.create({ data: { email, ...data, isActive: true } });
}

async function seedDevAdmin(sectorId: string, tenantId: string) {
  if (process.env.NODE_ENV === 'production') {
    console.log('• skipping dev admin (production)');
    return;
  }
  const email = 'admin@agnohire.local';
  const password = 'Admin@12345';
  const role = await prisma.role.findUniqueOrThrow({
    where: { name: ROLES.SUPERADMIN },
  });
  const passwordHash = await bcrypt.hash(password, 12);

  await upsertUserByEmail(email, {
    fullName: 'Super Admin',
    passwordHash,
    roleId: role.id,
    sectorId,
    tenantId,
  });
  console.log(`✓ dev superadmin → ${email} / ${password}`);
}

async function seedDevCandidate(sectorId: string, tenantId: string) {
  if (process.env.NODE_ENV === 'production') {
    console.log('• skipping dev candidate (production)');
    return;
  }
  const email = 'candidate@agnohire.local';
  const password = 'Candidate@12345';
  const role = await prisma.role.findUniqueOrThrow({ where: { name: ROLES.CANDIDATE } });
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await upsertUserByEmail(email, {
    fullName: 'Jordan Candidate',
    passwordHash,
    roleId: role.id,
    sectorId,
    tenantId,
  });

  // A linked candidate profile so candidate portal dashboard features work.
  // Match on the keys the DB actually enforces — the 1:1 user link, or the
  // per-tenant (tenantId, email); email alone is no longer unique. The
  // soft-delete middleware hides deleted rows from reads, so check explicitly
  // for one and revive it: Candidate_userId_key is a *full* unique index, so a
  // soft-deleted profile still occupies its userId and a create would collide.
  const identity = { OR: [{ userId: user.id }, { tenantId, email }] };
  const existing =
    (await prisma.candidate.findFirst({ where: identity })) ??
    (await prisma.candidate.findFirst({ where: { ...identity, deletedAt: { not: null } } }));
  if (existing) {
    await prisma.candidate.update({
      where: { id: existing.id },
      data: { userId: user.id, sectorId, tenantId, deletedAt: null },
    });
  } else {
    await prisma.candidate.create({
      data: {
        userId: user.id,
        email,
        fullName: 'Jordan Candidate',
        sectorId,
        tenantId,
        skills: ['JavaScript', 'React'],
        experienceLevel: 'Mid',
        consentGiven: true,
        consentAt: new Date(),
      },
    });
  }
  console.log(`✓ dev candidate → ${email} / ${password}`);
}

/**
 * Prebuilt starter email templates so the Admin Console → Email Templates page
 * is useful out of the box instead of empty. These are editable content
 * templates (one default per type); the {{placeholders}} are filled by the
 * mailer. Idempotent: seeded by name, never overwrites admin edits.
 */
const EMAIL_TEMPLATE_SEEDS: { name: string; type: string; subject: string; body: string }[] = [
  {
    name: 'Application Received',
    type: 'APPLICATION_RECEIVED',
    subject: "We've received your application for {{jobTitle}}",
    body:
      '<p>Hi {{candidateName}},</p>' +
      '<p>Thank you for applying for the <strong>{{jobTitle}}</strong> role at {{companyName}}. ' +
      "We've received your application and our team is reviewing it.</p>" +
      "<p>We'll be in touch with next steps soon. In the meantime, you can track your application status in your candidate portal.</p>" +
      '<p>Warm regards,<br/>The {{companyName}} Talent Team</p>',
  },
  {
    name: 'Interview Invitation',
    type: 'INTERVIEW_INVITATION',
    subject: 'Interview invitation — {{jobTitle}} at {{companyName}}',
    body:
      '<p>Hi {{candidateName}},</p>' +
      "<p>Great news — we'd like to invite you to interview for the <strong>{{jobTitle}}</strong> position.</p>" +
      '<p><strong>Date:</strong> {{interviewDate}}<br/><strong>Time:</strong> {{interviewTime}}</p>' +
      '<p>Please use the link below to join or to confirm a time that works for you:</p>' +
      '<p><a href="{{interviewLink}}">Join / confirm your interview</a></p>' +
      '<p>Looking forward to speaking with you,<br/>{{recruiterName}}</p>',
  },
  {
    name: 'Interview Reminder',
    type: 'INTERVIEW_REMINDER',
    subject: 'Reminder: your {{companyName}} interview is coming up',
    body:
      '<p>Hi {{candidateName}},</p>' +
      '<p>This is a friendly reminder that your interview for <strong>{{jobTitle}}</strong> is scheduled for ' +
      '<strong>{{interviewDate}} at {{interviewTime}}</strong>.</p>' +
      '<p><a href="{{interviewLink}}">Join the interview</a></p>' +
      '<p>Good luck — we’re rooting for you!<br/>The {{companyName}} Talent Team</p>',
  },
  {
    name: 'Assessment Invitation',
    type: 'ASSESSMENT_INVITATION',
    subject: 'Your {{jobTitle}} assessment is ready',
    body:
      '<p>Hi {{candidateName}},</p>' +
      '<p>As the next step in your application for <strong>{{jobTitle}}</strong>, please complete the short assessment below.</p>' +
      '<p><a href="{{assessmentLink}}">Start your assessment</a></p>' +
      '<p>Please complete it by <strong>{{assessmentDeadline}}</strong>. It should take about {{assessmentDuration}}.</p>' +
      '<p>Best of luck,<br/>{{recruiterName}}</p>',
  },
  {
    name: 'Offer Letter',
    type: 'OFFER',
    subject: "You've got an offer from {{companyName}}!",
    body:
      '<p>Hi {{candidateName}},</p>' +
      "<p>We're delighted to offer you the role of <strong>{{jobTitle}}</strong> at {{companyName}}, " +
      'with a proposed start date of <strong>{{startDate}}</strong>.</p>' +
      '<p>You can review the full details and accept your offer here:</p>' +
      '<p><a href="{{offerLink}}">View and respond to your offer</a></p>' +
      '<p>Please respond by <strong>{{offerExpiry}}</strong>. We can’t wait to welcome you aboard!</p>' +
      '<p>Congratulations,<br/>{{recruiterName}}</p>',
  },
  {
    name: 'Application Not Selected',
    type: 'REJECTION',
    subject: 'Update on your application for {{jobTitle}}',
    body:
      '<p>Hi {{candidateName}},</p>' +
      '<p>Thank you for taking the time to apply for the <strong>{{jobTitle}}</strong> role and for sharing your background with us.</p>' +
      '<p>After careful consideration, we’ve decided to move forward with other candidates for this position. ' +
      'This was a difficult decision and is not a reflection of your talent.</p>' +
      "<p>We'd love to stay in touch — we'll keep your profile on file and encourage you to apply for future roles that match your skills.</p>" +
      '<p>Wishing you all the best,<br/>The {{companyName}} Talent Team</p>',
  },
  {
    name: 'Onboarding Welcome',
    type: 'ONBOARDING_WELCOME',
    subject: 'Welcome to {{companyName}}, {{candidateName}}!',
    body:
      '<p>Hi {{candidateName}},</p>' +
      '<p>Welcome to the team! We’re thrilled to have you join {{companyName}} as <strong>{{jobTitle}}</strong>, ' +
      'starting <strong>{{startDate}}</strong>.</p>' +
      '<p>To help you get set up, please complete your onboarding checklist here:</p>' +
      '<p><a href="{{onboardingLink}}">Open your onboarding checklist</a></p>' +
      '<p>If you have any questions before day one, just reply to this email.</p>' +
      '<p>See you soon,<br/>{{recruiterName}}</p>',
  },
];

async function seedEmailTemplates() {
  let created = 0;
  for (const t of EMAIL_TEMPLATE_SEEDS) {
    const exists = await prisma.emailTemplate.findFirst({ where: { name: t.name } });
    if (exists) continue;
    await prisma.emailTemplate.create({
      data: { name: t.name, type: t.type, subject: t.subject, body: t.body, isDefault: true },
    });
    created++;
  }
  console.log(`✓ ${EMAIL_TEMPLATE_SEEDS.length} email templates (${created} new)`);
}

/**
 * Optional convenience for local/dev setup: if AI settings are present in the
 * environment (the developer's own gitignored .env), write them into the DB
 * config so the app's AI features work without clicking through the Admin
 * Console. The key is encrypted at rest, exactly like the UI path. Secrets are
 * NEVER committed — they only ever live in each developer's local .env + DB.
 *
 *   OPENAI_API_KEY=...        # OpenAI key, or a Gemini/Azure/compatible key
 *   OPENAI_BASE_URL=...       # e.g. https://generativelanguage.googleapis.com/v1beta/openai
 *   OPENAI_MODEL=...          # e.g. gemini-2.5-flash
 */
async function applyAiEnvOverrides() {
  const overrides: { key: string; value: string | undefined; secret?: boolean }[] = [
    { key: CONFIG_KEYS.OPENAI_API_KEY, value: process.env.OPENAI_API_KEY, secret: true },
    { key: CONFIG_KEYS.OPENAI_BASE_URL, value: process.env.OPENAI_BASE_URL },
    { key: CONFIG_KEYS.OPENAI_MODEL, value: process.env.OPENAI_MODEL },
  ];
  let applied = 0;
  for (const o of overrides) {
    if (!o.value) continue;
    const row = await prisma.systemConfiguration.findFirst({
      where: { key: o.key, sectorId: null },
    });
    if (!row) continue;
    await prisma.systemConfiguration.update({
      where: { id: row.id },
      data: { value: o.secret ? encrypt(o.value) : o.value },
    });
    applied++;
  }
  if (applied) console.log(`✓ applied ${applied} AI setting(s) from environment`);
}

/**
 * Optional convenience for local/dev setup: if Google Calendar OAuth credentials
 * are present in the environment, write them into the `integrations.google_*`
 * System Configuration rows (secrets encrypted at rest, exactly like the Admin
 * Console → System Configuration path) so interview scheduling auto-creates
 * Calendar events + Google Meet links without clicking through the UI.
 * Idempotent: runs after seedConfig, so the rows exist and are simply updated.
 * Secrets are NEVER committed — they only live in each dev's local .env + DB.
 *
 *   GOOGLE_CALENDAR_CLIENT_ID / _SECRET   (fall back to GOOGLE_CLIENT_ID/_SECRET)
 *   GOOGLE_CALENDAR_REFRESH_TOKEN         (required to activate)
 *   GOOGLE_CALENDAR_ID                    (optional, defaults to "primary")
 */
async function applyCalendarEnvOverrides() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  // The refresh-token flow (used by calendarService) needs all three.
  if (!refreshToken || !clientId || !clientSecret) {
    // If the teammate pasted *some* values but not the full set, say what's
    // missing so they aren't left wondering why scheduling still doesn't sync.
    if (refreshToken || process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CALENDAR_CLIENT_SECRET) {
      const missing = [
        !clientId && 'GOOGLE_CALENDAR_CLIENT_ID (or GOOGLE_CLIENT_ID)',
        !clientSecret && 'GOOGLE_CALENDAR_CLIENT_SECRET (or GOOGLE_CLIENT_SECRET)',
        !refreshToken && 'GOOGLE_CALENDAR_REFRESH_TOKEN',
      ].filter(Boolean);
      console.log(`⚠ Google Calendar not activated — missing: ${missing.join(', ')}`);
    }
    return;
  }

  const setConfig = async (key: string, value: string, secret = false) => {
    const row = await prisma.systemConfiguration.findFirst({ where: { key, sectorId: null } });
    if (!row) return;
    await prisma.systemConfiguration.update({
      where: { id: row.id },
      data: { value: secret ? encrypt(value) : value },
    });
  };

  await setConfig(CONFIG_KEYS.GOOGLE_CALENDAR_ENABLED, 'true');
  await setConfig(CONFIG_KEYS.GOOGLE_CLIENT_ID, clientId);
  await setConfig(CONFIG_KEYS.GOOGLE_CLIENT_SECRET, clientSecret, true);
  await setConfig(CONFIG_KEYS.GOOGLE_REFRESH_TOKEN, refreshToken, true);
  await setConfig(CONFIG_KEYS.GOOGLE_CALENDAR_ID, calendarId);
  console.log('✓ applied Google Calendar config from environment');
}

/**
 * Baseline dev fixtures the integration suite reads but never creates: a
 * question bank, an OPEN job requisition, and an application on it. Without
 * these, `npm test` fails on a freshly seeded database (several suites bail
 * with "no job available" / "Seeded database is missing required entities").
 * Idempotent — re-seeding reuses whatever already exists.
 */
async function seedDevWorkload(sectorId: string, tenantId: string, organizationId: string, workspaceId: string) {
  if (process.env.NODE_ENV === 'production') {
    console.log('• skipping dev workload (production)');
    return;
  }
  const admin = await prisma.user.findFirstOrThrow({ where: { email: 'admin@agnohire.local' } });
  const domain = await prisma.domain.findFirstOrThrow({ where: { sectorId } });

  const bankName = 'Dev Question Bank';
  let bank = await prisma.questionBank.findFirst({ where: { name: bankName, tenantId } });
  if (!bank) {
    bank = await prisma.questionBank.create({
      data: { name: bankName, description: 'Baseline dev bank.', domainId: domain.id, tenantId, organizationId, workspaceId, createdById: admin.id },
    });
    await prisma.question.create({
      data: {
        bankId: bank.id,
        text: 'Describe a system you designed and the trade-offs you made.',
        type: 'TEXT',
        difficulty: 'MEDIUM',
        tenantId,
      },
    });
  }

  const jobTitle = 'Dev Software Engineer';
  let job = await prisma.jobRequisition.findFirst({ where: { title: jobTitle, tenantId } });
  if (!job) {
    job = await prisma.jobRequisition.create({
      data: {
        title: jobTitle,
        description: 'Baseline OPEN requisition used by the dev environment and the test suite.',
        sectorId,
        domainId: domain.id,
        createdById: admin.id,
        approvedById: admin.id,
        approvedAt: new Date(),
        status: 'OPEN',
        headcount: 1,
        skills: ['TypeScript', 'PostgreSQL'],
        tenantId,
        organizationId,
        workspaceId,
        workflowRounds: {
          create: [
            { roundNumber: 1, roundName: 'Screening', roundType: 'SCREENING', passPercentage: 60, sequenceOrder: 1, isMandatory: true, autoProgression: false },
            { roundNumber: 2, roundName: 'Technical', roundType: 'TECHNICAL', passPercentage: 70, sequenceOrder: 2, isMandatory: true, autoProgression: false },
          ],
        },
      },
    });
  }

  const candidate = await prisma.candidate.findFirst({ where: { email: 'candidate@agnohire.local', tenantId } });
  if (candidate) {
    const application = await prisma.jobApplication.findFirst({
      where: { candidateId: candidate.id, jobRequisitionId: job.id },
    });
    if (!application) {
      await prisma.jobApplication.create({
        data: { candidateId: candidate.id, jobRequisitionId: job.id, status: 'APPLIED', stage: 'APPLIED', tenantId },
      });
    }
  }
  console.log('✓ dev workload → 1 question bank, 1 OPEN job, 1 application');
}

async function main() {
  return runAsPlatform(async () => {
    console.log('Seeding AgnoHire…');
    await seedPermissions();
    await seedRoles();
    await seedThemes();
    await seedConfig();
    await applyAiEnvOverrides();
    await applyCalendarEnvOverrides();
    await seedPlanCatalogue();
    const tenant = await seedDefaultTenant();
    const { sector, orgId, workspaceId } = await seedSectorAndDomains(tenant.id);
    await seedDevAdmin(sector.id, tenant.id);
    await seedDevCandidate(sector.id, tenant.id);
    await seedDevWorkload(sector.id, tenant.id, orgId, workspaceId);
    await seedEmailTemplates();
    console.log('Done.');
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
