-- CreateTable
CREATE TABLE "TenantRolePermission" (
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionKeys" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantRolePermission_pkey" PRIMARY KEY ("tenantId","roleId")
);

-- CreateIndex
CREATE INDEX "TenantRolePermission_tenantId_idx" ON "TenantRolePermission"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantRolePermission" ADD CONSTRAINT "TenantRolePermission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantRolePermission" ADD CONSTRAINT "TenantRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
