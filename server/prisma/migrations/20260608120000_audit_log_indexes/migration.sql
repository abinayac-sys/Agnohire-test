-- Index the AuditLog columns the Module 13 viewer filters/sorts on.
-- Append-only table; these are additive CREATE INDEX statements (non-destructive,
-- fully reversible via DROP INDEX). IF NOT EXISTS keeps re-runs/baselines safe.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_sectorId_createdAt_idx" ON "AuditLog"("sectorId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
