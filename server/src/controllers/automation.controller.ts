import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { z } from 'zod';
import { UnauthorizedError } from '../utils/errors.js';

const createWorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trigger: z.string().min(1),
  rules: z.array(z.object({
    field: z.string(),
    operator: z.string(),
    value: z.string()
  })).optional(),
  actions: z.array(z.object({
    type: z.string(),
    payload: z.any().optional(),
    orderIndex: z.number().default(0)
  }))
});

export async function createWorkflow(req: Request, res: Response) {
  const user = req.user as { id?: string; sub?: string; tenantId?: string };
  const tenantId = user?.tenantId;
  const userId = user?.id || user?.sub;
  if (!tenantId || !userId) throw new UnauthorizedError();

  const body = createWorkflowSchema.parse(req.body);

  const workflow = await prisma.automationWorkflow.create({
    data: {
      tenantId,
      name: body.name,
      description: body.description,
      trigger: body.trigger,
      createdById: userId,
      rules: {
        create: body.rules || []
      },
      actions: {
        create: body.actions.map(a => ({
          type: a.type,
          payload: a.payload || {},
          orderIndex: a.orderIndex
        }))
      }
    },
    include: {
      rules: true,
      actions: true
    }
  });

  res.json({ success: true, data: workflow });
}

export async function getWorkflows(req: Request, res: Response) {
  const user = req.user as { tenantId?: string };
  if (!user?.tenantId) throw new UnauthorizedError();

  const workflows = await prisma.automationWorkflow.findMany({
    where: { tenantId: user.tenantId },
    include: { rules: true, actions: { orderBy: { orderIndex: 'asc' } } },
    orderBy: { createdAt: 'desc' }
  });

  res.json({ success: true, data: workflows });
}

export async function getAutomationLogs(req: Request, res: Response) {
  const user = req.user as { tenantId?: string };
  if (!user?.tenantId) throw new UnauthorizedError();

  const logs = await prisma.automationLog.findMany({
    where: { tenantId: user.tenantId },
    include: { workflow: { select: { name: true, trigger: true } } },
    orderBy: { executedAt: 'desc' },
    take: 100
  });

  res.json({ success: true, data: logs });
}
