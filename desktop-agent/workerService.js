import { setTimeout as delay } from 'node:timers/promises';

export function createWorkerService(client, sessionStore, options = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const delayFn = options.delayFn ?? delay;
  const agentMeta = options.agentMeta;
  const maxRateLimitRetries = options.maxRateLimitRetries ?? 2;
  const logLevel = normalizeLogLevel(options.logLevel);
  let agentId = options.agentId ?? null;
  let activeJobId = null;
  let running = false;
  const emitWorkerEvent = (stage, payload) => logWorkerEvent(stage, payload, logLevel);

  return {
    async register() {
      const payload = await invokeClientOperation('register', () => client.register(agentMeta), {
        agentId,
        delayFn,
        pollIntervalMs,
        maxRateLimitRetries,
        logEvent: emitWorkerEvent,
      });
      agentId = payload.agentId;
      return payload;
    },

    getAgentId() {
      return agentId;
    },

    getActiveJobId() {
      return activeJobId;
    },

    async processNextJob() {
      if (!agentId) {
        throw new Error('Desktop Worker no esta registrado.');
      }

      const job = await invokeClientOperation('jobs.next', () => client.getNextJob(agentId), {
        agentId,
        delayFn,
        pollIntervalMs,
        maxRateLimitRetries,
        logEvent: emitWorkerEvent,
      });
      if (!job) {
        emitWorkerEvent('job.none', {
          agentId,
          status: 'IDLE',
        });
        return null;
      }

      const startedAt = Date.now();
      activeJobId = job.id;
      emitWorkerEvent('job.claimed', {
        agentId,
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: job.status ?? 'CLAIMED',
      });
      await invokeClientOperation(
        'heartbeat.busy',
        () =>
          client.heartbeat({
            agentId,
            status: 'BUSY',
            activeJobId,
          }),
        {
          agentId,
          delayFn,
          pollIntervalMs,
          maxRateLimitRetries,
          logEvent: emitWorkerEvent,
        },
      );
      emitWorkerEvent('job.started', {
        agentId,
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: 'RUNNING',
      });

      try {
        const result = await executeBrowserJob(sessionStore, job, emitWorkerEvent);
        await invokeClientOperation(
          'jobs.result',
          () =>
            client.reportResult(job.id, {
              agentId,
              result,
            }),
          {
            agentId,
            delayFn,
            pollIntervalMs,
            maxRateLimitRetries,
            logEvent: emitWorkerEvent,
          },
        );
        emitWorkerEvent('job.reported', {
          agentId,
          jobId: job.id,
          sessionId: job.payload?.sessionId ?? null,
          jobType: job.jobType,
          status: 'COMPLETED',
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        emitWorkerEvent('job.failed', {
          agentId,
          jobId: job.id,
          sessionId: job.payload?.sessionId ?? null,
          jobType: job.jobType,
          status: 'FAILED',
          durationMs: Date.now() - startedAt,
          errorMessage: error.message,
        });
        try {
          await invokeClientOperation(
            'jobs.error',
            () =>
              client.reportError(job.id, {
                agentId,
                error: {
                  message: error.message,
                  code: error.code ?? undefined,
                  details:
                    error?.details && typeof error.details === 'object' ? error.details : undefined,
                },
              }),
            {
              agentId,
              delayFn,
              pollIntervalMs,
              maxRateLimitRetries,
              logEvent: emitWorkerEvent,
            },
          );
        } catch (reportError) {
          emitWorkerEvent('job.report_error_failed', {
            agentId,
            jobId: job.id,
            sessionId: job.payload?.sessionId ?? null,
            jobType: job.jobType,
            status: 'FAILED',
            durationMs: Date.now() - startedAt,
            errorMessage: reportError.message,
          });
        }
        return null;
      } finally {
        activeJobId = null;
        try {
          await invokeClientOperation(
            'heartbeat.online',
            () =>
              client.heartbeat({
                agentId,
                status: 'ONLINE',
              }),
            {
              agentId,
              delayFn,
              pollIntervalMs,
              maxRateLimitRetries,
              logEvent: emitWorkerEvent,
            },
          );
        } catch (heartbeatError) {
            emitWorkerEvent('heartbeat.failed', {
            agentId,
            jobId: job.id,
            sessionId: job.payload?.sessionId ?? null,
            jobType: job.jobType,
            status: heartbeatError?.code === 'DESKTOP_AGENT_RATE_LIMITED' ? 'RATE_LIMITED' : 'FAILED',
            retryAfterMs: resolveRetryDelayMs(heartbeatError, pollIntervalMs),
            errorMessage: heartbeatError.message,
          });
        }
        emitWorkerEvent('job.finished', {
          agentId,
          jobId: job.id,
          sessionId: job.payload?.sessionId ?? null,
          jobType: job.jobType,
          status: 'ONLINE',
          durationMs: Date.now() - startedAt,
        });
      }
    },

    async runLoop() {
      running = true;
      while (running) {
        let waitMs = pollIntervalMs;

        try {
          await this.processNextJob();
        } catch (error) {
          if (error?.code === 'DESKTOP_AGENT_RATE_LIMITED') {
            waitMs = resolveRetryDelayMs(error, pollIntervalMs);
            emitWorkerEvent('loop.rate_limited', {
              agentId,
              status: 'RATE_LIMITED',
              requestLabel: error.requestLabel ?? null,
              retryAfterMs: waitMs,
              errorMessage: error.message,
            });
          } else {
            emitWorkerEvent('loop.failed', {
              agentId,
              status: 'FAILED',
              errorMessage: error?.message ?? 'Error desconocido',
            });
          }
        }

        await delayFn(waitMs);
      }
    },

    stop() {
      running = false;
    },
  };
}

async function executeBrowserJob(sessionStore, job, logEvent) {
  switch (job.jobType) {
    case 'START_SESSION': {
      logEvent('job.start_session.begin', {
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: 'RUNNING',
      });
      const result = await sessionStore.startSession(job.payload);
      logEvent('job.start_session.completed', {
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: 'COMPLETED',
      });
      return {
        snapshot: result.snapshot,
        reusedStoredSession: Boolean(result.reusedStoredSession),
      };
    }
    case 'NAVIGATE': {
      logEvent('job.navigate.begin', {
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: 'RUNNING',
      });
      const snapshot = await sessionStore.navigate(job.payload.sessionId, job.payload.url);
      logEvent('job.navigate.completed', {
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: 'COMPLETED',
      });
      return {
        snapshot,
      };
    }
    case 'GET_SNAPSHOT': {
      logEvent('job.get_snapshot.begin', {
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: 'RUNNING',
      });
      const snapshot = await sessionStore.getSnapshot(job.payload.sessionId, {
        captureMode: job.payload?.captureMode ?? 'passive',
      });
      logEvent('job.get_snapshot.completed', {
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: 'COMPLETED',
      });
      return {
        snapshot,
      };
    }
    case 'CLOSE_SESSION':
      logEvent('job.close_session.begin', {
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: 'RUNNING',
      });
      await sessionStore.closeSession(job.payload.sessionId);
      return { closed: true };
    default:
      throw new Error(`Browser job type no soportado: ${job.jobType}`);
  }
}

function logWorkerEvent(stage, payload, currentLogLevel = 'info') {
  const level = resolveWorkerLogLevel(stage);
  if (!shouldLog(level, currentLogLevel)) {
    return;
  }
  const writer = typeof console[level] === 'function' ? console[level].bind(console) : console.info.bind(console);
  writer(
    `[desktop-worker] ${JSON.stringify({
      stage,
      timestamp: new Date().toISOString(),
      ...payload,
    })}`,
  );
}

function resolveWorkerLogLevel(stage) {
  if (stage === 'job.none') {
    return 'debug';
  }

  if (stage === 'client.rate_limited' || stage === 'loop.rate_limited' || stage === 'heartbeat.failed') {
    return 'warn';
  }

  if (stage === 'job.failed' || stage === 'job.report_error_failed' || stage === 'loop.failed') {
    return 'error';
  }

  if (
    stage === 'job.claimed' ||
    stage === 'job.get_snapshot.begin' ||
    stage === 'job.reported' ||
    stage === 'job.navigate.begin' ||
    stage === 'job.start_session.begin'
  ) {
    return 'info';
  }

  return 'debug';
}

async function invokeClientOperation(operation, action, options) {
  const agentId = options.agentId ?? null;
  const delayFn = options.delayFn;
  const maxRateLimitRetries = options.maxRateLimitRetries ?? 0;
  const fallbackDelayMs = options.pollIntervalMs ?? 1_000;
  const logEvent = options.logEvent ?? ((stage, payload) => logWorkerEvent(stage, payload));
  let attempt = 0;

  while (true) {
    try {
      return await action();
    } catch (error) {
      if (error?.code !== 'DESKTOP_AGENT_RATE_LIMITED' || attempt >= maxRateLimitRetries) {
        throw error;
      }

      const retryAfterMs = resolveRetryDelayMs(error, fallbackDelayMs);
      logEvent('client.rate_limited', {
        agentId,
        operation,
        attempt: attempt + 1,
        requestLabel: error.requestLabel ?? null,
        retryAfterMs,
      });
      await delayFn(retryAfterMs);
      attempt += 1;
    }
  }
}

function resolveRetryDelayMs(error, fallbackDelayMs) {
  const retryAfterMs = Number(error?.retryAfterMs ?? NaN);
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return retryAfterMs;
  }

  return Math.max(250, fallbackDelayMs);
}

function normalizeLogLevel(value) {
  return ['debug', 'info', 'warn', 'error'].includes(String(value).toLowerCase())
    ? String(value).toLowerCase()
    : 'info';
}

function shouldLog(level, currentLogLevel) {
  const weights = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };

  return (weights[level] ?? weights.info) >= (weights[currentLogLevel] ?? weights.info);
}
