import { randomBytes } from 'node:crypto';
import { ToolRegistry } from '../../toolRegistry/index.js';
import { listBanks, createBank, updateBank, deleteBank, generateQuestions } from '../../../services/questionBankService.js';
import { createAssessment, assignAssessment } from '../../../services/assessmentService.js';
import { resolveSectorAndDomain } from '../../../services/jobService.js';
import { prisma } from '../../../config/database.js';
import { PERMISSIONS } from '@agnohire/shared';
import type { Request } from 'express';

// Default mirrors assessment.routes.ts's GET floor (ASSESSMENT_VIEW);
// mutations below override with ASSESSMENT_MANAGE/ASSESSMENT_ASSIGN, matching
// the equivalent route.
const rawRegister = ToolRegistry.register.bind(ToolRegistry);
const register = (tool: Omit<Parameters<typeof rawRegister>[0], 'category'>) =>
  rawRegister({ permissions: [PERMISSIONS.ASSESSMENT_VIEW], ...tool, category: 'assessments' });

register({
  name: 'getQuestionBanks',
  description: 'Get a list of all question banks. Use this to find the ID of a question bank when the user provides its name.',
  parameters: { type: 'object', properties: {} },
  execute: async (_args, ctx) => {
    return await listBanks({ page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' }, ctx);
  },
});

register({
  name: 'getQuestionBankCount',
  description: 'Get the total number of question banks.',
  parameters: { type: 'object', properties: {} },
  execute: async (_args, ctx) => {
    const banks = await listBanks({ page: 1, limit: 1, sortBy: 'createdAt', sortOrder: 'desc' }, ctx);
    return { count: banks.meta.total };
  },
});

register({
  name: 'createQuestionBank',
  permissions: [PERMISSIONS.ASSESSMENT_MANAGE],
  description: 'Create a new question bank.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['title'],
  },
  execute: async (args, ctx, req) => {
    return await createBank(args, ctx, req);
  },
});

register({
  name: 'updateQuestionBank',
  permissions: [PERMISSIONS.ASSESSMENT_MANAGE],
  description: 'Update a question bank.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['id'],
  },
  execute: async (args, ctx, req) => {
    const { id, ...data } = args;
    return await updateBank(id, data, ctx, req);
  },
});

register({
  name: 'deleteQuestionBank',
  permissions: [PERMISSIONS.ASSESSMENT_MANAGE],
  description: 'Delete a question bank.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
    },
    required: ['id'],
  },
  execute: async (args, ctx, req) => {
    return await deleteBank(args.id, ctx, req);
  },
});

