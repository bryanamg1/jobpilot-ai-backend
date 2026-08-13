import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const getConnectionMock = vi.fn();

vi.mock('../../src/repositories/mysql/mysqlClient.js', () => ({
  getMysqlPool: () => ({
    query: queryMock,
    getConnection: getConnectionMock,
  }),
}));

const { createMysqlRepository } = await import('../../src/repositories/mysql/mysqlRepository.js');

describe('mysqlRepository.saveJobAnalysis', () => {
  beforeEach(() => {
    queryMock.mockReset();
    getConnectionMock.mockReset();

    queryMock.mockImplementation(async (sql) => {
      if (String(sql).includes('SELECT id FROM candidate_profiles')) {
        return [[{ id: 'candidate-present' }]];
      }

      return [[{}]];
    });
  });

  it('persists an empty company_name when the job payload has no company', async () => {
    const repository = createMysqlRepository();
    const record = {
      id: 'job-1',
      matchId: 'match-1',
      fingerprint: 'fingerprint-1',
      createdAt: '2026-08-13T00:00:00.000Z',
      source: {
        id: 'source-1',
        type: 'LINKEDIN_JOBS_SUPERVISED',
        label: 'LinkedIn Jobs supervised session',
        originalUrl: 'https://www.linkedin.com/jobs/view/12345',
      },
      profile: {
        id: 'profile-1',
      },
      analysis: {
        extraction: {
          mode: 'deterministic',
          provider: 'openai',
          model: null,
          warnings: [],
        },
      },
      jobOffer: {
        company: null,
        title: 'Backend Developer',
        recruiterEmail: null,
      },
      match: {
        status: 'AWAITING_APPROVAL',
        score: 61,
        recommendation: 'review',
      },
    };

    await repository.saveJobAnalysis(record);

    const jobOfferInsert = queryMock.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO job_offers'));
    expect(jobOfferInsert).toBeTruthy();
    expect(jobOfferInsert[1][2]).toBe('');
  });
});
