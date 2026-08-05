import { describe, expect, it, vi } from 'vitest';
import { runWithRequestScope } from '../../src/lib/requestScope.js';
import { createAuditService } from '../../src/services/audit/auditService.js';

describe('auditService', () => {
  it('records the active request id inside audit metadata', async () => {
    const saveAuditEvent = vi.fn(async (event) => event);
    const service = createAuditService({
      saveAuditEvent,
    });

    const result = await runWithRequestScope({ requestId: 'req-123' }, () =>
      service.record('job_offer.created_manual', 'job_offer', 'job-1', { status: 'READY' }),
    );

    expect(saveAuditEvent).toHaveBeenCalledTimes(1);
    expect(result.payload._meta.requestId).toBe('req-123');
  });

  it('falls back to the operational queue when direct audit persistence fails', async () => {
    const queueDispatch = vi.fn(async () => ({}));
    const operationsQueueService = {
      registerProcessor: vi.fn(),
      dispatch: queueDispatch,
    };
    const service = createAuditService(
      {
        saveAuditEvent: vi.fn(async () => {
          throw new Error('storage unavailable');
        }),
      },
      { operationsQueueService },
    );

    const result = await service.record('gmail.draft_created', 'job_offer', 'job-2', {
      recipient: 'jobs@example.com',
    });

    expect(operationsQueueService.registerProcessor).toHaveBeenCalledWith(
      'audit.persist',
      expect.any(Function),
    );
    expect(queueDispatch).toHaveBeenCalledWith(
      'audit.persist',
      expect.objectContaining({
        event: expect.objectContaining({
          eventName: 'gmail.draft_created',
        }),
      }),
    );
    expect(result.queued).toBe(true);
  });
});
