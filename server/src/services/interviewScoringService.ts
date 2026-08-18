import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { configService } from './configService.js';
import { chatJson } from './aiProviderService.js';
import { maxScoreFor } from './questionBankService.js';
import { runOnPiston } from './pistonService.js';
import { CONFIG_KEYS } from '@agnohire/shared';
import type { McqOption, TestCase, CodeLanguage } from '@agnohire/shared';

interface QRow {
  id: string;
  type: string;
  difficulty: string;
  text: string;
  options: unknown;
  rubric: string | null;
  testCases: unknown;
}

function normalizeTestCases(raw: unknown): TestCase[] {
  return Array.isArray(raw) ? (raw as TestCase[]) : [];
}

/** Runs a CODE answer against every test case (visible + hidden) and scores by pass ratio. */
async function scoreByTestCases(
  code: string,
  language: CodeLanguage | undefined,
  testCases: TestCase[],
  max: number,
): Promise<{ isCorrect: boolean; aiScore: number; aiEvaluation: string }> {
  let passed = 0;
  for (const tc of testCases) {
    const result = await runOnPiston(language ?? 'python', code, tc.input);
    if (!result.error && result.stdout.trim() === tc.expectedOutput.trim()) passed++;
  }
  const ratio = passed / testCases.length;
  return {
    isCorrect: passed === testCases.length,
    aiScore: Math.round(ratio * max),
    aiEvaluation: `${passed}/${testCases.length} test cases passed.`,
  };
}

function correctOptionText(options: unknown): string | null {
  if (!Array.isArray(options)) return null;
  const correct = (options as McqOption[]).find((o) => o && o.correct);
  return correct ? correct.text : null;
}

/**
 * Scores a submitted interview: MCQ auto-graded; TEXT/CODE evaluated by the AI
 * against the rubric (gracefully skipped when OpenAI isn't configured — MCQ
 * still scores). Aggregates an InterviewResult and marks the interview EVALUATED.
 * Processor: must NOT import jobs/dispatch (avoids an import cycle).
 */
