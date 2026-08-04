import { CERTAINTY } from '../../constants/certainty.js';

export function evaluateGuardrails(parsedOffer, profile) {
  const approvals = [];
  const blocked = [];

  if (parsedOffer.jobOffer.salary) {
    approvals.push(flag('salary', CERTAINTY.REQUIRES_APPROVAL, 'Salary details are sensitive'));
  }

  if (parsedOffer.jobOffer.flags.requiresVisa) {
    approvals.push(
      flag('workAuthorization', CERTAINTY.REQUIRES_APPROVAL, 'Work authorization must be reviewed manually'),
    );
  }

  if (parsedOffer.jobOffer.flags.legalQuestions) {
    blocked.push(flag('legalQuestions', CERTAINTY.PROHIBITED, 'Legal screening answers cannot be auto-filled'));
  }

  if (parsedOffer.jobOffer.englishRequirement === 'advanced' && profile.englishLevel !== 'C1') {
    blocked.push(flag('englishRequirement', CERTAINTY.PROHIBITED, 'Offer requires advanced English beyond confirmed B1'));
  }

  return { approvals, blocked };
}

function flag(field, certainty, reason) {
  return { field, certainty, reason };
}
