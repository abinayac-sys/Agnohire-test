-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "autoPayConsentedAt" TIMESTAMP(3),
ADD COLUMN     "autoPayEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TenantAddonPendingChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "TenantAddonPendingChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringAddonCharge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "razorpayAddonId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ATTACHED',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringAddonCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantAddonPendingChange_tenantId_idx" ON "TenantAddonPendingChange"("tenantId");

-- CreateIndex
CREATE INDEX "RecurringAddonCharge_tenantId_idx" ON "RecurringAddonCharge"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringAddonCharge_tenantId_periodEnd_key" ON "RecurringAddonCharge"("tenantId", "periodEnd");

-- AddForeignKey
ALTER TABLE "TenantAddonPendingChange" ADD CONSTRAINT "TenantAddonPendingChange_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringAddonCharge" ADD CONSTRAINT "RecurringAddonCharge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
