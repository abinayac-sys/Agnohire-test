import { ToolRegistry, type AIContext, type AITool } from '../toolRegistry/index.js';
import { ParameterCollector } from '../parameterCollector/index.js';
import { PermissionChecker } from '../permissionChecker/index.js';
import { ResponseFormatter } from '../responseFormatter/index.js';
import { createConfirmationToken, consumeConfirmationToken } from './confirmationStore.js';
import { logger } from '../../config/logger.js';

/** Prefix-based fallback preview when a gated tool has no `preview()` of its
 * own — mirrors the DESTRUCTIVE_PREFIXES verbs in toolRegistry/index.ts. */
function genericPreview(tool: AITool, args: any): string {
  const verb = tool.name.startsWith('delete') ? 'delete'
    : tool.name.startsWith('withdraw') ? 'withdraw'
    : tool.name.startsWith('reject') ? 'reject'
    : tool.name.startsWith('disable') ? 'disable'
    : tool.name.startsWith('close') ? 'close'
    : 'run';
  const idHint = args?.id ?? args?.body?.id ?? args?.candidateId ?? args?.jobId ?? args?.interviewId ?? args?.questionId;
  return `About to ${verb} this record${idHint ? ` (${idHint})` : ''}. Confirm to proceed.`;
}

export class ToolExecutor {
  /**
   * Orchestrates the execution of a tool:
   * 1. Retrieves tool from registry
   * 2. Validates parameters
   * 3. Checks permissions
   * 4. Executes the backend function
   * 5. Formats the response
   * 6. Logs the action
   */
  static async execute(
    toolName: string,
    args: any,
    ctx: AIContext,
    req: any,
    prompt: string = 'Unknown prompt'
  ): Promise<any> {
    const startTime = Date.now();

    // Reroute toolName if LLM picked createApplication when creating a job requisition
    if (toolName === 'createApplication' && (args?.title || args?.body?.title || (prompt && prompt.toLowerCase().includes('job')))) {
      toolName = 'createJob';
      if (args?.body) {
        args = { ...args.body, ...args };
      }
    }

    // Reroute toolName if LLM picked createBank, createAssessment, or createQuestionBank_1
    if ((toolName === 'createBank' || toolName.startsWith('createQuestionBank')) && (args?.name || args?.body?.name || (prompt && prompt.toLowerCase().includes('question')))) {
      toolName = 'createQuestionBank';
      if (args?.body) {
        args = { ...args.body, ...args };
      }
    }

    // Reroute test link / assessment scheduling / assessment page requests to generateTestLink
    const lowerPrompt = (prompt || '').toLowerCase();
    if (
      toolName === 'runAi' ||
      toolName === 'postApiAiRun' ||
      toolName === 'sendTestLink' ||
      toolName === 'scheduleTestLink' ||
      toolName === 'createTestLink' ||
      toolName === 'assignAssessment' ||
      lowerPrompt.includes('assessment page') ||
      toolName.toLowerCase().includes('assessmentpage') ||
      (lowerPrompt.includes('test link') || lowerPrompt.includes('schedule link') || lowerPrompt.includes('send test'))
    ) {
      if (!ToolRegistry.getTool(toolName) || toolName === 'runAi' || toolName === 'postApiAiRun' || toolName === 'createAssessment' || lowerPrompt.includes('assessment page')) {
        toolName = 'generateTestLink';
        if (args?.body) {
          args = { ...args.body, ...args };
        }
      }
    }

    const tool = ToolRegistry.getTool(toolName);

    // Logging metadata
    const logData = {
      user: ctx?.userId || 'System',
      prompt,
      selectedTool: toolName,
      parameters: args,
      executionTimeMs: 0,
    };

    if (!tool) {
      const result = ResponseFormatter.error(`Tool ${toolName} is not registered.`);
      this.logAction(logData, startTime, result);
      return result;
    }

    // Validate parameters
    const paramValidation = ParameterCollector.validate(tool, args);
    if (!paramValidation.valid) {
      const result = ResponseFormatter.error(paramValidation.error);
      this.logAction(logData, startTime, result);
      return result;
    }

    // Auto-map flat arguments to 'body' if missing but expected by schema
    if (tool.parameters?.properties?.body && !args.body) {
      const bodyContent: any = {};
      for (const key of Object.keys(args)) {
        if (key !== 'params' && key !== 'query' && key !== 'confirmed') {
          bodyContent[key] = args[key];
          delete args[key];
        }
      }
      if (Object.keys(bodyContent).length > 0) {
        args.body = bodyContent;
      }
    }

    // Check permissions
    const isAllowed = await PermissionChecker.isAllowed(tool, ctx);
    if (!isAllowed) {
      const result = ResponseFormatter.error(`You do not have permission to execute the action: ${toolName}.`);
      this.logAction(logData, startTime, result);
      return result;
    }

    // For scope-sensitive tools, an LLM-supplied args.workspaceId is never
    // trusted on its own — verify it against the caller's real membership,
    // same threat model as the /api/auth/switch-workspace endpoint.
    if (tool.scopeSensitive) {
      const targetWorkspaceId = args?.workspaceId ?? args?.body?.workspaceId ?? null;
      const allowedForWorkspace = await PermissionChecker.isAllowedForWorkspace(ctx, targetWorkspaceId);
      if (!allowedForWorkspace) {
        const result = ResponseFormatter.error('You do not have access to that workspace.');
        this.logAction(logData, startTime, result);
        return result;
      }
    }

    // Destructive-action confirmation gate. A gated tool is NEVER executed
    // on this call — a single-use token bound to {user, tool, args} is
    // minted instead (see confirmationStore.ts), and the caller must
    // round-trip it back via executeConfirmed() once a human has actually
    // approved it. Unlike the old "ask the model to double-check and re-call
    // with confirmed: true" approach, the model itself can never talk its
    // way past this — it has no way to mint or guess a valid token.
    if (tool.requiresConfirmation) {
      const preview = tool.preview ? await tool.preview(args, ctx, req) : genericPreview(tool, args);
      const confirmationToken = await createConfirmationToken(ctx.userId, toolName, args);
      const result = ResponseFormatter.success({
        status: 'requires_confirmation',
        requiresConfirmation: true,
        confirmationToken,
        preview,
        toolName,
        message: `Confirmation required before running ${toolName}.`,
      });
      logger.info(`[ToolExecutor] ${toolName} requires confirmation — not executed on this call.`);
      this.logAction(logData, startTime, result);
      return result;
    }

    return this.runWithRetries(tool, toolName, args, ctx, req, logData, startTime);
  }

