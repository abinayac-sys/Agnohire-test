import { ToolRegistry } from '../../toolRegistry/index.js';
import { createBank, generateQuestions } from '../../../services/questionBankService.js';
import { resolveSectorAndDomain } from '../../../services/jobService.js';
import { prisma } from '../../../config/database.js';
import { PERMISSIONS } from '@agnohire/shared';
import type { Request } from 'express';

// Every tool here mutates, so default matches questionBank.routes.ts's write
// permission.
const rawRegister = ToolRegistry.register.bind(ToolRegistry);
const register = (tool: Omit<Parameters<typeof rawRegister>[0], 'category'>) =>
  rawRegister({ permissions: [PERMISSIONS.QUESTION_BANK_MANAGE], ...tool, category: 'general' });

/** The model sometimes ignores the `type` enum and sends a synonym (seen in
 * practice: "MULTIPLE_CHOICE" instead of "MCQ") — generateQuestions() does
 * an exact `=== 'MCQ'` check to decide whether to generate options at all,
 * so an unnormalized synonym silently produces plain-text questions with no
 * options despite the user asking for MCQs. */
function normalizeQuestionType(raw?: string): 'MCQ' | 'TEXT' | 'CODE' {
  const t = (raw || 'MCQ').toUpperCase();
  if (t === 'MCQ' || t.includes('MULTIPLE') || t.includes('CHOICE')) return 'MCQ';
  if (t === 'CODE' || t.includes('COD')) return 'CODE';
  return 'TEXT';
}

register({
  name: 'createQuestionBank',
  description: 'Create a new question bank and generate AI questions for it. Requires name. Sector and domain are auto-resolved if omitted.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the question bank (e.g. Aptitude)' },
      sectorName: { type: 'string', description: 'Optional sector name' },
      sectorId: { type: 'string', description: 'Optional sector UUID' },
      domainName: { type: 'string', description: 'Optional domain name' },
      domainId: { type: 'string', description: 'Optional domain UUID' },
      description: { type: 'string', description: 'Optional description' },
      isPublic: { type: 'boolean', description: 'Whether the bank is public (default true)' },
      count: { type: 'integer', description: 'Number of AI questions to generate into this bank (default 10)' },
      type: { type: 'string', description: 'Question type: MCQ, TEXT, or CODE (default MCQ)' },
      difficulty: { type: 'string', description: 'Difficulty: EASY, MEDIUM, or HARD (default MEDIUM)' },
      topic: { type: 'string', description: 'Specific topic/focus area for generated questions' }
    },
    required: ['name']
  },
  execute: async (args: any, ctx: any, req: any) => {
    const { name, description, isPublic = true, topic } = args;

    const resolved = await resolveSectorAndDomain(args.sectorName || args.sectorId, args.domainName || args.domainId);

    // 1. Create bank
    const bank = await createBank({
      name,
      sectorId: resolved.sectorId,
      domainId: resolved.domainId,
      description: description || `Question bank for ${name}`,
      isPublic,
    }, ctx, req as Request);

    // 2. Generate questions
    const questionCount = args.count ? Number(args.count) : 10;
    const qType = normalizeQuestionType(args.type);
    const qDiff = (args.difficulty || 'MEDIUM').toUpperCase();

    const questions = await generateQuestions(bank.id, {
      count: questionCount,
      type: qType,
      difficulty: qDiff as any,
      topic: topic || name,
    }, ctx, req as Request);

    return {
      success: true,
      bank,
      questionsCount: questions.length,
      questions,
      location: 'Question Bank page',
      message: `Question bank "${name}" created successfully with ${questions.length} questions. You can now view it on the Question Bank page.`
    };
  }
});

