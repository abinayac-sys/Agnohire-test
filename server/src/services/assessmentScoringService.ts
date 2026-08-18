import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { configService } from './configService.js';
import { chatJson, chatCompletion } from './aiProviderService.js';
import { maxScoreFor } from './questionBankService.js';
import { CONFIG_KEYS, type McqOption } from '@agnohire/shared';

/**
 * Scores a submitted assessment assignment: MCQ auto-graded; TEXT/CODE evaluated
 * by the AI against the rubric (gracefully skipped when OpenAI isn't configured).
 * Pass/fail is the assessment's own passingScore (falls back to the global
 * ASSESSMENT_PASS_CUTOFF). Marks the assignment EVALUATED.
 * Processor: must NOT import jobs/dispatch (avoids an import cycle).
 */
function correctOptionText(options: unknown): string | null {
  if (!Array.isArray(options)) return null;
  const correct = (options as McqOption[]).find((o) => o && o.correct);
  return correct ? correct.text : null;
}

export async function scoreAssignment(assignmentId: string): Promise<void> {
  const assignment = await prisma.assessmentAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true, status: true, assessmentId: true, candidateId: true,
      assessment: { select: { passingScore: true, jobRequisitionId: true } },
      answers: { select: { id: true, questionId: true, answerText: true, answerCode: true, selectedOption: true } },
    },
  });
  if (!assignment) {
    logger.warn('scoreAssignment: not found', { assignmentId });
    return;
  }

  await prisma.assessmentAssignment.update({ where: { id: assignmentId }, data: { status: 'EVALUATING' } });

  const aqs = await prisma.assessmentQuestion.findMany({
    where: { assessmentId: assignment.assessmentId },
    orderBy: { orderIndex: 'asc' },
    select: { questionId: true },
  });
  const questions = await prisma.question.findMany({
    where: { id: { in: aqs.map((a) => a.questionId) } },
    select: { id: true, type: true, difficulty: true, text: true, options: true, rubric: true },
  });
  const qOrder = aqs.map((a) => questions.find((q) => q.id === a.questionId)).filter((q): q is NonNullable<typeof q> => !!q);

  const candidate = await prisma.candidate.findUnique({ where: { id: assignment.candidateId }, select: { sectorId: true } });
  const sectorId = candidate?.sectorId ?? null;
  const aiAvailable = await configService.isConfigured(CONFIG_KEYS.OPENAI_API_KEY, sectorId);

  let roundPassPercentage: number | null = null;
  if (assignment.assessment?.jobRequisitionId) {
    const round = await prisma.interviewWorkflowRound.findFirst({
      where: {
        jobRequisitionId: assignment.assessment.jobRequisitionId,
        OR: [
          { roundType: { contains: 'assessment', mode: 'insensitive' } },
          { roundType: { contains: 'test', mode: 'insensitive' } },
          { roundName: { contains: 'assessment', mode: 'insensitive' } },
          { roundName: { contains: 'test', mode: 'insensitive' } },
        ],
      },
      select: { passPercentage: true },
    });
    roundPassPercentage = round?.passPercentage ?? null;
  }
  const { getEffectivePassThreshold } = await import('./workflowProgressionService.js');
  const passingScore = getEffectivePassThreshold(roundPassPercentage);

  const answerByQ = new Map(assignment.answers.map((a) => [a.questionId, a]));
  let totalScore = 0;
  let maxScore = 0;
  const evalLines: string[] = [];

  for (const q of qOrder) {
    const max = maxScoreFor(q.difficulty);
    maxScore += max;
    const ans = answerByQ.get(q.id);

    if (q.type === 'MCQ') {
      const correct = correctOptionText(q.options);
      const isCorrect = !!ans?.selectedOption && ans.selectedOption === correct;
      const score = isCorrect ? max : 0;
      totalScore += score;
      await saveScore(assignmentId, q.id, ans?.id, { isCorrect, aiScore: score, maxScore: max });
      evalLines.push(`MCQ "${q.text.slice(0, 50)}": ${isCorrect ? 'correct' : 'incorrect'} (${score}/${max})`);
      continue;
    }

    const submitted = ans?.answerCode ?? ans?.answerText ?? '';
    if (!aiAvailable || !submitted.trim()) {
      await saveScore(assignmentId, q.id, ans?.id, {
        isCorrect: null, aiScore: null, maxScore: max,
        aiEvaluation: !submitted.trim() ? 'No answer submitted.' : 'AI scoring unavailable (OpenAI key not configured).',
      });
      continue;
    }

    try {
      const result = await chatJson<{ score: number; evaluation: string }>(
        [
          { role: 'system', content: 'You are a fair technical grader. Score the answer from 0 to the max against the rubric. Respond ONLY with JSON {"score": number, "evaluation": string}.' },
          { role: 'user', content: [
            `Question (${q.type}): ${q.text}`,
            q.rubric ? `Rubric: ${q.rubric}` : 'Rubric: (use general best practices)',
            `Max score: ${max}`,
            `Candidate answer:\n"""\n${submitted.slice(0, 8000)}\n"""`,
          ].join('\n') },
        ],
        { sectorId, maxTokens: 600, temperature: 0.2 },
      );
      const score = Math.max(0, Math.min(max, Math.round(result.score)));
      totalScore += score;
      await saveScore(assignmentId, q.id, ans?.id, { isCorrect: null, aiScore: score, maxScore: max, aiEvaluation: result.evaluation?.slice(0, 2000) ?? null });
      evalLines.push(`${q.type} "${q.text.slice(0, 50)}": ${score}/${max}`);
    } catch (err) {
      logger.warn('AI assessment scoring failed', { assignmentId, qid: q.id, err: (err as Error).message });
      await saveScore(assignmentId, q.id, ans?.id, { isCorrect: null, aiScore: null, maxScore: max, aiEvaluation: 'AI evaluation error.' });
    }
  }

  const percentageScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  const passed = percentageScore >= passingScore;

  let aiSummary: string | null = null;
  if (aiAvailable) {
    try {
      aiSummary = await chatCompletion(
        [
          { role: 'system', content: 'Summarize a candidate skill-assessment result in 2-3 sentences for a recruiter. Be objective.' },
          { role: 'user', content: `Score: ${totalScore}/${maxScore} (${percentageScore}%), pass mark ${passingScore}% → ${passed ? 'PASS' : 'FAIL'}.\nPer-question:\n${evalLines.join('\n')}` },
        ],
        { sectorId, maxTokens: 250, temperature: 0.3 },
      );
    } catch {
      aiSummary = null;
    }
  }
  if (!aiSummary) {
    aiSummary = `Auto-scored ${totalScore}/${maxScore} (${percentageScore}%) — ${passed ? 'PASS' : 'FAIL'} at ${passingScore}% cutoff.${aiAvailable ? '' : ' TEXT/CODE answers were not AI-scored (OpenAI key not configured).'}`.trim();
  }

  await prisma.assessmentAssignment.update({
    where: { id: assignmentId },
    data: { status: 'EVALUATED', totalScore, maxScore, percentageScore, passed, aiSummary },
  });
  logger.info('Assessment scored', { assignmentId, percentageScore, passed });
}

async function saveScore(
  assignmentId: string,
  questionId: string,
  answerId: string | undefined,
  data: { isCorrect?: boolean | null; aiScore?: number | null; maxScore?: number | null; aiEvaluation?: string | null },
) {
  if (answerId) {
    await prisma.assessmentAnswer.update({ where: { id: answerId }, data });
  } else {
    await prisma.assessmentAnswer.create({ data: { assignmentId, questionId, ...data } });
  }
}
