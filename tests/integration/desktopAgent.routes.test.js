import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';

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

  it('no comparte el limiter publico con el Desktop Agent autenticado', async () => {
    const originalLimit = env.RATE_LIMIT_MAX;
    const originalWindow = env.RATE_LIMIT_WINDOW_MS;
    env.RATE_LIMIT_MAX = 1;
    env.RATE_LIMIT_WINDOW_MS = 60_000;

    try {
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

      const responses = await Promise.all([
        request(app)
          .post('/api/v1/desktop-agent/register')
          .set('x-desktop-agent-token', 'test-token')
          .send({ version: '1.0.0', os: 'Windows', hostname: 'BRYAN-PC', capabilities: ['PLAYWRIGHT'] }),
        request(app)
          .post('/api/v1/desktop-agent/heartbeat')
          .set('x-desktop-agent-token', 'test-token')
          .send({ agentId: 'agent-1', status: 'ONLINE' }),
        request(app)
          .get('/api/v1/desktop-agent/jobs/next')
          .set('x-desktop-agent-token', 'test-token')
          .query({ agentId: 'agent-1' }),
      ]);

      expect(responses.map((response) => response.status)).toEqual([201, 200, 204]);
    } finally {
      env.RATE_LIMIT_MAX = originalLimit;
      env.RATE_LIMIT_WINDOW_MS = originalWindow;
    }
  });

  it('mantiene rechazo por token invalido en rutas del Desktop Agent', async () => {
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
      desktopAgentToken: 'expected-token',
    });

    const response = await request(app)
      .post('/api/v1/desktop-agent/heartbeat')
      .set('x-desktop-agent-token', 'wrong-token')
      .send({
        agentId: 'agent-1',
        status: 'ONLINE',
      });

    expect(response.status).toBe(401);
  });

  it('mantiene rate limiting publico en rutas normales', async () => {
    const originalLimit = env.RATE_LIMIT_MAX;
    const originalWindow = env.RATE_LIMIT_WINDOW_MS;
    env.RATE_LIMIT_MAX = 1;
    env.RATE_LIMIT_WINDOW_MS = 60_000;

    try {
      const app = buildApp({
        desktopAgentToken: 'test-token',
        startAutomationScheduler: false,
      });

      const first = await request(app).get('/api/v1/health');
      const second = await request(app).get('/api/v1/health');

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
    } finally {
      env.RATE_LIMIT_MAX = originalLimit;
      env.RATE_LIMIT_WINDOW_MS = originalWindow;
    }
  });
});
