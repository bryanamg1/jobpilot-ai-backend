import { describe, expect, it, vi } from 'vitest';
import { createDesktopAgentBrowserRuntime } from '../../src/services/browser/desktopAgentBrowserRuntime.js';

function createRepositoryMock(finalJob) {
  const jobs = [];
  let reads = 0;

  return {
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
});
