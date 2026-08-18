-- RISK-1: /auth/refresh hard-coded `skipApprovalGate: true` on every rotation
-- (authService.refresh — both the normal path and the rotation-grace path),
-- because operator impersonation re-bootstraps the SPA through /refresh and
-- would otherwise be locked out of the very workspace it is reviewing.
--
-- The side effect was that the approval gate became a LOGIN-ONLY check: a normal
-- session in a workspace that was later un-approved, rejected or suspended kept
-- renewing itself indefinitely, until its refresh token expired (7 days).
--
-- Persist WHY a session was allowed to skip the gate. Normal sessions (false)
-- re-check it on every rotation; impersonated sessions (true) keep skipping it,
-- and the flag is inherited by the rotated token so the exemption survives an
-- unbounded rotation chain.
--
-- Existing rows default to false, i.e. every session live at deploy time is
-- treated as normal and is re-gated on its next refresh. That is the intended
-- fail-closed behaviour; the only people affected are operators mid-impersonation
-- at deploy time, who simply re-enter the workspace.
--
-- RefreshToken is not a tenant-scoped model (it carries no tenantId and RLS was
-- never enabled on it), so no policy needs updating for the new column.

ALTER TABLE "RefreshToken"
  ADD COLUMN "impersonated" BOOLEAN NOT NULL DEFAULT false;
