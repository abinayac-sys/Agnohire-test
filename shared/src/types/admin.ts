// ─── USERS ───────────────────────────────────────────────────────────────────

export interface AdminUserItem {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  roleId: string;
  roleName: string;
  sectorId: string | null;
  sectorName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

// ─── ROLES & PERMISSIONS ─────────────────────────────────────────────────────

export interface RoleItem {
  id: string;
  name: string;
  displayName: string;
  userCount: number;
  permissionKeys: string[];
  isSuperadmin: boolean;
}

// PermissionDef (key/label/group) is exported from constants/permissions.

// ─── SECTORS & DOMAINS ───────────────────────────────────────────────────────

export interface SectorItem {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  userCount: number;
  domainCount: number;
  createdAt: string;
}

export interface DomainItem {
  id: string;
  name: string;
  sectorId: string | null;
  sectorName: string | null;
  parentId: string | null;
  isActive: boolean;
  createdAt: string;
}

// ─── INTEGRATIONS ────────────────────────────────────────────────────────────

export interface IntegrationItem {
  id: string;
  name: string;
  type: string;
  isEnabled: boolean;
  /** Decrypted config. Secret-looking values are masked before leaving the server. */
  config: Record<string, unknown>;
  webhookUrl: string | null;
  sectorId: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── EMAIL TEMPLATES ─────────────────────────────────────────────────────────

export interface EmailTemplateItem {
  id: string;
  name: string;
  type: string;
  subject: string;
  body: string;
  sectorId: string | null;
  isDefault: boolean;
  isSystemOverride?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Result of a superadmin/admin broadcast to users. */
export interface MessageSendResult {
  total: number;
  sent: number;
  failed: number;
  /** Recipients skipped because SMTP isn't configured. */
  skipped: number;
}

/** One row of the email delivery log (Admin Console). */
export interface EmailLogItem {
  id: string;
  toEmail: string;
  subject: string;
  templateId: string | null;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  errorMsg: string | null;
  sentAt: string | null;
  createdAt: string;
}
