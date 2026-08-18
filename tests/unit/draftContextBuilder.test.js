import { describe, expect, it } from 'vitest';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import {
  buildDraftContext,
  selectRelevantExperience,
  selectRelevantProjects,
} from '../../src/services/openai/draftContextBuilder.js';

const sampleJobAnalysis = {
  source: {
    originalUrl: 'https://example.com/jobs/backend',
  },
  jobOffer: {
    title: 'Backend Developer',
    company: 'Acme Labs',
    recruiterEmail: 'jobs@acme.dev',
    location: 'Remote LATAM',
    modality: ['remote'],
    technologies: ['Node.js', 'Express', 'MySQL', 'Jest'],
    certaintyMap: [
      { field: 'title', value: 'Backend Developer', certainty: 'INFERRED', source: 'manual_text' },
      { field: 'company', value: 'Acme Labs', certainty: 'INFERRED', source: 'manual_text' },
    ],
  },
  match: {
    score: 87,
    recommendation: 'RECOMMENDED',
    status: 'READY_TO_PREPARE',
    matchedTechnologies: ['Node.js', 'Express', 'MySQL', 'Jest'],
    approvals: [],
    excludedByRules: [],
  },
};

describe('draftContextBuilder', () => {
  it('selecciona proyectos alineados con un rol backend', () => {
    const projects = selectRelevantProjects(
      defaultCandidateProfile,
      sampleJobAnalysis.jobOffer,
      sampleJobAnalysis.match.matchedTechnologies,
      'backend',
    );

    expect(projects).toEqual(['Social App', 'PronostIA']);
  });

  it('selecciona experiencia relevante segun stack y rol', () => {
    const experience = selectRelevantExperience(
      defaultCandidateProfile,
      sampleJobAnalysis.jobOffer,
      sampleJobAnalysis.match.matchedTechnologies,
      'backend',
    );

    expect(experience[0]).toContain('Node.js');
    expect(experience.join(' ')).toContain('Jest');
  });

  it('construye un contexto breve y relevante para el draft', () => {
    const context = buildDraftContext(sampleJobAnalysis, {
      candidateProfile: defaultCandidateProfile,
    });

    expect(context.templateVariant).toBe('KNOWN_COMPANY_KNOWN_TITLE');
    expect(context.candidate.relevantTechnologies).toEqual(['Node.js', 'Express', 'MySQL', 'Jest']);
    expect(context.candidate.relevantProjects.length).toBeGreaterThan(0);
    expect(context.factsUsed.some((fact) => fact.field === 'project')).toBe(true);
  });
});
