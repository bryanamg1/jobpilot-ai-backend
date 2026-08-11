import { env } from '../../config/env.js';

export function createHealthService(repository, options = {}) {
  const config = options.config ?? env;
  const gmailIntegrationService = options.gmailIntegrationService ?? null;
  const operationsQueueService = options.operationsQueueService ?? null;
  const reliabilityRegistry = options.reliabilityRegistry ?? null;
  const automationSettingsService = options.automationSettingsService ?? null;
  const automationSchedulerService = options.automationSchedulerService ?? null;

  return {
    async getStatus() {
      const dependency = await repository.ping();
      const automationSettings = await automationSettingsService?.getSettings?.();
      const schedulerStatus = automationSchedulerService?.getStatus?.() ?? {
        running: false,
        intervalMs: null,
        killSwitchEnabled: Boolean(config.AUTOMATION_KILL_SWITCH),
      };
      const gmailStatus = gmailIntegrationService ? await gmailIntegrationService.getStatus() : null;
      const queueStatus = operationsQueueService?.getStatus() ?? null;
      const reliabilityStatus = reliabilityRegistry?.getStatus() ?? {};
      const openAiStatus = {
        configured: Boolean(config.OPENAI_API_KEY),
        featureMode: config.OPENAI_FEATURE_MODE,
        status: config.isTest
          ? 'disabled'
          : config.OPENAI_FEATURE_MODE === 'assist' && config.OPENAI_API_KEY
            ? 'ready'
            : config.OPENAI_FEATURE_MODE === 'assist'
              ? 'unavailable'
              : 'disabled',
      };
      const overallStatus = [
        dependency.status === 'ok',
        !queueStatus || queueStatus.status === 'ok',
        !Object.values(reliabilityStatus).some((item) => item.state === 'open'),
      ].every(Boolean)
        ? 'ok'
        : 'degraded';

      return {
        status: overallStatus,
        storageMode: repository.mode,
        dependencies: {
          storage: dependency,
          queue: queueStatus,
        },
        integrations: {
          gmail: gmailStatus
            ? {
                status: gmailStatus.configured
                  ? gmailStatus.connected
                    ? 'connected'
                    : 'disconnected'
                  : 'unavailable',
                connected: gmailStatus.connected,
                configured: gmailStatus.configured,
              }
            : null,
          openai: openAiStatus,
        },
        services: {
          api: {
            status: 'online',
            port: config.PORT,
          },
          mysql: {
            status: dependency.status === 'ok' ? 'connected' : 'error',
            mode: repository.mode,
          },
          redis: {
            status: config.REDIS_URL ? 'configured' : 'unavailable',
          },
        },
        automation: {
          enabled: Boolean(automationSettings?.enabled),
          mode: automationSettings?.mode ?? null,
          requireHumanApproval: automationSettings?.requireHumanApproval ?? true,
          lastTriggeredAt: automationSettings?.lastTriggeredAt ?? null,
          scheduler: {
            status: schedulerStatus.running ? 'running' : 'stopped',
            intervalMs: schedulerStatus.intervalMs,
          },
          killSwitch: {
            enabled: Boolean(config.AUTOMATION_KILL_SWITCH),
            scope: 'runner_and_scheduler',
          },
        },
        reliability: {
          circuits: reliabilityStatus,
        },
        runtime: {
          nodeVersion: process.version,
          requestCorrelation: true,
          redisConfigured: Boolean(config.REDIS_URL),
        },
        timestamp: new Date().toISOString(),
      };
    },
  };
}
