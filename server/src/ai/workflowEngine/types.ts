export interface WorkflowStep {
  id: string;
  name: string;
  module: 'admin' | 'requisition' | 'interview' | 'hiring' | 'analytics';
  description: string;
  prerequisites: string[];
  nextStepId?: string;
  prevStepId?: string;
  automationTool?: string;
  manualFallbackGuide: string;
  successCondition: string;
}

export interface WorkflowState {
  currentStepId: string;
  completedStepIds: string[];
  context: {
    sectorId?: string;
    sectorName?: string;
    domainId?: string;
    domainName?: string;
    jobId?: string;
    jobTitle?: string;
    candidateListId?: string;
    candidateId?: string;
    interviewId?: string;
    questionBankId?: string;
    [key: string]: any;
  };
}
