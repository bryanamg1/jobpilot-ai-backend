import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const TERMINAL_JOB_STATUS = new Set(['COMPLETED', 'FAILED']);
const ACTIVE_AGENT_STATUS = new Set(['ONLINE', 'BUSY']);

export function createDesktopAgentBrowserRuntime(repository, options = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? 750;
  const timeoutMs = options.timeoutMs ?? 45_000;
  const claimTimeoutMs = options.claimTimeoutMs ?? Math.min(timeoutMs, 12_000);

  return {
    async startSession({ sessionId, provider, startUrl }) {
      const result = await dispatchBrowserJob(repository, {
        sessionId,
        jobType: 'START_SESSION',
        payload: { sessionId, provider, startUrl },
        pollIntervalMs,
        claimTimeoutMs,
        timeoutMs,
      });

      return {
        handle: { sessionId, runtimeKind: 'desktop_agent' },
        snapshot: {
          ...result.snapshot,
          runtimeKind: 'desktop_agent',
        },
        reusedStoredSession: Boolean(result.reusedStoredSession),
      };
    },

    async navigate(handle, url) {
      const result = await dispatchBrowserJob(repository, {
        sessionId: handle.sessionId,
        jobType: 'NAVIGATE',
        payload: { sessionId: handle.sessionId, url },
        pollIntervalMs,
        claimTimeoutMs,
        timeoutMs,
      });

      return {
        ...result.snapshot,
        runtimeKind: 'desktop_agent',
      };
    },

    async getSnapshot(handle) {
      const result = await dispatchBrowserJob(repository, {
        sessionId: handle.sessionId,
        jobType: 'GET_SNAPSHOT',
        payload: { sessionId: handle.sessionId },
        pollIntervalMs,
        claimTimeoutMs,
        timeoutMs,
      });

      return {
        ...result.snapshot,
        runtimeKind: 'desktop_agent',
      };
    },

    async close(handle) {
      await dispatchBrowserJob(repository, {
        sessionId: handle.sessionId,
        jobType: 'CLOSE_SESSION',
        payload: { sessionId: handle.sessionId },
        pollIntervalMs,
        claimTimeoutMs,
        timeoutMs,
      });
    },

    async getRemoteControlUrl() {
      return null;
    },
  };
}

async function dispatchBrowserJob(
  repository,
  { sessionId = null, jobType, payload, pollIntervalMs, claimTimeoutMs, timeoutMs },
) {
  const now = new Date().toISOString();
  const job = {
    id: randomUUID(),
    sessionId,
    agentId: null,
    jobType,
    status: 'PENDING',
    payload,
    result: null,
    error: null,
    claimedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  logBrowserJobEvent('dispatch.start', {
    jobId: job.id,
    sessionId,
    jobType,
    status: job.status,
  });

  await assertDesktopAgentAvailability(repository, {
    sessionId,
    jobId: job.id,
    jobType,
  });
  await repository.saveBrowserJob(job);

  const startedAt = Date.now();
  let lastStatus = job.status;
  while (Date.now() - startedAt < timeoutMs) {
    const current = await repository.getBrowserJobById(job.id);
    const durationMs = Date.now() - startedAt;

    if (current && current.status !== lastStatus) {
      lastStatus = current.status;
      logBrowserJobEvent('dispatch.status', {
        jobId: job.id,
        sessionId,
        jobType,
        status: current.status,
        durationMs,
      });
    }

    if (current && TERMINAL_JOB_STATUS.has(current.status)) {
      if (current.status === 'FAILED') {
        const error = new Error(current.error?.message ?? 'El Desktop Worker devolvio un error.');
        error.code = current.error?.code ?? 'DESKTOP_AGENT_JOB_FAILED';
        error.details = current.error ?? null;
        logBrowserJobEvent('dispatch.failed', {
          jobId: job.id,
          sessionId,
          jobType,
          status: current.status,
          durationMs,
          errorCode: error.code,
          errorMessage: error.message,
        });
        throw error;
      }

      logBrowserJobEvent('dispatch.completed', {
        jobId: job.id,
        sessionId,
        jobType,
        status: current.status,
        durationMs,
      });
      return current.result ?? {};
    }

    if (durationMs >= claimTimeoutMs && (!current || current.status === 'PENDING')) {
      const error = new Error(
        'Ningun Desktop Agent activo reclamo la sesion supervisada a tiempo. Verifica que el agente este conectado a este backend.',
      );
      error.code = 'DESKTOP_AGENT_JOB_NOT_CLAIMED';
      error.details = {
        jobId: job.id,
        sessionId,
        jobType,
        status: current?.status ?? 'PENDING',
        durationMs,
      };
      logBrowserJobEvent('dispatch.not_claimed', {
        jobId: job.id,
        sessionId,
        jobType,
        status: current?.status ?? 'PENDING',
        durationMs,
      });
      throw error;
    }

    await delay(pollIntervalMs);
  }

  const error = new Error('El Desktop Agent no devolvio un resultado dentro del tiempo esperado.');
  error.code = 'DESKTOP_AGENT_JOB_TIMEOUT';
  error.details = {
    jobId: job.id,
    sessionId,
    jobType,
    status: lastStatus,
    durationMs: Date.now() - startedAt,
  };
  logBrowserJobEvent('dispatch.timeout', {
    jobId: job.id,
    sessionId,
    jobType,
    status: lastStatus,
    durationMs: error.details.durationMs,
  });
  throw error;
}

async function assertDesktopAgentAvailability(repository, { sessionId, jobId, jobType }) {
  if (typeof repository.listDesktopAgents !== 'function') {
    return;
  }

  const agents = await repository.listDesktopAgents({ limit: 20 });
  const activeAgents = agents.filter((agent) => ACTIVE_AGENT_STATUS.has(agent.status));

  if (activeAgents.length > 0) {
    return;
  }

  logBrowserJobEvent('dispatch.no_agent', {
    jobId,
    sessionId,
    jobType,
    status: 'NO_AGENT',
  });

  const error = new Error(
    'No hay ningun Desktop Agent activo conectado a este backend. Verifica la URL configurada por el agente y vuelve a intentar.',
  );
  error.code = 'DESKTOP_AGENT_UNAVAILABLE';
  error.details = {
    jobId,
    sessionId,
    jobType,
  };
  throw error;
}

function logBrowserJobEvent(stage, payload) {
  console.info(
    `[desktop-agent-runtime] ${JSON.stringify({
      stage,
      timestamp: new Date().toISOString(),
      ...payload,
    })}`,
  );
}
