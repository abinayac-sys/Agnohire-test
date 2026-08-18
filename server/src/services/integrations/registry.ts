import { testWhatsAppConnection } from '../whatsappIntegrationService.js';

export interface IntegrationProviderBackend {
  id: string;
  testConnection: (config: any) => Promise<{ ok: boolean; error?: string }>;
}

export const BACKEND_PROVIDERS: Record<string, IntegrationProviderBackend> = {
  whatsapp: {
    id: 'whatsapp',
    testConnection: testWhatsAppConnection,
  },
  teams: {
    id: 'teams',
    testConnection: async (config) => {
      // Stub validation
      if (!config.tenantId || !config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  slack: {
    id: 'slack',
    testConnection: async (config) => {
      if (!config.botToken || !config.signingSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  linkedin: {
    id: 'linkedin',
    testConnection: async (config) => {
      if (!config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  naukri: {
    id: 'naukri',
    testConnection: async (config) => {
      if (!config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  indeed: {
    id: 'indeed',
    testConnection: async (config) => {
      if (!config.employerId || !config.apiToken) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  enhance: {
    id: 'enhance',
    testConnection: async (config) => {
      if (!config.apiBaseUrl || !config.tenantId || (!config.apiKey && !config.clientId)) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  servicenow: {
    id: 'servicenow',
    testConnection: async (config) => {
      if (!config.instanceUrl || !config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  salesforce: {
    id: 'salesforce',
    testConnection: async (config) => {
      if (!config.tenantId || !config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  zohocrm: {
    id: 'zohocrm',
    testConnection: async (config) => {
      if (!config.tenantId || !config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  sugarcrm: {
    id: 'sugarcrm',
    testConnection: async (config) => {
      if (!config.tenantId || !config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  msdynamics365: {
    id: 'msdynamics365',
    testConnection: async (config) => {
      if (!config.tenantId || !config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  hubspot: {
    id: 'hubspot',
    testConnection: async (config) => {
      if (!config.tenantId || !config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  successfactors: {
    id: 'successfactors',
    testConnection: async (config) => {
      if (!config.tenantId || !config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  workday: {
    id: 'workday',
    testConnection: async (config) => {
      if (!config.tenantId || !config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  bamboohr: {
    id: 'bamboohr',
    testConnection: async (config) => {
      if (!config.tenantId || !config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  oraclehcm: {
    id: 'oraclehcm',
    testConnection: async (config) => {
      if (!config.tenantId || !config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  ukgpro: {
    id: 'ukgpro',
    testConnection: async (config) => {
      if (!config.tenantId || !config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
  adp: {
    id: 'adp',
    testConnection: async (config) => {
      if (!config.tenantId || !config.clientId || !config.clientSecret) {
        return { ok: false, error: 'Missing required credentials' };
      }
      return { ok: true };
    }
  },
};

export function getBackendProvider(id: string): IntegrationProviderBackend | undefined {
  return BACKEND_PROVIDERS[id];
}
