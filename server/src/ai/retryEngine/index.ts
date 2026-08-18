import { logger } from '../../config/logger.js';

export class RetryEngine {
  /**
   * Executes a function with a built-in exponential backoff retry mechanism.
   * Useful for transient network failures or database locks.
   */
  static async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
  ): Promise<T> {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        return await operation();
      } catch (error: any) {
        attempt++;
        if (attempt >= maxRetries) {
          logger.error(`[RetryEngine] Operation failed after ${maxRetries} attempts`, error);
          throw error;
        }

        // Wait exponentially before retrying
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn(`[RetryEngine] Operation failed, retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('RetryEngine exhausted all retries.'); // Should never be reached
  }
}
