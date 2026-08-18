import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../config/database.js';
import { requireTenantId, runAsPlatform } from '../config/tenantContext.js';
import { recordAudit } from './auditService.js';
import { chatJson } from './aiProviderService.js';
import { extractDocumentRows } from '../utils/storage.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { paginate } from '../utils/response.js';
import {
  ROLES,
  DIFFICULTY_POINTS,
  type Difficulty,
  type CreateQuestionBankInput,
  type UpdateQuestionBankInput,
  type QuestionBankFilters,
  type CreateQuestionInput,
  type UpdateQuestionInput,
  type GenerateQuestionsInput,
  type QuestionItem,
  type McqOption,
} from '@agnohire/shared';
import type { Request } from 'express';

export interface InterviewContext {
  userId: string;
  role: string;
  sectorId?: string | null;
  permissions: string[];
}

function isSuperOrAdmin(role: string) {
  return role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === ROLES.HR;
}

/**
 * Visibility filter for question banks.
 *
 * QuestionBank.tenantId is required and every query already runs inside the
 * caller's tenant context (RLS choke point), so tenant isolation is handled
 * beneath this — there is no cross-tenant leakage to additionally filter for
 * here. (A prior "hide banks authored by a platform operator" carve-out was
 * removed: it keyed off role name alone, which meant a tenant's own SUPERADMIN
 * — the sole top-tier role after consolidating away the separate
 * PLATFORM_SUPERADMIN role — had every bank they created hidden from their
 * own teammates in the same tenant.)
 */
async function resolveBankScope(_ctx: InterviewContext): Promise<Prisma.QuestionBankWhereInput> {
  return {};
}

const BANK_LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  isPublic: true,
  createdAt: true,
  domain: { select: { id: true, name: true } },
  attachment: { select: { id: true, fileName: true, mimeType: true } },
  _count: { select: { questions: { where: { deletedAt: null } } } },
} satisfies Prisma.QuestionBankSelect;

interface RawQuestion {
  id: string;
  text: string;
  type: string;
  difficulty: string;
  options: Prisma.JsonValue;
  rubric: string | null;
  testCases: Prisma.JsonValue;
  tags: string[];
  aiGenerated: boolean;
  orderIndex: number;
}

export function maxScoreFor(difficulty: string): number {
  return DIFFICULTY_POINTS[difficulty as Difficulty] ?? 10;
}

export function mapQuestion(q: RawQuestion): QuestionItem {
  return {
    id: q.id,
    text: q.text,
    type: q.type as QuestionItem['type'],
    difficulty: q.difficulty as Difficulty,
    options: Array.isArray(q.options) ? (q.options as unknown as McqOption[]) : null,
    rubric: q.rubric,
    testCases: Array.isArray(q.testCases) ? (q.testCases as unknown as QuestionItem['testCases']) : null,
    tags: q.tags,
    maxScore: maxScoreFor(q.difficulty),
    orderIndex: q.orderIndex,
    aiGenerated: q.aiGenerated,
  };
}

const QUESTION_SELECT = {
  id: true,
  text: true,
  type: true,
  difficulty: true,
  options: true,
  rubric: true,
  testCases: true,
  tags: true,
  aiGenerated: true,
  orderIndex: true,
} satisfies Prisma.QuestionSelect;

// ─── BANKS ────────────────────────────────────────────────────────────────

