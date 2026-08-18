-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "offerAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offerAcceptedDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "acceptanceToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Offer_acceptanceToken_key" ON "Offer"("acceptanceToken");