export async function scoreInterview(interviewId: string): Promise<void> {
  const interview = await prisma.interview.findFirst({
    where: { id: interviewId },
    select: {
      id: true,
      status: true,
      recruiterId: true,
      completedAt: true,
      roundNumber: true,
      jobRequisitionId: true,
      tenantId: true,
      candidate: {
        select: {
          sectorId: true, fullName: true, email: true,
          applications: {
            where: { deletedAt: null },
            select: { job: { select: { title: true } } },
            take: 1
          }
        }
      },
      questions: {
        orderBy: { orderIndex: 'asc' },
        select: { question: { select: { id: true, type: true, difficulty: true, text: true, options: true, rubric: true, testCases: true } } },
      },
      answers: { select: { id: true, questionId: true, answerText: true, answerCode: true, selectedOption: true, language: true } },
    },
  });
  if (!interview) {
    logger.warn('scoreInterview: not found', { interviewId });
    return;
  }

  await prisma.interview.update({ where: { id: interviewId }, data: { status: 'EVALUATING' } });
  const { emitInterviewUpdate } = await import('../config/socket.js');
  emitInterviewUpdate(interview.tenantId, interviewId, 'EVALUATING');

  const sectorId = interview.candidate.sectorId ?? null;
  const aiAvailable = await configService.isConfigured(CONFIG_KEYS.OPENAI_API_KEY, sectorId);

  let roundPassPercentage: number | null = null;
  if (interview.jobRequisitionId && interview.roundNumber != null) {
    const round = await prisma.interviewWorkflowRound.findFirst({
      where: {
        jobRequisitionId: interview.jobRequisitionId,
        roundNumber: interview.roundNumber,
      },
      select: { passPercentage: true },
    });
    roundPassPercentage = round?.passPercentage ?? null;
  }
  const { getEffectivePassThreshold } = await import('./workflowProgressionService.js');
  const passCutoff = getEffectivePassThreshold(roundPassPercentage);

  const answerByQ = new Map(interview.answers.map((a) => [a.questionId, a]));
  const questions: QRow[] = interview.questions.map((q) => q.question);

  let totalScore = 0;
  let maxScore = 0;
  let aiPortion = 0;
  
  let totalTechnicalScore = 0;
  let totalProblemSolvingScore = 0;
  let totalCommunicationScore = 0;
  let totalConfidenceScore = 0;
  let totalDomainKnowledgeScore = 0;
  let evaluatedNonMcqCount = 0;
  let allStrengths: string[] = [];
  let allImprovements: string[] = [];

  const evalLines: string[] = [];

  for (const q of questions) {
    const max = maxScoreFor(q.difficulty);
    maxScore += max;
    const ans = answerByQ.get(q.id);

    if (q.type === 'MCQ') {
      const correct = correctOptionText(q.options);
      const isCorrect = !!ans?.selectedOption && ans.selectedOption === correct;
      const score = isCorrect ? max : 0;
      totalScore += score;
      await upsertAnswerScore(interviewId, q.id, ans?.id, { isCorrect, aiScore: score, maxScore: max });
      evalLines.push(`MCQ "${q.text.slice(0, 50)}": ${isCorrect ? 'correct' : 'incorrect'} (${score}/${max})`);
      continue;
    }

    // CODE with authored test cases → deterministic execution grading, no AI guess.
    const testCases = normalizeTestCases(q.testCases);
    if (q.type === 'CODE' && testCases.length > 0) {
      const code = ans?.answerCode ?? '';
      if (!code.trim()) {
        await upsertAnswerScore(interviewId, q.id, ans?.id, {
          isCorrect: false, aiScore: 0, maxScore: max, aiEvaluation: 'No answer submitted.',
        });
        evalLines.push(`CODE "${q.text.slice(0, 50)}": no answer (0/${max})`);
        continue;
      }
      const { isCorrect, aiScore, aiEvaluation } = await scoreByTestCases(
        code,
        ans?.language as CodeLanguage | undefined,
        testCases,
        max,
      );
      totalScore += aiScore;
      await upsertAnswerScore(interviewId, q.id, ans?.id, { isCorrect, aiScore, maxScore: max, aiEvaluation });
      evalLines.push(`CODE "${q.text.slice(0, 50)}": ${aiEvaluation} (${aiScore}/${max})`);
      continue;
    }

    // TEXT / CODE (no test cases) → AI evaluation against the rubric.
    const submitted = ans?.answerCode ?? ans?.answerText ?? '';
    if (!aiAvailable || !submitted.trim()) {
      await upsertAnswerScore(interviewId, q.id, ans?.id, {
        isCorrect: null,
        aiScore: null,
        maxScore: max,
        aiEvaluation: !submitted.trim() ? 'No answer submitted.' : 'AI scoring unavailable (OpenAI key not configured).',
      });
      continue;
    }

    try {
      const result = await chatJson<{ 
        technicalScore: number;
        problemSolvingScore: number;
        communicationScore: number;
        domainKnowledgeScore: number;
        confidenceScore: number;
        reasoning: string;
        strengths: string;
        improvements: string;
      }>(
        [
          {
            role: 'system',
            content:
              'You are a fair technical interviewer. Score the answer from 0 to 100 for each of these dimensions: technicalScore, problemSolvingScore, communicationScore, domainKnowledgeScore, confidenceScore. Judge correctly against the rubric. Respond ONLY with JSON {"technicalScore": number, "problemSolvingScore": number, "communicationScore": number, "domainKnowledgeScore": number, "confidenceScore": number, "reasoning": "string", "strengths": "string", "improvements": "string"}.',
          },
          {
            role: 'user',
            content: [
              `Question (${q.type}): ${q.text}`,
              q.rubric ? `Rubric: ${q.rubric}` : 'Rubric: (use general best practices)',
              q.type === 'CODE' && ans?.language ? `Programming language: ${ans.language} (judge syntax/idioms for this language)` : '',
              `Candidate answer:\n"""\n${submitted.slice(0, 8000)}\n"""`,
            ].filter(Boolean).join('\n'),
          },
        ],
        { sectorId, maxTokens: 800, temperature: 0.2 },
      );
      
      const tScore = Math.max(0, Math.min(100, Math.round(result.technicalScore)));
      const psScore = Math.max(0, Math.min(100, Math.round(result.problemSolvingScore)));
      const cScore = Math.max(0, Math.min(100, Math.round(result.communicationScore)));
      const dkScore = Math.max(0, Math.min(100, Math.round(result.domainKnowledgeScore)));
      const confScore = Math.max(0, Math.min(100, Math.round(result.confidenceScore)));

      // Calculate weighted percentage
      const weightedPercentage = 
        (tScore * 0.40) + 
        (psScore * 0.25) + 
        (cScore * 0.15) + 
        (dkScore * 0.10) + 
        (confScore * 0.10);

      const score = Math.max(0, Math.min(max, Math.round((weightedPercentage / 100) * max)));
      
      totalScore += score;
      aiPortion += score;
      totalTechnicalScore += tScore;
      totalProblemSolvingScore += psScore;
      totalCommunicationScore += cScore;
      totalDomainKnowledgeScore += dkScore;
      totalConfidenceScore += confScore;
      evaluatedNonMcqCount += 1;

      if (result.strengths) allStrengths.push(result.strengths);
      if (result.improvements) allImprovements.push(result.improvements);

      await upsertAnswerScore(interviewId, q.id, ans?.id, {
        isCorrect: null,
        aiScore: score,
        maxScore: max,
        aiEvaluation: result.reasoning?.slice(0, 2000) ?? null,
        aiStrengths: result.strengths?.slice(0, 2000) ?? null,
        aiImprovements: result.improvements?.slice(0, 2000) ?? null,
        aiReasoning: result.reasoning?.slice(0, 2000) ?? null,
      });
      evalLines.push(`${q.type} "${q.text.slice(0, 50)}": ${score}/${max} (${Math.round(weightedPercentage)}%)`);
    } catch (err) {
      logger.warn('AI answer scoring failed', { interviewId, qid: q.id, err: (err as Error).message });
      await upsertAnswerScore(interviewId, q.id, ans?.id, {
        isCorrect: null, aiScore: null, maxScore: max, aiEvaluation: 'AI evaluation error.',
      });
    }
  }

  const percentageScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  
  const aiDecision = percentageScore >= passCutoff ? 'PASS' : 'FAIL';

  const finalDecision = aiDecision;
  const decidedAt = new Date();
  const generatedAt = new Date();

  let aiSummary: string | null = null;
  let failureReason: string | null = null;
  let recommendedLearning: string | null = null;

  if (aiAvailable) {
    try {
      const completionResult = await chatJson<{ summary: string; failureReason?: string; recommendedLearning?: string }>(
        [
          { role: 'system', content: 'You are an AI interviewer summarizing a candidate\'s performance. Generate a summary (2-3 sentences). If the candidate failed (score less than passing), provide a concise failureReason (bullet points or short paragraph) explaining why they failed. Also provide a recommendedLearning path (bullet points) for the candidate. Return JSON: {"summary": "string", "failureReason": "string", "recommendedLearning": "string"}. Omit failureReason if they passed.' },
          { role: 'user', content: `Score: ${totalScore}/${maxScore} (${percentageScore}%). Passing Score: ${passCutoff}%. Per-question:\n${evalLines.join('\n')}` },
        ],
        { sectorId, maxTokens: 500, temperature: 0.3 },
      );
      aiSummary = completionResult.summary;
      if (aiDecision === 'FAIL' && completionResult.failureReason) {
        failureReason = completionResult.failureReason;
      }
      if (completionResult.recommendedLearning) {
        recommendedLearning = completionResult.recommendedLearning;
      }
    } catch {
      aiSummary = null;
    }
  }
  if (!aiSummary) {
    aiSummary = `Auto-scored ${totalScore}/${maxScore} (${percentageScore}%). ${aiAvailable ? '' : 'TEXT/CODE answers were not AI-scored (OpenAI key not configured).'}`.trim();
  }

  let isLastRound = true;
  if (interview.jobRequisitionId && interview.roundNumber != null) {
    const rounds = await prisma.interviewWorkflowRound.findMany({
      where: { jobRequisitionId: interview.jobRequisitionId },
      orderBy: { roundNumber: 'desc' },
      take: 1
    });
    if (rounds.length > 0) {
      isLastRound = rounds[0].roundNumber === interview.roundNumber;
    }
  }
  const hrStatusValue = aiDecision === 'PASS' && isLastRound ? 'PENDING' : 'NOT_APPLICABLE';

  let avgTechnicalScore = evaluatedNonMcqCount > 0 ? totalTechnicalScore / evaluatedNonMcqCount : null;
  let avgProblemSolvingScore = evaluatedNonMcqCount > 0 ? totalProblemSolvingScore / evaluatedNonMcqCount : null;
  let avgCommunicationScore = evaluatedNonMcqCount > 0 ? totalCommunicationScore / evaluatedNonMcqCount : null;
  let avgConfidenceScore = evaluatedNonMcqCount > 0 ? totalConfidenceScore / evaluatedNonMcqCount : null;
  let avgDomainKnowledgeScore = evaluatedNonMcqCount > 0 ? totalDomainKnowledgeScore / evaluatedNonMcqCount : null;
  
  let finalStrengths = allStrengths.length > 0 ? allStrengths.join('\n\n') : null;
  let finalImprovements = allImprovements.length > 0 ? allImprovements.join('\n\n') : null;

  await prisma.interviewResult.upsert({
    where: { interviewId },
    create: {
      interviewId, totalScore, maxScore, percentageScore,
      aiScore: aiPortion, finalScore: totalScore, aiDecision, aiReasoning: null, aiSummary,
      technicalScore: avgTechnicalScore,
      problemSolvingScore: avgProblemSolvingScore,
      communicationScore: avgCommunicationScore,
      confidenceScore: avgConfidenceScore,
      domainKnowledgeScore: avgDomainKnowledgeScore,
      strengths: finalStrengths,
      improvements: finalImprovements,
      failureReason,
      recommendedLearning,
      decision: finalDecision,
      decidedAt,
      generatedAt,
      hrStatus: hrStatusValue
    },
    update: {
      totalScore, maxScore, percentageScore, aiScore: aiPortion, finalScore: totalScore, aiDecision, aiSummary,
      technicalScore: avgTechnicalScore,
      problemSolvingScore: avgProblemSolvingScore,
      communicationScore: avgCommunicationScore,
      confidenceScore: avgConfidenceScore,
      domainKnowledgeScore: avgDomainKnowledgeScore,
      strengths: finalStrengths,
      improvements: finalImprovements,
      failureReason,
      recommendedLearning,
      decision: finalDecision,
      decidedAt,
      generatedAt,
      hrStatus: hrStatusValue
    },
  });

  await prisma.interview.update({ where: { id: interviewId }, data: { status: 'EVALUATED' } });
  emitInterviewUpdate(interview.tenantId, interviewId, 'EVALUATED');
  logger.info('Interview scored', { interviewId, percentageScore, aiDecision });

  try {
    const { processWorkflowProgression } = await import('./workflowProgressionService.js');
    await processWorkflowProgression(interviewId, aiDecision, percentageScore);
  } catch (err) {
    logger.warn('Failed to process workflow progression', { interviewId, err: (err as Error).message });
  }

  try {
    const { dispatchCandidateReport } = await import('../jobs/dispatch.js');
    await dispatchCandidateReport(interviewId, 0);
    logger.info('Queued auto-decision candidate report', { interviewId, delayMinutes: 0 });
  } catch (err) {
    logger.warn('Failed to queue candidate report', { interviewId, err: (err as Error).message });
  }

  // Notify the recruiter the result is ready so it surfaces in the bell.
  try {
    const { notify } = await import('./notificationService.js');
    const { NOTIFICATION_TYPE } = await import('@agnohire/shared');
    await notify({
      recipientId: interview.recruiterId,
      type: NOTIFICATION_TYPE.INTERVIEW_EVALUATED,
      title: 'Interview evaluated',
      message: `${interview.candidate.fullName}'s interview scored ${percentageScore}% (${aiDecision}).`,
      entityType: 'Interview',
      entityId: interviewId,
    });
  } catch (err) {
    logger.warn('Evaluation notification failed', { interviewId, err: (err as Error).message });
  }
}

async function upsertAnswerScore(
  interviewId: string,
  questionId: string,
  answerId: string | undefined,
  data: { isCorrect?: boolean | null; aiScore?: number | null; maxScore?: number | null; aiEvaluation?: string | null; aiStrengths?: string | null; aiImprovements?: string | null; aiReasoning?: string | null; },
) {
  if (answerId) {
    await prisma.candidateAnswer.update({ where: { id: answerId }, data });
  } else {
    await prisma.candidateAnswer.create({ data: { interviewId, questionId, ...data } });
  }
}
