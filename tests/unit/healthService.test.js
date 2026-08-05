import { describe, expect, it } from 'vitest';
import { createHealthService } from '../../src/services/health/healthService.js';

describe('healthService', () => {
  it('reports queue, integrations and circuit state in the operational payload', async () => {
    const repository = {
      mode: 'memory',
      ping: async () => ({
        status: 'ok',
      }),
    };
    const healthService = createHealthService(repository, {
      config: {
        OPENAI_FEATURE_MODE: 'assist',
        OPENAI_API_KEY: 'test-key',
        GOOGLE_CLIENT_ID: 'client-id',
        REDIS_URL: '',
      },
      gmailIntegrationService: {
        async getStatus() {
          return {
            configured: true,
            connected: false,
          };
        },
      },
      operationsQueueService: {
        getStatus() {
          return {
            status: 'ok',
            mode: 'inline',
            queueName: 'jobpilot-operations',
            registeredProcessors: 1,
            enqueued: 0,
            processed: 0,
            failed: 0,
            pending: 0,
            lastError: null,
          };
        },
      },
      reliabilityRegistry: {
        getStatus() {
          return {
            gmail: { state: 'closed' },
            openai: { state: 'closed' },
            playwright: { state: 'closed' },
          };
        },
      },
    });

    const status = await healthService.getStatus();

    expect(status.dependencies.queue.mode).toBe('inline');
    expect(status.integrations.gmail.status).toBe('configured');
    expect(status.integrations.openai.status).toBe('ready');
    expect(status.reliability.circuits.gmail.state).toBe('closed');
    expect(status.runtime.requestCorrelation).toBe(true);
  });
});
