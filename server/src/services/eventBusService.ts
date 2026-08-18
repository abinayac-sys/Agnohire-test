import { EventEmitter } from 'events';
import { logger } from '../config/logger.js';

class EventBus extends EventEmitter {}

const eventBus = new EventBus();
// Increase limit if we have many listeners
eventBus.setMaxListeners(20);

export interface AgnoEvent {
  tenantId: string;
  eventName: string; // e.g. "CANDIDATE_APPLIED", "INTERVIEW_ENDED"
  entityId: string;
  payload: any;
  actorId?: string;
}

export class EventBusService {
  static emit(event: AgnoEvent) {
    logger.info(`[EventBus] Emitting event: ${event.eventName} for tenant: ${event.tenantId}`);
    eventBus.emit(event.eventName, event);
    // Also emit a wildcard event if a global listener wants it
    eventBus.emit('*', event);
  }

  static on(eventName: string, listener: (event: AgnoEvent) => void) {
    eventBus.on(eventName, listener);
  }

  static off(eventName: string, listener: (event: AgnoEvent) => void) {
    eventBus.off(eventName, listener);
  }
}
