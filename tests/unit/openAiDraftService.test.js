import { describe, expect, it, vi } from 'vitest';
import { buildFallbackDraft, createOpenAiDraftService } from '../../src/services/openai/openAiDraftService.js';

const sampleJobAnalysis = {
  profile: {
    name: 'Bryan Marquez',
    modalities: ['remote', 'hybrid'],
  },
  jobOffer: {
    title: 'Backend Developer',
    company: 'Acme Labs',
    recruiterEmail: 'jobs@acmelabs.com',
    certaintyMap: [
      { field: 'title', value: 'Backend Developer', certainty: 'INFERRED', source: 'manual_text_first_line' },
      { field: 'company', value: 'Acme Labs', certainty: 'INFERRED', source: 'manual_text' },
    ],
  },
  match: {
    matchedTechnologies: ['Node.js', 'Express'],
    approvals: [{ field: 'salary', reason: 'El salario es un dato sensible y requiere aprobacion manual.' }],
    excludedByRules: [],
  },
};

describe('openAiDraftService', () => {
  it('builds a safe deterministic draft when approvals still exist', () => {
    const draft = buildFallbackDraft(sampleJobAnalysis);

    expect(draft.status).toBe('REVIEW_REQUIRED');
    expect(draft.subject).toContain('Backend Developer');
    expect(draft.body).toContain('Bryan Marquez');
    expect(draft.approvalsRequired[0]).toContain('salary');
  });

  it('omits unknown companies and keeps the fallback draft natural', () => {
    const draft = buildFallbackDraft({
      ...sampleJobAnalysis,
      jobOffer: {
        ...sampleJobAnalysis.jobOffer,
        company: 'Unknown company',
        recruiterEmail: null,
      },
    });

    expect(draft.body).toContain('A quien corresponda,');
    expect(draft.body).toContain('me interesa la oportunidad de Backend Developer.');
    expect(draft.body).not.toContain('Unknown company');
    expect(draft.body).not.toContain('Mi stack confirmado');
  });

  it('uses structured output when the OpenAI client succeeds', async () => {
    const client = {
      responses: {
        parse: vi.fn().mockResolvedValue({
          output_parsed: {
            subject: 'Postulacion para Backend Developer - Bryan Marquez',
            body: 'Hola,\n\nMe interesa la vacante de Backend Developer.\n\nSaludos,\nBryan Marquez',
            highlights: ['Node.js', 'Express'],
            factsUsed: [
              {
                field: 'technology',
                value: 'Node.js',
                certainty: 'CONFIRMED',
                source: 'candidate_profile',
              },
            ],
            warnings: [],
          },
        }),
      },
    };

    const service = createOpenAiDraftService({
      client,
      config: {
        OPENAI_FEATURE_MODE: 'assist',
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-5',
        OPENAI_REASONING_EFFORT: 'low',
        OPENAI_TEXT_VERBOSITY: 'medium',
        OPENAI_TIMEOUT_MS: 20_000,
      },
    });

    const draft = await service.generateDraft(sampleJobAnalysis);

    expect(draft.generation.mode).toBe('hybrid');
    expect(draft.subject).toContain('Postulacion para Backend Developer');
    expect(client.responses.parse).toHaveBeenCalledTimes(1);
  });
});

