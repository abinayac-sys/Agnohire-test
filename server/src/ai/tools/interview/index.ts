import '../interviewTools.js';
import { ToolRegistry } from '../../toolRegistry/index.js';
import { listInterviews, getInterview } from '../../../services/interviewService.js';
import { PERMISSIONS } from '@agnohire/shared';

const rawRegister = ToolRegistry.register.bind(ToolRegistry);
const register = (tool: Omit<Parameters<typeof rawRegister>[0], 'category'>) =>
  rawRegister({ permissions: [PERMISSIONS.INTERVIEW_VIEW], ...tool, category: 'interviews' });

register({
  name: 'getInterview',
  description: 'Get details of a specific interview.',
  parameters: {
    type: 'object',
    properties: {
      interviewId: { type: 'string' },
    },
  },
  execute: async (args: any, ctx: any) => {
    return await getInterview(args.interviewId, ctx);
  },
});

register({
  name: 'getInterviews',
  description: 'Get a list of interviews.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async (_args: any, ctx: any) => {
    return await listInterviews({ page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' }, ctx);
  },
});
