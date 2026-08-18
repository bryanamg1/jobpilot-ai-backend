import { describe, expect, it, vi } from 'vitest';
import { createWorkerService } from '../../desktop-agent/workerService.js';

describe('desktop worker service', () => {
  it('procesa un browser job, ejecuta la accion y reporta el resultado', async () => {
    const client = {
      register: vi.fn(async () => ({
        agentId: 'agent-1',
      })),
      getNextJob: vi.fn(async () => ({
        id: 'job-1',
        jobType: 'GET_SNAPSHOT',
        payload: {
          sessionId: 'session-1',
        },
      })),
      heartbeat: vi.fn(async () => ({})),
      reportResult: vi.fn(async () => ({})),
      reportError: vi.fn(async () => ({})),
    };
    const sessionStore = {
      getSnapshot: vi.fn(async () => ({
        title: 'LinkedIn Jobs',
        url: 'https://www.linkedin.com/jobs/',
      })),
    };
    const service = createWorkerService(client, sessionStore, {
      pollIntervalMs: 0,
      agentMeta: {
        version: '1.0.0',
        os: 'Windows',
        hostname: 'BRYAN-PC',
        capabilities: ['PLAYWRIGHT'],
      },
    });

    await service.register();
    await service.processNextJob();

    expect(sessionStore.getSnapshot).toHaveBeenCalledWith('session-1', {
      captureMode: 'passive',
    });
    expect(client.reportResult).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        agentId: 'agent-1',
      }),
    );
  });

  it('no rompe el loop si reportError tambien falla durante un GET_SNAPSHOT', async () => {
    const client = {
      register: vi.fn(async () => ({
        agentId: 'agent-1',
      })),
      getNextJob: vi.fn(async () => ({
        id: 'job-2',
        jobType: 'GET_SNAPSHOT',
        payload: {
          sessionId: 'session-2',
        },
      })),
      heartbeat: vi.fn(async () => ({})),
      reportResult: vi.fn(async () => {
        throw new Error('result endpoint down');
      }),
      reportError: vi.fn(async () => {
        throw new Error('error endpoint down');
      }),
    };
    const sessionStore = {
      getSnapshot: vi.fn(async () => ({
        title: 'LinkedIn Feed',
        url: 'https://www.linkedin.com/feed/',
      })),
    };
    const service = createWorkerService(client, sessionStore, {
      pollIntervalMs: 0,
      agentMeta: {
        version: '1.0.0',
        os: 'Windows',
        hostname: 'BRYAN-PC',
        capabilities: ['PLAYWRIGHT'],
      },
    });

    await service.register();
    await expect(service.processNextJob()).resolves.toBeNull();
    expect(service.getActiveJobId()).toBeNull();
    expect(client.reportError).toHaveBeenCalledTimes(1);
  });

  it('propaga details del error al reportar fallos del worker', async () => {
    const client = {
      register: vi.fn(async () => ({
        agentId: 'agent-1',
      })),
      getNextJob: vi.fn(async () => ({
        id: 'job-err-1',
        jobType: 'GET_SNAPSHOT',
        payload: {
          sessionId: 'session-err-1',
        },
      })),
      heartbeat: vi.fn(async () => ({})),
      reportResult: vi.fn(async () => {
        throw Object.assign(new Error('capture failed'), {
          code: 'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
          details: {
            currentUrl: 'https://www.linkedin.com/jobs/search-results/?currentJobId=123',
            length: 0,
          },
        });
      }),
      reportError: vi.fn(async () => ({})),
    };
    const sessionStore = {
      getSnapshot: vi.fn(async () => ({
        title: 'LinkedIn Jobs',
        url: 'https://www.linkedin.com/jobs/search-results/?currentJobId=123',
      })),
    };
    const service = createWorkerService(client, sessionStore, {
      pollIntervalMs: 0,
      agentMeta: {
        version: '1.0.0',
        os: 'Windows',
        hostname: 'BRYAN-PC',
        capabilities: ['PLAYWRIGHT'],
      },
    });

    await service.register();
    await service.processNextJob();

    expect(client.reportError).toHaveBeenCalledWith(
      'job-err-1',
      expect.objectContaining({
        error: expect.objectContaining({
          details: expect.objectContaining({
            currentUrl: 'https://www.linkedin.com/jobs/search-results/?currentJobId=123',
            length: 0,
          }),
        }),
      }),
    );
  });

  it('si recibe un 429 en jobs.next el runLoop aplica backoff y sigue operando', async () => {
    const rateLimitedError = new Error('Desktop Worker request failed: 429');
    rateLimitedError.code = 'DESKTOP_AGENT_RATE_LIMITED';
    rateLimitedError.retryAfterMs = 0;
    rateLimitedError.requestLabel = 'GET /api/v1/desktop-agent/jobs/next';

    const client = {
      register: vi.fn(async () => ({
        agentId: 'agent-1',
      })),
      getNextJob: vi
        .fn()
        .mockRejectedValueOnce(rateLimitedError)
        .mockImplementationOnce(async () => null),
      heartbeat: vi.fn(async () => ({})),
      reportResult: vi.fn(async () => ({})),
      reportError: vi.fn(async () => ({})),
    };
    const sessionStore = {
      getSnapshot: vi.fn(async () => ({
        title: 'LinkedIn Jobs',
        url: 'https://www.linkedin.com/jobs/',
      })),
    };
    const delayFn = vi.fn(async () => {
      if (client.getNextJob.mock.calls.length >= 2) {
        service.stop();
      }
    });
    const service = createWorkerService(client, sessionStore, {
      agentId: 'agent-1',
      pollIntervalMs: 0,
      delayFn,
      agentMeta: {
        version: '1.0.0',
        os: 'Windows',
        hostname: 'BRYAN-PC',
        capabilities: ['PLAYWRIGHT'],
      },
    });

    await service.runLoop();

    expect(client.getNextJob).toHaveBeenCalledTimes(2);
    expect(delayFn).toHaveBeenCalled();
  });

  it('no imprime job.none cuando el nivel de log es info', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const client = {
      register: vi.fn(async () => ({
        agentId: 'agent-1',
      })),
      getNextJob: vi.fn(async () => null),
      heartbeat: vi.fn(async () => ({})),
      reportResult: vi.fn(async () => ({})),
      reportError: vi.fn(async () => ({})),
    };
    const service = createWorkerService(client, {}, {
      pollIntervalMs: 0,
      logLevel: 'info',
      agentMeta: {
        version: '1.0.0',
        os: 'Windows',
        hostname: 'BRYAN-PC',
        capabilities: ['PLAYWRIGHT'],
      },
    });

    await service.register();
    await service.processNextJob();

    expect(debugSpy).not.toHaveBeenCalled();
    debugSpy.mockRestore();
  });
});
