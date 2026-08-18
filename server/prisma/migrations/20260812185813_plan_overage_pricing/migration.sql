-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "pricePerCandidate" DECIMAL(65,30),
ADD COLUMN     "pricePerOrganization" DECIMAL(65,30),
ADD COLUMN     "pricePerUser" DECIMAL(65,30),
ADD COLUMN     "pricePerWorkspace" DECIMAL(65,30);
