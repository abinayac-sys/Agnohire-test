import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import { resumeUpload } from '../utils/storage.js';
import * as bank from '../controllers/questionBank.controller.js';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.QUESTION_BANK_VIEW), bank.listBanks);
router.post('/', requirePermission(PERMISSIONS.QUESTION_BANK_MANAGE), bank.createBank);
router.get('/export', requirePermission(PERMISSIONS.QUESTION_BANK_VIEW), bank.exportBanksPdf);
router.get('/:id', requirePermission(PERMISSIONS.QUESTION_BANK_VIEW), bank.getBank);
router.patch('/:id', requirePermission(PERMISSIONS.QUESTION_BANK_MANAGE), bank.updateBank);
router.delete('/:id', requirePermission(PERMISSIONS.QUESTION_BANK_MANAGE), bank.deleteBank);

router.post('/:id/generate', requirePermission(PERMISSIONS.QUESTION_BANK_MANAGE), bank.generateQuestions);
router.post(
  '/:id/import-document',
  requirePermission(PERMISSIONS.QUESTION_BANK_MANAGE),
  resumeUpload.single('file'),
  bank.importDocument,
);
router.post('/:id/questions', requirePermission(PERMISSIONS.QUESTION_BANK_MANAGE), bank.addQuestion);
router.patch('/:id/questions/:qid', requirePermission(PERMISSIONS.QUESTION_BANK_MANAGE), bank.updateQuestion);
router.delete('/:id/questions/:qid', requirePermission(PERMISSIONS.QUESTION_BANK_MANAGE), bank.deleteQuestion);

export default router;
