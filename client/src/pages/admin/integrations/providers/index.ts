import type React from 'react';
import type { IntegrationItem } from '@agnohire/shared';
import type { WizardStep } from '../../../../components/ui/Wizard.js';

export interface ProviderState {
  step: number;
  [key: string]: any;
}

export interface ProviderContext {
  state: ProviderState;
  updateState: (update: Partial<ProviderState>) => void;
  integration?: IntegrationItem;
  testResult: { ok: boolean; error?: string } | null;
  setTestResult: (result: { ok: boolean; error?: string } | null) => void;
  isTesting: boolean;
  setIsTesting: (testing: boolean) => void;
  save?: (customConfig?: any) => Promise<any>;
}

export interface IntegrationCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  order: number;
}

export interface IntegrationProviderDef {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  getWizardSteps: (ctx: ProviderContext) => WizardStep[];
  getDefaultState: () => Record<string, any>;
  getSavePayload: (state: ProviderState, integration?: IntegrationItem) => Record<string, any>;
}

export const INTEGRATION_CATEGORIES: Record<string, IntegrationCategory> = {
  calendar: {
    id: 'calendar',
    name: 'Calendar & Meetings',
    description: 'Sync interviews to an external calendar and auto-generate meeting links.',
    icon: '📅',
    order: 0,
  },
  communication: {
    id: 'communication',
    name: 'Communication',
    description: 'Integrations used to communicate with candidates, recruiters and hiring teams.',
    icon: '💬',
    order: 1,
  },
  'job-portals': {
    id: 'job-portals',
    name: 'Job Portals',
    description: 'Integrations used for job posting, candidate sourcing and applicant synchronisation.',
    icon: '💼',
    order: 2,
  },
  crm: {
    id: 'crm',
    name: 'CRM Systems',
    description: 'Customer Relationship Management Integrations.',
    icon: '📈',
    order: 3,
  },
  hrms: {
    id: 'hrms',
    name: 'HRMS',
    description: 'Human Resource Management Systems.',
    icon: '👥',
    order: 4,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise / ITSM',
    description: 'Enterprise IT Service Management Integrations.',
    icon: '🏢',
    order: 5,
  },
  'partner-solutions': {
    id: 'partner-solutions',
    name: 'Partner Solutions',
    description: 'First-party and verified partner AI platforms.',
    icon: '🤝',
    order: 6,
  }
};

import { googleCalendarProvider } from './googleCalendarProvider.js';
import { microsoftCalendarProvider } from './microsoftCalendarProvider.js';
import { whatsappProvider } from './whatsappProvider.js';
import { teamsProvider } from './teamsProvider.js';
import { slackProvider } from './slackProvider.js';
import { linkedinProvider } from './linkedinProvider.js';
import { naukriProvider } from './naukriProvider.js';
import { indeedProvider } from './indeedProvider.js';
import { enhanceProvider } from './enhanceProvider.js';
import { servicenowProvider } from './servicenowProvider.js';

import { salesforceProvider } from './salesforceProvider.js';
import { zohocrmProvider } from './zohocrmProvider.js';
import { sugarcrmProvider } from './sugarcrmProvider.js';
import { msdynamics365Provider } from './msdynamics365Provider.js';
import { hubspotProvider } from './hubspotProvider.js';

import { successfactorsProvider } from './successfactorsProvider.js';
import { workdayProvider } from './workdayProvider.js';
import { bamboohrProvider } from './bamboohrProvider.js';
import { oraclehcmProvider } from './oraclehcmProvider.js';
import { ukgproProvider } from './ukgproProvider.js';
import { adpProvider } from './adpProvider.js';

// We will import and export the actual providers here
export const PROVIDER_REGISTRY: Record<string, IntegrationProviderDef> = {};

export function registerProvider(def: IntegrationProviderDef) {
  PROVIDER_REGISTRY[def.id] = def;
}

registerProvider(googleCalendarProvider);
registerProvider(microsoftCalendarProvider);
registerProvider(whatsappProvider);
registerProvider(teamsProvider);
registerProvider(slackProvider);
registerProvider(linkedinProvider);
registerProvider(naukriProvider);
registerProvider(indeedProvider);
registerProvider(enhanceProvider);
registerProvider(servicenowProvider);

registerProvider(salesforceProvider);
registerProvider(zohocrmProvider);
registerProvider(sugarcrmProvider);
registerProvider(msdynamics365Provider);
registerProvider(hubspotProvider);

registerProvider(successfactorsProvider);
registerProvider(workdayProvider);
registerProvider(bamboohrProvider);
registerProvider(oraclehcmProvider);
registerProvider(ukgproProvider);
registerProvider(adpProvider);
