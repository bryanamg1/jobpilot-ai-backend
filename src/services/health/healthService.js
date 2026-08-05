import { env } from '../../config/env.js';

export function createHealthService(repository, options = {}) {
  const config = options.config ?? env;
  const gmailIntegrationService = options.gmailIntegrationService ?? null;
  const operationsQueueService = options.operationsQueueService ?? null;
  const reliabilityRegistry = options.reliabilityRegistry ?? null;

  return {
    async getStatus() {
      const dependency = await repository.ping();
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
              ? 'missing_api_key'
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
                    : 'configured'
                  : 'not_configured',
                connected: gmailStatus.connected,
                configured: gmailStatus.configured,
              }
            : null,
          openai: openAiStatus,
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
