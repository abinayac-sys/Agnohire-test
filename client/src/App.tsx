import { Route, Routes } from 'react-router-dom';
import { ROLES, type RoleKey } from '@agnohire/shared';
import { ROLE_BASE } from './config/rolePaths.js';
import { ProtectedRoute } from './routes/ProtectedRoute.js';
import { RoleRoute } from './routes/RoleRoute.js';
import { AppLayout } from './layouts/AppLayout.js';
import { LoginPage } from './pages/LoginPage.js';
import { AuthCallbackPage } from './pages/AuthCallbackPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { PlaceholderPage } from './pages/PlaceholderPage.js';
import { RootRedirect } from './pages/RootRedirect.js';
import { NotFoundPage, UnauthorizedPage } from './pages/ErrorPages.js';
import { JobsPage } from './pages/jobs/JobsPage.js';
import { CandidatesPage } from './pages/candidates/CandidatesPage.js';
import { ScreeningPage } from './pages/screening/ScreeningPage.js';
import { SourcingPage } from './pages/sourcing/SourcingPage.js';
import { QuestionBankPage } from './pages/interviews/QuestionBankPage.js';
import { InterviewsPage } from './pages/interviews/InterviewsPage.js';
import { InterviewTakePage } from './pages/interviews/InterviewTakePage.js';
import { SchedulePage } from './pages/schedule/SchedulePage.js';

import { AssessmentTakePage } from './pages/assessments/AssessmentTakePage.js';
import { AnalyticsPage } from './pages/analytics/AnalyticsPage.js';
import { ReviewsPage } from './pages/reviews/ReviewsPage.js';
import { PipelinePage } from './pages/pipeline/PipelinePage.js';
import { OffersPage } from './pages/offers/OffersPage.js';
import { OfferAcceptPage } from './pages/offers/OfferAcceptPage.js';
import { TentativeOfferAcceptPage } from './pages/offers/TentativeOfferAcceptPage.js';
import { DocumentPortalPage } from './pages/offers/DocumentPortalPage.js';
import { MyInterviewsPage } from './pages/candidate/MyInterviewsPage.js';
import { MyOffersPage } from './pages/candidate/MyOffersPage.js';
import { AuditLogsPage } from './pages/audit/AuditLogsPage.js';
import { CompliancePage } from './pages/compliance/CompliancePage.js';
import { UsersPage } from './pages/admin/UsersPage.js';
import { RolesPage } from './pages/admin/RolesPage.js';
import { SectorsPage } from './pages/admin/SectorsPage.js';
import { OrganizationsWorkspacesPage } from './pages/admin/OrganizationsWorkspacesPage.js';
import { IntegrationsPage } from './pages/admin/IntegrationsPage.js';
import { CareersEmbedPage } from './pages/admin/integrations/CareersEmbedPage.js';
import { EmailTemplatesPage } from './pages/admin/EmailTemplatesPage.js';
import { EmailLogPage } from './pages/admin/EmailLogPage.js';
import { SystemConfigPage } from './pages/admin/SystemConfigPage.js';
import { AIPlaygroundPage } from './pages/admin/AIPlaygroundPage.js';
import { WorkspaceCommunicationPage } from './pages/communication/WorkspaceCommunicationPage.js';
import { HrApprovalQueuePage } from './pages/hr/HrApprovalQueuePage.js';
// SaaS (additive): self-registration, email verification, invites, billing
import { RegisterPage } from './pages/saas/RegisterPage.js';
import { VerifyEmailPage } from './pages/saas/VerifyEmailPage.js';
import { AcceptInvitePage } from './pages/saas/AcceptInvitePage.js';
import { ForgotPasswordPage } from './pages/saas/ForgotPasswordPage.js';
import { ResetPasswordPage } from './pages/saas/ResetPasswordPage.js';
import { BillingPage } from './pages/saas/BillingPage.js';
import { PlansAdminPage } from './pages/saas/PlansAdminPage.js';
import { TenantAccountsPage } from './pages/saas/TenantAccountsPage.js';
import { UsageMonitorPage } from './pages/saas/UsageMonitorPage.js';
import { MaintenanceSchedulePage } from './pages/saas/MaintenanceSchedulePage.js';
// Public careers page (no auth, no app shell — embeddable via iframe)
import { CareersListPage } from './pages/careers/CareersListPage.js';
import { CareersJobDetailPage } from './pages/careers/CareersJobDetailPage.js';

/** Module routes shared across staff roles (rendered as placeholders for now). */
const STAFF_PAGES: { path: string; title: string; module: string }[] = [];

const STAFF_ROLES: RoleKey[] = [
  ROLES.SUPERADMIN,
  ROLES.ADMIN,
  ROLES.HR,
  ROLES.RECRUITER,
  ROLES.HIRING_MANAGER,
  ROLES.PANEL_MEMBER,
];

