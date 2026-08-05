import { matchingRules } from '../../config/matchingRules.js';
import { JOB_STATUS } from '../../constants/jobStatus.js';

export function matchJobOffer(profile, parsedOffer, guardrails) {
  const confirmedTechnologies = new Set(
    profile.facts.filter((fact) => fact.key === 'technology').map((fact) => String(fact.value).toLowerCase()),
  );
  const offerTechnologies = parsedOffer.jobOffer.technologies;
  const matchedTechnologies = offerTechnologies.filter((tech) =>
    confirmedTechnologies.has(String(tech).toLowerCase()),
  );
  const missingTechnologies = offerTechnologies.filter(
    (tech) => !matchedTechnologies.includes(tech),
  );

  const technologyScore = ratioScore(
    matchedTechnologies.length,
    offerTechnologies.length || 1,
    matchingRules.weights.technologies,
  );
  const seniorityScore = computeSeniorityScore(parsedOffer.jobOffer.seniority);
  const languageScore = computeLanguageScore(parsedOffer.jobOffer.englishRequirement);
  const locationScore = computeLocationScore(parsedOffer.jobOffer.modality, profile.modalities);
  const roleAlignmentScore = computeRoleAlignmentScore(profile.headlineTargets, parsedOffer.jobOffer.title);
  const projectScore = computeProjectScore(profile.projects, parsedOffer.jobOffer.title);
  const salaryScore = computeSalaryScore(parsedOffer.jobOffer.salary, profile.salaryExpectation);

  const score = Math.round(
    technologyScore +
      seniorityScore +
      languageScore +
      locationScore +
      roleAlignmentScore +
      projectScore +
      salaryScore,
  );

  const excludedByRules = guardrails.blocked.map((item) => item.reason);
  const recommendation = selectRecommendation(score);
  const status = selectStatus(score, parsedOffer, guardrails, excludedByRules);

  return {
    score,
    recommendation,
    status,
    explanation: {
      matches: [
        ...matchedTechnologies.map((tech) => `${tech} is confirmed in candidate profile`),
        locationScore > 0 ? 'Modality aligns with preferred work modes' : null,
        roleAlignmentScore > 0 ? 'Role aligns with target positions' : null,
      ].filter(Boolean),
      gaps: [
        ...missingTechnologies.map((tech) => `${tech} is not confirmed in the profile`),
        parsedOffer.jobOffer.englishRequirement === 'advanced' ? 'Advanced English requirement exceeds confirmed B1' : null,
        parsedOffer.jobOffer.seniority === 'senior' ? 'Senior profile requested while candidate is targeting junior roles' : null,
      ].filter(Boolean),
      risks: [
        ...guardrails.approvals.map((item) => item.reason),
        parsedOffer.jobOffer.flags.asksForSalary ? 'Salary expectations are sensitive and require review' : null,
      ].filter(Boolean),
      unverified: excludedByRules,
    },
    componentScores: {
      technologyScore,
      seniorityScore,
      languageScore,
      locationScore,
      roleAlignmentScore,
      projectScore,
      salaryScore,
    },
    matchedTechnologies,
    missingTechnologies,
    excludedByRules,
  };
}

function ratioScore(matches, total, weight) {
  return (matches / total) * weight;
}

function computeSeniorityScore(seniority) {
  if (seniority === 'junior' || seniority === 'unknown') {
    return matchingRules.weights.seniority;
  }
  if (seniority === 'mid') {
    return matchingRules.weights.seniority * 0.4;
  }
  return 0;
}

function computeLanguageScore(level) {
  if (level === 'unknown' || level === 'basic') {
    return matchingRules.weights.language;
  }
  if (level === 'intermediate') {
    return matchingRules.weights.language * 0.6;
  }
  return 0;
}

function computeLocationScore(modalities, preferredModalities) {
  if (!modalities?.length) {
    return matchingRules.weights.location * 0.5;
  }

  const preferredSet = new Set(preferredModalities);
  const intersection = modalities.filter((mode) => preferredSet.has(mode)).length;
  return ratioScore(intersection, modalities.length, matchingRules.weights.location);
}

function computeRoleAlignmentScore(targets, title) {
  const lowerTitle = title.toLowerCase();
  const matches = targets.filter((target) =>
    lowerTitle.includes(target.toLowerCase().split(' ')[0]),
  ).length;
  return matches ? matchingRules.weights.roleAlignment : matchingRules.weights.roleAlignment * 0.3;
}

function computeProjectScore(projects, title) {
  const lowerTitle = title.toLowerCase();
  const scoreTerms = ['full stack', 'backend', 'frontend', 'software'];
  const hits = scoreTerms.filter((term) => lowerTitle.includes(term)).length;
  return hits ? matchingRules.weights.projects : matchingRules.weights.projects * 0.2;
}

function computeSalaryScore(salary, salaryExpectation) {
  if (!salary) {
    return matchingRules.weights.salary * 0.5;
  }
  return salary.max >= salaryExpectation.amount ? matchingRules.weights.salary : matchingRules.weights.salary * 0.2;
}

function selectRecommendation(score) {
  return Object.values(matchingRules.thresholds).find(
    (threshold) => score >= threshold.min && score <= threshold.max,
  )?.recommendation;
}

function selectStatus(score, parsedOffer, guardrails, excludedByRules) {
  if (excludedByRules.length) {
    return JOB_STATUS.REJECTED_BY_RULES;
  }

  if (score >= 65) {
    return guardrails.approvals.length ? JOB_STATUS.AWAITING_APPROVAL : JOB_STATUS.READY_TO_PREPARE;
  }

  if (
    score >= 50 &&
    (parsedOffer.jobOffer.seniority === 'junior' || parsedOffer.jobOffer.seniority === 'unknown')
  ) {
    return JOB_STATUS.AWAITING_APPROVAL;
  }

  return JOB_STATUS.REJECTED_BY_RULES;
}
