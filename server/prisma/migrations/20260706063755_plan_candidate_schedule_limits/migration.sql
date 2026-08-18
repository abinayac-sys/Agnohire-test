-- DropForeignKey
ALTER TABLE "Sector" DROP CONSTRAINT "Sector_tenantId_fkey";

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "maxCandidates" INTEGER,
ADD COLUMN     "maxSchedules" INTEGER,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Subscription" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Tenant" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UsageCounter" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
