import type { ApiResponse, ThemeTokens, MaintenanceWindowDto } from '@agnohire/shared';
import { api, unwrap } from './api.js';

export interface ThemeRecord {
  name: string;
  tokens: ThemeTokens;
  isDefault?: boolean;
}

export interface BootstrapData {
  companyName: string;
  appIcon: string | null;
  companyLogo: string | null;
  loginBackground: string | null;
  defaultThemeName: string;
  activeTheme: ThemeRecord | null;
  themes: ThemeRecord[];
  sidebarLogoWidth?: string;
  sidebarLogoHeight?: string;
}

// Single-flight guard: two callers racing to load bootstrap data (e.g. React
// StrictMode's dev-only double mount, or any other double-invoke) share one
// in-flight request instead of firing two GET /system/bootstrap calls.
let bootstrapInFlight: Promise<BootstrapData> | null = null;

/** Public bootstrap — fetched before auth to theme the login screen. */
export function fetchBootstrap(): Promise<BootstrapData> {
  if (bootstrapInFlight) return bootstrapInFlight;

  bootstrapInFlight = (async () => {
    const res = await api.get<ApiResponse<BootstrapData>>('/system/bootstrap');
    return unwrap(res.data);
  })().finally(() => {
    bootstrapInFlight = null;
  });

  return bootstrapInFlight;
}

/** Current/upcoming maintenance window, if any — used to hydrate the maintenance banner on load. */
export async function fetchActiveMaintenance(): Promise<MaintenanceWindowDto | null> {
  return unwrap((await api.get<ApiResponse<MaintenanceWindowDto | null>>('/system/maintenance-active')).data);
}
