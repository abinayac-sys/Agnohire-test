import { ToolRegistry } from '../../toolRegistry/index.js';
import { generateInterviewReportPDF } from '../../../services/pdfReportService.js';
import { PERMISSIONS } from '@agnohire/shared';

const rawRegister = ToolRegistry.register.bind(ToolRegistry);
const register = (tool: Omit<Parameters<typeof rawRegister>[0], 'category'>) =>
  rawRegister({ permissions: [PERMISSIONS.ANALYTICS_VIEW], ...tool, category: 'analytics' });

register({
  name: 'generateReport',
  description: 'Generate a PDF report for a given interview.',
  parameters: {
    type: 'object',
    properties: {
      interviewId: { type: 'string', description: 'ID of the interview' },
    },
    required: ['interviewId'],
  },
  execute: async (args) => {
    // Generate the PDF buffer
    await generateInterviewReportPDF(args.interviewId);
    return { success: true, message: 'PDF generated successfully.' };
  },
});
