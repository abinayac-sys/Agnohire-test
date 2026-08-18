import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { z } from 'zod';
import { getIO } from '../config/socket.js';
import { logger } from '../config/logger.js';

// ---- MEETINGS API ----

export async function createMeeting(req: Request, res: Response) {
  try {
    const user = req.user as { id?: string; sub?: string; tenantId?: string };
    const userId = user?.id || user?.sub;
    const tenantId = user?.tenantId;
    if (!userId || !tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const schema = z.object({
      commHubId: z.string().uuid(),
      title: z.string().min(1),
      description: z.string().optional(),
      scheduledAt: z.string().datetime().optional()
    });

    const body = schema.parse(req.body);

    const meeting = await prisma.communicationMeeting.create({
      data: {
        tenantId,
        commHubId: body.commHubId,
        title: body.title,
        description: body.description,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
        createdById: userId,
        status: body.scheduledAt ? 'SCHEDULED' : 'ONGOING',
        startedAt: body.scheduledAt ? undefined : new Date()
      }
    });

    getIO().to(`tenant_${tenantId}`).emit('meeting-created', meeting);

    res.json({ success: true, data: meeting });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}

export async function getMeetings(req: Request, res: Response) {
  try {
    const user = req.user as { id?: string; sub?: string; tenantId?: string };
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { commHubId } = req.query;

    const meetings = await prisma.communicationMeeting.findMany({
      where: {
        tenantId,
        ...(commHubId ? { commHubId: commHubId as string } : {})
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: meetings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// ---- NOTES API ----

export async function createNote(req: Request, res: Response) {
  try {
    const user = req.user as { id?: string; sub?: string; tenantId?: string };
    const userId = user?.id || user?.sub;
    const tenantId = user?.tenantId;
    if (!userId || !tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const schema = z.object({
      meetingId: z.string().uuid().optional(),
      channelId: z.string().uuid().optional(),
      content: z.string()
    });

    const body = schema.parse(req.body);
    if (!body.meetingId && !body.channelId) {
      return res.status(400).json({ success: false, error: 'Must provide meetingId or channelId' });
    }

    const note = await prisma.communicationNote.create({
      data: {
        tenantId,
        meetingId: body.meetingId,
        channelId: body.channelId,
        content: body.content,
        lastEditedById: userId
      }
    });

    getIO().to(`tenant_${tenantId}`).emit('note-created', note);

    res.json({ success: true, data: note });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}

export async function getNotes(req: Request, res: Response) {
  try {
    const user = req.user as { id?: string; sub?: string; tenantId?: string };
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { meetingId, channelId } = req.query;

    const notes = await prisma.communicationNote.findMany({
      where: {
        tenantId,
        ...(meetingId ? { meetingId: meetingId as string } : {}),
        ...(channelId ? { channelId: channelId as string } : {})
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: notes });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// ---- TASKS API ----

import { notify } from '../services/notificationService.js';

export async function createTask(req: Request, res: Response) {
  try {
    const user = req.user as { id?: string; sub?: string; tenantId?: string };
    const userId = user?.id || user?.sub;
    const tenantId = user?.tenantId;
    if (!userId || !tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const schema = z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      dueDate: z.string().datetime().optional(),
      messageId: z.string().uuid().optional(),
      assigneeId: z.string().uuid().optional()
    });

    const body = schema.parse(req.body);

    const task = await prisma.communicationTask.create({
      data: {
        tenantId,
        title: body.title,
        description: body.description,
        priority: body.priority || 'MEDIUM',
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        messageId: body.messageId,
        assigneeId: body.assigneeId,
        createdById: userId
      },
      include: { message: true }
    });

    getIO().to(`tenant_${tenantId}`).emit('task-created', task);

    if (body.assigneeId) {
      await notify({
        recipientId: body.assigneeId,
        type: 'COMMUNICATION_TASK_ASSIGNMENT',
        title: 'New Task Assigned',
        message: `You were assigned a task: ${body.title}`,
        actorId: userId,
        entityType: 'COMMUNICATION_TASK',
        entityId: task.id
      }).catch(e => logger.error('Failed to notify task assignment', e));
    }

    res.json({ success: true, data: task });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}

// ---- DASHBOARD API ----

export async function getDashboardMetrics(req: Request, res: Response) {
  try {
    const user = req.user as { id?: string; sub?: string; tenantId?: string };
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [messagesToday, callsToday, onlineUsers, activeMeetings] = await Promise.all([
      prisma.communicationMessage.count({
        where: { tenantId, createdAt: { gte: today } }
      }),
      prisma.communicationCall.count({
        where: { tenantId, createdAt: { gte: today } }
      }),
      prisma.communicationPresence.count({
        where: { tenantId, status: 'ONLINE' }
      }),
      prisma.communicationMeeting.count({
        where: { tenantId, status: 'ONGOING' }
      })
    ]);

    res.json({
      success: true,
      data: {
        messagesToday,
        callsToday,
        onlineUsers,
        activeMeetings
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// ---- SETTINGS API ----

export async function updateSettings(req: Request, res: Response) {
  try {
    const user = req.user as { id?: string; sub?: string; tenantId?: string };
    const userId = user?.id || user?.sub;
    const tenantId = user?.tenantId;
    if (!userId || !tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const schema = z.object({
      notificationSound: z.boolean().optional(),
      desktopNotifications: z.boolean().optional(),
      defaultStatus: z.string().optional(),
      theme: z.string().optional(),
      autoJoinMeetings: z.boolean().optional()
    });

    const body = schema.parse(req.body);

    const settings = await prisma.communicationSettings.upsert({
      where: { userId },
      update: body,
      create: {
        userId,
        tenantId,
        ...body
      }
    });

    res.json({ success: true, data: settings });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
}

// ---- AI API ----

import { CommunicationAiService } from '../services/communicationAi.service.js';

export async function summarizeChat(req: Request, res: Response) {
  try {
    const user = req.user as { id?: string; sub?: string; tenantId?: string };
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { channelId, startDate, endDate } = req.body;
    if (!channelId) return res.status(400).json({ success: false, error: 'channelId is required' });

    const result = await CommunicationAiService.summarizeChat(
      tenantId,
      channelId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function summarizeMeeting(req: Request, res: Response) {
  try {
    const user = req.user as { id?: string; sub?: string; tenantId?: string };
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { meetingId } = req.params;
    if (!meetingId) return res.status(400).json({ success: false, error: 'meetingId is required' });

    const result = await CommunicationAiService.summarizeMeeting(tenantId, meetingId);

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}
