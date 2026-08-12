import { randomUUID } from 'node:crypto';
import { HttpError } from '../../lib/httpError.js';

const DESKTOP_AGENT_STATUS = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  BUSY: 'BUSY',
};

export function createDesktopAgentService(repository, auditService, options = {}) {
  const config = options.config;

  return {
    async register(input) {
      const now = new Date().toISOString();
      const record = {
        id: input.agentId?.trim() || randomUUID(),
        status: DESKTOP_AGENT_STATUS.ONLINE,
        version: input.version ?? null,
        os: input.os ?? null,
        hostname: input.hostname ?? null,
        metadata: {
          capabilities: input.capabilities ?? [],
        },
        lastHeartbeatAt: now,
        createdAt: now,
        updatedAt: now,
      };

      const existing = await repository.getDesktopAgentById?.(record.id);
      if (existing) {
        const updated = {
          ...existing,
          ...record,
          createdAt: existing.createdAt,
        };
        await repository.updateDesktopAgent(updated);
        logDesktopAgentEvent('register.updated', {
          agentId: updated.id,
          status: updated.status,
        });
        await auditService.record('desktop_agent.registered', 'desktop_agent', updated.id, {
          status: updated.status,
          version: updated.version,
          os: updated.os,
        });
        return buildRegisterResponse(updated, config);
      }

      await repository.saveDesktopAgent(record);
      logDesktopAgentEvent('register.created', {
        agentId: record.id,
        status: record.status,
      });
      await auditService.record('desktop_agent.registered', 'desktop_agent', record.id, {
        status: record.status,
        version: record.version,
        os: record.os,
      });
      return buildRegisterResponse(record, config);
    },

    async heartbeat(input) {
      const existing = await requireDesktopAgent(repository, input.agentId);
      const now = new Date().toISOString();
      const status = input.status ?? existing.status ?? DESKTOP_AGENT_STATUS.ONLINE;
      const updated = {
        ...existing,
        status,
        lastHeartbeatAt: now,
        updatedAt: now,
      };

      await repository.updateDesktopAgent(updated);
      logDesktopAgentEvent('heartbeat.received', {
        agentId: updated.id,
        status: updated.status,
        activeJobId: input.activeJobId ?? null,
      });

      if (input.activeJobId) {
        const job = await repository.getBrowserJobById?.(input.activeJobId);
        if (job && job.status === 'CLAIMED') {
          await repository.updateBrowserJob({
            ...job,
            status: 'RUNNING',
            agentId: updated.id,
            updatedAt: now,
          });
          logDesktopAgentEvent('job.running', {
            agentId: updated.id,
            jobId: job.id,
            sessionId: job.sessionId,
            status: 'RUNNING',
          });
        }
      }

      return {
        agentId: updated.id,
        status: updated.status,
        lastHeartbeatAt: updated.lastHeartbeatAt,
      };
    },

    async getNextJob(agentId) {
      const agent = await requireDesktopAgent(repository, agentId);
      await repository.updateDesktopAgent({
        ...agent,
        status: DESKTOP_AGENT_STATUS.BUSY,
        updatedAt: new Date().toISOString(),
      });

      const job = await repository.claimNextBrowserJob(agentId);
      if (!job) {
        await repository.updateDesktopAgent({
          ...agent,
          status: DESKTOP_AGENT_STATUS.ONLINE,
          updatedAt: new Date().toISOString(),
        });
        logDesktopAgentEvent('job.none', {
          agentId,
          status: 'ONLINE',
        });
      } else {
        logDesktopAgentEvent('job.claimed', {
          agentId,
          jobId: job.id,
          sessionId: job.sessionId,
          jobType: job.jobType,
          status: job.status,
        });
      }

      return job;
    },

    async completeJob(jobId, input) {
      const job = await requireBrowserJob(repository, jobId);
      const now = new Date().toISOString();
      await repository.updateBrowserJob({
        ...job,
        status: 'COMPLETED',
        agentId: input.agentId ?? job.agentId ?? null,
        result: input.result,
        error: null,
        completedAt: now,
        updatedAt: now,
      });
      logDesktopAgentEvent('job.completed', {
        agentId: input.agentId ?? job.agentId ?? null,
        jobId,
        sessionId: job.sessionId,
        jobType: job.jobType,
        status: 'COMPLETED',
      });

      if (input.agentId) {
        await setAgentStatus(repository, input.agentId, DESKTOP_AGENT_STATUS.ONLINE);
      }

      await auditService.record('browser_job.completed', 'browser_job', jobId, {
        jobType: job.jobType,
        sessionId: job.sessionId,
      });

      return { ok: true };
    },

    async failJob(jobId, input) {
      const job = await requireBrowserJob(repository, jobId);
      const now = new Date().toISOString();
      await repository.updateBrowserJob({
        ...job,
        status: 'FAILED',
        agentId: input.agentId ?? job.agentId ?? null,
        error: input.error,
        completedAt: now,
        updatedAt: now,
      });
      logDesktopAgentEvent('job.failed', {
        agentId: input.agentId ?? job.agentId ?? null,
        jobId,
        sessionId: job.sessionId,
        jobType: job.jobType,
        status: 'FAILED',
        errorMessage: input.error?.message ?? null,
      });

      if (input.agentId) {
        await setAgentStatus(repository, input.agentId, DESKTOP_AGENT_STATUS.ONLINE);
      }

      await auditService.record('browser_job.failed', 'browser_job', jobId, {
        jobType: job.jobType,
        sessionId: job.sessionId,
        message: input.error?.message ?? null,
      });

      return { ok: true };
    },
  };
}

function buildRegisterResponse(record, config) {
  return {
    agentId: record.id,
    pollIntervalMs: config.DESKTOP_AGENT_POLL_INTERVAL_MS,
    heartbeatMs: config.DESKTOP_AGENT_HEARTBEAT_MS,
    status: record.status,
  };
}

async function requireDesktopAgent(repository, agentId) {
  const agent = await repository.getDesktopAgentById?.(agentId);
  if (!agent) {
    throw new HttpError(404, 'Desktop agent not found');
  }
  return agent;
}

async function requireBrowserJob(repository, jobId) {
  const job = await repository.getBrowserJobById?.(jobId);
  if (!job) {
    throw new HttpError(404, 'Browser job not found');
  }
  return job;
}

async function setAgentStatus(repository, agentId, status) {
  const agent = await repository.getDesktopAgentById?.(agentId);
  if (!agent) {
    return;
  }

  await repository.updateDesktopAgent({
    ...agent,
    status,
    updatedAt: new Date().toISOString(),
  });
}

function logDesktopAgentEvent(stage, payload) {
  console.info(
    `[desktop-agent-service] ${JSON.stringify({
      stage,
      timestamp: new Date().toISOString(),
      ...payload,
    })}`,
  );
}