  /**
   * Executes a previously-gated tool call now that the human has confirmed
   * it. `token` must be the exact token returned by a prior `execute()` call
   * — it is single-use and bound to {userId, toolName, hash(args)}.
   */
  static async executeConfirmed(token: string, ctx: AIContext, req: any, prompt: string = 'Unknown prompt'): Promise<any> {
    const startTime = Date.now();
    const logData: any = { user: ctx?.userId || 'System', prompt, selectedTool: 'unknown', parameters: {}, executionTimeMs: 0 };

    const pending = await consumeConfirmationToken(token, ctx.userId);
    if (!pending) {
      const result = ResponseFormatter.error('This confirmation has expired or was already used. Please retry the action.');
      this.logAction(logData, startTime, result);
      return result;
    }

    const tool = ToolRegistry.getTool(pending.toolName);
    logData.selectedTool = pending.toolName;
    logData.parameters = pending.args;
    if (!tool) {
      const result = ResponseFormatter.error(`Tool ${pending.toolName} is not registered.`);
      this.logAction(logData, startTime, result);
      return result;
    }

    // Re-check permission at confirm time too — the user's role/permissions
    // could have changed in the (up to 5-minute) gap since the preview.
    const isAllowed = await PermissionChecker.isAllowed(tool, ctx);
    if (!isAllowed) {
      const result = ResponseFormatter.error(`You do not have permission to execute the action: ${pending.toolName}.`);
      this.logAction(logData, startTime, result);
      return result;
    }

    const result = await this.runWithRetries(tool, pending.toolName, pending.args, ctx, req, logData, startTime);
    return { ...result, toolName: pending.toolName };
  }

  /** Shared execution path for both a directly-runnable tool and a
   * just-confirmed one — retry/backoff and tenant scoping must be identical
   * either way. */
  private static async runWithRetries(
    tool: AITool,
    toolName: string,
    args: any,
    ctx: AIContext,
    req: any,
    logData: any,
    startTime: number,
  ): Promise<any> {
    try {
      // Execute with retries (up to 3 times)
      let rawResult: any;
      let lastError: any = null;
      const MAX_RETRIES = 3;

      const { runWithScope } = await import('../../config/tenantContext.js');
      const isPlatformOperator = ctx.role === 'SUPERADMIN' || ctx.role === 'ADMIN';

      // Debug log: shows what context the tool will execute with
      logger.info(`[ToolExecutor] Running ${toolName} | role=${ctx.role} | tenantId=${ctx.tenantId} | workspaceId=${ctx.workspaceId} | perms=${ctx.permissions?.length ?? 0} | bypass=${isPlatformOperator}`);

      await runWithScope({ tenantId: ctx.tenantId ?? null, organizationId: ctx.organizationId ?? null, workspaceId: ctx.workspaceId ?? null }, async () => {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            rawResult = await tool.execute(args, ctx, req);
            lastError = null;
            break;
          } catch (err: any) {
            lastError = err;
            logger.warn(`[ToolExecutor] Tool ${toolName} execution attempt ${attempt} failed: ${err.message || err}`);
            if (attempt < MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 5000)));
            }
          }
        }
        if (lastError) {
          throw lastError;
        }
      }, isPlatformOperator);
      const formattedResult = ResponseFormatter.success(rawResult);
      this.logAction(logData, startTime, formattedResult);
      return formattedResult;
    } catch (err: any) {
      const formattedError = ResponseFormatter.error(err.message || err);
      this.logAction(logData, startTime, formattedError);
      return formattedError;
    }
  }

  private static logAction(logData: any, startTime: number, result: any) {
    logData.executionTimeMs = Date.now() - startTime;
    logData.result = result.success ? result.data : null;
    logData.error = result.success ? null : result.error;

    logger.info('[AIToolExecution]', logData);
  }
}
