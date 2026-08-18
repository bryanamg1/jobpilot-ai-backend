import { describe, expect, it, vi } from 'vitest';
import { createDesktopAgentService } from '../../src/services/desktopAgent/desktopAgentService.js';

function createRepositoryMock() {
  const agents = [];
  const jobs = [];

  return {
    getDesktopAgentById: vi.fn(async (agentId) => agents.find((entry) => entry.id === agentId) ?? null),
    saveDesktopAgent: vi.fn(async (record) => {
      agents.push(structuredClone(record));
      return record;
    }),
    updateDesktopAgent: vi.fn(async (record) => {
      const index = agents.findIndex((entry) => entry.id === record.id);
      if (index >= 0) {
        agents[index] = structuredClone(record);
      }
      return record;
    }),
    claimNextBrowserJob: vi.fn(async (agentId) => {
      const job = jobs.find((entry) => entry.status === 'PENDING') ?? null;
      if (!job) {
        return null;
      }
      job.status = 'CLAIMED';
      job.agentId = agentId;
      return structuredClone(job);
    }),
    getBrowserJobById: vi.fn(async (jobId) => jobs.find((entry) => entry.id === jobId) ?? null),
    updateBrowserJob: vi.fn(async (record) => {
      const index = jobs.findIndex((entry) => entry.id === record.id);
      if (index >= 0) {
        jobs[index] = structuredClone(record);
      }
      return record;
    }),
    _agents: agents,
    _jobs: jobs,
  };
}

describe('desktopAgentService', () => {
  it('registra un agente y devuelve la configuracion de polling', async () => {
    const repository = createRepositoryMock();
    const service = createDesktopAgentService(repository, { record: vi.fn(async () => ({})) }, {
      config: {
        DESKTOP_AGENT_POLL_INTERVAL_MS: 5000,
        DESKTOP_AGENT_HEARTBEAT_MS: 30000,
      },
    });

    const result = await service.register({
      version: '1.0.0',
      os: 'Windows',
      hostname: 'BRYAN-PC',
      capabilities: ['PLAYWRIGHT'],
    });

    expect(result.pollIntervalMs).toBe(5000);
    expect(result.heartbeatMs).toBe(30000);
    expect(repository.saveDesktopAgent).toHaveBeenCalledTimes(1);
  });

  it('marca RUNNING en heartbeat cuando el agente ya reclamo un browser job', async () => {
    const repository = createRepositoryMock();
    repository._agents.push({
      id: 'agent-1',
      status: 'BUSY',
      version: '1.0.0',
      os: 'Windows',
      hostname: 'BRYAN-PC',
      metadata: {},
      lastHeartbeatAt: null,
      createdAt: '2026-08-12T12:00:00.000Z',
      updatedAt: '2026-08-12T12:00:00.000Z',
    });
    repository._jobs.push({
      id: 'job-1',
      sessionId: 'session-1',
      agentId: 'agent-1',
      jobType: 'START_SESSION',
      status: 'CLAIMED',
      payload: {},
      result: null,
      error: null,
      claimedAt: null,
      completedAt: null,
      createdAt: '2026-08-12T12:00:00.000Z',
      updatedAt: '2026-08-12T12:00:00.000Z',
    });
    const service = createDesktopAgentService(repository, { record: vi.fn(async () => ({})) }, {
      config: {
        DESKTOP_AGENT_POLL_INTERVAL_MS: 5000,
        DESKTOP_AGENT_HEARTBEAT_MS: 30000,
      },
    });

    await service.heartbeat({
      agentId: 'agent-1',
      status: 'BUSY',
      activeJobId: 'job-1',
    });

    expect(repository.updateBrowserJob).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'job-1',
        status: 'RUNNING',
      }),
    );
  });

  it('no imprime heartbeat.received cuando LOG_LEVEL es info', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const repository = createRepositoryMock();
    repository._agents.push({
      id: 'agent-1',
      status: 'ONLINE',
      version: '1.0.0',
      os: 'Windows',
      hostname: 'BRYAN-PC',
      metadata: {},
      lastHeartbeatAt: null,
      createdAt: '2026-08-12T12:00:00.000Z',
      updatedAt: '2026-08-12T12:00:00.000Z',
    });
    const service = createDesktopAgentService(repository, { record: vi.fn(async () => ({})) }, {
      config: {
        DESKTOP_AGENT_POLL_INTERVAL_MS: 5000,
        DESKTOP_AGENT_HEARTBEAT_MS: 30000,
        LOG_LEVEL: 'info',
      },
    });

    await service.heartbeat({
      agentId: 'agent-1',
      status: 'ONLINE',
    });

    expect(debugSpy).not.toHaveBeenCalled();
    debugSpy.mockRestore();
  });
});
