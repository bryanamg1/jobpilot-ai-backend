import { env } from '../config/env.js';
import { logger as defaultLogger } from '../config/logger.js';
import { retryOperation } from './retry.js';

export function createOperationalQueueService(options = {}) {
  const config = options.config ?? env;
  const logger = options.logger ?? defaultLogger;
  const handlers = new Map();
  const stats = {
    enqueued: 0,
    processed: 0,
    failed: 0,
    pending: 0,
    lastError: null,
  };

  return {
    mode: config.REDIS_URL && !config.isTest ? 'redis_pending' : 'inline',

    registerProcessor(taskName, handler) {
      handlers.set(taskName, handler);
    },

    async dispatch(taskName, payload, optionsInput = {}) {
      const handler = handlers.get(taskName);
      if (!handler) {
        throw new Error(`Operational queue processor is not registered: ${taskName}`);
      }

      const attempts = Math.max(1, optionsInput.attempts ?? config.OPERATIONS_QUEUE_RETRY_ATTEMPTS);
      const baseDelayMs = Math.max(0, optionsInput.baseDelayMs ?? config.OPERATIONS_QUEUE_RETRY_DELAY_MS);

      stats.enqueued += 1;
      stats.pending += 1;

      try {
        const result = await retryOperation(
          () => handler(payload),
          {
            attempts,
            baseDelayMs: config.isTest ? 0 : baseDelayMs,
          },
        );

        stats.processed += 1;
        return result;
      } catch (error) {
        stats.failed += 1;
        stats.lastError = {
          taskName,
          message: error?.message ?? 'Unknown queue error',
          recordedAt: new Date().toISOString(),
        };
        logger.warn(
          {
            taskName,
            attempts,
            error: error?.message ?? 'Unknown queue error',
          },
          'Operational queue task failed',
        );
        throw error;
      } finally {
        stats.pending = Math.max(0, stats.pending - 1);
      }
    },

    getStatus() {
      return {
        status: this.mode === 'redis_pending' ? 'degraded' : 'ok',
        mode: this.mode,
        queueName: config.OPERATIONS_QUEUE_NAME,
        registeredProcessors: handlers.size,
        ...stats,
      };
    },
  };
}
