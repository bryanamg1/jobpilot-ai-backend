import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { getInMemoryRuntime } from '../../src/repositories/inMemory/inMemoryRuntime.js';
import { resetRepositoryForTests } from '../../src/repositories/repositoryFactory.js';

const fixture = (name) =>
  fs.readFileSync(path.join(import.meta.dirname, '../fixtures', name), 'utf8');

describe('jobs routes', () => {
  beforeEach(() => {
    resetRepositoryForTests();
    const runtime = getInMemoryRuntime();
    runtime.offers = [];
    runtime.audits = [];
  });

  it('creates a manual job analysis and exposes it on the dashboard', async () => {
    const app = buildApp();

    const createResponse = await request(app).post('/api/v1/jobs/manual').send({
      rawText: fixture('manual-job-spanish.txt'),
      sourceUrl: 'https://example.com/backend-job',
      sourceLabel: 'Manual test',
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.match.score).toBeGreaterThan(0);

    const dashboardResponse = await request(app).get('/api/v1/dashboard');
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.data.metrics.total).toBe(1);
  });

  it('rejects duplicate manual jobs', async () => {
    const app = buildApp();
    const payload = {
      rawText: fixture('manual-job-spanish.txt'),
      sourceUrl: 'https://example.com/backend-job',
      sourceLabel: 'Manual test',
    };

    await request(app).post('/api/v1/jobs/manual').send(payload);
    const duplicateResponse = await request(app).post('/api/v1/jobs/manual').send(payload);

    expect(duplicateResponse.status).toBe(409);
  });
});
