import { logger } from '../../config/logger.js';

export interface AIContext {
  userId: string;
  role: string;
  sectorId?: string | null;
  tenantId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  workspaceRole?: string | null;
  permissions: string[];
}

export interface AIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

export interface AITool {
  name: string;
  description: string;
  parameters: any;
  category?: string;
  /** Domain entity this tool acts on (e.g. 'job', 'candidate', 'analytics').
   * Used by ToolExecutor to tag the EventBus/audit context of a run so
   * callers know what changed. Distinct from `category`, which only groups
   * tools when filtering the set exposed to the model. */
  entity?: string;
  execute: (args: any, ctx: AIContext, req: any) => Promise<any>;
  roles?: string[]; // E.g., ['ADMIN', 'RECRUITER']
  /** Permission keys (from PERMISSIONS) ALL of which the caller must hold.
   * Checked by PermissionChecker, which fails closed: a tool with none of
   * `permissions`, `permissionsAny`, `allowedRoles`, or `publicTool` set is
   * denied to everyone but SUPERADMIN/ADMIN. */
  permissions?: string[];
  /** Alternative to `permissions`: caller needs at least ONE of these. */
  permissionsAny?: string[];
  /** Restrict to specific roles instead of/in addition to permissions
   * (mirrors requireRole() on the HTTP route this tool wraps). */
  allowedRoles?: string[];
  /** Explicit opt-out of the permission check for genuine reference/lookup
   * tools (e.g. listing sectors) that carry no sensitive data and require
   * nothing beyond being authenticated. Required when a tool has none of
   * `permissions`, `permissionsAny`, or `allowedRoles` — omitting all four
   * denies the tool rather than silently allowing it. */
  publicTool?: boolean;
  /** Mutating/destructive tools must set this so ToolExecutor gates them
   * behind a verified requires_confirmation → human-confirm round trip. */
  requiresConfirmation?: boolean;
  /** Tools that read/write a SPECIFIC workspace (typically via an
   * LLM-supplied `args.workspaceId`) must set this so ToolExecutor verifies
   * that workspace against the caller's real membership — never trusts the
   * model-supplied id on its own. Tools that just operate in the caller's
   * own ambient workspace (the common case) don't need this. */
  scopeSensitive?: boolean;
  /** Optional richer preview for gated tools. Called by ToolExecutor instead
   * of execute() while unconfirmed. May return a human-readable preview
   * (string/object) or `{ status: 'clarification_needed', message }` to make
   * the model re-ask instead of showing a preview. Must never mutate. */
  preview?: (args: any, ctx: AIContext, req: any) => Promise<any>;
}

/** Name prefixes that historically triggered the destructive-action gate. */
const DESTRUCTIVE_PREFIXES = ['delete', 'withdraw', 'reject', 'disable', 'close'];

class Registry {
  private tools: Map<string, AITool> = new Map();

  register(tool: AITool) {
    if (this.tools.has(tool.name)) {
      // By design: hand-written "smart" tools are registered after the
      // auto-generated raw-HTTP tools and intentionally replace them.
      logger.info(`[ToolRegistry] Tool ${tool.name} already registered — overwriting with the later registration.`);
    }

    if (tool.requiresConfirmation === undefined &&
        DESTRUCTIVE_PREFIXES.some((p) => tool.name.startsWith(p))) {
      tool.requiresConfirmation = true;
    }

    // Auto-infer category from tool name if not provided (especially for generated tools)
    if (!tool.category) {
      if (tool.name.toLowerCase().includes('job')) tool.category = 'jobs';
      else if (tool.name.toLowerCase().includes('candidate') || tool.name.toLowerCase().includes('resume')) tool.category = 'candidates';
      else if (tool.name.toLowerCase().includes('interview')) tool.category = 'interviews';
      else if (tool.name.toLowerCase().includes('assessment')) tool.category = 'assessments';
      else if (tool.name.toLowerCase().includes('offer')) tool.category = 'offers';
      else if (tool.name.toLowerCase().includes('user') || tool.name.toLowerCase().includes('role')) tool.category = 'users';
      else if (tool.name.toLowerCase().includes('tenant') || tool.name.toLowerCase().includes('department') || tool.name.toLowerCase().includes('location') || tool.name.toLowerCase().includes('sector') || tool.name.toLowerCase().includes('domain')) tool.category = 'organization';
      else if (tool.name.toLowerCase().includes('report') || tool.name.toLowerCase().includes('analytic') || tool.name.toLowerCase().includes('dashboard')) tool.category = 'reports';
      else if (tool.name.toLowerCase().includes('email') || tool.name.toLowerCase().includes('notification') || tool.name.toLowerCase().includes('remind')) tool.category = 'emails';
      else tool.category = 'general';
    }

    this.tools.set(tool.name, tool);
  }

  getTool(name: string): AITool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): AITool[] {
    return Array.from(this.tools.values());
  }

  getOpenAITools(categories?: string[]): AIToolDefinition[] {
    let tools = this.getAllTools();
    
    if (categories && categories.length > 0) {
      tools = tools.filter(t => categories.includes(t.category || 'general'));
    }

    // Exclude raw API tools that conflict with smart natural-language tools
    // registered under a DIFFERENT name (e.g. the raw 'createInterview' vs.
    // the smart 'scheduleInterview'/'rescheduleInterview'). This prevents the
    // AI from hitting backend validation errors (e.g. missing UUIDs) because
    // it will use the smart tool that resolves names to IDs automatically.
    // Do NOT add 'createQuestionBank'/'updateQuestionBank' here — the smart
    // hand-written tool in ai/tools/questionBank/index.ts registers under
    // that EXACT same name (overwriting, not replacing under a new name), so
    // excluding it by name here would exclude the smart tool itself, not a
    // separate raw one.
    const excludedTools = new Set([
      'createInterview',
      'updateInterview',
      'createAssessment',
      'updateAssessment',
      'assignAssessment',
    ]);
    tools = tools.filter(t => !excludedTools.has(t.name));

    // Hand-written "smart" tools (name/ID resolution, sane defaults,
    // multi-step orchestration) are vastly outnumbered by auto-generated
    // raw-HTTP tools that load first (see tools/index.ts) and fill most of
    // the Map's insertion order before any smart tool ever registers — so a
    // plain slice(0, 128) by insertion order silently drops tools like
    // createJob/createQuestionBank/sendNotification while keeping raw,
    // default-free generated tools that fail on missing fields the smart
    // tools would have auto-filled. Every generated tool's description has
    // this exact fixed prefix (see generateAITools.ts) — a reliable signal,
    // with no extra registry field needed, to always prioritize hand-written
    // tools into the cap ahead of the generated long tail.
    const isGenerated = (t: typeof tools[number]) => t.description.startsWith('Auto-generated tool for ');
    tools = [...tools.filter((t) => !isGenerated(t)), ...tools.filter(isGenerated)];

    if (tools.length > 128) {
      // Loud on purpose: a silent truncation here means tools past the cap
      // are invisible to the model with no indication why.
      logger.error(
        `[ToolRegistry] getOpenAITools(${categories?.join(',') ?? 'ALL'}) resolved ${tools.length} tools, ` +
        `truncating to 128. Tools past the cap will be invisible to the model.`,
      );
    }

    return tools.slice(0, 128).map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }
}

export const ToolRegistry = new Registry();
