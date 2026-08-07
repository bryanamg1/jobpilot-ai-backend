import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { getInMemoryRuntime } from '../../src/repositories/inMemory/inMemoryRuntime.js';
import { resetRepositoryForTests } from '../../src/repositories/repositoryFactory.js';

describe('automation routes', () => {
  beforeEach(() => {
    resetRepositoryForTests();
    const runtime = getInMemoryRuntime();
    runtime.profile = structuredClone(defaultCandidateProfile);
    runtime.automationSettings = null;
    runtime.applications = [];
    runtime.agentRuns = [];
    runtime.offers = [];
    runtime.approvalRequests = [];
    runtime.audits = [];
  });

  it('returns default automation settings and persists changes', async () => {
    const app = buildApp();

    const initialResponse = await request(app).get('/api/v1/automation/settings');

    expect(initialResponse.status).toBe(200);
    expect(initialResponse.body.data.mode).toBe('DRY_RUN');
    expect(initialResponse.body.data.enabled).toBe(false);

    const updatePayload = {
      enabled: true,
      mode: 'DRY_RUN',
      timezone: 'America/Argentina/Buenos_Aires',
      dailyApplicationLimit: 3,
      dailyDiscoveryLimit: 10,
      minimumMatchScore: 60,
      requireHumanApproval: true,
      unknownQuestionPolicy: 'PAUSE',
      captchaPolicy: 'PAUSE',
      mfaPolicy: 'PAUSE',
      salaryRequiresApproval: true,
      startTime: '08:30',
      daysOfWeek: [1, 2, 3, 4, 5],
      filters: {
        allowedSources: ['MANUAL'],
        allowedRoles: ['backend'],
        allowedSeniorities: ['junior', 'unknown'],
        allowedWorkModes: ['remote', 'hybrid'],
        blockedCompanies: [],
        blockedKeywords: [],
      },
      sourcePolicies: {
        MANUAL: 'AUTO_PREPARE',
        LINKEDIN_JOBS_SUPERVISED: 'AUTO_PREPARE',
        LINKEDIN_FEED_SUPERVISED: 'AUTO_PREPARE',
        LINKEDIN_POST_SEARCH_SUPERVISED: 'AUTO_PREPARE',
      },
    };

    const updateResponse = await request(app).put('/api/v1/automation/settings').send(updatePayload);

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.enabled).toBe(true);
    expect(updateResponse.body.data.filters.allowedSources).toEqual(['MANUAL']);
    expect(updateResponse.body.data.sourcePolicies.MANUAL).toBe('AUTO_PREPARE');

    const persistedResponse = await request(app).get('/api/v1/automation/settings');

    expect(persistedResponse.status).toBe(200);
    expect(persistedResponse.body.data.enabled).toBe(true);
    expect(persistedResponse.body.data.version).toBeGreaterThan(1);
  });

  it('exposes persisted default automation settings on the dashboard before any manual update', async () => {
    const app = buildApp();

    const dashboardResponse = await request(app).get('/api/v1/dashboard');

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.data.automation.settings).toBeTruthy();
    expect(dashboardResponse.body.data.automation.settings.id).toBe('default');
    expect(dashboardResponse.body.data.automation.settings.mode).toBe('DRY_RUN');
    expect(dashboardResponse.body.data.automation.dailyCompleted).toBe(0);

    const settingsResponse = await request(app).get('/api/v1/automation/settings');

    expect(settingsResponse.status).toBe(200);
    expect(settingsResponse.body.data.id).toBe('default');
    expect(settingsResponse.body.data.version).toBe(1);
  });

  it('runs a DRY_RUN automation cycle and exposes the recorded application on the dashboard', async () => {
    const app = buildApp();

    await request(app).post('/api/v1/jobs/manual').send({
      rawText: [
        'Junior Backend Developer - Remote at Acme Labs',
        'Company: Acme Labs',
        'Location: Remote LATAM',
        'We are hiring a Junior Backend Developer with Node.js, Express, MySQL, Docker and REST APIs.',
        'Requirements: JavaScript, testing, Git and remote collaboration.',
        'Send your resume to jobs@acmelabs.com',
      ].join('\n'),
      sourceUrl: 'https://example.com/backend-job-automation',
      sourceLabel: 'Manual automation seed',
    });

    await request(app).put('/api/v1/automation/settings').send({
      enabled: true,
      mode: 'DRY_RUN',
      timezone: 'America/Argentina/Buenos_Aires',
      dailyApplicationLimit: 2,
      dailyDiscoveryLimit: 5,
      minimumMatchScore: 50,
      requireHumanApproval: true,
      unknownQuestionPolicy: 'PAUSE',
      captchaPolicy: 'PAUSE',
      mfaPolicy: 'PAUSE',
      salaryRequiresApproval: true,
      startTime: '08:30',
      daysOfWeek: [1, 2, 3, 4, 5],
      filters: {
        allowedSources: ['MANUAL'],
        allowedRoles: ['backend'],
        allowedSeniorities: ['junior', 'unknown'],
        allowedWorkModes: ['remote', 'hybrid'],
        blockedCompanies: [],
        blockedKeywords: [],
      },
      sourcePolicies: {
        MANUAL: 'AUTO_PREPARE',
        LINKEDIN_JOBS_SUPERVISED: 'AUTO_PREPARE',
        LINKEDIN_FEED_SUPERVISED: 'AUTO_PREPARE',
        LINKEDIN_POST_SEARCH_SUPERVISED: 'AUTO_PREPARE',
      },
    });

    const runResponse = await request(app).post('/api/v1/automation/runs').send({
      reason: 'Integration test dry run',
    });

    expect(runResponse.status).toBe(201);
    expect(runResponse.body.data.status).toBe('COMPLETED');
    expect(runResponse.body.data.metadata.summary.total).toBe(1);
    expect(runResponse.body.data.metadata.summary.completed).toBe(1);

    const dashboardResponse = await request(app).get('/api/v1/dashboard');

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.data.automation.settings.enabled).toBe(true);
    expect(dashboardResponse.body.data.automation.dailyCompleted).toBe(1);
    expect(dashboardResponse.body.data.applications).toHaveLength(1);
    expect(dashboardResponse.body.data.applications[0].status).toBe('COMPLETED');
    expect(dashboardResponse.body.data.agentRuns).toHaveLength(1);
    expect(dashboardResponse.body.data.agentRuns[0].status).toBe('COMPLETED');
  });
});
