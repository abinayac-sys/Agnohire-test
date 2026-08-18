import { api, unwrap } from './api.js';
import type {
  ApiResponse,
  Paginated,
  AdminUserItem,
  UserFilters,
  CreateUserInput,
  UpdateUserInput,
  AdminResetPasswordInput,
  RoleItem,
  PermissionDef,
  SetRolePermissionsInput,
  SectorItem,
  CreateSectorInput,
  UpdateSectorInput,
  DomainItem,
  CreateDomainInput,
  UpdateDomainInput,
  IntegrationItem,
  CreateIntegrationInput,
  UpdateIntegrationInput,
  EmailTemplateItem,
  CreateEmailTemplateInput,
  UpdateEmailTemplateInput,
  ThemeTokens,
  SendUserMessageInput,
  MessageSendResult,
  EmailLogItem,
  EmailLogFilters,
  OrganizationItem,
  OrganizationMemberItem,
  CreateOrganizationInput,
  UpdateOrganizationInput,
  AddOrganizationMemberInput,
  UpdateOrganizationMemberRoleInput,
  WorkspaceItem,
  WorkspaceMemberItem,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  AddWorkspaceMemberInput,
  UpdateWorkspaceMemberRoleInput,
} from '@agnohire/shared';

// ─── USERS ───────────────────────────────────────────────────────────────────

