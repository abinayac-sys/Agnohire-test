-- AlterTable
ALTER TABLE "TenantAddonPurchase" ADD COLUMN     "paymentLinkShortUrl" TEXT,
ADD COLUMN     "paymentLinkStatus" TEXT,
ADD COLUMN     "prorationAmount" DECIMAL(65,30),
ADD COLUMN     "razorpayPaymentLinkId" TEXT;

-- CreateIndex
CREATE INDEX "TenantAddonPurchase_razorpayPaymentLinkId_idx" ON "TenantAddonPurchase"("razorpayPaymentLinkId");
