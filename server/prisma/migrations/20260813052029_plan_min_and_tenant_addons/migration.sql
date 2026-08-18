-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "minCandidates" INTEGER,
ADD COLUMN     "minOrganizations" INTEGER,
ADD COLUMN     "minUsers" INTEGER,
ADD COLUMN     "minWorkspaces" INTEGER;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "extraCandidates" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "extraOrganizations" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "extraUsers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "extraWorkspaces" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TenantAddonPurchase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantAddonPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantAddonPurchase_tenantId_idx" ON "TenantAddonPurchase"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantAddonPurchase" ADD CONSTRAINT "TenantAddonPurchase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
