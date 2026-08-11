import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { resetRepositoryForTests } from '../../src/repositories/repositoryFactory.js';

describe('health routes', () => {
  beforeEach(() => {
    resetRepositoryForTests();
  });

  it('reports storage health without touching external dependencies in test mode', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.storageMode).toBe('memory');
    expect(response.body.dependencies.storage.status).toBe('ok');
    expect(response.body.dependencies.queue.mode).toBe('inline');
    expect(response.body.services.api.status).toBe('online');
    expect(response.body.services.mysql.status).toBe('connected');
    expect(response.body.services.redis.status).toBe('unavailable');
    expect(response.body.automation.scheduler.status).toBe('stopped');
    expect(response.body.automation.enabled).toBe(false);
    expect(response.body.automation.killSwitch.enabled).toBe(false);
    expect(response.body.integrations.openai.status).toBe('disabled');
    expect(response.body.reliability.circuits.openai.state).toBe('closed');
    expect(response.body.runtime.requestCorrelation).toBe(true);
  });
});
