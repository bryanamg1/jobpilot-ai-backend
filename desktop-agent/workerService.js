import { setTimeout as delay } from 'node:timers/promises';

export function createWorkerService(client, sessionStore, options = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const agentMeta = options.agentMeta;
  let agentId = options.agentId ?? null;
  let activeJobId = null;
  let running = false;

  return {
    async register() {
      const payload = await client.register(agentMeta);
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

      const job = await client.getNextJob(agentId);
      if (!job) {
        logWorkerEvent('job.none', {
          agentId,
          status: 'IDLE',
        });
        return null;
      }

      const startedAt = Date.now();
      activeJobId = job.id;
      logWorkerEvent('job.claimed', {
        agentId,
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: job.status ?? 'CLAIMED',
      });
      await client.heartbeat({
        agentId,
        status: 'BUSY',
        activeJobId,
      });
      logWorkerEvent('job.started', {
        agentId,
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: 'RUNNING',
      });

      try {
        const result = await executeBrowserJob(sessionStore, job);
        await client.reportResult(job.id, {
          agentId,
          result,
        });
        logWorkerEvent('job.reported', {
          agentId,
          jobId: job.id,
          sessionId: job.payload?.sessionId ?? null,
          jobType: job.jobType,
          status: 'COMPLETED',
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        logWorkerEvent('job.failed', {
          agentId,
          jobId: job.id,
          sessionId: job.payload?.sessionId ?? null,
          jobType: job.jobType,
          status: 'FAILED',
          durationMs: Date.now() - startedAt,
          errorMessage: error.message,
        });
        try {
          await client.reportError(job.id, {
            agentId,
            error: {
              message: error.message,
              code: error.code ?? undefined,
            },
          });
        } catch (reportError) {
          logWorkerEvent('job.report_error_failed', {
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
        await client.heartbeat({
          agentId,
          status: 'ONLINE',
        });
        logWorkerEvent('job.finished', {
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
        await this.processNextJob();
        await delay(pollIntervalMs);
      }
    },

    stop() {
      running = false;
    },
  };
}

async function executeBrowserJob(sessionStore, job) {
  switch (job.jobType) {
    case 'START_SESSION': {
      logWorkerEvent('job.start_session.begin', {
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: 'RUNNING',
      });
      const result = await sessionStore.startSession(job.payload);
      logWorkerEvent('job.start_session.completed', {
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
      logWorkerEvent('job.navigate.begin', {
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: 'RUNNING',
      });
      const snapshot = await sessionStore.navigate(job.payload.sessionId, job.payload.url);
      logWorkerEvent('job.navigate.completed', {
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
      logWorkerEvent('job.get_snapshot.begin', {
        jobId: job.id,
        sessionId: job.payload?.sessionId ?? null,
        jobType: job.jobType,
        status: 'RUNNING',
      });
      const snapshot = await sessionStore.getSnapshot(job.payload.sessionId);
      logWorkerEvent('job.get_snapshot.completed', {
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
      logWorkerEvent('job.close_session.begin', {
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

function logWorkerEvent(stage, payload) {
  console.info(
    `[desktop-worker] ${JSON.stringify({
      stage,
      timestamp: new Date().toISOString(),
      ...payload,
    })}`,
  );
}
