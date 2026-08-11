import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { getInMemoryRuntime } from '../../src/repositories/inMemory/inMemoryRuntime.js';
import { resetRepositoryForTests } from '../../src/repositories/repositoryFactory.js';

const SAMPLE_BASE64 = Buffer.from('sample resume content', 'utf8').toString('base64');

describe('resumes routes', () => {
  beforeEach(() => {
    resetRepositoryForTests();
    const runtime = getInMemoryRuntime();
    runtime.profile = structuredClone(defaultCandidateProfile);
    runtime.resumes = [];
    runtime.audits = [];
  });

  it('uploads and lists resumes', async () => {
    const app = buildApp();

    const createResponse = await request(app).post('/api/v1/resumes').send({
      label: 'Backend CV',
      fileName: 'Bryan-Marquez-Backend.pdf',
      mimeType: 'application/pdf',
      contentBase64: SAMPLE_BASE64,
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.label).toBe('Backend CV');
    expect(createResponse.body.data.originalFileName).toBe('Bryan-Marquez-Backend.pdf');

    const listResponse = await request(app).get('/api/v1/resumes');

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toHaveLength(1);
    expect(listResponse.body.data[0].mimeType).toBe('application/pdf');
  });
});
