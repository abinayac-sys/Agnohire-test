/** A single audit-log row in the viewer list. */
export interface AuditLogItem {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  description: string;
  userId: string | null;
  userName: string | null;
  role: string | null;
  ipAddress: string | null;
  sectorId: string | null;
  createdAt: string;
}

/** Full audit-log detail, including the before/after snapshots. */
export interface AuditLogDetail extends AuditLogItem {
  userAgent: string | null;
  deviceInfo: unknown;
  oldValue: unknown;
  newValue: unknown;
}

/** Distinct values that drive the viewer's filter dropdowns. */
export interface AuditFacets {
  actions: string[];
  entities: string[];
}
