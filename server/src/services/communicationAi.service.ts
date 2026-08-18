import { prisma } from '../config/database.js';
import { chatCompletion } from './aiProviderService.js';
import { logger } from '../config/logger.js';

export class CommunicationAiService {
  /**
   * Summarizes a channel's messages within a date range.
   */
  static async summarizeChat(tenantId: string, channelId: string, startDate?: Date, endDate?: Date): Promise<any> {
    const where: any = { tenantId, channelId };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const messages = await prisma.communicationMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { sender: { select: { fullName: true } } },
      take: 200 // limit to last 200 for context window safety
    });

    if (!messages.length) {
      return { summary: "No messages to summarize.", actionItems: "", decisions: "", followUp: "" };
    }

    const transcript = messages.map(m => `[${m.createdAt.toISOString()}] ${m.sender.fullName}: ${m.content}`).join('\n');

    const prompt = `You are an AI assistant. Analyze the following chat transcript and provide a structured JSON response with exactly these fields: "summary" (string, overall summary), "actionItems" (array of strings), "decisions" (array of strings), "followUp" (array of strings). Do not use markdown blocks for the JSON.

    Transcript:
    ${transcript}`;

    try {
      const response = await chatCompletion(
        [{ role: 'user', content: prompt }],
        { json: true } // force JSON output if supported by aiProvider
      );

      const parsed = JSON.parse(response);

      return {
        summary: parsed.summary || "",
        actionItems: parsed.actionItems || [],
        decisions: parsed.decisions || [],
        followUp: parsed.followUp || []
      };
    } catch (error: any) {
      logger.error('Error generating chat summary:', error);
      throw new Error('Failed to generate chat summary');
    }
  }

  /**
   * Summarizes a meeting including notes and call history.
   */
  static async summarizeMeeting(tenantId: string, meetingId: string): Promise<any> {
    const meeting = await prisma.communicationMeeting.findUnique({
      where: { id: meetingId, tenantId },
      include: {
        notes: { orderBy: { createdAt: 'asc' } }
      }
    });

    if (!meeting) throw new Error('Meeting not found');

    const notesContent = meeting.notes.map(n => n.content).join('\n---\n');

    const prompt = `You are an AI assistant. Summarize the following meeting details and notes. Return a JSON object with: "summary" (string), "participants" (array of strings based on notes if mentioned), "decisions" (array of strings), "actionItems" (array of strings). Do not use markdown blocks for the JSON.

    Meeting Title: ${meeting.title}
    Description: ${meeting.description || 'N/A'}

    Notes:
    ${notesContent}`;

    try {
      const response = await chatCompletion(
        [{ role: 'user', content: prompt }],
        { json: true }
      );

      const parsed = JSON.parse(response);

      return {
        summary: parsed.summary || "",
        participants: parsed.participants || [],
        decisions: parsed.decisions || [],
        actionItems: parsed.actionItems || []
      };
    } catch (error: any) {
      logger.error('Error generating meeting summary:', error);
      throw new Error('Failed to generate meeting summary');
    }
  }

  /**
   * Generates and upserts an InterviewResult based on the CommunicationMeeting notes.
   *
   * NOTE: the source repo's InterviewResult had bespoke `strengths`/
   * `improvements`/`recommendation` text columns for this. This target's
   * InterviewResult (a pre-existing, heavily-used model this task explicitly
   * does not touch) has no such columns — it already has `aiSummary`,
   * `aiDecision` and `aiReasoning` for the equivalent AI-generated verdict, so
   * strengths/improvements are folded into `aiReasoning` and recommendation
   * maps onto the existing `aiDecision` instead of adding new columns.
   */
  static async generateInterviewResult(tenantId: string, interviewId: string): Promise<any> {
    const meeting = await prisma.communicationMeeting.findUnique({
      where: { interviewId },
      include: {
        notes: { orderBy: { createdAt: 'asc' } }
      }
    });

    if (!meeting || meeting.tenantId !== tenantId) throw new Error('Interview meeting not found');

    const notesContent = meeting.notes.map(n => n.content).join('\n---\n');

    const prompt = `You are an expert technical recruiter and interviewer AI. Analyze the following interview meeting notes. Provide a structured JSON response with exactly these fields:
    "strengths" (string, summarizing candidate strengths),
    "improvements" (string, summarizing candidate weaknesses),
    "recommendation" (string, one of: "STRONG_HIRE", "HIRE", "NO_HIRE"),
    "aiSummary" (string, overall summary of the interview),
    "decision" (string, same as recommendation).
    Do not use markdown blocks for the JSON.

    Meeting Title: ${meeting.title}

    Notes:
    ${notesContent}`;

    try {
      const response = await chatCompletion(
        [{ role: 'user', content: prompt }],
        { json: true }
      );

      const parsed = JSON.parse(response);
      const aiReasoning = [
        parsed.strengths ? `Strengths: ${parsed.strengths}` : null,
        parsed.improvements ? `Improvements: ${parsed.improvements}` : null,
      ].filter(Boolean).join('\n\n') || null;
      const aiDecision = parsed.decision || parsed.recommendation || null;

      const result = await prisma.interviewResult.upsert({
        where: { interviewId },
        update: {
          aiReasoning,
          aiSummary: parsed.aiSummary,
          aiDecision,
        },
        create: {
          interviewId,
          aiReasoning,
          aiSummary: parsed.aiSummary,
          aiDecision,
        }
      });

      return result;
    } catch (error: any) {
      logger.error('Error generating interview result:', error);
      throw new Error('Failed to generate interview result');
    }
  }
}
