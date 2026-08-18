import { ToolRegistry } from '../../toolRegistry/index.js';
import { notify } from '../../../services/notificationService.js';

ToolRegistry.register({
  name: 'sendNotification',
  description: 'Send a notification or reminder to a user.',
  // An internal in-app notification carries no candidate PII and
  // notification.routes.ts requires nothing beyond authentication.
  publicTool: true,
  parameters: {
    type: 'object',
    properties: {
      userId: { type: 'string' },
      title: { type: 'string' },
      message: { type: 'string' },
      type: { type: 'string' },
    },
    required: ['userId', 'title', 'message'],
  },
  execute: async (args) => {
    // notify() returns void (it's fire-and-forget: create + socket push), so
    // without building a confirmation payload here the tool result carried
    // no data at all for the model to relay back to the user.
    await notify({
      recipientId: args.userId,
      title: args.title,
      message: args.message,
      type: args.type || 'SYSTEM',
    });
    return { success: true, data: { sent: true, userId: args.userId, title: args.title } };
  },
});
