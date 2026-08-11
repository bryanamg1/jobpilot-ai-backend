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
        PORT: 4300,
        OPENAI_FEATURE_MODE: 'assist',
        OPENAI_API_KEY: 'test-key',
        GOOGLE_CLIENT_ID: 'client-id',
        REDIS_URL: '',
        AUTOMATION_KILL_SWITCH: true,
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
      automationSettingsService: {
        async getSettings() {
          return {
            enabled: true,
            mode: 'DRY_RUN',
            requireHumanApproval: true,
            lastTriggeredAt: null,
          };
        },
      },
      automationSchedulerService: {
        getStatus() {
          return {
            running: true,
            intervalMs: 60_000,
            killSwitchEnabled: true,
          };
        },
      },
    });

    const status = await healthService.getStatus();

    expect(status.services.api.status).toBe('online');
    expect(status.services.mysql.status).toBe('connected');
    expect(status.services.redis.status).toBe('unavailable');
    expect(status.dependencies.queue.mode).toBe('inline');
    expect(status.integrations.gmail.status).toBe('disconnected');
    expect(status.integrations.openai.status).toBe('ready');
    expect(status.automation.enabled).toBe(true);
    expect(status.automation.scheduler.status).toBe('running');
    expect(status.automation.killSwitch.enabled).toBe(true);
    expect(status.reliability.circuits.gmail.state).toBe('closed');
    expect(status.runtime.requestCorrelation).toBe(true);
  });
});
