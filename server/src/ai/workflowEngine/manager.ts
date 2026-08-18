import { WorkflowState } from './types.js';
import { WorkflowRegistry, WORKFLOW_STEPS } from './registry.js';

export class WorkflowManager {
  /** Retrieves or initializes the workflow state from the last assistant message's metadata. */
  static getOrInitState(lastMessageMetadata: any): WorkflowState {
    if (lastMessageMetadata && lastMessageMetadata.workflowState) {
      return lastMessageMetadata.workflowState as WorkflowState;
    }
    return {
      currentStepId: 'create-sector',
      completedStepIds: [],
      context: {},
    };
  }

  /**
   * Scans a tool result recursively to extract an ID for a given key.
   * e.g., finding the 'id' in { success: true, data: { job: { id: 'uuid-123' } } }
   */
  static extractField(data: any, fieldName: string): any {
    if (!data || typeof data !== 'object') return undefined;

    // Check direct properties
    if (data[fieldName] !== undefined) return data[fieldName];

    // Check nested structures
    for (const key of Object.keys(data)) {
      const val = data[key];
      if (val && typeof val === 'object') {
        const found = this.extractField(val, fieldName);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  /**
   * Transitions the workflow state based on successful execution of a tool.
   */
  static transition(state: WorkflowState, toolName: string, toolResult: any): WorkflowState {
    const newState = {
      ...state,
      completedStepIds: [...state.completedStepIds],
      context: { ...state.context },
    };

    if (!toolResult || !toolResult.success) {
      return newState; // No transition on failure
    }

    const data = toolResult.data || toolResult;

    // 1. Capture context variables from the tool result
    if (toolName === 'createSector' || toolName === 'listSectors') {
      const id = this.extractField(data, 'id');
      const name = this.extractField(data, 'name');
      if (id) {
        newState.context.sectorId = id;
        if (name) newState.context.sectorName = name;
      }
    }
    if (toolName === 'createDomain' || toolName === 'listDomains') {
      const id = this.extractField(data, 'id');
      const name = this.extractField(data, 'name');
      if (id) {
        newState.context.domainId = id;
        if (name) newState.context.domainName = name;
      }
    }
    if (toolName === 'createJob' || toolName === 'listJobs' || toolName === 'searchJobs') {
      const id = this.extractField(data, 'id');
      const title = this.extractField(data, 'title');
      if (id) {
        newState.context.jobId = id;
        if (title) newState.context.jobTitle = title;
      }
    }
    if (toolName === 'uploadCandidate' || toolName === 'listCandidateLists') {
      const id = this.extractField(data, 'id');
      if (id) newState.context.candidateListId = id;
    }
    if (toolName === 'createCandidate' || toolName === 'searchCandidates') {
      const id = this.extractField(data, 'id');
      if (id) newState.context.candidateId = id;
    }
    if (toolName === 'scheduleInterview') {
      const id = this.extractField(data, 'id');
      if (id) newState.context.interviewId = id;
    }

    // 2. Determine current step progression
    const currentStep = WorkflowRegistry.getStep(state.currentStepId);
    if (currentStep) {
      // Check if success condition is met based on tool execution
      const isCurrentStepAutomation = currentStep.automationTool === toolName;
      const isManualCompletionInput = toolName === 'general' && currentStep.id === 'approve-job'; // e.g. typing "Approved" or "Done"
      
      if (isCurrentStepAutomation || isManualCompletionInput) {
        if (!newState.completedStepIds.includes(currentStep.id)) {
          newState.completedStepIds.push(currentStep.id);
        }
        if (currentStep.nextStepId) {
          newState.currentStepId = currentStep.nextStepId;
        }
      }
    }

    // 3. Proactive Auto-Jump: Skip completed steps
    while (newState.completedStepIds.includes(newState.currentStepId)) {
      const next = WorkflowRegistry.getNextStep(newState.currentStepId);
      if (next) {
        newState.currentStepId = next.id;
      } else {
        break;
      }
    }

    return newState;
  }

  /**
   * Formats the system prompt instructions based on the workflow state.
   */
  static getSystemInstructions(state: WorkflowState): string {
    const currentStep = WorkflowRegistry.getStep(state.currentStepId) || WORKFLOW_STEPS[0];
    
    return `
==================================================
RECRUITMENT WORKFLOW ENGINE STATE & FLEXIBLE EXECUTION
==================================================
Current Workflow Context:
- **Active Step:** ${currentStep.name} (Step ID: ${currentStep.id})
- **Completed Steps:** ${state.completedStepIds.map(id => WorkflowRegistry.getStep(id)?.name || id).join(', ') || 'None'}
- **Active Context Data:** ${JSON.stringify(state.context)}

WORKFLOW ENGINE DIRECTIVES:
1. Flexible Direct Action Execution: You are an enterprise AI Operating System. You must execute ANY platform action or tool requested by the user IMMEDIATELY (e.g. Bulk Import Candidates, Create Sector, Create Job, Schedule Interview, Send Email, etc.).
2. Do NOT block user requests with "you must create a sector first" or force rigid step order. If the user asks for a bulk import, execute the bulk import tool immediately.
3. Parameter Auto-Lookup: If a specific tool invocation requires an ID (such as sectorId, jobId, or candidateId) and the user didn't explicitly provide it, look up the active context or call a search/list tool (e.g., listSectors, listJobs) to find it automatically.
4. Always execute the backend tool first before delivering the final result to the user.
`;
  }
}
