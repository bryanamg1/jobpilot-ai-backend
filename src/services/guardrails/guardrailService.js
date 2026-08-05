import { CERTAINTY } from '../../constants/certainty.js';

export function evaluateGuardrails(parsedOffer, profile) {
  const approvals = [];
  const blocked = [];
  const text = parsedOffer.source.originalText.toLowerCase();

  if (parsedOffer.jobOffer.salary) {
    approvals.push(flag('salary', CERTAINTY.REQUIRES_APPROVAL, 'Salary details are sensitive and require approval'));
  }

  if (parsedOffer.jobOffer.flags.requiresVisa) {
    approvals.push(
      flag('workAuthorization', CERTAINTY.REQUIRES_APPROVAL, 'Work authorization must be reviewed manually'),
    );
  }

  if (parsedOffer.jobOffer.flags.requiresRelocation) {
    approvals.push(flag('relocation', CERTAINTY.REQUIRES_APPROVAL, 'Relocation requirements need explicit approval'));
  }

  if (parsedOffer.jobOffer.flags.requiresTravel) {
    approvals.push(flag('travel', CERTAINTY.REQUIRES_APPROVAL, 'Travel availability is sensitive and must be reviewed'));
  }

  if (parsedOffer.jobOffer.flags.requiresImmediateAvailability) {
    approvals.push(
      flag(
        'availabilityImmediate',
        CERTAINTY.REQUIRES_APPROVAL,
        'Immediate availability must be confirmed manually before any draft is prepared',
      ),
    );
  }

  if (parsedOffer.jobOffer.flags.legalQuestions) {
    blocked.push(flag('legalQuestions', CERTAINTY.PROHIBITED, 'Legal screening answers cannot be auto-filled'));
  }

  if (parsedOffer.jobOffer.englishRequirement === 'advanced' && profile.englishLevel !== 'C1') {
    blocked.push(flag('englishRequirement', CERTAINTY.PROHIBITED, 'Offer requires advanced English beyond confirmed B1'));
  }

  if (parsedOffer.jobOffer.englishRequirement === 'intermediate' && profile.englishLevel === 'B1') {
    approvals.push(
      flag(
        'englishLevel',
        CERTAINTY.REQUIRES_APPROVAL,
        'Intermediate English requirements should be reviewed against the confirmed B1 level',
      ),
    );
  }

  const yearsRequirement = extractRequiredYears(text);
  if (yearsRequirement >= 3) {
    blocked.push(
      flag(
        'yearsOfExperience',
        CERTAINTY.PROHIBITED,
        `Offer requests ${yearsRequirement}+ years of experience that are not confirmed in the candidate profile`,
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
        `Offer depends on a technology with unverified experience: ${claim}`,
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
