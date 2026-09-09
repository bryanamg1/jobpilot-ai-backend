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
  it('corta una vacante duplicada antes de enrichment, perfil y persistencia', async () => {
    const duplicate = { id: 'job-duplicate-1' };
    const { service, repository, openAiEnrichmentService } = createService({
      repository: {
        ...createRepositoryMock(),
        findByFingerprint: vi.fn(async () => duplicate),
      },
    });

    await expect(
      service.createFromManualInput({
        rawText: [
          'Backend Developer',
          'Company: Acme Labs',
          'Send your resume to jobs@acme.dev',
        ].join('\n'),
        sourceUrl: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4448050563',
        sourceLabel: 'LinkedIn Jobs supervised session',
        sourceType: 'LINKEDIN_JOBS_SUPERVISED',
        structuredJob: {
          title: 'Backend Developer',
          company: 'Acme Labs',
          recruiterEmail: 'jobs@acme.dev',
          description:
            'We are hiring a Backend Developer with Node.js, Express, SQL, observability and testing across distributed teams.',
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: expect.objectContaining({
        duplicateId: 'job-duplicate-1',
      }),
    });

    expect(openAiEnrichmentService.enrichManualJob).not.toHaveBeenCalled();
    expect(repository.getCandidateProfile).not.toHaveBeenCalled();
    expect(repository.saveJobAnalysis).not.toHaveBeenCalled();
  });

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

  it('permite una captura supervisada valida sin enrichment sincronico y persiste un titulo corto de dominio', async () => {
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

    expect(openAiEnrichmentService.enrichManualJob).not.toHaveBeenCalled();
    expect(repository.saveJobAnalysis).toHaveBeenCalledTimes(1);
    expect(result.jobOffer.title).toBe('Backend Engineer (Node.js, SQL)');
    expect(result.jobOffer.company).toBe('Sundayy');
    expect(result.analysis.extraction.mode).toBe('deterministic');
    expect(result.match.recommendationBreakdown).toEqual(
      expect.objectContaining({
        decision: expect.any(String),
        confidence: expect.any(String),
        suggestedActions: expect.any(Array),
      }),
    );
  });

  it('mantiene enrichment habilitado para entradas manuales no supervisadas', async () => {
    const { service, openAiEnrichmentService } = createService();

    await service.createFromManualInput({
      rawText: [
        'Backend Engineer',
        'Company: Acme Labs',
        'Location: Remote LATAM',
        'Requirements: Node.js, APIs, SQL, testing and observability.',
      ].join('\n'),
      sourceUrl: 'https://example.com/backend-manual-openai',
      sourceLabel: 'Manual',
    });

    expect(openAiEnrichmentService.enrichManualJob).toHaveBeenCalledTimes(1);
  });

  it('preserva modality confirmada frente a enrichment inferido y mantiene fallback determinista', async () => {
    const { service } = createService({
      openAiEnrichmentService: {
        enrichManualJob: vi.fn(async () => ({
          applied: true,
          mode: 'hybrid',
          provider: 'openai',
          model: 'gpt-5.6-terra',
          warnings: [],
          extracted: {
            title: 'Backend Engineer (Remote Position) | Entefy',
            company: 'Entefy',
            location: 'Estados Unidos',
            modality: ['remote', 'hybrid'],
            seniority: 'unknown',
            englishRequirement: 'advanced',
            technologies: ['Node.js', 'AWS'],
            requirements: ['Requirements: AWS experience'],
            instructions: [],
            salary: null,
            flags: {
              requiresVisa: false,
              asksForSalary: false,
              legalQuestions: false,
              visibleContactCallToAction: false,
              requiresRelocation: false,
              requiresTravel: false,
              requiresImmediateAvailability: false,
            },
            certaintyMap: [
              {
                field: 'modality',
                value: 'hybrid',
                certainty: 'INFERRED',
                source: 'raw_text',
              },
            ],
            summary: 'OpenAI enrichment',
          },
        })),
      },
    });

    const result = await service.createFromManualInput({
      rawText: [
        'Backend Engineer (Remote Position) | Entefy',
        'Minimum 3 years of demonstrable Node.js experience',
        'Hybrid collaboration rhythms are part of the company culture.',
      ].join('\n'),
      sourceUrl: 'https://example.com/entefy',
      sourceLabel: 'LinkedIn Jobs supervised session',
      sourceType: 'LINKEDIN_JOBS_SUPERVISED',
      structuredJob: {
        title: 'Backend Engineer (Remote Position) | Entefy',
        company: 'Entefy',
        location: 'Estados Unidos',
        modality: ['remote'],
        technologies: ['JavaScript', 'Node.js', 'AWS'],
        description: [
          'Minimum 3 years of demonstrable Node.js experience.',
          'Build backend APIs for distributed systems and collaborate remotely with product and infrastructure teams.',
        ].join('\n'),
      },
    });

    expect(result.jobOffer.modality).toEqual(['remote']);
    expect(result.jobOffer.certaintyMap.some((entry) => entry.field === 'modality' && entry.value === 'hybrid')).toBe(false);
  });

  it('normaliza Sophilabs sin volver preferred u alternativas en bloqueos obligatorios', async () => {
    const { service } = createService();

    const result = await service.createFromManualInput({
      rawText: [
        'Back End Node Developer | Sophilabs',
        'Fluency in English',
        'Experience in programming languages such as PHP, Python, Java, etc.',
        'Experience developing GCP/AWS and code version control tools like Git.',
        'Preferred Qualifications',
        'Familiarity with AWS and Docker',
      ].join('\n'),
      sourceUrl: 'https://example.com/sophilabs',
      sourceLabel: 'LinkedIn Jobs supervised session',
      sourceType: 'LINKEDIN_JOBS_SUPERVISED',
      structuredJob: {
        title: 'Back End Node Developer | Sophilabs',
        company: 'Sophilabs',
        location: 'Argentina',
        modality: ['remote'],
        employmentType: 'full-time',
        technologies: ['JavaScript', 'Node.js', 'MySQL', 'Docker', 'PHP', 'AWS', 'Git', 'GitHub'],
        description: [
          'Fluency in English',
          'Experience in programming languages such as PHP, Python, Java, etc.',
          'Experience developing GCP/AWS and code version control tools like Git.',
          'Preferred Qualifications',
          'Familiarity with AWS and Docker',
        ].join('\n'),
      },
    });

    expect(result.jobOffer.modality).toEqual(['remote']);
    expect(result.jobOffer.englishRequirement).toBe('fluent');
    expect(result.match.blocked.some((entry) => entry.reason.includes('advanced php'))).toBe(false);
    expect(result.match.blocked.some((entry) => entry.reason.includes('aws experience'))).toBe(false);
    expect(result.jobOffer.preferredRequirements).toEqual(['Familiarity with AWS and Docker']);
    expect(result.jobOffer.technologyClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          technology: 'PHP',
          requirementLevel: 'optional',
          relationship: 'alternative',
        }),
        expect.objectContaining({
          technology: 'AWS',
          requirementLevel: 'optional',
          relationship: 'alternative',
        }),
      ]),
    );
  });
});
