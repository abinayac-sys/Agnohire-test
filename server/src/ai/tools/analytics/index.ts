import { ToolRegistry } from '../../toolRegistry/index.js';
import { listCandidates } from '../../../services/candidateService.js';
import { PERMISSIONS } from '@agnohire/shared';

// Despite the directory name, these are candidate pipeline-status lookups,
// not analytics. All read-only, so CANDIDATE_VIEW (the same floor
// candidate.routes.ts GETs require) covers every tool here.
const rawRegister = ToolRegistry.register.bind(ToolRegistry);
const register = (tool: Omit<Parameters<typeof rawRegister>[0], 'category'>) =>
  rawRegister({ permissions: [PERMISSIONS.CANDIDATE_VIEW], ...tool, category: 'candidates' });

register({
  name: 'getSelectedCandidates',
  description: 'Retrieve a list of selected candidates.',
  parameters: { type: 'object', properties: {} },
  execute: async (_args, ctx) => {
    return await listCandidates({ page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' }, ctx);
  },
});

register({
  name: 'getRejectedCandidates',
  description: 'Retrieve a list of rejected candidates.',
  parameters: { type: 'object', properties: {} },
  execute: async (_args, ctx) => {
    return await listCandidates({ page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' }, ctx);
  },
});

register({
  name: 'getCompletedCandidates',
  description: 'Retrieve candidates who have completed their interviews.',
  parameters: { type: 'object', properties: {} },
  execute: async (_args, ctx) => {
    return await listCandidates({ page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' }, ctx);
  },
});

register({
  name: 'getPendingCandidates',
  description: 'Retrieve candidates with pending interviews or actions.',
  parameters: { type: 'object', properties: {} },
  execute: async (_args, ctx) => {
    return await listCandidates({ page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' }, ctx);
  },
});
