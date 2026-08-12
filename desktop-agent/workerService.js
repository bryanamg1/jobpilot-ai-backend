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
        return null;
      }

      activeJobId = job.id;
      await client.heartbeat({
        agentId,
        status: 'BUSY',
        activeJobId,
      });

      try {
        const result = await executeBrowserJob(sessionStore, job);
        await client.reportResult(job.id, {
          agentId,
          result,
        });
        activeJobId = null;
        await client.heartbeat({
          agentId,
          status: 'ONLINE',
        });
        return result;
      } catch (error) {
        await client.reportError(job.id, {
          agentId,
          error: {
            message: error.message,
          },
        });
        activeJobId = null;
        await client.heartbeat({
          agentId,
          status: 'ONLINE',
        });
        return null;
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
      const result = await sessionStore.startSession(job.payload);
      return {
        snapshot: result.snapshot,
        reusedStoredSession: Boolean(result.reusedStoredSession),
      };
    }
    case 'NAVIGATE':
      return {
        snapshot: await sessionStore.navigate(job.payload.sessionId, job.payload.url),
      };
    case 'GET_SNAPSHOT':
      return {
        snapshot: await sessionStore.getSnapshot(job.payload.sessionId),
      };
    case 'CLOSE_SESSION':
      await sessionStore.closeSession(job.payload.sessionId);
      return { closed: true };
    default:
      throw new Error(`Browser job type no soportado: ${job.jobType}`);
  }
}
