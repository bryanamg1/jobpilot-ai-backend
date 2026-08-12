import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const TERMINAL_JOB_STATUS = new Set(['COMPLETED', 'FAILED']);

export function createDesktopAgentBrowserRuntime(repository, options = {}) {
  const pollIntervalMs = options.pollIntervalMs ?? 750;
  const timeoutMs = options.timeoutMs ?? 45_000;

  return {
    async startSession({ sessionId, provider, startUrl }) {
      const result = await dispatchBrowserJob(repository, {
        sessionId,
        jobType: 'START_SESSION',
        payload: { sessionId, provider, startUrl },
        pollIntervalMs,
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
  { sessionId = null, jobType, payload, pollIntervalMs, timeoutMs },
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

  await repository.saveBrowserJob(job);

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = await repository.getBrowserJobById(job.id);
    if (current && TERMINAL_JOB_STATUS.has(current.status)) {
      if (current.status === 'FAILED') {
        const error = new Error(current.error?.message ?? 'El Desktop Worker devolvio un error.');
        error.details = current.error ?? null;
        throw error;
      }

      return current.result ?? {};
    }

    await delay(pollIntervalMs);
  }

  throw new Error('El Desktop Worker no devolvio un resultado dentro del tiempo esperado.');
}
