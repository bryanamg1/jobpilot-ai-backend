import { randomUUID } from 'node:crypto';

export function createAuditService(repository) {
  return {
    async record(eventName, entityType, entityId, payload) {
      return repository.saveAuditEvent({
        id: randomUUID(),
        entityType,
        entityId,
        eventName,
        payload,
      });
    },
  };
}
