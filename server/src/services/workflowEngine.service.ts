import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { EventBusService, AgnoEvent } from './eventBusService.js';
import { notify } from './notificationService.js';
// Add additional service imports here when executing actions (e.g. communicationAiService)

export class WorkflowEngineService {
  /**
   * Evaluates if a given event payload matches the workflow rules.
   */
  private static evaluateRules(rules: any[], payload: any): boolean {
    if (!rules || rules.length === 0) return true; // No rules = always run

    for (const rule of rules) {
      // Very basic evaluation for demonstration. In production, use dot-notation parser (e.g. lodash.get)
      const actualValue = payload[rule.field];
      if (actualValue === undefined) return false;

      switch (rule.operator) {
        case 'EQUALS':
          if (String(actualValue) !== String(rule.value)) return false;
          break;
        case 'GREATER_THAN':
          if (Number(actualValue) <= Number(rule.value)) return false;
          break;
        case 'CONTAINS':
          if (!String(actualValue).includes(String(rule.value))) return false;
          break;
        default:
          return false;
      }
    }
    return true;
  }

  /**
   * Executes a specific action.
   */
  private static async executeAction(action: any, event: AgnoEvent) {
    logger.info(`[WorkflowEngine] Executing action: ${action.type} for entity: ${event.entityId}`);

    switch (action.type) {
      case 'CREATE_TASK':
        // Example logic to create a task
        await prisma.communicationTask.create({
          data: {
            tenantId: event.tenantId,
            title: action.payload?.title || `Follow-up for ${event.eventName}`,
            description: action.payload?.description || '',
            createdById: event.actorId || 'system',
            priority: 'MEDIUM',
            status: 'TODO'
          }
        });
        break;
      case 'NOTIFY_RECRUITER':
        if (action.payload?.recipientId) {
          await notify({
            recipientId: action.payload.recipientId,
            type: 'AUTOMATION_NOTIFICATION',
            title: action.payload.title || 'Workflow Alert',
            message: action.payload.message || `Event ${event.eventName} triggered.`,
            entityType: 'AUTOMATION',
            entityId: event.entityId
          });
        }
        break;
      case 'GENERATE_AI_SUMMARY':
        // Specifically for INTERVIEW_ENDED
        // import { CommunicationAiService } from './communicationAi.service.js';
        // await CommunicationAiService.generateInterviewResult(event.tenantId, event.entityId);
        break;
      default:
        logger.warn(`[WorkflowEngine] Unknown action type: ${action.type}`);
    }
  }

  /**
   * The core listener that processes incoming events.
   */
  public static async processEvent(event: AgnoEvent) {
    try {
      // Find workflows that match this trigger
      const workflows = await prisma.automationWorkflow.findMany({
        where: {
          tenantId: event.tenantId,
          trigger: event.eventName,
          isActive: true
        },
        include: {
          rules: true,
          actions: { orderBy: { orderIndex: 'asc' } }
        }
      });

      for (const workflow of workflows) {
        const passed = this.evaluateRules(workflow.rules, event.payload);

        if (passed) {
          logger.info(`[WorkflowEngine] Workflow ${workflow.name} matched event ${event.eventName}`);

          let status = 'SUCCESS';
          let errorMessage = null;

          try {
            for (const action of workflow.actions) {
              await this.executeAction(action, event);
            }
          } catch (err: any) {
            status = 'FAILED';
            errorMessage = err.message;
            logger.error(`[WorkflowEngine] Workflow ${workflow.name} failed:`, err);
          }

          // Log the execution
          await prisma.automationLog.create({
            data: {
              tenantId: event.tenantId,
              workflowId: workflow.id,
              entityId: event.entityId,
              status,
              error: errorMessage
            }
          });
        }
      }
    } catch (err) {
      logger.error(`[WorkflowEngine] Error processing event ${event.eventName}:`, err);
    }
  }

  /**
   * Initializes the engine by subscribing to the EventBus.
   */
  public static init() {
    EventBusService.on('*', (event: AgnoEvent) => {
      // We process asynchronously so we don't block the caller
      this.processEvent(event).catch(err => {
        logger.error('[WorkflowEngine] Unhandled error during event processing:', err);
      });
    });
    logger.info('[WorkflowEngine] Initialized and listening to EventBus.');
  }
}