export async function fetchUsers(filters: Partial<UserFilters> = {}): Promise<Paginated<AdminUserItem>> {
  return unwrap((await api.get<ApiResponse<Paginated<AdminUserItem>>>('/admin/users', { params: filters })).data);
}
export async function createUser(data: CreateUserInput): Promise<AdminUserItem> {
  return unwrap((await api.post<ApiResponse<{ user: AdminUserItem }>>('/admin/users', data)).data).user;
}
export async function updateUser(id: string, data: UpdateUserInput): Promise<AdminUserItem> {
  return unwrap((await api.patch<ApiResponse<{ user: AdminUserItem }>>(`/admin/users/${id}`, data)).data).user;
}
export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/admin/users/${id}`);
}
export async function sendUserMessage(data: SendUserMessageInput): Promise<MessageSendResult> {
  return unwrap((await api.post<ApiResponse<{ result: MessageSendResult }>>('/admin/messages', data)).data).result;
}

export async function fetchEmailLogs(filters: Partial<EmailLogFilters> = {}): Promise<Paginated<EmailLogItem>> {
  return unwrap((await api.get<ApiResponse<Paginated<EmailLogItem>>>('/admin/email-logs', { params: filters })).data);
}

export async function resetUserPassword(id: string, data: AdminResetPasswordInput): Promise<void> {
  await api.post(`/admin/users/${id}/reset-password`, data);
}

// ─── ROLES & PERMISSIONS ─────────────────────────────────────────────────────

export async function fetchRoles(): Promise<RoleItem[]> {
  return unwrap((await api.get<ApiResponse<{ roles: RoleItem[] }>>('/admin/roles')).data).roles;
}
export async function fetchPermissions(): Promise<PermissionDef[]> {
  return unwrap((await api.get<ApiResponse<{ permissions: PermissionDef[] }>>('/admin/permissions')).data).permissions;
}
export async function setRolePermissions(id: string, data: SetRolePermissionsInput): Promise<RoleItem> {
  return unwrap((await api.put<ApiResponse<{ role: RoleItem }>>(`/admin/roles/${id}/permissions`, data)).data).role;
}

// ─── SECTORS & DOMAINS ───────────────────────────────────────────────────────

export async function fetchAdminSectors(): Promise<SectorItem[]> {
  return unwrap((await api.get<ApiResponse<{ sectors: SectorItem[] }>>('/admin/sectors')).data).sectors;
}
export async function createSector(data: CreateSectorInput): Promise<SectorItem> {
  return unwrap((await api.post<ApiResponse<{ sector: SectorItem }>>('/admin/sectors', data)).data).sector;
}
export async function updateSector(id: string, data: UpdateSectorInput): Promise<SectorItem> {
  return unwrap((await api.patch<ApiResponse<{ sector: SectorItem }>>(`/admin/sectors/${id}`, data)).data).sector;
}
export async function deleteSector(id: string): Promise<void> {
  await api.delete(`/admin/sectors/${id}`);
}
export async function fetchAdminDomains(sectorId?: string): Promise<DomainItem[]> {
  return unwrap((await api.get<ApiResponse<{ domains: DomainItem[] }>>('/admin/domains', { params: sectorId ? { sectorId } : {} })).data).domains;
}
export async function createDomain(data: CreateDomainInput): Promise<DomainItem> {
  return unwrap((await api.post<ApiResponse<{ domain: DomainItem }>>('/admin/domains', data)).data).domain;
}
export async function updateDomain(id: string, data: UpdateDomainInput): Promise<DomainItem> {
  return unwrap((await api.patch<ApiResponse<{ domain: DomainItem }>>(`/admin/domains/${id}`, data)).data).domain;
}
export async function deleteDomain(id: string): Promise<void> {
  await api.delete(`/admin/domains/${id}`);
}

// ─── ORGANIZATIONS & WORKSPACES ──────────────────────────────────────────────

export async function fetchOrganizations(): Promise<OrganizationItem[]> {
  return unwrap((await api.get<ApiResponse<{ organizations: OrganizationItem[] }>>('/organizations')).data).organizations;
}
export async function createOrganization(data: CreateOrganizationInput): Promise<OrganizationItem> {
  return unwrap((await api.post<ApiResponse<{ organization: OrganizationItem }>>('/organizations', data)).data).organization;
}
export async function updateOrganization(id: string, data: UpdateOrganizationInput): Promise<OrganizationItem> {
  return unwrap((await api.patch<ApiResponse<{ organization: OrganizationItem }>>(`/organizations/${id}`, data)).data).organization;
}
export async function deleteOrganization(id: string): Promise<void> {
  await api.delete(`/organizations/${id}`);
}
export async function fetchOrganizationMembers(id: string): Promise<OrganizationMemberItem[]> {
  return unwrap((await api.get<ApiResponse<{ members: OrganizationMemberItem[] }>>(`/organizations/${id}/members`)).data).members;
}
export async function addOrganizationMember(id: string, data: AddOrganizationMemberInput): Promise<void> {
  await api.post(`/organizations/${id}/members`, data);
}
export async function updateOrganizationMemberRole(id: string, userId: string, data: UpdateOrganizationMemberRoleInput): Promise<void> {
  await api.patch(`/organizations/${id}/members/${userId}`, data);
}
export async function removeOrganizationMember(id: string, userId: string): Promise<void> {
  await api.delete(`/organizations/${id}/members/${userId}`);
}

export async function fetchWorkspaces(organizationId?: string): Promise<WorkspaceItem[]> {
  return unwrap((await api.get<ApiResponse<{ workspaces: WorkspaceItem[] }>>('/workspaces', { params: organizationId ? { organizationId } : {} })).data).workspaces;
}
export async function createWorkspace(data: CreateWorkspaceInput): Promise<WorkspaceItem> {
  return unwrap((await api.post<ApiResponse<{ workspace: WorkspaceItem }>>('/workspaces', data)).data).workspace;
}
export async function updateWorkspace(id: string, data: UpdateWorkspaceInput): Promise<WorkspaceItem> {
  return unwrap((await api.patch<ApiResponse<{ workspace: WorkspaceItem }>>(`/workspaces/${id}`, data)).data).workspace;
}
export async function deleteWorkspace(id: string): Promise<void> {
  await api.delete(`/workspaces/${id}`);
}
export async function fetchWorkspaceMembers(id: string): Promise<WorkspaceMemberItem[]> {
  return unwrap((await api.get<ApiResponse<{ members: WorkspaceMemberItem[] }>>(`/workspaces/${id}/members`)).data).members;
}
export async function addWorkspaceMember(id: string, data: AddWorkspaceMemberInput): Promise<void> {
  await api.post(`/workspaces/${id}/members`, data);
}
export async function updateWorkspaceMemberRole(id: string, userId: string, data: UpdateWorkspaceMemberRoleInput): Promise<void> {
  await api.patch(`/workspaces/${id}/members/${userId}`, data);
}
export async function removeWorkspaceMember(id: string, userId: string): Promise<void> {
  await api.delete(`/workspaces/${id}/members/${userId}`);
}

// ─── INTEGRATIONS ────────────────────────────────────────────────────────────

export async function fetchIntegrations(): Promise<IntegrationItem[]> {
  return unwrap((await api.get<ApiResponse<{ integrations: IntegrationItem[] }>>('/admin/integrations')).data).integrations;
}
export async function createIntegration(data: CreateIntegrationInput): Promise<IntegrationItem> {
  return unwrap((await api.post<ApiResponse<{ integration: IntegrationItem }>>('/admin/integrations', data)).data).integration;
}
export async function updateIntegration(id: string, data: UpdateIntegrationInput): Promise<IntegrationItem> {
  return unwrap((await api.patch<ApiResponse<{ integration: IntegrationItem }>>(`/admin/integrations/${id}`, data)).data).integration;
}
export async function deleteIntegration(id: string): Promise<void> {
  await api.delete(`/admin/integrations/${id}`);
}
export async function testWhatsAppConnection(config: {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
  useStoredAccessToken?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  return unwrap((await api.post<ApiResponse<{ ok: boolean; error?: string }>>('/admin/integrations/whatsapp/test', config)).data);
}

// ─── EMAIL TEMPLATES ─────────────────────────────────────────────────────────

export async function fetchEmailTemplates(): Promise<EmailTemplateItem[]> {
  return unwrap((await api.get<ApiResponse<{ templates: EmailTemplateItem[] }>>('/admin/email-templates')).data).templates;
}
export async function createEmailTemplate(data: CreateEmailTemplateInput): Promise<EmailTemplateItem> {
  return unwrap((await api.post<ApiResponse<{ template: EmailTemplateItem }>>('/admin/email-templates', data)).data).template;
}
export async function updateEmailTemplate(id: string, data: UpdateEmailTemplateInput): Promise<EmailTemplateItem> {
  return unwrap((await api.patch<ApiResponse<{ template: EmailTemplateItem }>>(`/admin/email-templates/${id}`, data)).data).template;
}
export async function deleteEmailTemplate(id: string): Promise<void> {
  await api.delete(`/admin/email-templates/${id}`);
}
export async function applyLogoToAllTemplates(data: { useCustomLogo: boolean; customLogoId: string; logoWidth: number }): Promise<void> {
  await api.post('/admin/email-templates/apply-logo', data);
}
export async function previewEmailTemplate(
  subject: string, 
  body: string, 
  theme?: string, 
  brandSettings?: any,
  type?: string
): Promise<{ html: string }> {
  return unwrap((await api.post<ApiResponse<{ html: string }>>('/admin/email-templates/preview', { subject, body, theme, brandSettings, type })).data);
}

// ─── SYSTEM CONFIG (existing /system endpoints) ──────────────────────────────

export interface ConfigItem {
  id: string;
  key: string;
  category: string;
  label: string;
  description: string | null;
  dataType: string;
  isSecret: boolean;
  sectorId: string | null;
  value: string | null;
  hasValue: boolean;
  updatedAt: string;
}

export async function fetchConfig(): Promise<ConfigItem[]> {
  return unwrap((await api.get<ApiResponse<{ config: ConfigItem[] }>>('/system/config')).data).config;
}
export async function updateConfig(key: string, value: string): Promise<void> {
  await api.put(`/system/config/${encodeURIComponent(key)}`, { value });
}

export interface ConnectionInfo {
  live: {
    postgresMaxConnections: string | null;
    postgresSharedBuffers: string | null;
  };
  configured: {
    postgresMaxConnections: string | null;
    postgresSharedBuffers: string | null;
    pgbouncerDefaultPoolSize: string | null;
    pgbouncerReservePoolSize: string | null;
    pgbouncerReservePoolTimeout: string | null;
    pgbouncerMaxClientConn: string | null;
    pgbouncerQueryWaitTimeout: string | null;
    pgbouncerServerIdleTimeout: string | null;
    pgbouncerServerLifetime: string | null;
  } | null;
  appPool: { connectionLimit: string | null; poolTimeout: string | null };
  note: string;
}

/** Read-only DB connection capacity (Postgres/PgBouncer/app pool). SUPERADMIN only. */
export async function fetchConnectionInfo(): Promise<ConnectionInfo> {
  return unwrap((await api.get<ApiResponse<ConnectionInfo>>('/system/connection-info')).data);
}
export async function testEmail(to?: string): Promise<{ verified: boolean; sent?: boolean; error?: string }> {
  return unwrap((await api.post<ApiResponse<{ verified: boolean; sent?: boolean; error?: string }>>('/system/email/test', to ? { to } : {})).data);
}

export interface CalendarTestResult {
  configured: boolean;
  ok: boolean;
  source: 'system-config' | 'integration' | null;
  calendar?: string;
  error?: string;
}
export async function testCalendar(): Promise<CalendarTestResult> {
  return unwrap((await api.post<ApiResponse<CalendarTestResult>>('/system/calendar/test', {})).data);
}

// ─── THEMES (appearance customization) ───────────────────────────────────────

export interface ThemeRecord {
  name: string;
  tokens: ThemeTokens;
  isDefault?: boolean;
}

export async function fetchThemes(): Promise<ThemeRecord[]> {
  return unwrap((await api.get<ApiResponse<{ themes: ThemeRecord[] }>>('/system/themes')).data).themes;
}
/** Persist edited colour tokens for a theme (broadcasts live if it's active). */
export async function updateThemeTokens(name: string, tokens: ThemeTokens): Promise<void> {
  await api.put(`/system/themes/${encodeURIComponent(name)}`, { tokens });
}
/** Make a theme the active default and broadcast it to all clients. */
export async function setActiveTheme(name: string): Promise<void> {
  await api.put('/system/active-theme', { name });
}
