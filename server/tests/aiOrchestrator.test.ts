import { describe, it, expect, vi } from 'vitest';
import { AIOrchestratorService } from '../src/services/aiOrchestratorService.js';
import * as aiProvider from '../src/services/aiProviderService.js';
import { ToolExecutor } from '../src/ai/toolExecutor/index.js';

vi.mock('../src/services/aiProviderService.js', () => ({
  agentCompletion: vi.fn(),
}));

vi.mock('../src/ai/toolExecutor/index.js', () => ({
  ToolExecutor: {
    execute: vi.fn(),
  },
}));

describe('AIOrchestratorService unit test', () => {
  it('discards premature LLM text when tool_calls are present, then uses post-tool response', async () => {
    vi.mocked(aiProvider.agentCompletion)
      // Loop 1: model returns text AND tool_calls simultaneously — text must be discarded
      .mockResolvedValueOnce({
        content: 'Sector created successfully!', // ← premature hallucination — must be discarded
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'createSector',
              arguments: JSON.stringify({ body: { name: 'Fintech', type: 'general' } }),
            },
          },
        ],
      })
      // Loop 2: after tool result injected — model now has the real result and responds
      .mockResolvedValueOnce({
        content: '✓ Sector "Fintech" created. You can view it on the Sectors & Domains page.',
        tool_calls: undefined,
      });

    vi.mocked(ToolExecutor.execute).mockResolvedValue({
      success: true,
      data: { id: 'sector-uuid-123', name: 'Fintech' },
    });

    const ctx = {
      userId: 'user-123',
      role: 'ADMIN',
      sectorId: null,
      tenantId: 'tenant-123',
      permissions: ['sector.manage'],
    };

    const result = await AIOrchestratorService.run('Create sector Fintech', ctx, {});

    // Final output must come from the POST-tool-result turn, not the hallucinated pre-tool turn
    expect(result.output).toBe('✓ Sector "Fintech" created. You can view it on the Sectors & Domains page.');
    expect(result.actionsRun).toHaveLength(1);
    expect(result.actionsRun[0].tool).toBe('createSector');
    expect(result.actionsRun[0].success).toBe(true);
    expect(result.actionsRun[0].data?.id).toBe('sector-uuid-123');
  });

  it('reports backend failure accurately — never fabricates success', async () => {
    vi.mocked(aiProvider.agentCompletion)
      // Loop 1: model calls tool
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          {
            id: 'call_2',
            type: 'function',
            function: {
              name: 'createSector',
              arguments: JSON.stringify({ body: { name: 'Civil', type: 'general' } }),
            },
          },
        ],
      })
      // Loop 2: model sees { success: false } result and reports it
      .mockResolvedValueOnce({
        content: '❌ Unable to create sector "Civil". Reason: A sector with this name already exists.',
        tool_calls: undefined,
      });

    // Simulate backend failure
    vi.mocked(ToolExecutor.execute).mockResolvedValue({
      success: false,
      error: 'A sector with this name already exists.',
    });

    const ctx = {
      userId: 'user-123',
      role: 'ADMIN',
      sectorId: null,
      tenantId: 'tenant-123',
      permissions: ['sector.manage'],
    };

    const result = await AIOrchestratorService.run('Create Civil sector', ctx, {});

    // The output must reflect the REAL failure, not a fabricated success
    expect(result.output).toContain('❌');
    expect(result.output).toContain('already exists');
    expect(result.actionsRun[0].success).toBe(false);
    expect(result.actionsRun[0].error).toBe('A sector with this name already exists.');
  });
});
