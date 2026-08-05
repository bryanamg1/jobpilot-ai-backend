import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { getInMemoryRuntime } from '../../src/repositories/inMemory/inMemoryRuntime.js';
import { resetRepositoryForTests } from '../../src/repositories/repositoryFactory.js';

describe('approval routes', () => {
  beforeEach(() => {
    resetRepositoryForTests();
    const runtime = getInMemoryRuntime();
    runtime.profile = structuredClone(defaultCandidateProfile);
    runtime.offers = [];
    runtime.approvalRequests = [];
    runtime.audits = [];
  });

  it('creates approval requests from a sensitive manual job and resolves one', async () => {
    const app = buildApp();

    const createResponse = await request(app).post('/api/v1/jobs/manual').send({
      rawText: [
        'Backend Developer - Remote',
        'Company: Acme Labs',
        'Salary: USD 1500 - 2000',
        'Intermediate English B2 required.',
        'Travel occasionally across LATAM.',
        'Visa sponsorship is needed.',
      ].join('\n'),
      sourceUrl: 'https://example.com/backend-sensitive-job',
      sourceLabel: 'Sensitive manual test',
    });

    expect(createResponse.status).toBe(201);

    const listResponse = await request(app).get('/api/v1/approvals');

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.some((item) => item.approvalKind === 'salaryExpectation')).toBe(true);
    expect(listResponse.body.data.some((item) => item.approvalKind === 'englishLevel')).toBe(true);
    expect(listResponse.body.data.some((item) => item.approvalKind === 'travel')).toBe(true);
    expect(listResponse.body.data.some((item) => item.approvalKind === 'workAuthorization')).toBe(true);

    const salaryRequest = listResponse.body.data.find((item) => item.approvalKind === 'salaryExpectation');
    const approveResponse = await request(app)
      .post(`/api/v1/approvals/${salaryRequest.id}/approve`)
      .send({ note: 'Salary reviewed manually.' });

    expect(approveResponse.status).toBe(200);
    expect(approveResponse.body.data.status).toBe('APPROVED');
    expect(approveResponse.body.data.payload.note).toBe('Salary reviewed manually.');
  });
});