export async function listBanks(filters: QuestionBankFilters, ctx: InterviewContext) {
  const { page, limit, search, domainId, sortBy, sortOrder } = filters;
  const where: Prisma.QuestionBankWhereInput = {
    ...(await resolveBankScope(ctx)),
    ...(domainId && { domainId }),
    ...(search && { name: { contains: search, mode: 'insensitive' } }),
  };
  const [total, items] = await Promise.all([
    prisma.questionBank.count({ where }),
    prisma.questionBank.findMany({
      where,
      select: BANK_LIST_SELECT,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return paginate(items, total, page, limit);
}

export async function getBank(id: string, ctx: InterviewContext) {
  const bank = await prisma.questionBank.findFirst({
    where: { id, ...(await resolveBankScope(ctx)) },
    select: {
      ...BANK_LIST_SELECT,
      questions: {
        where: { deletedAt: null },
        orderBy: { orderIndex: 'asc' },
        select: QUESTION_SELECT,
      },
    },
  });
  if (!bank) throw new NotFoundError('Question bank not found');
  return { ...bank, questions: bank.questions.map(mapQuestion) };
}

export async function createBank(data: CreateQuestionBankInput, ctx: InterviewContext, req: Request) {
  const trimmedName = data.name.trim();

  let tenantId: string;
  try {
    tenantId = requireTenantId();
  } catch (err) {
    if (isSuperOrAdmin(ctx.role)) {
      const defaultTenant = await prisma.tenant.findFirst();
      if (!defaultTenant) throw new Error('No tenant found in the system.');
      tenantId = defaultTenant.id;
    } else {
      throw err;
    }
  }

  // Prevent duplicate Question Bank names. Case-sensitive (unlike
  // Sector/Domain) to match the partial unique index (tenantId, name) WHERE
  // deletedAt IS NULL.
  const existingBank = await prisma.questionBank.findFirst({
    where: {
      name: trimmedName,
      deletedAt: null,
      tenantId
    }
  });
  if (existingBank) {
    throw new BadRequestError('A question bank with this name already exists.');
  }

  let domainId = data.domainId;
  if (!domainId) {
    // Scoped to this tenant — an unscoped findFirst() here would grab an
    // arbitrary domain from ANY tenant (Domain.tenantId is required, so every
    // row belongs to exactly one), producing a cross-tenant domainId that
    // later fails with "Field domain is required to return data, got null"
    // once RLS hides that other tenant's domain from this tenant's session.
    const defaultDomain = await runAsPlatform(() => prisma.domain.findFirst({
      where: { deletedAt: null, tenantId }
    }));
    if (!defaultDomain) {
      throw new BadRequestError('No domain found in the system. Cannot create question bank.');
    }
    domainId = defaultDomain.id;
  } else {
    const domain = await prisma.domain.findFirst({ where: { id: domainId } });
    if (!domain) throw new BadRequestError('Domain not found');
  }

  const isPublic = true;
  const sectorId = null;

  // Must use tenantTransaction, not a raw prisma.$transaction — the latter
  // re-enters the RLS-GUC extension on every statement inside the callback,
  // which nests a fresh base.$transaction() per statement instead of sharing
  // the outer one. That nesting can throw before any known-Prisma-error branch
  // in error.middleware.ts recognizes it, surfacing as a raw 500 instead of a
  // clean 4xx. tenantTransaction sets the tenant GUCs once and keeps every
  // statement in `fn` on that same already-scoped connection.
  // The findFirst check above is check-then-act and can race two concurrent
  // creates of the same name; the partial unique index (tenantId, name)
  // WHERE deletedAt IS NULL is the real guard, so a P2002 here still needs
  // translating into the same friendly error.
  let bank;
  try {
    bank = await tenantTransaction(async (tx) => {
      const newBank = await tx.questionBank.create({
        data: {
          name: trimmedName,
          domainId,
          description: data.description || null,
          isPublic,
          createdById: ctx.userId,
          sectorId,
          tenantId,
          attachmentId: data.attachmentId || null,
        },
        select: BANK_LIST_SELECT,
      });

      if (data.questions && data.questions.length > 0) {
        for (const q of data.questions) {
          await tx.question.create({
            data: {
              bankId: newBank.id,
              domainId,
              text: q.text,
              type: q.type,
              difficulty: q.difficulty,
              rubric: q.rubric || null,
              orderIndex: q.orderIndex,
              tags: q.tags,
              aiGenerated: q.aiGenerated || false,
              tenantId,
              ...(q.type === 'MCQ' && q.options && {
                options: q.options as any,
              }),
              ...(q.type === 'CODE' && (q as any).testCases && {
                testCases: (q as any).testCases as any,
              }),
            },
          });
        }
      }

      return newBank;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new BadRequestError('A question bank with this name already exists.');
    }
    throw err;
  }

  await recordAudit(req, {
    action: 'CREATE',
    entity: 'QuestionBank',
    entityId: bank.id,
    description: `Created question bank: ${bank.name}`,
  });
  return bank;
}

export async function updateBank(
  id: string,
  data: UpdateQuestionBankInput,
  ctx: InterviewContext,
  req: Request,
) {
  const existing = await prisma.questionBank.findFirst({ where: { id, ...(await resolveBankScope(ctx)) } });
  if (!existing) throw new NotFoundError('Question bank not found');

  if (data.name !== undefined && data.name.trim() !== existing.name) {
    const trimmedName = data.name.trim();
    // Case-sensitive — matches the partial unique index (tenantId, name)
    // WHERE deletedAt IS NULL.
    const nameExists = await prisma.questionBank.findFirst({
      where: { name: trimmedName, tenantId: existing.tenantId, deletedAt: null, id: { not: id } },
    });
    if (nameExists) {
      throw new BadRequestError('A question bank with this name already exists.');
    }
  }

  // See createBank(): findFirst above is check-then-act, so a P2002 from the
  // partial unique index (tenantId, name) WHERE deletedAt IS NULL still
  // needs translating into the same friendly error.
  let bank;
  try {
    bank = await prisma.questionBank.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.domainId != null && { domainId: data.domainId }),
        ...(data.description !== undefined && { description: data.description || null }),
        ...(data.isPublic !== undefined && { isPublic: data.isPublic }),
      },
      select: BANK_LIST_SELECT,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new BadRequestError('A question bank with this name already exists.');
    }
    throw err;
  }
  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'QuestionBank',
    entityId: id,
    description: `Updated question bank: ${bank.name}`,
  });
  return bank;
}

