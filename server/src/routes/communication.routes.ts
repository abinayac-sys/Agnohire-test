import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { authenticate } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as controller from '../controllers/communication.controller.js';
import * as hubController from '../controllers/communicationHub.controller.js';

const uploadsPath = path.resolve(process.cwd(), 'uploads/communication');

if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

const commUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsPath),
    filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'))
  }),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const router = Router();

router.use(authenticate);

router.get('/hub', asyncHandler(controller.getCommHubInfo));
router.get('/hubs/:commHubId/users', asyncHandler(controller.getCommHubUsersByCommHubId));
router.get('/channels', asyncHandler(controller.listChannels));
router.post('/channels', asyncHandler(controller.createChannel));
router.get('/channels/:channelId', asyncHandler(controller.getChannelDetails));
router.post('/channels/:channelId/archive', asyncHandler(controller.archiveChannel));
router.delete('/channels/:channelId', asyncHandler(controller.deleteChannel));
router.get('/channels/:channelId/messages', asyncHandler(controller.getChannelMessages));
router.get('/dm/:targetUserId/messages', asyncHandler(controller.getDMMessages));
router.post('/messages', asyncHandler(controller.sendMessage));
router.post('/messages/:messageId/reactions', asyncHandler(controller.addReaction));
router.post('/messages/:messageId/pin', asyncHandler(controller.pinMessage));
router.patch('/messages/:messageId', asyncHandler(controller.editMessage));
router.delete('/messages/:messageId', asyncHandler(controller.deleteMessage));
router.get('/users', asyncHandler(controller.getCommHubUsers));
router.get('/search', asyncHandler(controller.searchCommunication));
router.post('/invitations', asyncHandler(controller.inviteUsers));
router.post('/files', commUpload.single('file'), asyncHandler(controller.uploadFile));
router.post('/presence', asyncHandler(controller.updatePresence));
router.post('/read', asyncHandler(controller.markAsRead));
router.get('/livekit/token', asyncHandler(controller.getLiveKitToken));

// Phase 2 Routes
router.post('/meetings', asyncHandler(hubController.createMeeting));
router.get('/meetings', asyncHandler(hubController.getMeetings));

router.post('/tasks', asyncHandler(hubController.createTask));

router.post('/notes', asyncHandler(hubController.createNote));
router.get('/notes', asyncHandler(hubController.getNotes));

router.get('/dashboard', asyncHandler(hubController.getDashboardMetrics));

router.post('/settings', asyncHandler(hubController.updateSettings));

router.post('/ai/chat-summary', asyncHandler(hubController.summarizeChat));
router.get('/ai/meeting-summary/:meetingId', asyncHandler(hubController.summarizeMeeting));

// ---- PHASE 3: RECRUITMENT COMMUNICATION INTELLIGENCE ----
import * as timelineController from '../controllers/candidateTimeline.controller.js';
import * as interviewWorkspaceController from '../controllers/interviewWorkspace.controller.js';
import { CommunicationAiService } from '../services/communicationAi.service.js';

router.get('/timeline/:candidateId', asyncHandler(timelineController.getCandidateTimeline));
router.post('/timeline', asyncHandler(timelineController.createTimelineEvent));

router.post('/interview-workspace', asyncHandler(interviewWorkspaceController.createInterviewMeeting));
router.get('/interview-workspace/:interviewId', asyncHandler(interviewWorkspaceController.getInterviewMeeting));
router.post('/ai/interview-summary/:interviewId', asyncHandler(async (req, res) => {
  const user = req.user as { tenantId?: string };
  if (!user?.tenantId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const result = await CommunicationAiService.generateInterviewResult(user.tenantId, req.params.interviewId);
  res.json({ success: true, data: result });
}));

export default router;
