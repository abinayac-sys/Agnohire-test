import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';

import * as hrApproval from '../controllers/hrApproval.controller.js';

const router = Router();
router.use(authenticate);

router.get('/queue', hrApproval.getApprovalQueue);
router.get('/processed', hrApproval.getProcessedQueue);
router.get('/report/:candidateId', hrApproval.getConsolidatedReport);
router.post('/process/:interviewId', hrApproval.processHrApproval);
router.delete('/process/:interviewId', hrApproval.deleteHrApproval);

export default router;
