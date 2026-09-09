import { describe, expect, it } from 'vitest';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { evaluateGuardrails } from '../../src/services/guardrails/guardrailService.js';
import { parseManualJob } from '../../src/services/manualIntake/manualJobParser.js';

function buildParsedOffer({ description, technologies = ['Node.js'], modality = ['remote'] }) {
  return parseManualJob({
    rawText: description,
    sourceUrl: 'https://example.com/job',
    sourceLabel: 'LinkedIn Jobs supervised session',
    sourceType: 'LINKEDIN_JOBS_SUPERVISED',
    structuredJob: {
      title: 'Back End Node Developer',
      company: 'Example Co',
      location: 'Argentina',
      modality,
      technologies,
      description,
    },
  });
}

describe('guardrailService', () => {
  it('does not block preferred familiarity with AWS', () => {
    const parsed = buildParsedOffer({
      description: ['Preferred Qualifications', 'Familiarity with AWS and Docker'].join('\n'),
      technologies: ['Node.js', 'AWS', 'Docker'],
    });

    const result = evaluateGuardrails(parsed, defaultCandidateProfile);

    expect(result.blocked.some((entry) => entry.field === 'technologyClaims')).toBe(false);
  });

  it('blocks AWS when the requirement is explicitly required', () => {
    const parsed = buildParsedOffer({
      description: ['Requirements', 'AWS is required for this role.'].join('\n'),
      technologies: ['Node.js', 'AWS'],
    });

    const result = evaluateGuardrails(parsed, defaultCandidateProfile);

    expect(result.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'technologyClaims',
          reason: expect.stringContaining('aws experience'),
        }),
      ]),
    );
  });

  it('does not block alternative technology lists as simultaneous prohibited requirements', () => {
    const parsed = buildParsedOffer({
      description: [
        'Preferred Qualifications',
        'Experience in programming languages such as PHP, Python, Java, etc.',
        'Experience developing GCP/AWS and code version control tools like Git.',
      ].join('\n'),
      technologies: ['Node.js', 'PHP', 'AWS', 'Git'],
    });

    const result = evaluateGuardrails(parsed, defaultCandidateProfile);

    expect(result.blocked.some((entry) => entry.reason.includes('advanced php'))).toBe(false);
    expect(result.blocked.some((entry) => entry.reason.includes('aws experience'))).toBe(false);
  });

  it('keeps blocking explicit required years of experience', () => {
    const parsed = buildParsedOffer({
      description: ['Requirements', 'Minimum 3 years of demonstrable Node.js experience'].join('\n'),
      technologies: ['Node.js'],
    });

    const result = evaluateGuardrails(parsed, defaultCandidateProfile);

    expect(result.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'yearsOfExperience',
        }),
      ]),
    );
  });

  it('does not require approval when intermediate English matches candidate B1', () => {
    const parsed = buildParsedOffer({
      description: ['Requirements', 'Intermediate English required'].join('\n'),
      technologies: ['Node.js'],
    });

    const result = evaluateGuardrails(parsed, defaultCandidateProfile);

    expect(result.approvals.some((entry) => entry.field === 'englishLevel')).toBe(false);
    expect(result.blocked.some((entry) => entry.field === 'englishRequirement')).toBe(false);
  });

  it('requires approval for B2 or fluent English with candidate B1', () => {
    const parsed = buildParsedOffer({
      description: ['Requirements', 'B2 English required'].join('\n'),
      technologies: ['Node.js'],
    });

    const result = evaluateGuardrails(parsed, defaultCandidateProfile);

    expect(result.approvals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'englishLevel',
        }),
      ]),
    );
    expect(result.blocked.some((entry) => entry.field === 'englishRequirement')).toBe(false);
  });

  it('does not block preferred years of experience', () => {
    const parsed = buildParsedOffer({
      description: ['Preferred Qualifications', '2-3 years preferred with Node.js'].join('\n'),
      technologies: ['Node.js'],
    });

    const result = evaluateGuardrails(parsed, defaultCandidateProfile);

    expect(result.blocked.some((entry) => entry.field === 'yearsOfExperience')).toBe(false);
  });
});
