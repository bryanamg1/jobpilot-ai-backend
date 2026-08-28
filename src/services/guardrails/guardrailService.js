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

  if (parsedOffer.jobOffer.englishRequirement === 'fluent') {
    approvals.push(flag('englishLevel', CERTAINTY.REQUIRES_APPROVAL, userFacingText.guardrails.fluentEnglish));
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

  const yearsRequirement = extractRequiredYears(parsedOffer.jobOffer.requirementItems, text);
  if (yearsRequirement >= 3) {
    blocked.push(
      flag(
        'yearsOfExperience',
        CERTAINTY.PROHIBITED,
        userFacingText.guardrails.yearsOfExperience(yearsRequirement),
      ),
    );
  }

  const prohibitedTechnologyClaims = findBlockedTechnologyClaims(parsedOffer, profile);

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

function extractRequiredYears(requirementItems = [], fallbackText = '') {
  const requiredText = Array.isArray(requirementItems)
    ? requirementItems
        .filter((item) => item.level === 'required')
        .map((item) => item.text)
        .join('\n')
    : '';
  const text = requiredText || fallbackText;
  const matches = [...text.matchAll(/\b(\d)\+?\s+years?\b/gi)];
  return matches.reduce((highest, match) => Math.max(highest, Number(match[1] ?? 0)), 0);
}

function findBlockedTechnologyClaims(parsedOffer, profile) {
  const claims = Array.isArray(parsedOffer.jobOffer.technologyClaims) ? parsedOffer.jobOffer.technologyClaims : [];
  const confirmedTechnologies = new Set(
    (profile.technologies ?? []).map((technology) => String(technology).trim().toLowerCase()),
  );
  const prohibitedClaims = (profile.prohibitedClaims ?? []).map((claim) => claim.toLowerCase());

  return claims
    .filter((claim) => claim.requirementLevel === 'required')
    .filter((claim) => claim.relationship !== 'alternative')
    .filter((claim) => !confirmedTechnologies.has(String(claim.technology).trim().toLowerCase()))
    .map((claim) => {
      const matchedProfileClaim = prohibitedClaims.find((entry) =>
        entry.includes(String(claim.technology).trim().toLowerCase()),
      );
      return matchedProfileClaim ?? null;
    })
    .filter(Boolean);
}

function dedupeFlags(values) {
  return values.filter(
    (entry, index, list) =>
      index === list.findIndex((candidate) => candidate.field === entry.field && candidate.reason === entry.reason),
  );
}
