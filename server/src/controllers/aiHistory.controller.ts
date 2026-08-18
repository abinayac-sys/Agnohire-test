import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { runWithTenant } from '../config/tenantContext.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';

export async function saveHistory(req: Request, res: Response) {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new BadRequestError('Messages array is required and cannot be empty');
  }

  const tenantId = req.user!.tenantId || null;
  const userId = req.user!.sub;
  
  // Extract title from the first message
  let title = messages[0].content || 'New Chat';
  if (title.length > 50) {
    title = title.substring(0, 50) + '...';
  }

  const history = await runWithTenant(tenantId, async () => {
    return prisma.aiChatHistory.create({
      data: {
        title,
        messages,
        userId,
        tenantId,
      }
    });
  }, req.user!.role === 'SUPERADMIN'); // ADMIN is a per-tenant role, not a platform operator — must not bypass tenant scoping

  res.status(201).json({ success: true, data: history });
}

export async function getHistories(req: Request, res: Response) {
  const tenantId = req.user!.tenantId || null;
  const userId = req.user!.sub;

  const histories = await runWithTenant(tenantId, async () => {
    return prisma.aiChatHistory.findMany({
      where: {
        userId,
        deletedAt: null
      },
      orderBy: {
        createdAt: 'desc'
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
      }
    });
  }, req.user!.role === 'SUPERADMIN'); // ADMIN is a per-tenant role, not a platform operator — must not bypass tenant scoping

  res.json({ success: true, data: histories });
}

export async function getHistory(req: Request, res: Response) {
  const { id } = req.params;
  const tenantId = req.user!.tenantId || null;
  const userId = req.user!.sub;

  const history = await runWithTenant(tenantId, async () => {
    return prisma.aiChatHistory.findFirst({
      where: {
        id,
        userId,
        deletedAt: null
      }
    });
  }, req.user!.role === 'SUPERADMIN'); // ADMIN is a per-tenant role, not a platform operator — must not bypass tenant scoping

  if (!history) throw new NotFoundError('History not found');

  res.json({ success: true, data: history });
}

export async function deleteHistory(req: Request, res: Response) {
  const { id } = req.params;
  const tenantId = req.user!.tenantId || null;
  const userId = req.user!.sub;

  await runWithTenant(tenantId, async () => {
    const existing = await prisma.aiChatHistory.findFirst({
      where: { id, userId, deletedAt: null }
    });
    if (!existing) throw new NotFoundError('History not found');

    await prisma.aiChatHistory.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
  }, req.user!.role === 'SUPERADMIN'); // ADMIN is a per-tenant role, not a platform operator — must not bypass tenant scoping

  res.json({ success: true });
}
