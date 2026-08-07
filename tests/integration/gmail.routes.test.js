import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { getInMemoryRuntime } from '../../src/repositories/inMemory/inMemoryRuntime.js';
import { resetRepositoryForTests } from '../../src/repositories/repositoryFactory.js';

describe('gmail integration routes', () => {
  beforeEach(() => {
    resetRepositoryForTests();
    const runtime = getInMemoryRuntime();
    runtime.profile = structuredClone(defaultCandidateProfile);
    runtime.offers = [];
    runtime.approvalRequests = [];
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
            draftLabelNote: 'Los borradores de Gmail solo admiten la etiqueta predeterminada DRAFT. La etiqueta de revision se conserva para seguimiento interno y futuras automatizaciones.',
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
            subject: 'Postulacion para Backend Developer - Bryan Marquez',
            provider: 'GMAIL',
            labelName: 'Postulaciones/Por revisar',
            draftLabelNote: 'Los borradores de Gmail solo admiten la etiqueta predeterminada DRAFT. La etiqueta de revision se conserva para seguimiento interno y futuras automatizaciones.',
            attachmentStatus: 'MANUAL_REQUIRED',
            warnings: ['Antes de enviar, adjunta manualmente el CV correspondiente.'],
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

  it('accepts the legacy google callback route used by the current local redirect URI', async () => {
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
        async createDraftFromJob() {
          return {};
        },
      },
    });

    const response = await request(app).get('/api/auth/google/callback?code=test-code&state=test-state');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('http://localhost:5173/?gmail=connected');
  });
});

