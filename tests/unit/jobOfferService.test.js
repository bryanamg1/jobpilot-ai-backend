import { describe, expect, it, vi } from 'vitest';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { createJobOfferService } from '../../src/services/jobs/jobOfferService.js';

function createRepositoryMock() {
  return {
    getCandidateProfile: vi.fn(async () => defaultCandidateProfile),
    findByFingerprint: vi.fn(async () => null),
    saveJobAnalysis: vi.fn(async (record) => record),
    listJobAnalyses: vi.fn(async () => []),
    getJobAnalysisById: vi.fn(async () => null),
  };
}

function createService(overrides = {}) {
  const repository = overrides.repository ?? createRepositoryMock();
  const auditService = overrides.auditService ?? { record: vi.fn(async () => ({})) };
  const openAiEnrichmentService =
    overrides.openAiEnrichmentService ??
    {
      enrichManualJob: vi.fn(async () => ({
        mode: 'deterministic',
        applied: false,
        warnings: [],
        provider: null,
        model: null,
        extracted: null,
      })),
    };
  const approvalRequestService =
    overrides.approvalRequestService ?? {
      syncForJob: vi.fn(async () => undefined),
    };

  return {
    repository,
    auditService,
    openAiEnrichmentService,
    approvalRequestService,
    service: createJobOfferService(repository, auditService, {
      openAiEnrichmentService,
      approvalRequestService,
    }),
  };
}

describe('jobOfferService', () => {
  it('detiene la captura supervisada contaminada antes de OpenAI y persistencia', async () => {
    const { service, repository, openAiEnrichmentService } = createService();

    await expect(
      service.createFromManualInput({
        rawText: `
Source: LinkedIn Jobs supervised session
Captured URL: https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421
Description:
Seleccionado, Backend Engineer (Node.js, SQL) Backend Engineer (Node.js, SQL) Sundayy Estados Unidos En remoto Visto Publicado hace 12 horas
        `.trim(),
        sourceUrl: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421',
        sourceLabel: 'LinkedIn Jobs supervised session',
        sourceType: 'LINKEDIN_JOBS_SUPERVISED',
        structuredJob: {
          title:
            'Seleccionado, Backend Engineer (Node.js, SQL) Backend Engineer (Node.js, SQL) Sundayy Estados Unidos En remoto Visto Publicado hace 12 horas',
          company: 'Sundayy',
          description:
            'Seleccionado, Backend Engineer (Node.js, SQL) Sundayy Estados Unidos En remoto Visto Adelantate a solicitar el empleo Publicado hace 12 horas',
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: expect.objectContaining({
        code: 'LINKEDIN_CAPTURE_INVALID_TITLE',
      }),
    });

    expect(openAiEnrichmentService.enrichManualJob).not.toHaveBeenCalled();
    expect(repository.saveJobAnalysis).not.toHaveBeenCalled();
  });

  it('permite una captura supervisada valida y persiste un titulo corto de dominio', async () => {
    const { service, repository, openAiEnrichmentService } = createService();

    const result = await service.createFromManualInput({
      rawText: `
Source: LinkedIn Jobs supervised session
Captured URL: https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421
Title: Backend Engineer (Node.js, SQL)
Company: Sundayy
Location: Estados Unidos
Description:
We are hiring a Backend Engineer with Node.js, SQL, APIs, observability, testing and collaboration across distributed teams.
      `.trim(),
      sourceUrl: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421',
      sourceLabel: 'LinkedIn Jobs supervised session',
      sourceType: 'LINKEDIN_JOBS_SUPERVISED',
      structuredJob: {
        title: 'Backend Engineer (Node.js, SQL)',
        company: 'Sundayy',
        location: 'Estados Unidos',
        modality: ['remote'],
        technologies: ['Node.js', 'MySQL'],
        description:
          'We are hiring a Backend Engineer with Node.js, SQL, APIs, observability, testing and collaboration across distributed teams.',
      },
    });

    expect(openAiEnrichmentService.enrichManualJob).toHaveBeenCalledTimes(1);
    expect(repository.saveJobAnalysis).toHaveBeenCalledTimes(1);
    expect(result.jobOffer.title).toBe('Backend Engineer (Node.js, SQL)');
    expect(result.jobOffer.company).toBe('Sundayy');
  });
});
