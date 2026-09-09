import { JOB_STATUS } from '../../constants/jobStatus.js';

export const RECOMMENDATION_DECISION = {
  PREPARE_DRAFT: 'PREPARE_DRAFT',
  REQUIRE_APPROVAL: 'REQUIRE_APPROVAL',
  REQUIRE_REVIEW: 'REQUIRE_REVIEW',
  DISCARD: 'DISCARD',
};

export const RECOMMENDATION_CONFIDENCE = {
  VERY_HIGH: 'VERY_HIGH',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  VERY_LOW: 'VERY_LOW',
};

export const SUGGESTED_ACTION = {
  GENERATE_DRAFT: 'GENERATE_DRAFT',
  GENERATE_CUSTOM_RESUME: 'GENERATE_CUSTOM_RESUME',
  NEED_HUMAN_APPROVAL: 'NEED_HUMAN_APPROVAL',
  REVIEW_ENGLISH_REQUIREMENT: 'REVIEW_ENGLISH_REQUIREMENT',
  REVIEW_REQUIRED_MISSING: 'REVIEW_REQUIRED_MISSING',
  REVIEW_PREFERRED_MISSING: 'REVIEW_PREFERRED_MISSING',
  NO_GENERATE_DRAFT: 'NO_GENERATE_DRAFT',
  SKIP: 'SKIP',
};

export function recommendJobOffer({
  candidateProfile,
  structuredJob,
  guardrailResult,
  matchingResult,
}) {
  const score = Number(matchingResult?.score ?? 0);
  const matchBreakdown = matchingResult?.matchBreakdown ?? {};
  const blockingFactors = uniqueStrings([
    ...(guardrailResult?.blocked ?? []).map((item) => item.reason),
    ...(matchBreakdown.blockers ?? []),
  ]);
  const approvalReasons = uniqueStrings((guardrailResult?.approvals ?? []).map((item) => item.reason));
  const missingRequired = uniqueStrings(matchBreakdown.gaps ?? []);
  const missingPreferred = uniqueStrings(matchBreakdown.preferredMissing ?? []);
  const strengths = uniqueStrings(matchBreakdown.strengths ?? []);
  const weaknesses = uniqueStrings([
    ...missingRequired,
    ...missingPreferred,
    ...(matchBreakdown.optionalMissing ?? []),
    ...approvalReasons,
  ]);
  const qualitySignals = buildQualitySignals(candidateProfile, structuredJob, matchingResult);

  if (blockingFactors.length) {
    return buildDecision({
      decision: RECOMMENDATION_DECISION.DISCARD,
      confidence: score >= 80 ? RECOMMENDATION_CONFIDENCE.HIGH : RECOMMENDATION_CONFIDENCE.VERY_HIGH,
      recommendation: 'DISCARD',
      status: JOB_STATUS.REJECTED_BY_RULES,
      reasons: ['Existen reglas bloqueantes que impiden preparar la postulacion automaticamente.'],
      strengths,
      weaknesses,
      blockingFactors,
      missingRequired,
      missingPreferred,
      suggestedActions: [SUGGESTED_ACTION.NO_GENERATE_DRAFT, SUGGESTED_ACTION.SKIP],
      qualitySignals,
    });
  }

  if (score < 50) {
    return buildDecision({
      decision: RECOMMENDATION_DECISION.DISCARD,
      confidence: strengths.length ? RECOMMENDATION_CONFIDENCE.MEDIUM : RECOMMENDATION_CONFIDENCE.HIGH,
      recommendation: 'DISCARD',
      status: JOB_STATUS.REJECTED,
      reasons: ['El score es bajo y no hay suficientes fortalezas para justificar preparar la postulacion.'],
      strengths,
      weaknesses,
      blockingFactors,
      missingRequired,
      missingPreferred,
      suggestedActions: [SUGGESTED_ACTION.NO_GENERATE_DRAFT, SUGGESTED_ACTION.SKIP],
      qualitySignals,
    });
  }

  if (approvalReasons.length || requiresHumanReview(structuredJob, matchingResult)) {
    return buildDecision({
      decision: RECOMMENDATION_DECISION.REQUIRE_APPROVAL,
      confidence: score >= 80 ? RECOMMENDATION_CONFIDENCE.HIGH : RECOMMENDATION_CONFIDENCE.MEDIUM,
      recommendation: score >= 65 ? 'REVIEW' : 'CONDITIONAL',
      status: JOB_STATUS.AWAITING_APPROVAL,
      reasons: [
        score >= 80
          ? 'La vacante tiene buen fit, pero contiene datos sensibles o no verificados.'
          : 'La vacante puede ser viable, pero requiere revision humana antes de avanzar.',
      ],
      strengths,
      weaknesses,
      blockingFactors,
      missingRequired,
      missingPreferred,
      suggestedActions: buildReviewActions({ approvalReasons, missingRequired, missingPreferred }),
      qualitySignals,
    });
  }

  if (score >= 80 && hasStrongFit(strengths, missingPreferred)) {
    return buildDecision({
      decision: RECOMMENDATION_DECISION.PREPARE_DRAFT,
      confidence: RECOMMENDATION_CONFIDENCE.VERY_HIGH,
      recommendation: 'RECOMMENDED',
      status: JOB_STATUS.READY_TO_PREPARE,
      reasons: ['La vacante muestra alto fit tecnico y no tiene bloqueos ni aprobaciones pendientes.'],
      strengths,
      weaknesses,
      blockingFactors,
      missingRequired,
      missingPreferred,
      suggestedActions: [SUGGESTED_ACTION.GENERATE_DRAFT, SUGGESTED_ACTION.GENERATE_CUSTOM_RESUME],
      qualitySignals,
    });
  }

  if (score >= 65) {
    return buildDecision({
      decision: RECOMMENDATION_DECISION.REQUIRE_REVIEW,
      confidence: RECOMMENDATION_CONFIDENCE.MEDIUM,
      recommendation: 'REVIEW',
      status: JOB_STATUS.AWAITING_APPROVAL,
      reasons: ['El fit es razonable, pero conviene revisar brechas antes de invertir una postulacion.'],
      strengths,
      weaknesses,
      blockingFactors,
      missingRequired,
      missingPreferred,
      suggestedActions: buildReviewActions({ approvalReasons, missingRequired, missingPreferred }),
      qualitySignals,
    });
  }

  return buildDecision({
    decision: RECOMMENDATION_DECISION.REQUIRE_REVIEW,
    confidence: RECOMMENDATION_CONFIDENCE.LOW,
    recommendation: 'CONDITIONAL',
    status: JOB_STATUS.AWAITING_APPROVAL,
    reasons: ['La vacante solo deberia considerarse si el rol es junior y las brechas son aceptables.'],
    strengths,
    weaknesses,
    blockingFactors,
    missingRequired,
    missingPreferred,
    suggestedActions: [SUGGESTED_ACTION.NEED_HUMAN_APPROVAL, SUGGESTED_ACTION.REVIEW_PREFERRED_MISSING],
    qualitySignals,
  });
}

