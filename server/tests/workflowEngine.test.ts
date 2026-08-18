import { describe, it, expect } from 'vitest';
import { WorkflowRegistry } from '../src/ai/workflowEngine/registry.js';
import { WorkflowManager } from '../src/ai/workflowEngine/manager.js';
import { WorkflowState } from '../src/ai/workflowEngine/types.js';

describe('Recruitment Workflow Engine Tests', () => {
  it('WorkflowRegistry should correctly lookup step details', () => {
    const sectorStep = WorkflowRegistry.getStep('create-sector');
    expect(sectorStep).toBeDefined();
    expect(sectorStep?.name).toBe('Create Sector');
    expect(sectorStep?.nextStepId).toBe('create-domain');
  });

  it('WorkflowManager should transition state correctly upon successful sector creation', () => {
    let state: WorkflowState = {
      currentStepId: 'create-sector',
      completedStepIds: [],
      context: {},
    };

    // Transition with successful createSector call
    state = WorkflowManager.transition(state, 'createSector', {
      success: true,
      data: { id: 'sector-uuid-123', name: 'Information Technology' }
    });

    expect(state.completedStepIds).toContain('create-sector');
    expect(state.currentStepId).toBe('create-domain');
    expect(state.context.sectorId).toBe('sector-uuid-123');
    expect(state.context.sectorName).toBe('Information Technology');
  });

  it('WorkflowManager should transition state correctly upon successful domain creation', () => {
    let state: WorkflowState = {
      currentStepId: 'create-domain',
      completedStepIds: ['create-sector'],
      context: { sectorId: 'sector-uuid-123', sectorName: 'Information Technology' },
    };

    // Transition with successful createDomain call
    state = WorkflowManager.transition(state, 'createDomain', {
      success: true,
      data: { id: 'domain-uuid-456', name: 'Software Development' }
    });

    expect(state.completedStepIds).toContain('create-domain');
    expect(state.currentStepId).toBe('create-job');
    expect(state.context.domainId).toBe('domain-uuid-456');
  });

  it('WorkflowManager should transition state on manual completion (e.g. Done/Approved)', () => {
    let state: WorkflowState = {
      currentStepId: 'approve-job',
      completedStepIds: ['create-sector', 'create-domain', 'create-job'],
      context: { sectorId: 's-id', domainId: 'd-id', jobId: 'j-id' },
    };

    // Manual confirmation transition
    state = WorkflowManager.transition(state, 'general', { success: true });

    expect(state.completedStepIds).toContain('approve-job');
    expect(state.currentStepId).toBe('import-candidates');
  });

  it('WorkflowManager should generate correct system prompt guidelines', () => {
    const state: WorkflowState = {
      currentStepId: 'create-job',
      completedStepIds: ['create-sector', 'create-domain'],
      context: { sectorId: 'sector-uuid-123', domainId: 'domain-uuid-456' },
    };

    const instructions = WorkflowManager.getSystemInstructions(state);
    expect(instructions).toContain('Create Job Requisition');
    expect(instructions).toContain('sector-uuid-123');
    expect(instructions).toContain('domain-uuid-456');
  });
});
