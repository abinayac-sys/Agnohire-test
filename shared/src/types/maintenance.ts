export type MaintenanceWindowStatus = 'SCHEDULED' | 'NOTIFIED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface MaintenanceWindowDto {
  id: string;
  title: string;
  message: string;
  startAt: string;
  endAt: string;
  status: MaintenanceWindowStatus;
  createdAt: string;
}
