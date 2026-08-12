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

    expect(sessionStore.getSnapshot).toHaveBeenCalledWith('session-1');
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
});