register({
  name: 'generateTestLink',
  permissions: [PERMISSIONS.ASSESSMENT_ASSIGN],
  description: 'Generate and schedule an assessment test link for candidates (individual candidate by name/id or all candidates).',
  parameters: {
    type: 'object',
    properties: {
      candidateName: { type: 'string', description: 'Name of the candidate (e.g. Abinaya C AgnoShin) or "all" for all candidates' },
      candidateId: { type: 'string', description: 'Optional candidate UUID' },
      questionBankName: { type: 'string', description: 'Name of the question bank (e.g. Aptitude)' },
      questionBankId: { type: 'string', description: 'Optional question bank UUID' },
      assessmentTitle: { type: 'string', description: 'Optional assessment title' },
      jobTitle: { type: 'string', description: 'Optional job title' },
    }
  },
  execute: async (args: any, ctx: any, req: any) => {
    // 1. Resolve candidate(s)
    let candidates: Array<{ id: string; fullName: string; email: string }> = [];

    if (args.candidateId) {
      const c = await prisma.candidate.findFirst({ where: { id: args.candidateId, deletedAt: null }, select: { id: true, fullName: true, email: true } });
      if (c) candidates.push(c);
    } else if (args.candidateName && args.candidateName.toLowerCase() !== 'all') {
      const found = await prisma.candidate.findMany({
        where: {
          fullName: { contains: args.candidateName, mode: 'insensitive' },
          deletedAt: null
        },
        select: { id: true, fullName: true, email: true }
      });
      if (found.length > 0) {
        candidates = found;
      }
    }

    // Fallback: If candidateName is 'all' or no candidate matched by name, find recent candidates
    if (candidates.length === 0) {
      const allCands = await prisma.candidate.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, fullName: true, email: true }
      });
      candidates = allCands;
    }

    if (candidates.length === 0) {
      return {
        success: false,
        error: 'No active candidates found in the system. Please create or import candidates first.'
      };
    }

    // 2. Resolve Question Bank & Questions
    let bank: any = null;
    const qbName = args.questionBankName || args.topic || 'Aptitude';

    if (args.questionBankId) {
      bank = await prisma.questionBank.findFirst({
        where: { id: args.questionBankId },
        include: { questions: { select: { id: true } } }
      });
    }

    if (!bank && qbName) {
      bank = await prisma.questionBank.findFirst({
        where: { name: { contains: qbName, mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' },
        include: { questions: { select: { id: true } } }
      });
    }

    if (!bank) {
      bank = await prisma.questionBank.findFirst({
        orderBy: { createdAt: 'desc' },
        include: { questions: { select: { id: true } } }
      });
    }

    if (!bank || !bank.questions || bank.questions.length === 0) {
      // Auto-create question bank and generate questions if missing
      const resolved = await resolveSectorAndDomain(qbName, qbName);
      const newBank = await createBank({
        name: qbName.length > 3 ? qbName : `${qbName} Question Bank`,
        sectorId: resolved.sectorId,
        domainId: resolved.domainId,
        description: `Question bank for ${qbName}`,
        isPublic: true
      }, ctx, req as Request);
      await generateQuestions(newBank.id, { count: 10, type: 'MCQ' as any, difficulty: 'MEDIUM' as any, topic: qbName }, ctx, req as Request);
      bank = await prisma.questionBank.findFirst({
        where: { id: newBank.id },
        include: { questions: { select: { id: true } } }
      });
    }

    // 3. Resolve or create Assessment
    const title = args.assessmentTitle || `${bank?.name || 'Aptitude'} Assessment`;
    let assessment: { id: string; title: string; jobRequisitionId?: string | null } | null = await prisma.assessment.findFirst({
      where: { title: { contains: title, mode: 'insensitive' }, deletedAt: null },
      select: { id: true, isActive: true, title: true, jobRequisitionId: true }
    });

    if (!assessment && bank && bank.questions) {
      const qIds = bank.questions.map((q: any) => q.id);
      const createdAss = await createAssessment({
        title,
        description: `Assessment generated for ${bank.name}`,
        passingScore: 60,
        durationMin: 30,
        questionIds: qIds,
      }, ctx, req as Request);
      assessment = { id: createdAss.id, title: createdAss.title, jobRequisitionId: createdAss.jobRequisition?.id || null };
    }

    if (!assessment) {
      return {
        success: false,
        error: 'Failed to locate or create an assessment for generating test links.'
      };
    }

    // 4. Assign assessment to candidates & generate test links
    const candidateIds = candidates.map(c => c.id);
    const assignResult = await assignAssessment(assessment.id, { candidateIds }, ctx, req as Request);

    // 5. Ensure Interview records exist AND are assigned to the current user (ctx.userId)
    const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
    const candidateLinks: Array<{ candidateName: string; candidateEmail: string; testLink: string }> = [];

    for (const cand of candidates) {
      try {
        const existingAssign = await prisma.candidateAssignment.findFirst({
          where: {
            candidateId: cand.id,
            recruiterId: ctx.userId,
          }
        });
        if (!existingAssign) {
          await prisma.candidateAssignment.create({
            data: {
              candidateId: cand.id,
              recruiterId: ctx.userId,
              assignedById: ctx.userId,
              status: 'ASSIGNED',
              tenantId: ctx.tenantId || null,
            }
          });
        }
      } catch {
        // Ignore duplicate constraint edge cases
      }

      let interview = await prisma.interview.findFirst({
        where: {
          candidateId: cand.id,
          questionBankId: bank.id,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          deletedAt: null,
        }
      });

      if (interview) {
        // Re-assign recruiterId to current user so the logged-in user can see it on their Interviews page
        interview = await prisma.interview.update({
          where: { id: interview.id },
          data: {
            recruiterId: ctx.userId,
            tenantId: ctx.tenantId || interview.tenantId || null,
          }
        });
      } else {
        const token = randomBytes(24).toString('base64url');
        interview = await prisma.interview.create({
          data: {
            candidateId: cand.id,
            recruiterId: ctx.userId,
            questionBankId: bank.id,
            jobRequisitionId: assessment.jobRequisitionId || null,
            status: 'SCHEDULED',
            type: 'AI',
            accessToken: token,
            duration: 30,
            tenantId: ctx.tenantId || null,
          }
        });

        if (bank.questions && bank.questions.length > 0) {
          await prisma.interviewQuestion.createMany({
            data: bank.questions.map((q: any, idx: number) => ({
              interviewId: interview!.id,
              questionId: q.id,
              orderIndex: idx,
            })),
            skipDuplicates: true,
          });
        }
      }

      candidateLinks.push({
        candidateName: cand.fullName,
        candidateEmail: cand.email,
        testLink: `${clientUrl}/interview/${interview.accessToken || interview.id}`
      });
    }

    return {
      success: true,
      assessmentId: assessment.id,
      assessmentTitle: title,
      assignedCount: assignResult.assigned,
      invitedCount: assignResult.invited,
      skippedCount: assignResult.skipped,
      candidates: candidateLinks,
      message: `Test link for "${title}" successfully generated and scheduled for ${candidateLinks.length} candidate(s). You can view the candidate link(s) right here on the Interviews page.`
    };
  }
});
