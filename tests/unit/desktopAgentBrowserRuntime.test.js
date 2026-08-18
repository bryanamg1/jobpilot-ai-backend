import { describe, expect, it, vi } from 'vitest';
import { createDesktopAgentBrowserRuntime } from '../../src/services/browser/desktopAgentBrowserRuntime.js';

function createRepositoryMock(finalJob) {
  const jobs = [];
  let reads = 0;

  return {
    listDesktopAgents: vi.fn(async () => [
      {
        id: 'agent-1',
        status: 'ONLINE',
      },
    ]),
    saveBrowserJob: vi.fn(async (job) => {
      jobs.push(structuredClone(job));
      return job;
    }),
    getBrowserJobById: vi.fn(async (jobId) => {
      reads += 1;
      const job = jobs.find((entry) => entry.id === jobId);
      if (!job) {
        return null;
      }

      if (reads >= 2) {
        return {
          ...job,
          status: finalJob.status,
          result: finalJob.result ?? null,
          error: finalJob.error ?? null,
        };
      }

      return structuredClone(job);
    }),
  };
}

describe('desktopAgentBrowserRuntime', () => {
  it('encola un browser job y devuelve el snapshot completado por el worker', async () => {
    const repository = createRepositoryMock({
      status: 'COMPLETED',
      result: {
        snapshot: {
          title: 'LinkedIn Jobs',
          url: 'https://www.linkedin.com/jobs/',
          visibleText: 'Visible text',
        },
        reusedStoredSession: true,
      },
    });
    const runtime = createDesktopAgentBrowserRuntime(repository, {
      pollIntervalMs: 0,
      timeoutMs: 100,
    });

    const result = await runtime.startSession({
      sessionId: 'session-1',
      provider: 'LINKEDIN_JOBS',
      startUrl: 'https://www.linkedin.com/jobs/',
    });

    expect(repository.saveBrowserJob).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        jobType: 'START_SESSION',
        status: 'PENDING',
      }),
    );
    expect(result.snapshot.runtimeKind).toBe('desktop_agent');
    expect(result.reusedStoredSession).toBe(true);
  });

  it('propaga el error reportado por el worker', async () => {
    const repository = createRepositoryMock({
      status: 'FAILED',
      error: {
        message: 'Worker failed',
      },
    });
    const runtime = createDesktopAgentBrowserRuntime(repository, {
      pollIntervalMs: 0,
      timeoutMs: 100,
    });

    await expect(
      runtime.getSnapshot({
        sessionId: 'session-2',
      }),
    ).rejects.toThrow('Worker failed');
  });

  it('preserva currentUrl dentro de error.details cuando el worker reporta detalles anidados', async () => {
    const repository = createRepositoryMock({
      status: 'FAILED',
      error: {
        message: 'Descripcion no visible',
        code: 'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
        details: {
          currentUrl: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421',
          length: 0,
        },
      },
    });
    const runtime = createDesktopAgentBrowserRuntime(repository, {
      pollIntervalMs: 0,
      timeoutMs: 100,
    });

    await expect(
      runtime.getSnapshot({
        sessionId: 'session-2b',
      }),
    ).rejects.toMatchObject({
      code: 'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
      details: expect.objectContaining({
        currentUrl: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421',
        length: 0,
      }),
    });
  });

  it('falla rapido cuando no hay desktop agent activo conectado al backend', async () => {
    const repository = {
      listDesktopAgents: vi.fn(async () => []),
      saveBrowserJob: vi.fn(async () => {
        throw new Error('saveBrowserJob no deberia ejecutarse');
      }),
      getBrowserJobById: vi.fn(async () => null),
    };
    const runtime = createDesktopAgentBrowserRuntime(repository, {
      pollIntervalMs: 0,
      timeoutMs: 100,
    });

    await expect(
      runtime.getSnapshot({
        sessionId: 'session-3',
      }),
    ).rejects.toMatchObject({
      code: 'DESKTOP_AGENT_UNAVAILABLE',
    });
    expect(repository.saveBrowserJob).not.toHaveBeenCalled();
  });

  it('falla cuando el job no es reclamado dentro del claim timeout', async () => {
    const repository = {
      listDesktopAgents: vi.fn(async () => [
        {
          id: 'agent-1',
          status: 'ONLINE',
        },
      ]),
      saveBrowserJob: vi.fn(async () => ({})),
      getBrowserJobById: vi.fn(async () => ({
        id: 'job-1',
        status: 'PENDING',
      })),
    };
    const runtime = createDesktopAgentBrowserRuntime(repository, {
      pollIntervalMs: 0,
      claimTimeoutMs: 1,
      timeoutMs: 50,
    });

    await expect(
      runtime.getSnapshot({
        sessionId: 'session-4',
      }),
    ).rejects.toMatchObject({
      code: 'DESKTOP_AGENT_JOB_NOT_CLAIMED',
    });
  });
});
