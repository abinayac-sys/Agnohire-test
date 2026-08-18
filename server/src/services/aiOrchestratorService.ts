import { agentCompletion, type AgentChatMessage } from './aiProviderService.js';
import { WorkflowManager } from '../ai/workflowEngine/manager.js';
import { ToolRegistry } from '../ai/tools/index.js';
import type { AIContext } from '../ai/toolRegistry/index.js';
import { ToolExecutor } from '../ai/toolExecutor/index.js';
import { IntentDetector } from '../ai/intentDetector/index.js';
import { RetryEngine } from '../ai/retryEngine/index.js';
import { emitToUser } from '../config/socket.js';
import { logger } from '../config/logger.js';

export interface AIOSResult {
  output: string;
  workflowState: any;
  actionsRun: Array<{ tool: string; success: boolean; data?: any; error?: string }>;
  /** Set when a destructive tool call was gated and is awaiting human
   * confirmation — see ToolExecutor.execute()/executeConfirmed() and
   * confirmationStore.ts. The client must round-trip `confirmationToken`
   * back via a second /ai/run call to actually run it. */
  pendingConfirmation?: { toolName: string; preview: unknown; confirmationToken: string };
}

export class AIOrchestratorService {
  /**
   * Run a natural language instruction through the AI Operating System.
   *
   * Architecture guarantee:
   *   - The LLM's final text response is ONLY captured from a loop iteration
   *     where the model returned NO tool_calls. This ensures the LLM has
   *     already seen every tool result before composing its reply.
   *   - If the model produces text AND tool_calls in the same turn, the text
   *     is discarded and only the tool calls are executed. The model is then
   *     called again with the tool results appended.
   *   - The orchestrator never fabricates success: it always passes the raw
   *     tool result (including success=false) back to the LLM.
   */
  static async run(
    instruction: string,
    ctx: AIContext,
    req: any,
    lastWorkflowState?: any,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    /** When present, short-circuits everything else: it means the human
     * just approved a previously-previewed destructive tool call, so this
     * executes THAT exact call directly rather than starting a fresh LLM
     * turn — the model never sees or handles confirmation tokens. */
    confirmationToken?: string,
  ): Promise<AIOSResult> {
    if (confirmationToken) {
      const toolResult = await ToolExecutor.executeConfirmed(confirmationToken, ctx, req, instruction);
      return {
        output: toolResult.success
          ? `✓ ${toolResult.toolName ?? 'Action'} completed.`
          : `❌ Unable to complete: ${toolResult.error}`,
        workflowState: lastWorkflowState ?? {},
        actionsRun: [{
          tool: toolResult.toolName ?? 'unknown',
          success: toolResult.success,
          data: toolResult.success ? toolResult.data : undefined,
          error: toolResult.success ? undefined : toolResult.error,
        }],
      };
    }

    const workflowState = WorkflowManager.getOrInitState(lastWorkflowState ? { workflowState: lastWorkflowState } : null);

    const systemPrompt = IntentDetector.getRoutingInstructions() + WorkflowManager.getSystemInstructions(workflowState);
    const messages: AgentChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user', content: instruction }
    ];

    const actionsRun: Array<{ tool: string; success: boolean; data?: any; error?: string }> = [];
    let currentLoop = 0;
    const MAX_LOOPS = 8;

    // finalContent is ONLY set when the model returns text with NO tool_calls.
    // This guarantees the LLM has already seen the tool results before responding.
    let finalContent = '';

    const availableTools = ToolRegistry.getOpenAITools();

