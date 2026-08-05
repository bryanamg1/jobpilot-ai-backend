import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { getInMemoryRuntime } from '../../src/repositories/inMemory/inMemoryRuntime.js';
import { resetRepositoryForTests } from '../../src/repositories/repositoryFactory.js';

describe('profile routes', () => {
  beforeEach(() => {
    resetRepositoryForTests();
    const runtime = getInMemoryRuntime();
    runtime.profile = structuredClone(defaultCandidateProfile);
    runtime.offers = [];
    runtime.audits = [];
  });

  it('returns the seeded profile', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/v1/profile');

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Bryan Marquez');
    expect(response.body.data.technologies).toContain('Node.js');
  });

  it('updates the profile in the active repository', async () => {
    const app = buildApp();

    const payload = {
      name: 'Bryan Marquez',
      headlineTargets: ['Backend Developer', 'Full Stack Developer'],
      location: 'Buenos Aires, Argentina',
      availability: 'Full time',
      modalities: ['remote', 'hybrid'],
      englishLevel: 'B1',
      salaryExpectation: {
        amount: 1200,
        currency: 'USD',
        period: 'monthly',
      },
      publicLinks: {
        github: 'https://github.com/bryanamg1',
        linkedin: 'https://www.linkedin.com/in/bryan-marquez-dev/',
      },
      contact: {
        email: 'bryanamg181@gmail.com',
      },
      projects: ['Social App', 'PronostIA'],
      technologies: ['Node.js', 'Express', 'MySQL'],
      knowledgeAreas: ['AI agents', 'Automation'],
      prohibitedClaims: ['English C1'],
    };

    const updateResponse = await request(app).put('/api/v1/profile').send(payload);

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.salaryExpectation.amount).toBe(1200);
    expect(updateResponse.body.data.knowledgeAreas).toContain('Automation');

    const readResponse = await request(app).get('/api/v1/profile');
    expect(readResponse.body.data.technologies).toEqual(['Node.js', 'Express', 'MySQL']);
    expect(readResponse.body.data.facts.some((fact) => fact.value === 'Automation')).toBe(true);
    expect(readResponse.body.data.answerLibrary.length).toBeGreaterThan(0);
  });
});
