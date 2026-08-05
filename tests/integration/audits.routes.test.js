import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { getInMemoryRuntime } from '../../src/repositories/inMemory/inMemoryRuntime.js';
import { resetRepositoryForTests } from '../../src/repositories/repositoryFactory.js';

describe('audit routes', () => {
  beforeEach(() => {
    resetRepositoryForTests();
    const runtime = getInMemoryRuntime();
    runtime.profile = structuredClone(defaultCandidateProfile);
    runtime.offers = [];
    runtime.approvalRequests = [];
    runtime.emailDrafts = [];
    runtime.audits = [];
  });

  it('lists recent audit events and supports job drill-down filters', async () => {
    const app = buildApp();

    const createResponse = await request(app).post('/api/v1/jobs/manual').send({
      rawText: [
        'Backend Developer - Remote',
        'Company: Acme Labs',
        'Salary: USD 1500 - 2000',
        'Intermediate English B2 required.',
        'Travel occasionally across LATAM.',
      ].join('\n'),
      sourceUrl: 'https://example.com/backend-timeline-job',
      sourceLabel: 'Timeline manual test',
    });

    expect(createResponse.status).toBe(201);
    const jobId = createResponse.body.data.id;

    const previewResponse = await request(app).post(`/api/v1/jobs/${jobId}/draft-preview`).send({});
    expect(previewResponse.status).toBe(200);

    const filteredResponse = await request(app).get('/api/v1/audits').query({
      entityType: 'job_offer',
      entityId: jobId,
      limit: 10,
    });

    expect(filteredResponse.status).toBe(200);
    expect(filteredResponse.body.data.length).toBeGreaterThan(0);
    expect(filteredResponse.body.data.every((item) => item.entityId === jobId)).toBe(true);
    expect(filteredResponse.body.data.some((item) => item.eventName === 'job_offer.created_manual')).toBe(true);
    expect(filteredResponse.body.data.some((item) => item.eventName === 'job_draft.preview_generated')).toBe(true);
  });
});
