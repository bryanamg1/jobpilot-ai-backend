import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { getInMemoryRuntime } from '../../src/repositories/inMemory/inMemoryRuntime.js';
import { resetRepositoryForTests } from '../../src/repositories/repositoryFactory.js';

describe('gmail integration routes', () => {
  beforeEach(() => {
    resetRepositoryForTests();
    const runtime = getInMemoryRuntime();
    runtime.offers = [];
    runtime.emailDrafts = [];
    runtime.audits = [];
  });

  it('returns gmail integration status through the public route', async () => {
    const app = buildApp({
      gmailIntegrationService: {
        async getStatus() {
          return {
            configured: true,
            connected: false,
            emailAddress: null,
            labelName: 'Postulaciones/Por revisar',
            draftLabelNote: 'Draft labels are limited in Gmail.',
            alertQuery: 'job alert',
            scopes: ['gmail.readonly'],
          };
        },
        async getAuthUrl() {
          return { url: 'https://accounts.google.com/mock-consent' };
        },
        async handleCallback() {
          return { redirectUrl: 'http://localhost:5173/?gmail=connected' };
        },
        async disconnect() {
          return { disconnected: true };
        },
        async listAlerts() {
          return { query: 'job alert', messages: [] };
        },
        async createDraftFromJob() {
          return {};
        },
      },
    });

    const response = await request(app).get('/api/v1/integrations/gmail/status');

    expect(response.status).toBe(200);
    expect(response.body.data.configured).toBe(true);
    expect(response.body.data.connected).toBe(false);
  });

  it('creates a gmail draft from an analyzed job through the jobs route', async () => {
    const app = buildApp({
      gmailIntegrationService: {
        async getStatus() {
          return {};
        },
        async getAuthUrl() {
          return { url: 'https://accounts.google.com/mock-consent' };
        },
        async handleCallback() {
          return { redirectUrl: 'http://localhost:5173/?gmail=connected' };
        },
        async disconnect() {
          return { disconnected: true };
        },
        async listAlerts() {
          return { query: 'job alert', messages: [] };
        },
        async createDraftFromJob(jobId) {
          return {
            externalId: `draft-${jobId}`,
            recipient: 'jobs@acmelabs.com',
            subject: 'Application for Backend Developer - Bryan Marquez',
            provider: 'GMAIL',
            labelName: 'Postulaciones/Por revisar',
            draftLabelNote: 'Draft labels are limited in Gmail.',
            attachmentStatus: 'MANUAL_REQUIRED',
            warnings: ['Attach the selected CV manually before sending.'],
          };
        },
      },
      jobOfferService: {
        async list() {
          return [];
        },
        async createFromManualInput() {
          return {
            id: 'job-123',
            source: { label: 'Manual', originalUrl: 'https://example.com' },
            jobOffer: { company: 'Acme Labs', title: 'Backend Developer' },
            match: { score: 82, status: 'AWAITING_APPROVAL', explanation: {}, approvals: [], blocked: [], excludedByRules: [] },
            analysis: { extraction: { mode: 'deterministic' } },
          };
        },
      },
      jobDraftService: {
        async createPreview() {
          return {};
        },
      },
    });

    const response = await request(app).post('/api/v1/jobs/job-123/gmail-draft').send({});

    expect(response.status).toBe(201);
    expect(response.body.data.provider).toBe('GMAIL');
    expect(response.body.data.attachmentStatus).toBe('MANUAL_REQUIRED');
  });
});