    while (currentLoop < MAX_LOOPS) {
      currentLoop++;
      logger.info(`[AI OS] Execution loop ${currentLoop}/${MAX_LOOPS}`);

      const response = await RetryEngine.executeWithRetry(async () => {
        return await agentCompletion(messages, {
          tools: availableTools,
          tool_choice: 'auto',
          sectorId: ctx.sectorId ?? null
        });
      });

      let toolCalls = response.tool_calls;

      // Fallback: If native tool_calls is empty, check if LLM returned tool arguments in text content
      if (!toolCalls || toolCalls.length === 0) {
        toolCalls = detectToolCallFromContent(response.content, instruction, actionsRun.length);
      }

      const hasToolCalls = toolCalls && toolCalls.length > 0;

      if (!hasToolCalls) {
        // ✅ No tool calls → this is the final response. Capture it and stop.
        // The LLM has already seen all tool results and is now summarising.
        finalContent = response.content || 'Task completed.';
        break;
      }

      // ⚠️ Model returned tool_calls (possibly WITH text too).
      // Discard any accompanying text — it was generated before tools ran
      // and may be a premature/hallucinated success message.
      // Only the tool results (added below) determine what the LLM says next.
      if (response.content) {
        logger.debug(`[AI OS] Discarding premature LLM text (tool calls pending): "${response.content.slice(0, 80)}..."`);
      }

      // Record the assistant turn with tool_calls (required by the protocol)
      messages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: toolCalls
      } as AgentChatMessage);

      // Execute each requested tool and feed results back into the message thread
      for (const tc of toolCalls!) {
        const toolName = tc.function.name;
        let args: any = {};
        try {
          args = typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments;
        } catch {
          logger.warn(`[AI OS] Failed to parse arguments for tool ${toolName}`);
        }

        emitToUser(ctx.userId, 'ai:step_progress', {
          status: 'running',
          tool: toolName,
          message: `Calling ${toolName}…`
        });

        logger.info(`[AI OS] Executing tool: ${toolName}`, args);

        const toolResult = await ToolExecutor.execute(toolName, args, ctx, req, instruction);

        logger.info(`[AI OS] Tool result for ${toolName}: success=${toolResult.success}`, toolResult.success ? toolResult.data : toolResult.error);

        if (toolResult.success && toolResult.data?.requiresConfirmation) {
          // Stop here — do NOT feed this back into the LLM loop. The model
          // must never see or fabricate a confirmation; the human approves
          // via a second /ai/run call carrying confirmationToken, which
          // short-circuits straight to ToolExecutor.executeConfirmed() at
          // the top of run().
          emitToUser(ctx.userId, 'ai:step_progress', {
            status: 'pending_confirmation',
            tool: toolName,
            message: 'This action needs your confirmation before it runs.',
            workflowState
          });
          return {
            output: toolResult.data.preview ? String(toolResult.data.preview) : 'This action needs your confirmation before it runs.',
            workflowState,
            actionsRun,
            pendingConfirmation: {
              toolName,
              preview: toolResult.data.preview,
              confirmationToken: toolResult.data.confirmationToken,
            },
          };
        }

        actionsRun.push({
          tool: toolName,
          success: toolResult.success,
          data: toolResult.success ? toolResult.data : undefined,
          error: toolResult.success ? undefined : toolResult.error
        });

        const transitionedState = WorkflowManager.transition(workflowState, toolName, toolResult);
        Object.assign(workflowState, transitionedState);

        emitToUser(ctx.userId, 'ai:step_progress', {
          status: toolResult.success ? 'success' : 'failed',
          tool: toolName,
          message: toolResult.success
            ? `✓ ${toolName} succeeded`
            : `✗ ${toolName} failed: ${toolResult.error}`,
          workflowState
        });

        // Feed the ACTUAL backend result back to the LLM.
        // The LLM MUST read this before composing its final reply.
        // This is what prevents hallucinated success messages.
        messages.push({
          role: 'tool',
          name: toolName,
          tool_call_id: tc.id,
          content: JSON.stringify({
            success: toolResult.success,
            data: toolResult.success ? toolResult.data : undefined,
            error: toolResult.success ? undefined : toolResult.error,
            _instruction: toolResult.success
              ? 'Tool succeeded. The action is fully complete. Use the data above to confirm the final result. Do NOT say the task is processing or ask the user to check back later.'
              : 'Tool FAILED. You MUST report this failure. Do NOT say the action succeeded. Report the exact error above.'
          })
        });
      }
    }

    // If the loop exhausted without a final text turn, ask for a summary
    if (!finalContent) {
      logger.warn('[AI OS] Max loops reached without a final text response — requesting summary');
      const summary = await agentCompletion([
        ...messages,
        {
          role: 'user',
          content: 'Summarise the outcome of all the steps above for the user in one concise message. If any step failed, say so clearly.'
        }
      ], { tools: [], tool_choice: 'none', sectorId: ctx.sectorId ?? null });
      finalContent = summary.content || 'The operation has been completed. Please check the relevant pages for the updated data.';
    }

    return {
      output: finalContent,
      workflowState,
      actionsRun
    };
  }
}

function detectToolCallFromContent(content: string | null, instruction: string, actionsRunCount: number = 0): any[] | undefined {
  // Check if instruction is a bulk import command with attachment ID (only on first loop)
  if (actionsRunCount === 0) {
    const attachmentMatch = instruction.match(/document ID ([a-f0-9-]{36})/i);
    if (attachmentMatch && attachmentMatch[1]) {
      const isCandidateList = /candidate|applicant|resume|cv|list/i.test(instruction);
      const isQuestionBank = /question|bank|mcq/i.test(instruction) && !isCandidateList;
      
      // Try to extract bank name/id if user provided it
      let bankId = undefined;
      const bankMatch = instruction.match(/bank (?:ID )?([a-f0-9-]{36})/i);
      if (bankMatch) bankId = bankMatch[1];
      else if (instruction.toLowerCase().includes('mcq')) bankId = 'mcq';
      
      return [{
        id: `call_detected_${Date.now()}`,
        type: 'function',
        function: {
          name: isQuestionBank ? 'importQuestionBankFromAttachment' : 'importCandidateListFromAttachment',
          arguments: JSON.stringify(isQuestionBank ? { attachmentId: attachmentMatch[1], bankId } : { body: { attachmentId: attachmentMatch[1] } })
        }
      }];
    }
  }

  if (!content) return undefined;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('```')) return undefined;

  try {
    const cleaned = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.tool || parsed.name || parsed.function) {
      let toolName = parsed.tool || parsed.name || parsed.function;
      let args = parsed.args || parsed.arguments || parsed.body || parsed;

      // Fix LLM mis-mapping: if prompt or payload relates to job creation, ensure tool is createJob (not createApplication)
      if (toolName === 'createApplication' && (instruction.toLowerCase().includes('job') || args.title)) {
        toolName = 'createJob';
      }

      return [{
        id: `call_detected_${Date.now()}`,
        type: 'function',
        function: { name: toolName, arguments: typeof args === 'string' ? args : JSON.stringify(args) }
      }];
    }

    if (parsed.body?.attachmentId || parsed.attachmentId) {
      const attachmentId = parsed.body?.attachmentId || parsed.attachmentId;
      const bankId = parsed.body?.bankId || parsed.bankId;
      const isCandidateList = /candidate|applicant|resume|cv|list/i.test(instruction);
      const isQuestionBank = /question|bank|mcq/i.test(instruction) && !isCandidateList;
      return [{
        id: `call_detected_${Date.now()}`,
        type: 'function',
        function: {
          name: isQuestionBank ? 'importQuestionBankFromAttachment' : 'importCandidateListFromAttachment',
          arguments: JSON.stringify(isQuestionBank ? { attachmentId, bankId } : { body: { attachmentId } })
        }
      }];
    }
  } catch {
    // Ignore non-JSON text
  }

  return undefined;
}