function StaffArea({ role }: { role: RoleKey }) {
  // SaaS role reuses the existing admin area (see rolePaths.ts), so the
  // shared area guard admits it alongside the classic role.
  const guardRoles: RoleKey[] =
    role === ROLES.ADMIN ? [ROLES.ADMIN, ROLES.TENANT_OWNER]
    : [role];
  return (
    <Route key={role} element={<RoleRoute roles={guardRoles} />}>
      <Route path={ROLE_BASE[role].slice(1)} element={<AppLayout />}>
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="profile" element={<ProfilePage />} />
        {/* Module 1 — Job Requisition */}
        <Route path="jobs" element={<JobsPage />} />
        {/* Module 2 — Resume Parsing & Candidate Screening */}
        <Route path="candidates" element={<CandidatesPage />} />
        <Route path="screening" element={<ScreeningPage />} />
        {/* Module 3 — Candidate Sourcing */}
        <Route path="sourcing" element={<SourcingPage />} />
        {/* Module 4 — AI Interview Engine */}
        <Route path="question-bank" element={<QuestionBankPage />} />
        <Route path="interviews" element={<InterviewsPage />} />
        {/* Module 5 — Interview Scheduling */}
        <Route path="schedule" element={<SchedulePage />} />

        {/* Module 7 — AI Analytics & Reporting */}
        <Route path="analytics" element={<AnalyticsPage />} />
        {/* Module 8 — Video Interview Intelligence */}
        <Route path="reviews" element={<ReviewsPage />} />
        {/* Module 9 — ATS Pipeline / Kanban */}
        <Route path="pipeline" element={<PipelinePage />} />
        {/* Team communication hub: channels/DMs/calls/meetings/notes/tasks (tenant-scoped) */}
        <Route path="communication" element={<WorkspaceCommunicationPage />} />
        {/* Module 11 — Offer & Onboarding */}
        <Route path="hr-approval" element={<HrApprovalQueuePage />} />
        <Route path="offers" element={<OffersPage />} />
        <Route path="onboarding" element={<OffersPage onboardingMode />} />
        {/* Module 13 — Security & GDPR Compliance */}
        <Route path="audit-logs" element={<AuditLogsPage />} />
        <Route path="compliance" element={<CompliancePage />} />
        {/* Module 14 — Admin Console */}
        <Route path="users" element={<UsersPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="sectors" element={<SectorsPage />} />
        <Route path="organizations" element={<OrganizationsWorkspacesPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="integrations/careers-embed" element={<CareersEmbedPage />} />
        <Route path="email-templates" element={<EmailTemplatesPage />} />
        <Route path="email-log" element={<EmailLogPage />} />
        <Route path="system-config" element={<SystemConfigPage />} />
        <Route path="ai-playground" element={<AIPlaygroundPage />} />
        {/* SaaS — tenant billing & usage (admin/owner; server enforces role) */}
        <Route path="billing" element={<BillingPage />} />
        {/* SaaS platform console (SUPERADMIN; server enforces role) */}
        <Route path="tenants" element={<TenantAccountsPage />} />
        <Route path="plans" element={<PlansAdminPage />} />
        <Route path="maintenance" element={<MaintenanceSchedulePage />} />
        <Route path="usage-monitor" element={<UsageMonitorPage />} />
        {STAFF_PAGES.map((p) => (
          <Route
            key={p.path}
            path={p.path}
            element={<PlaceholderPage title={p.title} module={p.module} />}
          />
        ))}
      </Route>
    </Route>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* SaaS — public self-registration & account activation */}
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      {/* Module 4 — public candidate interview (token-based, no auth/layout) */}
      <Route path="/interview/:token" element={<InterviewTakePage />} />
      {/* Module 6 — public candidate assessment (token-based, no auth/layout) */}
      <Route path="/assessment/:token" element={<AssessmentTakePage />} />
      {/* Module 11 — public candidate offer acceptance */}
      <Route path="/offer/tentative-accept/:token" element={<TentativeOfferAcceptPage />} />
      <Route path="/offer/accept/:token" element={<OfferAcceptPage />} />
      {/* Module 11 — public candidate document upload portal */}
      <Route path="/public/offer/documents/:token" element={<DocumentPortalPage />} />
      {/* Public careers page (tenant-slug-scoped, no auth/layout) — embeddable via iframe */}
      <Route path="/careers/:tenantSlug" element={<CareersListPage />} />
      <Route path="/careers/:tenantSlug/jobs/:jobId" element={<CareersJobDetailPage />} />

      {/* Bare '/' has no tenant slug yet (e.g. straight after login) —
          RootRedirect resolves the user's real slug and redirects there. */}
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<RootRedirect />} />
      </Route>

      {/* Every authenticated area lives under /:tenantSlug — a tenant's
          slug, or the synthetic "platform" slug for a platform-superadmin's
          own (non-impersonating) session. See utils/tenantPath.ts. */}
      <Route path="/:tenantSlug" element={<ProtectedRoute />}>
        {STAFF_ROLES.map((role) => StaffArea({ role }))}

        {/* Candidate portal */}
        <Route element={<RoleRoute roles={[ROLES.CANDIDATE]} />}>
          <Route path="candidate" element={<AppLayout />}>
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="interviews" element={<MyInterviewsPage />} />
            <Route path="offers" element={<MyOffersPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
