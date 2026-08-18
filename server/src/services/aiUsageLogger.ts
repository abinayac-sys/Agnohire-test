import { prisma } from '../config/database.js';
import { runAsPlatform } from '../config/tenantContext.js';
import { logger } from '../config/logger.js';
import { estimateCostUsd } from '../config/aiPricing.js';
import { CONFIG_KEYS } from '@agnohire/shared';

export interface AiUsageEntry {
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  feature: string;
  agentName?: string | null;
  toolName?: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  success: boolean;
  errorMsg?: string | null;
  durationMs?: number | null;
}

/**
 * True when this tenant relies on the platform-provided API key (i.e. no
 * tenant-scoped override row exists for ai.openai_api_key with a value) —
 * meaning AgnoHire, not the tenant, is paying the provider for this call, and
 * the usage should be billed back to them at month end. A tenant with their
 * own key (BYOK) pays their provider directly and is never billed by us for
 * tokens.
 */
export async function isBillableToTenant(tenantId: string | null): Promise<boolean> {
  if (!tenantId) return false;
  return runAsPlatform(async () => {
    // sectorId: null matches how every tenant-scoped override is actually
    // written (configService.set() defaults sectorId to null for this key —
    // there is no UI path that creates a sector-scoped AI key override).
    // Filtering it explicitly, rather than leaving it unconstrained, avoids an
    // unordered findFirst ever picking an unrelated sector-scoped row instead.
    const override = await prisma.systemConfiguration.findFirst({
      where: { key: CONFIG_KEYS.OPENAI_API_KEY, tenantId, sectorId: null },
      select: { value: true },
    });
    return !override || !override.value;
  });
}

/**
 * Records one AI provider call. Fire-and-forget from the caller's
 * perspective — aiProviderService.ts calls this as `void logAiUsage(...)` so
 * logging never adds latency to the user-facing AI response. Because of that,
 * this function must never throw, and must never depend on the caller's
 * ambient tenant context still being live when its internal awaits resolve:
 * every tenant-scoped read goes through runAsPlatform with an explicit
 * tenantId, and the insert target (AiUsageLog) is deliberately excluded from
 * the tenant-scoping Prisma middleware (see config/database.ts TENANT_MODELS)
 * for the same reason — see the model's doc comment in schema.prisma.
 */
export async function logAiUsage(entry: AiUsageEntry): Promise<void> {
  try {
    const costUsd = estimateCostUsd(entry.model, entry.promptTokens, entry.completionTokens);
    const billable = entry.success && (await isBillableToTenant(entry.tenantId));

    await prisma.aiUsageLog.create({
      data: {
        tenantId: entry.tenantId,
        userId: entry.userId,
        sessionId: entry.sessionId,
        feature: entry.feature,
        agentName: entry.agentName ?? null,
        toolName: entry.toolName ?? null,
        provider: entry.provider,
        model: entry.model,
        promptTokens: entry.promptTokens,
        completionTokens: entry.completionTokens,
        totalTokens: entry.totalTokens,
        costUsd: costUsd ?? null,
        billable,
        success: entry.success,
        errorMsg: entry.errorMsg ?? null,
        durationMs: entry.durationMs ?? null,
      },
    });
  } catch (err) {
    logger.warn('Failed to record AI usage log', { err: (err as Error).message, feature: entry.feature });
  }
}
