import { randomUUID } from 'node:crypto';
import { logger } from '../../config/logger.js';
import { getRequestScope } from '../../lib/requestScope.js';

export function createAuditService(repository, options = {}) {
  const operationsQueueService = options.operationsQueueService ?? null;

  operationsQueueService?.registerProcessor('audit.persist', async ({ event }) =>
    repository.saveAuditEvent(event),
  );

  return {
    async record(eventName, entityType, entityId, payload) {
      const scope = getRequestScope();
      const event = {
        id: randomUUID(),
        entityType,
        entityId,
        eventName,
        payload: {
          ...payload,
          _meta: {
            requestId: scope?.requestId ?? null,
          },
        },
        createdAt: new Date().toISOString(),
      };

      try {
        return await repository.saveAuditEvent(event);
      } catch (error) {
        logger.warn(
          {
            eventName,
            entityType,
            entityId,
            error: error?.message ?? 'Unknown audit persistence error',
          },
          'Audit persistence failed, retrying through the operational queue',
        );

        if (operationsQueueService) {
          operationsQueueService
            .dispatch('audit.persist', { event })
            .catch(() => {});
        }

        return {
          ...event,
          queued: Boolean(operationsQueueService),
        };
      }
    },

    async listEvents(filters = {}) {
      return repository.listAuditEvents(filters);
    },
  };
}
