import type { WorkMode } from '../constants/enums.js';

export interface PublicCareersTenant {
  name: string;
  slug: string;
  /** Whether the hosted careers page should render its own branded header/banner. */
  showHeader: boolean;
}

/**
 * Job cards on the public list show ONLY these fields: title, work
 * location + work type, skills, experience, salary (per-job, admin-gated),
 * and when the job opened — no free-text description on the list view.
 */
export interface PublicJobListItem {
  id: string;
  title: string;
  location: string | null;
  workMode: WorkMode | null;
  skills: string[];
  experienceMin: number | null;
  experienceMax: number | null;
  postedAt: string;
  /** Present only when this specific job has salary visibility enabled. */
  budgetMin: number | null;
  budgetMax: number | null;
}

export interface PublicJobDetail {
  id: string;
  title: string;
  description: string;
  location: string | null;
  workMode: WorkMode | null;
  headcount: number;
  skills: string[];
  experienceMin: number | null;
  experienceMax: number | null;
  deadline: string | null;
  postedAt: string;
  sector: { name: string };
  domain: { name: string };
  /** Present only when this specific job has salary visibility enabled. */
  budgetMin: number | null;
  budgetMax: number | null;
}

/** Staff-authenticated view of a job for the "per-job salary visibility" admin list. */
export interface CareersAdminJobItem {
  id: string;
  title: string;
  showSalaryPublicly: boolean;
  budgetMin: number | null;
  budgetMax: number | null;
}

/**
 * Tenant self-service read of the superadmin-controlled careers-page feature
 * grant (GET /tenant/features) — read fresh from the DB, not cached on the
 * JWT, so a superadmin's grant/revoke takes effect without waiting for token
 * refresh. Drives whether the tenant's own Integrations UI shows the
 * "Careers Page" card at all.
 */
export interface CareersFeatureStatus {
  careersPageEnabled: boolean;
}
