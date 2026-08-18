-- CreateTable
CREATE TABLE "AdminNotificationState" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isCleared" BOOLEAN NOT NULL DEFAULT false,
    "tenantId" TEXT,

    CONSTRAINT "AdminNotificationState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminNotificationState_adminId_idx" ON "AdminNotificationState"("adminId");

-- CreateIndex
CREATE INDEX "AdminNotificationState_notificationId_idx" ON "AdminNotificationState"("notificationId");

-- CreateIndex
CREATE INDEX "AdminNotificationState_tenantId_idx" ON "AdminNotificationState"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminNotificationState_adminId_notificationId_key" ON "AdminNotificationState"("adminId", "notificationId");

-- AddForeignKey
ALTER TABLE "AdminNotificationState" ADD CONSTRAINT "AdminNotificationState_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotificationState" ADD CONSTRAINT "AdminNotificationState_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
