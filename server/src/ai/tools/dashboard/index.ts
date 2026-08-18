import { ToolRegistry } from '../../toolRegistry/index.js';
import { getDashboard } from '../../../services/analyticsService.js';
import { PERMISSIONS } from '@agnohire/shared';

const rawRegister = ToolRegistry.register.bind(ToolRegistry);
const register = (tool: Omit<Parameters<typeof rawRegister>[0], 'category'>) =>
  rawRegister({ permissions: [PERMISSIONS.ANALYTICS_VIEW], ...tool, category: 'reports' });

register({
  name: 'getDashboardStats',
  description: 'Get high-level hiring analytics, KPIs, and dashboard statistics like number of candidates, jobs, and interviews.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async (_args, ctx) => {
    return await getDashboard({ granularity: 'day' }, ctx);
  },
});