register({
  name: 'generateQuestions',
  description: 'Generate AI questions for a question bank by bank ID or bank name. If no bank with the given name exists yet, one is created automatically (sector/domain auto-resolved).',
  parameters: {
    type: 'object',
    properties: {
      bankId: { type: 'string', description: 'Optional Question Bank ID or name' },
      bankName: { type: 'string', description: 'Optional Question Bank name' },
      count: { type: 'integer', description: 'Number of questions to generate (default 10)' },
      type: { type: 'string', enum: ['MCQ', 'TEXT', 'CODE'], description: 'Question type (default MCQ). Use MCQ for multiple-choice.' },
      difficulty: { type: 'string', description: 'Difficulty: EASY, MEDIUM, HARD (default MEDIUM)' },
      topic: { type: 'string', description: 'Topic/focus area' }
    }
  },
  execute: async (args: any, ctx: any, req: any) => {
    const isUuid = (val?: string) => !!val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    // bankId's own description says it also accepts a name — honor that
    // rather than 404ing on `id: <name>` the way a literal UUID lookup would.
    let bankId = isUuid(args.bankId) ? args.bankId : undefined;
    const nameToResolve = !bankId ? (args.bankName || args.bankId) : undefined;
    if (!bankId && nameToResolve) {
      const bank = await prisma.questionBank.findFirst({
        where: { name: { contains: nameToResolve, mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' }
      });
      if (bank) bankId = bank.id;
    }
    if (!bankId && nameToResolve) {
      // A specific bank name was given but nothing matched — this used to
      // silently fall back to whatever bank was most recently created,
      // dumping the new questions into an unrelated bank while still
      // reporting success. Auto-create the named bank instead.
      const resolved = await resolveSectorAndDomain(undefined, undefined);
      const created = await createBank({
        name: nameToResolve,
        sectorId: resolved.sectorId,
        domainId: resolved.domainId,
        description: `Question bank for ${nameToResolve}`,
        isPublic: true,
      }, ctx, req as Request);
      bankId = created.id;
    }
    if (!bankId) {
      // No bank reference given at all (truly "add to whatever I'm
      // currently working on") — only here is falling back to the most
      // recent bank appropriate.
      const latestBank = await prisma.questionBank.findFirst({ orderBy: { createdAt: 'desc' } });
      bankId = latestBank?.id ?? 'draft';
    }

    const count = args.count ? Number(args.count) : 10;
    const type = normalizeQuestionType(args.type);
    const difficulty = (args.difficulty || 'MEDIUM').toUpperCase();

    const questions = await generateQuestions(bankId, {
      count,
      type,
      difficulty: difficulty as any,
      topic: args.topic || 'General',
    }, ctx, req as Request);

    return {
      success: true,
      bankId,
      questionsCount: questions.length,
      questions
    };
  }
});

register({
  name: 'importQuestionBankFromAttachment',
  description: 'Import questions into a Question Bank from a document attachment (PDF, DOCX, TXT, CSV).',
  parameters: {
    type: 'object',
    properties: {
      attachmentId: { type: 'string', description: 'The UUID of the uploaded document attachment' },
      bankId: { type: 'string', description: 'Optional Question Bank ID to import into. Defaults to draft.' },
    },
    required: ['attachmentId']
  },
  execute: async (args: any, ctx: any, req: any) => {
    const { attachmentId } = args;

    const { getAttachmentBytesById } = await import('../../../services/attachmentService.js');
    const attachment = await getAttachmentBytesById(attachmentId);
    if (!attachment) throw new Error('Attachment not found or empty');

    let bankId = args.bankId;
    let bankName = args.bankName;

    const isUuid = (val?: string | null) => !!val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    if (bankId && bankId !== 'draft' && !isUuid(bankId)) {
      const { prisma } = await import('../../../config/database.js');
      const { requireTenantId } = await import('../../../config/tenantContext.js');
      const tenantId = requireTenantId();
      
      const existingBank = await prisma.questionBank.findFirst({
        where: { name: { contains: bankId, mode: 'insensitive' }, tenantId }
      });
      if (existingBank) {
        bankId = existingBank.id;
      } else {
        bankName = bankId; // use it as the name instead
        bankId = undefined;
      }
    }

    const { importQuestionsFromDocument, createBank } = await import('../../../services/questionBankService.js');
    
    if (!bankId || bankId === 'draft') {
      const { resolveSectorAndDomain } = await import('../../../services/jobService.js');
      const resolved = await resolveSectorAndDomain(null, null);
      
      bankName = bankName || attachment.fileName.replace(/\.[^/.]+$/, "");
      
      const bank = await createBank({
        name: bankName,
        sectorId: resolved.sectorId,
        domainId: resolved.domainId,
        description: `Imported from ${attachment.fileName}`,
        isPublic: true,
        attachmentId,
      }, ctx, req);
      
      bankId = bank.id;
    }

    const questions = await importQuestionsFromDocument(
      bankId,
      attachment.buffer,
      attachment.mimeType,
      ctx,
      req
    );

    return {
      success: true,
      bankId,
      questionsCount: questions.length,
      questions,
      location: 'Question Bank page',
      message: `Question bank uploaded successfully with ${questions.length} questions. The task is fully complete. Do NOT tell the user it is processing or to check back later.`
    };
  }
});
