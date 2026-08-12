import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { getInMemoryRuntime } from '../../src/repositories/inMemory/inMemoryRuntime.js';
import { resetRepositoryForTests } from '../../src/repositories/repositoryFactory.js';

describe('browser session routes', () => {
  beforeEach(() => {
    resetRepositoryForTests();
    const runtime = getInMemoryRuntime();
    runtime.profile = structuredClone(defaultCandidateProfile);
    runtime.browserSessions = [];
    runtime.offers = [];
    runtime.approvalRequests = [];
    runtime.audits = [];
  });

  it('starts, lists and closes supervised browser sessions through the API', async () => {
    const listSessions = vi.fn(async () => [
      {
        id: 'browser-session-1',
        provider: 'LINKEDIN_FEED',
        status: 'ACTIVE',
        metadata: {
          currentUrl: 'https://www.linkedin.com/feed/',
        },
      },
    ]);
    const startSession = vi.fn(async () => ({
      id: 'browser-session-1',
      provider: 'LINKEDIN_FEED',
      status: 'ACTIVE',
      metadata: {
        currentUrl: 'https://www.linkedin.com/feed/',
      },
    }));
    const closeSession = vi.fn(async () => ({
      id: 'browser-session-1',
      provider: 'LINKEDIN_FEED',
      status: 'CLOSED',
      metadata: {
        currentUrl: 'https://www.linkedin.com/feed/',
      },
    }));

    const app = buildApp({
      browserSessionService: {
        listSessions,
        startSession,
        getSession: vi.fn(),
        refreshSession: vi.fn(),
        navigateSession: vi.fn(),
        captureCurrentJob: vi.fn(),
        closeSession,
      },
    });

    const createResponse = await request(app).post('/api/v1/browser-sessions').send({
      provider: 'LINKEDIN_FEED',
    });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.status).toBe('ACTIVE');
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'LINKEDIN_FEED',
      }),
    );

    const listResponse = await request(app).get('/api/v1/browser-sessions');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toHaveLength(1);

    const closeResponse = await request(app).post('/api/v1/browser-sessions/browser-session-1/close').send({});
    expect(closeResponse.status).toBe(200);
    expect(closeResponse.body.data.status).toBe('CLOSED');
  });

  it('captures the current supervised LinkedIn Jobs view through the API', async () => {
    const captureCurrentJob = vi.fn(async () => ({
      session: {
        id: 'browser-session-2',
        provider: 'LINKEDIN_POST_SEARCH',
        status: 'ACTIVE',
      },
      job: {
        id: 'job-from-browser-1',
        match: {
          score: 81,
        },
      },
    }));

    const app = buildApp({
      browserSessionService: {
        listSessions: vi.fn(async () => []),
        startSession: vi.fn(),
        getSession: vi.fn(),
        refreshSession: vi.fn(),
        navigateSession: vi.fn(),
        captureCurrentJob,
        closeSession: vi.fn(),
      },
    });

    const response = await request(app).post('/api/v1/browser-sessions/browser-session-2/capture-job').send({});

    expect(response.status).toBe(201);
    expect(response.body.data.job.id).toBe('job-from-browser-1');
    expect(captureCurrentJob).toHaveBeenCalledWith('browser-session-2');
  });

  it('redirige a una URL temporal de Browserless para control remoto', async () => {
    const getRemoteControlUrl = vi.fn(async () => 'https://browserless.example.com/devtools/inspector.html?token=temp');

    const app = buildApp({
      browserSessionService: {
        listSessions: vi.fn(async () => []),
        startSession: vi.fn(),
        getSession: vi.fn(),
        getRemoteControlUrl,
        refreshSession: vi.fn(),
        navigateSession: vi.fn(),
        captureCurrentJob: vi.fn(),
        closeSession: vi.fn(),
      },
    });

    const response = await request(app).get('/api/v1/browser-sessions/browser-session-3/remote-control').send();

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      'https://browserless.example.com/devtools/inspector.html?token=temp',
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(getRemoteControlUrl).toHaveBeenCalledWith('browser-session-3');
  });
});
