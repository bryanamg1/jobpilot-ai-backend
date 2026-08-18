import { describe, expect, it, vi } from 'vitest';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { buildFallbackDraft, createOpenAiDraftService } from '../../src/services/openai/openAiDraftService.js';

const sampleJobAnalysis = {
  profile: {
    name: 'Bryan Marquez',
    modalities: ['remote', 'hybrid'],
  },
  source: {
    originalUrl: 'https://example.com/jobs/backend',
  },
  jobOffer: {
    title: 'Backend Developer',
    company: 'Acme Labs',
    recruiterEmail: 'jobs@acmelabs.com',
    modality: ['remote'],
    technologies: ['Node.js', 'Express', 'MySQL', 'Jest'],
    certaintyMap: [
      { field: 'title', value: 'Backend Developer', certainty: 'INFERRED', source: 'manual_text_first_line' },
      { field: 'company', value: 'Acme Labs', certainty: 'INFERRED', source: 'manual_text' },
    ],
  },
  match: {
    matchedTechnologies: ['Node.js', 'Express', 'MySQL'],
    approvals: [{ field: 'salary', reason: 'El salario es un dato sensible y requiere aprobacion manual.' }],
    excludedByRules: [],
  },
};

describe('openAiDraftService', () => {
  it('builds a natural deterministic draft when approvals still exist', () => {
    const draft = buildFallbackDraft(sampleJobAnalysis, {
      candidateProfile: defaultCandidateProfile,
    });

    expect(draft.status).toBe('REVIEW_REQUIRED');
    expect(draft.subject).toContain('Backend Developer');
    expect(draft.body).toContain('Bryan Marquez');
    expect(draft.body).toContain('Acme Labs');
    expect(draft.body).not.toContain('Mi stack confirmado');
    expect(draft.approvalsRequired[0]).toContain('salary');
  });

  it('keeps the draft natural when the company is unknown', () => {
    const draft = buildFallbackDraft(
      {
        ...sampleJobAnalysis,
        jobOffer: {
          ...sampleJobAnalysis.jobOffer,
          company: 'Unknown company',
          recruiterEmail: null,
        },
      },
      {
        candidateProfile: defaultCandidateProfile,
      },
    );

    expect(draft.body).toContain('Hola,');
    expect(draft.body).toContain('la posicion de Backend Developer');
    expect(draft.body).not.toContain('Unknown company');
    expect(draft.body).not.toContain('Empresa desconocida');
  });

  it('uses a general template when the title is unknown', () => {
    const draft = buildFallbackDraft(
      {
        ...sampleJobAnalysis,
        jobOffer: {
          ...sampleJobAnalysis.jobOffer,
          title: 'Unknown title',
        },
      },
      {
        candidateProfile: defaultCandidateProfile,
      },
    );

    expect(draft.subject).toBe('Postulacion a Acme Labs - Bryan Marquez');
    expect(draft.body).toContain('la oportunidad que publicaron recientemente');
    expect(draft.body).not.toContain('Unknown title');
  });

  it('uses structured output when the OpenAI client succeeds', async () => {
    const client = {
      responses: {
        parse: vi.fn().mockResolvedValue({
          output_parsed: {
            subject: 'Postulacion para Backend Developer - Bryan Marquez',
            body:
              'Hola,\\n\\nMe interesa la posicion de Backend Developer en Acme Labs. Mi experiencia se alinea con Node.js, Express y MySQL, y proyectos como Social App y PronostIA respaldan ese encaje.\\n\\nSaludos,\\nBryan Marquez',
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

    const draft = await service.generateDraft(sampleJobAnalysis, {
      candidateProfile: defaultCandidateProfile,
    });

    expect(draft.generation.mode).toBe('hybrid');
    expect(draft.subject).toContain('Postulacion para Backend Developer');
    expect(client.responses.parse).toHaveBeenCalledTimes(1);
  });
});