export async function deleteBank(id: string, ctx: InterviewContext, req: Request) {
  const existing = await prisma.questionBank.findFirst({ where: { id, ...(await resolveBankScope(ctx)) } });
  if (!existing) throw new NotFoundError('Question bank not found');
  await prisma.questionBank.delete({ where: { id } });
  await recordAudit(req, {
    action: 'DELETE',
    entity: 'QuestionBank',
    entityId: id,
    description: `Deleted question bank: ${existing.name}`,
  });
}

// ─── QUESTIONS ──────────────────────────────────────────────────────────────

async function requireBank(bankId: string, ctx: InterviewContext) {
  const bank = await prisma.questionBank.findFirst({
    where: { id: bankId, ...(await resolveBankScope(ctx)) },
    select: { id: true, domainId: true },
  });
  if (!bank) throw new NotFoundError('Question bank not found');
  return bank;
}

export async function addQuestion(
  bankId: string,
  data: CreateQuestionInput,
  ctx: InterviewContext,
  req: Request,
) {
  const bank = await requireBank(bankId, ctx);
  const q = await prisma.question.create({
    data: {
      bankId,
      domainId: bank.domainId,
      tenantId: requireTenantId(),
      text: data.text,
      type: data.type,
      difficulty: data.difficulty,
      options: data.type === 'MCQ' ? (data.options as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      rubric: data.rubric || null,
      testCases: data.type === 'CODE' && data.testCases?.length
        ? (data.testCases as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      tags: data.tags,
      orderIndex: data.orderIndex,
    },
    select: QUESTION_SELECT,
  });
  await recordAudit(req, {
    action: 'CREATE',
    entity: 'Question',
    entityId: q.id,
    description: `Added question to bank ${bankId}`,
  });
  return mapQuestion(q);
}

export async function updateQuestion(
  bankId: string,
  questionId: string,
  data: UpdateQuestionInput,
  ctx: InterviewContext,
  req: Request,
) {
  await requireBank(bankId, ctx);
  const existing = await prisma.question.findFirst({ where: { id: questionId, bankId } });
  if (!existing) throw new NotFoundError('Question not found');

  const nextType = data.type ?? existing.type;
  const q = await prisma.question.update({
    where: { id: questionId },
    data: {
      ...(data.text !== undefined && { text: data.text }),
      ...(data.type !== undefined && { type: data.type }),
      ...(data.difficulty !== undefined && { difficulty: data.difficulty }),
      ...(data.options !== undefined && {
        options: nextType === 'MCQ' ? (data.options as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      }),
      ...(data.rubric !== undefined && { rubric: data.rubric || null }),
      ...(data.testCases !== undefined && {
        testCases: nextType === 'CODE' && data.testCases?.length
          ? (data.testCases as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
      }),
      ...(data.tags !== undefined && { tags: data.tags }),
      ...(data.orderIndex !== undefined && { orderIndex: data.orderIndex }),
    },
    select: QUESTION_SELECT,
  });
  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'Question',
    entityId: questionId,
    description: `Updated question ${questionId}`,
  });
  return mapQuestion(q);
}

export async function deleteQuestion(
  bankId: string,
  questionId: string,
  ctx: InterviewContext,
  req: Request,
) {
  await requireBank(bankId, ctx);
  const existing = await prisma.question.findFirst({ where: { id: questionId, bankId } });
  if (!existing) throw new NotFoundError('Question not found');
  await prisma.question.delete({ where: { id: questionId } });
  await recordAudit(req, {
    action: 'DELETE',
    entity: 'Question',
    entityId: questionId,
    description: `Deleted question ${questionId}`,
  });
}

// ─── AI GENERATION ──────────────────────────────────────────────────────────

interface AiMcqOption {
  text?: unknown;
  correct?: unknown;
}
interface AiQuestion {
  text?: unknown;
  options?: unknown;
  rubric?: unknown;
}

/** Coerce one raw model question into a valid CreateQuestion-shaped record. */
function normalizeAiQuestion(
  raw: AiQuestion,
  type: GenerateQuestionsInput['type'],
): { text: string; options: McqOption[] | null; rubric: string | null } | null {
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (text.length < 3) return null;

  if (type === 'MCQ') {
    const opts = Array.isArray(raw.options)
      ? (raw.options as AiMcqOption[])
        .map((o) => ({ text: typeof o.text === 'string' ? o.text.trim() : '', correct: o.correct === true }))
        .filter((o) => o.text.length > 0)
      : [];
    if (opts.length < 2 || !opts.some((o) => o.correct)) return null;
    // Force exactly one correct option: MCQ grading treats the first correct as
    // THE answer, so collapse any extra correct flags the model may have set.
    let correctSeen = false;
    const single = opts.map((o) => {
      const correct = o.correct && !correctSeen;
      if (correct) correctSeen = true;
      return { text: o.text, correct };
    });
    return { text, options: single, rubric: null };
  }

  const rubric = typeof raw.rubric === 'string' ? raw.rubric.trim() : '';
  return { text, options: null, rubric: rubric || null };
}

export async function generateQuestions(
  bankId: string,
  data: GenerateQuestionsInput,
  ctx: InterviewContext,
  req: Request,
): Promise<QuestionItem[]> {
  const isDraft = bankId === 'draft';
  let bankName = 'Draft Bank';
  let domainId = '';
  let domainName = '';

  if (!isDraft) {
    const bank = await prisma.questionBank.findFirst({
      where: { id: bankId, ...(await resolveBankScope(ctx)) },
      select: { id: true, name: true, domainId: true, domain: { select: { name: true } } },
    });
    if (!bank) throw new NotFoundError('Question bank not found');
    bankName = bank.name;
    domainId = bank.domainId;
    domainName = bank.domain.name;
  } else {
    const defaultDomain = await prisma.domain.findFirst({ where: { deletedAt: null } });
    domainId = defaultDomain?.id ?? '';
    domainName = defaultDomain?.name ?? 'General';
  }

  const focus = (data.topic && data.topic.trim()) || domainName;
  const isMcq = data.type === 'MCQ';
  const shape = isMcq
    ? '{"text": string, "options": [{"text": string, "correct": boolean}]}  // 4 options, exactly one correct'
    : '{"text": string, "rubric": string}  // rubric describes what a strong answer must contain';

  const content = await chatJson<{ questions?: AiQuestion[] }>(
    [
      {
        role: 'system',
        content:
          'You are an expert technical interviewer who writes clear, unambiguous, non-trivial interview questions. Respond ONLY with a JSON object.',
      },
      {
        role: 'user',
        content:
          `Generate ${data.count} ${data.difficulty} difficulty ${data.type} interview question(s) about "${focus}".\n` +
          `Return JSON: {"questions": [${shape}]}.\n` +
          (isMcq
            ? 'Each MCQ must have exactly 4 plausible options with exactly one correct.'
            : 'Each question must include a concise grading rubric.') +
          ' Do not number the questions. Keep each question self-contained.',
      },
    ],
    { sectorId: ctx.sectorId ?? null, temperature: 0.7, maxTokens: 4000 },
  );

  const candidates = Array.isArray(content.questions) ? content.questions : [];
  const normalized = candidates
    .map((q) => normalizeAiQuestion(q, data.type))
    .filter((q): q is NonNullable<typeof q> => q !== null)
    .slice(0, data.count);

  if (normalized.length === 0) {
    throw new BadRequestError('The AI did not return any valid questions — try again or adjust the topic.');
  }

  if (isDraft) {
    let nextOrder = 0;
    const result: QuestionItem[] = normalized.map((q) => ({
      id: randomUUID(),
      bankId: 'draft',
      domainId,
      text: q.text,
      type: data.type,
      difficulty: data.difficulty,
      maxScore: maxScoreFor(data.difficulty),
      options: q.options ? (q.options as any) : [],
      rubric: q.rubric || null,
      testCases: null,
      tags: [],
      aiGenerated: true,
      orderIndex: nextOrder++,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    return result;
  }

  const agg = await prisma.question.aggregate({
    where: { bankId },
    _max: { orderIndex: true },
  });
  let nextOrder = (agg._max.orderIndex ?? -1) + 1;

  const created = await tenantTransaction((tx) =>
    Promise.all(
      normalized.map((q) =>
        tx.question.create({
          data: {
            bankId,
            domainId,
            tenantId: requireTenantId(),
            text: q.text,
            type: data.type,
            difficulty: data.difficulty,
            options: q.options ? (q.options as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            rubric: q.rubric,
            tags: [],
            aiGenerated: true,
            orderIndex: nextOrder++,
          },
          select: QUESTION_SELECT,
        }),
      ),
    ),
  );

  await recordAudit(req, {
    action: 'CREATE',
    entity: 'QuestionBank',
    entityId: bankId,
    description: `AI-generated ${created.length} ${data.type} question(s) for bank ${bankName}`,
  });

  return created.map(mapQuestion);
}

// ─── DOCUMENT IMPORT (PDF / Word / text → AI-structured questions) ────────────

const VALID_TYPES = ['MCQ', 'TEXT', 'CODE'];
const VALID_DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];

interface AiImportedQuestion extends AiQuestion {
  type?: unknown;
  difficulty?: unknown;
  tags?: unknown;
}

interface NormalizedImport {
  text: string;
  type: QuestionItem['type'];
  difficulty: Difficulty;
  options: McqOption[] | null;
  rubric: string | null;
  tags: string[];
}

/** Coerce a model-extracted question (mixed type) into a valid record. */
function normalizeImportedQuestion(raw: AiImportedQuestion): NormalizedImport | null {
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (text.length < 3) return null;

  let type = (typeof raw.type === 'string' ? raw.type.toUpperCase() : 'TEXT') as QuestionItem['type'];
  if (!VALID_TYPES.includes(type)) type = 'TEXT';
  let difficulty = (typeof raw.difficulty === 'string' ? raw.difficulty.toUpperCase() : 'MEDIUM') as Difficulty;
  if (!VALID_DIFFICULTIES.includes(difficulty)) difficulty = 'MEDIUM';

  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean).slice(0, 10)
    : [];

  if (type === 'MCQ') {
    const opts = Array.isArray(raw.options)
      ? (raw.options as AiMcqOption[])
        .map((o) => ({ text: typeof o.text === 'string' ? o.text.trim() : '', correct: o.correct === true }))
        .filter((o) => o.text.length > 0)
      : [];
    // Unusable MCQ (no/insufficient options or no correct answer) → keep as written answer.
    if (opts.length < 2 || !opts.some((o) => o.correct)) {
      return { text, type: 'TEXT', difficulty, options: null, rubric: null, tags };
    }
    let correctSeen = false;
    const single = opts.map((o) => {
      const correct = o.correct && !correctSeen;
      if (correct) correctSeen = true;
      return { text: o.text, correct };
    });
    return { text, type: 'MCQ', difficulty, options: single, rubric: null, tags };
  }

  const rubric = typeof raw.rubric === 'string' ? raw.rubric.trim() : '';
  return { text, type, difficulty, options: null, rubric: rubric || null, tags };
}

/** Parse an MCQ option string ("A*|B|C" — '*' marks the correct one). */
function parseOptionString(raw: string): McqOption[] {
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith('*') ? { text: s.slice(0, -1).trim(), correct: true } : { text: s, correct: false }));
}

/**
 * Deterministically turn a document's extracted grid (a table with the same
 * columns as the CSV template) into questions — no AI required. Returns [] when
 * the grid has no recognizable header, so callers can fall back to AI.
 */
function rowsToQuestions(rows: string[][]): NormalizedImport[] {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (!header.includes('text') || !header.includes('type')) return [];
  const col = (name: string) => header.indexOf(name);
  const ci = {
    text: col('text'),
    type: col('type'),
    difficulty: col('difficulty'),
    tags: col('tags'),
    rubric: col('rubric'),
    options: col('options'),
  };
  const out: NormalizedImport[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (idx: number) => (idx >= 0 ? (r[idx] ?? '').trim() : '');
    const text = get(ci.text);
    if (text.length < 3) continue;
    const type = get(ci.type).toUpperCase();
    const normalized = normalizeImportedQuestion({
      text,
      type,
      difficulty: get(ci.difficulty).toUpperCase(),
      tags: get(ci.tags) ? get(ci.tags).split(';').map((t) => t.trim()).filter(Boolean) : [],
      rubric: get(ci.rubric),
      options: type === 'MCQ' ? parseOptionString(get(ci.options)) : undefined,
    });
    if (normalized) out.push(normalized);
  }
  return out;
}

/**
 * Imports questions from an uploaded document (PDF / DOCX / TXT). A structured
 * questions table is parsed directly (no AI needed); otherwise the free-form
 * text is sent to the AI for extraction (which requires a configured key).
 */
export async function importQuestionsFromDocument(
  bankId: string,
  buffer: Buffer,
  mimeType: string,
  ctx: InterviewContext,
  req: Request,
): Promise<QuestionItem[]> {
  const isDraft = bankId === 'draft';
  let bankName = 'Draft Bank';
  let domainId = '';

  if (!isDraft) {
    const bank = await prisma.questionBank.findFirst({
      where: { id: bankId, ...(await resolveBankScope(ctx)) },
      select: { id: true, name: true, domainId: true },
    });
    if (!bank) throw new NotFoundError('Question bank not found');
    bankName = bank.name;
    domainId = bank.domainId;
  } else {
    const defaultDomain = await prisma.domain.findFirst({ where: { deletedAt: null } });
    domainId = defaultDomain?.id ?? '';
  }

  const { rows, rawText } = await extractDocumentRows(buffer, mimeType);

  // 1) Deterministic: a questions table in the document (DOCX table, or a
  //    delimited PDF/TXT grid) imports directly without any AI.
  let normalized = rowsToQuestions(rows);
  const viaAi = normalized.length === 0;

  // 2) Free-form prose → AI extraction (throws a clear error if no AI key).
  if (viaAi) {
    if (!rawText.trim()) {
      throw new BadRequestError('No readable text could be extracted from this document.');
    }
    const clipped = rawText.slice(0, 16_000);
    const content = await chatJson<{ questions?: AiImportedQuestion[] }>(
      [
        {
          role: 'system',
          content:
            'You extract interview and assessment questions from a document and return them as structured JSON. Respond ONLY with a JSON object.',
        },
        {
          role: 'user',
          content:
            'Extract every distinct question from the document below. For each question return: ' +
            '{"text": string, "type": "MCQ"|"TEXT"|"CODE", "difficulty": "EASY"|"MEDIUM"|"HARD", ' +
            '"options": [{"text": string, "correct": boolean}] (MCQ only — include the choices and mark exactly one correct), ' +
            '"rubric": string (TEXT/CODE only — what a strong answer should contain), "tags": string[]}. ' +
            'Infer the type and difficulty from context (a coding task is CODE, a multiple-choice item is MCQ, otherwise TEXT). ' +
            'Only use questions that actually appear in the document — do not invent new ones. ' +
            'Return JSON: {"questions": [ ... ]}.\n\nDocument:\n"""\n' +
            clipped +
            '\n"""',
        },
      ],
      { sectorId: ctx.sectorId ?? null, temperature: 0.2, maxTokens: 4000 },
    );
    const candidates = Array.isArray(content.questions) ? content.questions : [];
    normalized = candidates
      .map(normalizeImportedQuestion)
      .filter((q): q is NormalizedImport => q !== null);
  }

  if (normalized.length === 0) {
    throw new BadRequestError('No questions could be extracted from this document. Check the file or try a clearer format.');
  }

  if (isDraft) {
    let nextOrder = 0;
    const result: QuestionItem[] = normalized.map((q) => ({
      id: randomUUID(),
      bankId: 'draft',
      domainId,
      text: q.text,
      type: q.type,
      difficulty: q.difficulty,
      maxScore: maxScoreFor(q.difficulty),
      options: q.options ? (q.options as any) : [],
      rubric: q.rubric || null,
      testCases: null,
      tags: q.tags,
      aiGenerated: viaAi,
      orderIndex: nextOrder++,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    return result;
  }

  const agg = await prisma.question.aggregate({ where: { bankId }, _max: { orderIndex: true } });
  let nextOrder = (agg._max.orderIndex ?? -1) + 1;

  const created = await tenantTransaction((tx) =>
    Promise.all(
      normalized.map((q) =>
        tx.question.create({
          data: {
            bankId,
            domainId,
            tenantId: requireTenantId(),
            text: q.text,
            type: q.type,
            difficulty: q.difficulty,
            options: q.options ? (q.options as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            rubric: q.rubric,
            tags: q.tags,
            aiGenerated: viaAi,
            orderIndex: nextOrder++,
          },
          select: QUESTION_SELECT,
        }),
      ),
    ),
  );

  await recordAudit(req, {
    action: 'CREATE',
    entity: 'QuestionBank',
    entityId: bankId,
    description: `Imported ${created.length} question(s) from a document into bank ${bankName}`,
  });

  return created.map(mapQuestion);
}
