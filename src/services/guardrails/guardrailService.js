import { CERTAINTY } from '../../constants/certainty.js';
import { userFacingText } from '../../constants/userFacingText.js';

export function evaluateGuardrails(parsedOffer, profile) {
  const approvals = [];
  const blocked = [];
  const text = parsedOffer.source.originalText.toLowerCase();

  if (parsedOffer.jobOffer.salary) {
    approvals.push(flag('salary', CERTAINTY.REQUIRES_APPROVAL, userFacingText.guardrails.salary));
  }

  if (parsedOffer.jobOffer.flags.requiresVisa) {
    approvals.push(
      flag('workAuthorization', CERTAINTY.REQUIRES_APPROVAL, userFacingText.guardrails.workAuthorization),
    );
  }

  if (parsedOffer.jobOffer.flags.requiresRelocation) {
    approvals.push(flag('relocation', CERTAINTY.REQUIRES_APPROVAL, userFacingText.guardrails.relocation));
  }

  if (parsedOffer.jobOffer.flags.requiresTravel) {
    approvals.push(flag('travel', CERTAINTY.REQUIRES_APPROVAL, userFacingText.guardrails.travel));
  }

  if (parsedOffer.jobOffer.flags.requiresImmediateAvailability) {
    approvals.push(
      flag(
        'availabilityImmediate',
        CERTAINTY.REQUIRES_APPROVAL,
        userFacingText.guardrails.immediateAvailability,
      ),
    );
  }

  if (parsedOffer.jobOffer.flags.legalQuestions) {
    blocked.push(flag('legalQuestions', CERTAINTY.PROHIBITED, userFacingText.guardrails.legalQuestions));
  }

  if (parsedOffer.jobOffer.englishRequirement === 'advanced' && profile.englishLevel !== 'C1') {
    blocked.push(flag('englishRequirement', CERTAINTY.PROHIBITED, userFacingText.guardrails.advancedEnglish));
  }

  if (parsedOffer.jobOffer.englishRequirement === 'intermediate' && profile.englishLevel === 'B1') {
    approvals.push(
      flag(
        'englishLevel',
        CERTAINTY.REQUIRES_APPROVAL,
        userFacingText.guardrails.intermediateEnglish,
      ),
    );
  }

  const yearsRequirement = extractRequiredYears(text);
  if (yearsRequirement >= 3) {
    blocked.push(
      flag(
        'yearsOfExperience',
        CERTAINTY.PROHIBITED,
        userFacingText.guardrails.yearsOfExperience(yearsRequirement),
      ),
    );
  }

  const prohibitedTechnologyClaims = profile.prohibitedClaims
    .map((claim) => claim.toLowerCase())
    .filter((claim) =>
      parsedOffer.jobOffer.technologies.some((technology) => claim.includes(technology.toLowerCase())),
    );

  for (const claim of prohibitedTechnologyClaims) {
    blocked.push(
      flag(
        'technologyClaims',
        CERTAINTY.PROHIBITED,
        userFacingText.guardrails.technologyClaim(claim),
      ),
    );
  }

  return {
    approvals: dedupeFlags(approvals),
    blocked: dedupeFlags(blocked),
  };
}

function flag(field, certainty, reason) {
  return { field, certainty, reason };
}

function extractRequiredYears(text) {
  const matches = [...text.matchAll(/\b(\d)\+?\s+years?\b/gi)];
  return matches.reduce((highest, match) => Math.max(highest, Number(match[1] ?? 0)), 0);
}

function dedupeFlags(values) {
  return values.filter(
    (entry, index, list) =>
      index === list.findIndex((candidate) => candidate.field === entry.field && candidate.reason === entry.reason),
  );
}