function buildDecision({
  decision,
  confidence,
  recommendation,
  status,
  reasons,
  strengths,
  weaknesses,
  blockingFactors,
  missingRequired,
  missingPreferred,
  suggestedActions,
  qualitySignals,
}) {
  return {
    recommendation,
    status,
    suggestedActions: uniqueStrings(suggestedActions),
    recommendationBreakdown: {
      decision,
      confidence,
      reasons: uniqueStrings(reasons),
      strengths: uniqueStrings(strengths),
      weaknesses: uniqueStrings(weaknesses),
      blockingFactors: uniqueStrings(blockingFactors),
      missingRequired: uniqueStrings(missingRequired),
      missingPreferred: uniqueStrings(missingPreferred),
      suggestedActions: uniqueStrings(suggestedActions),
      qualitySignals,
    },
  };
}

function buildReviewActions({ approvalReasons, missingRequired, missingPreferred }) {
  const actions = [SUGGESTED_ACTION.NEED_HUMAN_APPROVAL];
  if (approvalReasons.some((reason) => /ingles|english/i.test(reason))) {
    actions.push(SUGGESTED_ACTION.REVIEW_ENGLISH_REQUIREMENT);
  }
  if (missingRequired.length) {
    actions.push(SUGGESTED_ACTION.REVIEW_REQUIRED_MISSING);
  }
  if (missingPreferred.length) {
    actions.push(SUGGESTED_ACTION.REVIEW_PREFERRED_MISSING);
  }
  actions.push(SUGGESTED_ACTION.GENERATE_DRAFT);
  return actions;
}

function buildQualitySignals(candidateProfile, structuredJob, matchingResult) {
  return {
    hasCandidateProfile: Boolean(candidateProfile?.id),
    hasKnownTitle: Boolean(structuredJob?.jobOffer?.title),
    hasKnownCompany: Boolean(structuredJob?.jobOffer?.company),
    technologyEvidenceCount: matchingResult?.matchBreakdown?.technologyUnits?.length ?? 0,
    strengthCount: matchingResult?.matchBreakdown?.strengths?.length ?? 0,
    weaknessCount:
      (matchingResult?.matchBreakdown?.gaps?.length ?? 0) +
      (matchingResult?.matchBreakdown?.preferredMissing?.length ?? 0) +
      (matchingResult?.matchBreakdown?.optionalMissing?.length ?? 0),
  };
}

function requiresHumanReview(structuredJob, matchingResult) {
  const englishRequirement = structuredJob?.jobOffer?.englishRequirement;
  const missingRequired = matchingResult?.matchBreakdown?.gaps ?? [];
  return englishRequirement === 'fluent' || missingRequired.length > 0;
}

function hasStrongFit(strengths, missingPreferred) {
  return strengths.length >= 3 && missingPreferred.length <= 1;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}
