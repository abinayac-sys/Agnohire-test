import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { z } from 'zod';
import { logger } from '../config/logger.js';
import { getIO } from '../config/socket.js';

export async function getCandidateTimeline(req: Request, res: Response) {
  try {
    const user = req.user as { id?: string; sub?: string; tenantId?: string };
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { candidateId } = req.params;
    if (!candidateId) return res.status(400).json({ success: false, error: 'candidateId is required' });

    const timelineEvents = await prisma.candidateTimelineEvent.findMany({
      where: { tenantId, candidateId },
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { id: true, fullName: true, avatarUrl: true } }
      }
    });

    res.json({ success: true, data: timelineEvents });
  } catch (error: any) {
    logger.error('Error fetching candidate timeline:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function createTimelineEvent(req: Request, res: Response) {
  try {
    const user = req.user as { id?: string; sub?: string; tenantId?: string };
    const actorId = user?.id || user?.sub;
    const tenantId = user?.tenantId;
    if (!actorId || !tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const schema = z.object({
      candidateId: z.string().uuid(),
      title: z.string().min(1),
      description: z.string().optional(),
      eventType: z.enum(['SYSTEM', 'COMMUNICATION', 'INTERVIEW', 'STAGE_CHANGE']).default('SYSTEM'),
      metadata: z.any().optional()
    });

    const body = schema.parse(req.body);

    const timelineEvent = await prisma.candidateTimelineEvent.create({
      data: {
        tenantId,
        candidateId: body.candidateId,
        title: body.title,
        description: body.description,
        eventType: body.eventType,
        metadata: body.metadata,
        actorId
      },
      include: {
        actor: { select: { id: true, fullName: true, avatarUrl: true } }
      }
    });

    // Notify clients about the new event
    getIO().to(`workspace_${tenantId}`).emit('candidate-timeline-updated', timelineEvent);

    res.json({ success: true, data: timelineEvent });
  } catch (error: any) {
    logger.error('Error creating candidate timeline event:', error);
    res.status(400).json({ success: false, error: error.message });
  }
}
