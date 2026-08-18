import { Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { z } from 'zod';
import { logger } from '../config/logger.js';
import { getIO } from '../config/socket.js';

export async function createInterviewMeeting(req: Request, res: Response) {
  try {
    const user = req.user as { id?: string; sub?: string; tenantId?: string };
    const userId = user?.id || user?.sub;
    const tenantId = user?.tenantId;
    if (!userId || !tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const schema = z.object({
      interviewId: z.string().uuid(),
      commHubId: z.string().uuid()
    });

    const body = schema.parse(req.body);

    const interview = await prisma.interview.findUnique({
      where: { id: body.interviewId },
      include: {
        jobRequisition: true
      }
    });

    if (!interview) {
      return res.status(404).json({ success: false, error: 'Interview not found' });
    }

    // Check if meeting already exists
    const existingMeeting = await prisma.communicationMeeting.findUnique({
      where: { interviewId: body.interviewId }
    });

    if (existingMeeting) {
      return res.json({ success: true, data: existingMeeting });
    }

    const meeting = await prisma.communicationMeeting.create({
      data: {
        tenantId,
        commHubId: body.commHubId,
        interviewId: body.interviewId,
        title: `Interview Workspace - ${interview.id}`,
        description: 'Auto-generated interview workspace.',
        createdById: userId,
        status: 'ONGOING',
        startedAt: new Date()
      }
    });

    // Notify clients about the new interview meeting
    getIO().to(`workspace_${tenantId}`).emit('interview-meeting-created', meeting);

    res.json({ success: true, data: meeting });
  } catch (error: any) {
    logger.error('Error creating interview meeting:', error);
    res.status(400).json({ success: false, error: error.message });
  }
}

export async function getInterviewMeeting(req: Request, res: Response) {
  try {
    const user = req.user as { id?: string; sub?: string; tenantId?: string };
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { interviewId } = req.params;
    if (!interviewId) return res.status(400).json({ success: false, error: 'interviewId is required' });

    const meeting = await prisma.communicationMeeting.findUnique({
      where: { interviewId },
      include: {
        notes: true
      }
    });

    if (!meeting || meeting.tenantId !== tenantId) {
      return res.status(404).json({ success: false, error: 'Meeting not found for interview' });
    }

    res.json({ success: true, data: meeting });
  } catch (error: any) {
    logger.error('Error fetching interview meeting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
