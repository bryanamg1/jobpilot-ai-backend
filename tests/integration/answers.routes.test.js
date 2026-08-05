import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { getInMemoryRuntime } from '../../src/repositories/inMemory/inMemoryRuntime.js';
import { resetRepositoryForTests } from '../../src/repositories/repositoryFactory.js';

describe('answers routes', () => {
  beforeEach(() => {
    resetRepositoryForTests();
    const runtime = getInMemoryRuntime();
    runtime.profile = structuredClone(defaultCandidateProfile);
    runtime.offers = [];
    runtime.audits = [];
  });

  it('lists the seeded answer library', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/v1/answers');

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data.some((item) => item.kind === 'salaryExpectation')).toBe(true);
  });

  it('creates, updates and deletes an answer library entry', async () => {
    const app = buildApp();

    const createResponse = await request(app).post('/api/v1/answers').send({
      kind: 'custom',
      question: 'Do you have Redis experience?',
      answer: 'Confirmed Redis knowledge through backend projects and queue experiments.',
      certainty: 'INFERRED',
      tags: ['redis', 'queues'],
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.kind).toBe('custom');

    const updateResponse = await request(app)
      .put(`/api/v1/answers/${createResponse.body.data.id}`)
      .send({
        kind: 'custom',
        question: 'Do you have Redis experience?',
        answer: 'Confirmed Redis exposure through backend projects and local queue experiments.',
        certainty: 'REQUIRES_APPROVAL',
        tags: ['redis', 'queues'],
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.certainty).toBe('REQUIRES_APPROVAL');

    const deleteResponse = await request(app).delete(`/api/v1/answers/${createResponse.body.data.id}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.data.deleted).toBe(true);
  });
});
