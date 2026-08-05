import { describe, expect, it, vi } from 'vitest';
import { createOpenAiEnrichmentService } from '../../src/services/openai/openAiEnrichmentService.js';

describe('openAiEnrichmentService', () => {
  it('falls back to deterministic mode when the feature is disabled', async () => {
    const service = createOpenAiEnrichmentService({
      config: {
        OPENAI_FEATURE_MODE: 'disabled',
        OPENAI_API_KEY: '',
        OPENAI_MODEL: 'gpt-5.6-terra',
        OPENAI_REASONING_EFFORT: 'low',
        OPENAI_TEXT_VERBOSITY: 'medium',
        OPENAI_TIMEOUT_MS: 20_000,
      },
    });

    const result = await service.enrichManualJob(
      { rawText: 'Example role', sourceLabel: 'Manual', sourceUrl: '' },
      { jobOffer: { title: 'Example role' } },
    );

    expect(result.applied).toBe(false);
    expect(result.mode).toBe('deterministic');
    expect(result.warnings[0]).toContain('disabled');
  });

  it('returns parsed structured output when the OpenAI client succeeds', async () => {
    const client = {
      responses: {
        parse: vi.fn().mockResolvedValue({
          output_parsed: {
            title: 'Backend Developer',
            company: 'Acme Labs',
            location: 'Remote LATAM',
            recruiterEmail: 'jobs@acmelabs.com',
            modality: ['remote'],
            seniority: 'junior',
            englishRequirement: 'basic',
            technologies: ['Node.js'],
            requirements: ['Experience with APIs'],
            instructions: ['Send your resume'],
            salary: null,
            flags: {
              requiresVisa: false,
              asksForSalary: false,
              legalQuestions: false,
              visibleContactCallToAction: true,
              requiresRelocation: false,
              requiresTravel: false,
              requiresImmediateAvailability: false,
            },
            certaintyMap: [
              {
                field: 'title',
                value: 'Backend Developer',
                certainty: 'CONFIRMED',
                source: 'raw_text',
              },
            ],
            summary: 'Backend role',
          },
        }),
      },
    };

    const service = createOpenAiEnrichmentService({
      client,
      config: {
        OPENAI_FEATURE_MODE: 'assist',
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-5.6-terra',
        OPENAI_REASONING_EFFORT: 'low',
        OPENAI_TEXT_VERBOSITY: 'medium',
        OPENAI_TIMEOUT_MS: 20_000,
      },
    });

    const result = await service.enrichManualJob(
      {
        rawText: 'Backend Developer with Node.js',
        sourceLabel: 'Manual',
        sourceUrl: 'https://example.com',
      },
      { jobOffer: { title: 'Backend Developer' } },
    );

    expect(result.applied).toBe(true);
    expect(result.mode).toBe('hybrid');
    expect(result.extracted.title).toBe('Backend Developer');
    expect(client.responses.parse).toHaveBeenCalledTimes(1);
  });
});
