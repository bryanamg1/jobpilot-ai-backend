import { describe, expect, it } from 'vitest';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { JOB_STATUS } from '../../src/constants/jobStatus.js';
import {
  RECOMMENDATION_CONFIDENCE,
  RECOMMENDATION_DECISION,
  SUGGESTED_ACTION,
  recommendJobOffer,
} from '../../src/services/recommendations/recommendationEngine.js';

const baseJob = {
  jobOffer: {
    title: 'Backend Developer',
    company: 'Acme Labs',
    englishRequirement: 'intermediate',
  },
};

function matching(overrides = {}) {
  return {
    score: 82,
    matchBreakdown: {
      strengths: [
        'Node.js esta confirmado en el perfil del candidato.',
        'Express esta confirmado en el perfil del candidato.',
        'MySQL esta confirmado en el perfil del candidato.',
      ],
      gaps: [],
      preferredMissing: [],
      optionalMissing: [],
      blockers: [],
      technologyUnits: [
        { technologies: ['Node.js'], requirementLevel: 'required' },
      ],
      ...overrides.matchBreakdown,
    },
    ...overrides,
  };
}

function guardrails(overrides = {}) {
  return {
    approvals: [],
    blocked: [],
    ...overrides,
  };
}

describe('recommendationEngine', () => {
  it('descarta una vacante con score alto si existen bloqueos', () => {
    const result = recommendJobOffer({
      candidateProfile: defaultCandidateProfile,
      structuredJob: baseJob,
      guardrailResult: guardrails({
        blocked: [{ reason: 'Requiere experiencia avanzada en AWS no confirmada.' }],
      }),
      matchingResult: matching({ score: 88 }),
    });

    expect(result.recommendation).toBe('DISCARD');
    expect(result.status).toBe(JOB_STATUS.REJECTED_BY_RULES);
    expect(result.recommendationBreakdown.decision).toBe(RECOMMENDATION_DECISION.DISCARD);
    expect(result.recommendationBreakdown.confidence).toBe(RECOMMENDATION_CONFIDENCE.HIGH);
    expect(result.suggestedActions).toEqual([
      SUGGESTED_ACTION.NO_GENERATE_DRAFT,
      SUGGESTED_ACTION.SKIP,
    ]);
  });

  it('recomienda preparar draft para una vacante excelente sin bloqueos ni aprobaciones', () => {
    const result = recommendJobOffer({
      candidateProfile: defaultCandidateProfile,
      structuredJob: baseJob,
      guardrailResult: guardrails(),
      matchingResult: matching({ score: 91 }),
    });

    expect(result.recommendation).toBe('RECOMMENDED');
    expect(result.status).toBe(JOB_STATUS.READY_TO_PREPARE);
    expect(result.recommendationBreakdown.decision).toBe(RECOMMENDATION_DECISION.PREPARE_DRAFT);
    expect(result.recommendationBreakdown.confidence).toBe(RECOMMENDATION_CONFIDENCE.VERY_HIGH);
    expect(result.suggestedActions).toEqual([
      SUGGESTED_ACTION.GENERATE_DRAFT,
      SUGGESTED_ACTION.GENERATE_CUSTOM_RESUME,
    ]);
  });

  it('pide revision para una vacante media con buen encaje tecnico', () => {
    const result = recommendJobOffer({
      candidateProfile: defaultCandidateProfile,
      structuredJob: baseJob,
      guardrailResult: guardrails(),
      matchingResult: matching({ score: 72 }),
    });

    expect(result.recommendation).toBe('REVIEW');
    expect(result.status).toBe(JOB_STATUS.AWAITING_APPROVAL);
    expect(result.recommendationBreakdown.decision).toBe(RECOMMENDATION_DECISION.REQUIRE_REVIEW);
    expect(result.recommendationBreakdown.confidence).toBe(RECOMMENDATION_CONFIDENCE.MEDIUM);
    expect(result.suggestedActions).toContain(SUGGESTED_ACTION.NEED_HUMAN_APPROVAL);
    expect(result.suggestedActions).toContain(SUGGESTED_ACTION.GENERATE_DRAFT);
  });

  it('descarta una vacante con score bajo aunque no existan bloqueos', () => {
    const result = recommendJobOffer({
      candidateProfile: defaultCandidateProfile,
      structuredJob: baseJob,
      guardrailResult: guardrails(),
      matchingResult: matching({
        score: 44,
        matchBreakdown: {
          strengths: [],
          optionalMissing: ['Go no esta confirmado en el perfil.'],
          technologyUnits: [],
        },
      }),
    });

    expect(result.recommendation).toBe('DISCARD');
    expect(result.status).toBe(JOB_STATUS.REJECTED);
    expect(result.recommendationBreakdown.decision).toBe(RECOMMENDATION_DECISION.DISCARD);
    expect(result.suggestedActions).toContain(SUGGESTED_ACTION.NO_GENERATE_DRAFT);
  });

  it('pide aprobacion cuando el ingles fluido no esta confirmado', () => {
    const result = recommendJobOffer({
      candidateProfile: defaultCandidateProfile,
      structuredJob: {
        jobOffer: {
          ...baseJob.jobOffer,
          englishRequirement: 'fluent',
        },
      },
      guardrailResult: guardrails({
        approvals: [{ reason: 'El nivel de ingles requerido debe ser revisado manualmente.' }],
      }),
      matchingResult: matching({ score: 76 }),
    });

    expect(result.status).toBe(JOB_STATUS.AWAITING_APPROVAL);
    expect(result.recommendationBreakdown.decision).toBe(RECOMMENDATION_DECISION.REQUIRE_APPROVAL);
    expect(result.suggestedActions).toContain(SUGGESTED_ACTION.REVIEW_ENGLISH_REQUIREMENT);
  });

  it('pide aprobacion cuando faltan requisitos obligatorios aunque el score sea alto', () => {
    const result = recommendJobOffer({
      candidateProfile: defaultCandidateProfile,
      structuredJob: baseJob,
      guardrailResult: guardrails(),
      matchingResult: matching({
        score: 84,
        matchBreakdown: {
          gaps: ['AWS aparece como requisito obligatorio y no esta confirmado en el perfil.'],
        },
      }),
    });

    expect(result.status).toBe(JOB_STATUS.AWAITING_APPROVAL);
    expect(result.recommendationBreakdown.missingRequired).toEqual([
      'AWS aparece como requisito obligatorio y no esta confirmado en el perfil.',
    ]);
    expect(result.suggestedActions).toContain(SUGGESTED_ACTION.REVIEW_REQUIRED_MISSING);
  });

  it('marca como condicional una vacante mediocre sin bloqueos', () => {
    const result = recommendJobOffer({
      candidateProfile: defaultCandidateProfile,
      structuredJob: baseJob,
      guardrailResult: guardrails(),
      matchingResult: matching({
        score: 56,
        matchBreakdown: {
          strengths: ['Trabajo remoto alineado con las preferencias del candidato.'],
          preferredMissing: ['Docker aparece como requisito deseable y no esta confirmado en el perfil.'],
        },
      }),
    });

    expect(result.recommendation).toBe('CONDITIONAL');
    expect(result.status).toBe(JOB_STATUS.AWAITING_APPROVAL);
    expect(result.recommendationBreakdown.confidence).toBe(RECOMMENDATION_CONFIDENCE.LOW);
    expect(result.suggestedActions).toContain(SUGGESTED_ACTION.REVIEW_PREFERRED_MISSING);
  });
});
