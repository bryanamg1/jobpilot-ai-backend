import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';

describe('desktop agent routes', () => {
  it('registers an agent, returns 204 when no job exists and accepts a heartbeat', async () => {
    const desktopAgentService = {
      register: vi.fn(async () => ({
        agentId: 'agent-1',
        pollIntervalMs: 5000,
        heartbeatMs: 30000,
        status: 'ONLINE',
      })),
      heartbeat: vi.fn(async () => ({
        agentId: 'agent-1',
        status: 'ONLINE',
        lastHeartbeatAt: '2026-08-12T12:00:00.000Z',
      })),
      getNextJob: vi.fn(async () => null),
      completeJob: vi.fn(async () => ({ ok: true })),
      failJob: vi.fn(async () => ({ ok: true })),
    };
    const app = buildApp({
      desktopAgentService,
      desktopAgentToken: 'test-token',
    });

    const registerResponse = await request(app)
      .post('/api/v1/desktop-agent/register')
      .set('x-desktop-agent-token', 'test-token')
      .send({
        version: '1.0.0',
        os: 'Windows',
        hostname: 'BRYAN-PC',
        capabilities: ['PLAYWRIGHT'],
      });

    const heartbeatResponse = await request(app)
      .post('/api/v1/desktop-agent/heartbeat')
      .set('x-desktop-agent-token', 'test-token')
      .send({
        agentId: 'agent-1',
        status: 'ONLINE',
      });

    const nextJobResponse = await request(app)
      .get('/api/v1/desktop-agent/jobs/next')
      .set('x-desktop-agent-token', 'test-token')
      .query({ agentId: 'agent-1' });

    expect(registerResponse.status).toBe(201);
    expect(heartbeatResponse.status).toBe(200);
    expect(nextJobResponse.status).toBe(204);
  });
});
