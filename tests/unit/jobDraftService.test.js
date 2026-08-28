import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJobDraftService } from '../../src/services/jobs/jobDraftService.js';

function createRepositoryMock(jobAnalysis = null) {
  return {
    getJobAnalysisById: vi.fn(async () => jobAnalysis),
    getCandidateProfile: vi.fn(async () => ({ id: 'profile-1', name: 'Bryan Marquez' })),
  };
}

describe('jobDraftService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registra skipped cuando la vacante fue descartada y no debe generar draft', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const repository = createRepositoryMock({
      id: 'job-1',
      jobOffer: {
        title: 'Senior Golang Platform Engineer',
        company: 'Platform Co',
      },
      source: {
        originalUrl: 'https://example.com/jobs/golang',
      },
      match: {
        status: 'REJECTED',
        score: 41,
      },
    });
    const service = createJobDraftService(
      repository,
      { record: vi.fn(async () => undefined) },
      {
        openAiDraftService: {
          generateDraft: vi.fn(async () => ({
            status: 'BLOCKED',
            recipient: null,
            subject: null,
            body: null,
            highlights: [],
            factsUsed: [],
            approvalsRequired: [],
            blockedReasons: ['La vacante fue descartada durante el analisis y no se generara un borrador automatico.'],
            generation: {
              mode: 'deterministic',
              provider: 'openai',
              model: null,
              attemptCount: 0,
              fallbackReason: 'not_recommended',
              warnings: [],
            },
          })),
        },
        answerLibraryService: {
          getPreviewSuggestions: vi.fn(async () => []),
        },
        approvalRequestService: {
          listRequestsForJob: vi.fn(async () => []),
          decorateSuggestions: vi.fn((items) => items),
          summarizeRequests: vi.fn(() => ({ pending: [], rejected: [] })),
        },
      },
    );

    await service.createPreview('job-1');

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('"stage":"draft.generation.skipped"'));
  });

  it('registra detalles del provider cuando la generacion falla', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const repository = createRepositoryMock({
      id: 'job-2',
      jobOffer: {
        title: 'Backend Developer',
        company: 'Acme Labs',
      },
      source: {
        originalUrl: 'https://example.com/jobs/backend',
      },
      match: {
        status: 'AWAITING_APPROVAL',
        score: 78,
      },
    });
    const service = createJobDraftService(
      repository,
      { record: vi.fn(async () => undefined) },
      {
        openAiDraftService: {
          generateDraft: vi.fn(async () => ({
            status: 'REVIEW_REQUIRED',
            recipient: 'jobs@acme.dev',
            subject: 'Postulacion para Backend Developer - Bryan Marquez',
            body: 'Hola.',
            highlights: [],
            factsUsed: [],
            approvalsRequired: [],
            blockedReasons: [],
            generation: {
              mode: 'deterministic',
              provider: 'openai',
              model: 'gpt-5',
              attemptCount: 1,
              fallbackReason: 'validation_error',
              warnings: [],
              error: {
                name: 'BadRequestError',
                code: 'invalid_request_error',
                providerStatus: 400,
                failureType: 'validation_error',
              },
            },
          })),
        },
        answerLibraryService: {
          getPreviewSuggestions: vi.fn(async () => []),
        },
        approvalRequestService: {
          listRequestsForJob: vi.fn(async () => []),
          decorateSuggestions: vi.fn((items) => items),
          summarizeRequests: vi.fn(() => ({ pending: [], rejected: [] })),
        },
      },
    );

    await service.createPreview('job-2');

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('"stage":"draft.generation.failed"'));
    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('"errorName":"BadRequestError"'));
    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('"providerStatus":400'));
  });
});
