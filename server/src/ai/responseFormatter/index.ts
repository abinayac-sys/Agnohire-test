import { logger } from '../../config/logger.js';

export class ResponseFormatter {
  /**
   * Wraps the raw data returned by the backend service into a standard JSON structure.
   */
  static success(data: any): any {
    return {
      success: true,
      data,
    };
  }

  /**
   * Formats backend errors gracefully without exposing stack traces.
   */
  static error(error: unknown): any {
    logger.error('[ResponseFormatter] Tool execution error:', error);
    
    let message = 'An unexpected error occurred during execution.';
    if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === 'string') {
      message = error;
    }

    return {
      success: false,
      error: message,
    };
  }
}
