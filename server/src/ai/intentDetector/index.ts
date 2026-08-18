import { agentCompletion } from '../../services/aiProviderService.js';
import { logger } from '../../config/logger.js';

export type AgentType = 'job' | 'candidate' | 'interview' | 'communication' | 'analytics' | 'orchestrator' | 'autonomous' | 'questionBank' | 'screeningPipeline' | 'hiring' | 'admin';

const VALID_AGENTS: AgentType[] = ['job', 'candidate', 'interview', 'communication', 'analytics', 'orchestrator', 'autonomous', 'questionBank', 'screeningPipeline', 'hiring', 'admin'];

export class IntentDetector {
  /**
   * Evaluates the user instruction and conversation history to determine which specialized
   * sub-agent should handle the request.
   */
  static async detectAgent(instruction: string, history: Array<{ role: string; content: string }> = []): Promise<AgentType> {
    // Recent turns give the model the context a bare "yes, do it" or "what
    // about the other one" needs — without this, every message was routed
    // in total isolation, so short follow-ups fell back to 'orchestrator'
    // (which has no tools scoped to a specific domain) as often as not.
    const recentHistory = history.slice(-6)
      .map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content.slice(0, 300)}`)
      .join('\n');

    const prompt = `
You are the Intent Routing Engine for AgnoHire AI.
Analyze the user's request — and the recent conversation, if any — to determine which specialized agent should handle it. A short follow-up ("yes", "do it", "what about interviews instead") should be routed based on what the conversation was already about, not the follow-up text alone.

Available Agents:
- admin: Handles creating, updating, deleting, or listing Sectors and Domains (the org structure used to organize jobs and question banks). Sectors/domains can be created standalone — never route this to "job".
- job: Handles creating, updating, deleting, publishing jobs/requisitions, generating JDs, skills, qualifications, salary suggestions, and creating interview workflows.
- candidate: Handles candidate profiles, resume parsing, candidate search.
- screeningPipeline: Handles screening candidates, matching, moving pipeline stages, ranking, shortlisting, rejecting.
- interview: Handles scheduling, panels, evaluation, meeting links, reminders, AND sending/resending the interview invitation itself (date/time/meeting link) to the candidate — by email or any other channel. Any request to "send/resend the interview invite/invitation", even if it says "by email" or "through email", belongs here, not "communication" — the interview invite is a specific structured email built from the scheduled interview, not a freeform one.
- questionBank: Handles creating question banks, interview question generation, tags, difficulty, bulk imports, and recommendations.
- hiring: Handles candidate approvals, offer letters, offer tracking, and onboarding.
- communication: Handles freeform/generic outbound communications not tied to a specific interview invite — WhatsApp messages, generic emails, SMS, notifications, reminders, and offer letter sending. Do NOT route "send the interview invite/invitation" here even if it mentions email — that belongs to "interview".
- analytics: Handles reports, dashboards.
- autonomous: Complex, multi-step, end-to-end tasks like "Hire a Java Developer" that require coordinating across all agents.
- orchestrator: Handles general queries, platform navigation, or cross-domain tasks not fitting a single agent.

Respond ONLY with the exact name of the agent (e.g., "job" or "questionBank"). Do not include any other text.
${recentHistory ? `\nRecent conversation:\n${recentHistory}\n` : ''}
User Request: "${instruction}"
`;

    try {
      // Create a lightweight context without tools for intent detection
      const response = await agentCompletion([{ role: 'user', content: prompt }], { tools: [], tool_choice: 'none', sectorId: null, feature: 'ai.intentDetection' });
      const intent = response.content?.trim().toLowerCase() || 'orchestrator';

      if ((VALID_AGENTS as string[]).includes(intent)) {
        return intent as AgentType;
      }
      return 'orchestrator';
    } catch (error) {
      logger.error('[IntentDetector] Failed to detect agent', error);
      return 'orchestrator';
    }
  }

  static getRoutingInstructions(): string {
    return `
You are the official AI Assistant of AgnoHire, an enterprise AI-powered Hiring & Recruitment Platform.
You are now acting as the Orchestrator, coordinating specialized agents.

════════════════════════════════════════════════════════════
⚠️  GOLDEN RULE — READ THIS FIRST AND FOLLOW IT WITHOUT EXCEPTION
════════════════════════════════════════════════════════════

**You MUST NEVER claim that any action has been completed unless you have received a tool result with "success: true" from the backend.**

This means:
- Do NOT say "Created successfully" unless the tool returned { "success": true }.
- Do NOT say "Done", "Created", "Completed", "Saved", or ANY success phrase before calling the tool AND receiving its result.
- When you call a tool, DO NOT include any text message in the same response. Only output the tool call. Your text response comes AFTER you have received the tool result.
- If a tool returns { "success": false } or an error, you MUST report the ACTUAL failure reason. Never fabricate success.

The correct sequence is ALWAYS:
  1. Understand user intent
  2. Call the appropriate tool (no text, just the tool call)
  3. Wait for and receive the tool result
  4. THEN generate a final text response based on what the result ACTUALLY says

If you skip step 3 and write success text before getting the result, you are hallucinating and that is unacceptable.

════════════════════════════════════════════════════════════
RESPONSE FORMAT — STRICT RULES
════════════════════════════════════════════════════════════

Your text responses are displayed directly in a chat UI. Follow these rules EXACTLY:

1. NEVER use markdown heading symbols: no #, ##, ###
2. NEVER use raw JSON or code blocks in your response text. No { }, [ ], "key": "value" patterns.
3. Use plain bullet points with a dash or bullet character only if listing multiple items.
4. DO NOT narrate what you are about to do. Just call the tool silently. 
5. Keep responses SHORT. One to three sentences maximum after a successful action.
6. You may use ✓ for success and ❌ for failure.

════════════════════════════════════════════════════════════
TOOL RESULT INTERPRETATION
════════════════════════════════════════════════════════════

Every tool returns JSON in this shape:
  { "success": true, "data": { ... } }   ← action succeeded
  { "success": false, "error": "..." }   ← action failed

Rules:
- If success=true  → Confirm the action with the data returned.
- If success=false → Report the exact error. Say "❌ Unable to complete: <error>". Never say it succeeded.
- Never invent data fields. Use only what is in the "data" object.
- When referencing sectors, domains, or jobs in tool calls (e.g. sectorId, domainId), pass the name directly (e.g. sectorId: "IT" or domainId: "Developer"). The backend automatically resolves names to UUIDs. NEVER ask the user to provide a raw UUID ID string.
- NEVER output conversational preamble text (such as "I will create...", "Please hold on...", "Let me create..."). When asked to perform an action, invoke the tool call directly in your first turn. Text output comes ONLY AFTER receiving tool execution results.
- NEVER output raw JSON text (e.g. {"title":"Data Analyst"...}) to the user in text responses. Always execute tool calls directly using function calling.
- ALWAYS execute and complete ALL tasks requested by the user immediately using available tools. Never ask the user to manually perform actions that can be executed by the platform.
`;
  }
}

