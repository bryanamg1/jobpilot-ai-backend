import { matchingRules } from '../../config/matchingRules.js';
import { JOB_STATUS } from '../../constants/jobStatus.js';
import { userFacingText } from '../../constants/userFacingText.js';
import { normalizeTechnology } from '../manualIntake/manualJobParser.js';

const technologyLevelWeights = {
  required: 1,
  preferred: 0.45,
  optional: 0.2,
  mentioned: 0.25,
};

export function matchJobOffer(profile, parsedOffer, guardrails) {
  const confirmedTechnologies = new Set(
    profile.facts
      .filter((fact) => fact.key === 'technology')
      .map((fact) => normalizeTechnology(fact.value).toLowerCase()),
  );
  const technologyEvaluation = evaluateTechnologyFit(parsedOffer.jobOffer, confirmedTechnologies);
  const {
    matchedTechnologies,
    missingTechnologies,
    missingRequiredTechnologies,
    missingPreferredTechnologies,
    missingOptionalTechnologies,
    technologyUnits,
  } = technologyEvaluation;
  const technologyScore = technologyEvaluation.score;
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
  const scoreComponents = {
    technologyScore,
    seniorityScore,
    languageScore,
    locationScore,
    roleAlignmentScore,
    projectScore,
    salaryScore,
  };
  const matchBreakdown = {
    strengths: [
      ...matchedTechnologies.map((tech) => userFacingText.matching.technologyConfirmed(tech)),
      locationScore > 0 ? userFacingText.matching.modalityAligned : null,
      roleAlignmentScore > 0 ? userFacingText.matching.roleAligned : null,
    ].filter(Boolean),
    gaps: [
      ...missingRequiredTechnologies.map((tech) => userFacingText.matching.requiredTechnologyMissing(tech)),
      parsedOffer.jobOffer.englishRequirement === 'advanced'
        ? userFacingText.matching.advancedEnglishGap
        : parsedOffer.jobOffer.englishRequirement === 'fluent'
          ? userFacingText.matching.fluentEnglishGap
          : null,
      parsedOffer.jobOffer.seniority === 'senior'
        ? userFacingText.matching.seniorityGap
        : null,
    ].filter(Boolean),
    preferredMissing: missingPreferredTechnologies.map((tech) =>
      userFacingText.matching.preferredTechnologyMissing(tech),
    ),
    optionalMissing: missingOptionalTechnologies.map((tech) => userFacingText.matching.optionalTechnologyMissing(tech)),
    blockers: excludedByRules,
    scoreComponents,
    technologyUnits,
  };

  return {
    score,
    recommendation,
    status,
    explanation: {
      matches: [
        ...matchedTechnologies.map((tech) => userFacingText.matching.technologyConfirmed(tech)),
        locationScore > 0 ? userFacingText.matching.modalityAligned : null,
        roleAlignmentScore > 0 ? userFacingText.matching.roleAligned : null,
      ].filter(Boolean),
      gaps: [
        ...missingTechnologies.map((tech) => userFacingText.matching.technologyMissing(tech)),
        parsedOffer.jobOffer.englishRequirement === 'advanced'
          ? userFacingText.matching.advancedEnglishGap
          : parsedOffer.jobOffer.englishRequirement === 'fluent'
            ? userFacingText.matching.fluentEnglishGap
          : null,
        parsedOffer.jobOffer.seniority === 'senior'
          ? userFacingText.matching.seniorityGap
          : null,
      ].filter(Boolean),
      risks: [
        ...guardrails.approvals.map((item) => item.reason),
        parsedOffer.jobOffer.flags.asksForSalary ? userFacingText.matching.salarySensitive : null,
      ].filter(Boolean),
      unverified: excludedByRules,
    },
    matchBreakdown,
    componentScores: scoreComponents,
    matchedTechnologies,
    missingTechnologies,
    excludedByRules,
  };
}

function ratioScore(matches, total, weight) {
  return (matches / total) * weight;
}

function evaluateTechnologyFit(jobOffer, confirmedTechnologies) {
  const offerTechnologies = dedupeTechnologies(jobOffer.technologies);
  const claimUnits = buildTechnologyUnits(jobOffer.technologyClaims, offerTechnologies);
  const units = claimUnits.length
    ? addMentionedTechnologyUnits(claimUnits, offerTechnologies)
    : offerTechnologies.map((technology) => ({
        technologies: [technology],
        requirementLevel: 'mentioned',
        relationship: 'all',
        evidence: null,
      }));

  let earnedWeight = 0;
  let totalWeight = 0;
  const matched = new Set();
  const missing = new Map();

  for (const unit of units) {
    const weight = technologyLevelWeights[unit.requirementLevel] ?? technologyLevelWeights.mentioned;
    totalWeight += weight;

    const matchedInUnit = unit.technologies.filter((technology) =>
      confirmedTechnologies.has(normalizeTechnology(technology).toLowerCase()),
    );
    const isMatched = unit.relationship === 'alternative' ? matchedInUnit.length > 0 : matchedInUnit.length === unit.technologies.length;

    if (isMatched) {
      earnedWeight += weight;
      for (const technology of matchedInUnit.length ? matchedInUnit : unit.technologies) {
        matched.add(normalizeTechnology(technology));
      }
      continue;
    }

    const missingTechnologies = unit.technologies.filter(
      (technology) => !confirmedTechnologies.has(normalizeTechnology(technology).toLowerCase()),
    );
    for (const technology of missingTechnologies) {
      const canonical = normalizeTechnology(technology);
      const current = missing.get(canonical);
      if (!current || technologyLevelWeights[unit.requirementLevel] > technologyLevelWeights[current]) {
        missing.set(canonical, unit.requirementLevel);
      }
    }
  }

  const missingEntries = [...missing.entries()];
  return {
    score: totalWeight ? (earnedWeight / totalWeight) * matchingRules.weights.technologies : matchingRules.weights.technologies,
    matchedTechnologies: [...matched],
    missingTechnologies: missingEntries.map(([technology]) => technology),
    missingRequiredTechnologies: missingEntries.filter(([, level]) => level === 'required').map(([technology]) => technology),
    missingPreferredTechnologies: missingEntries.filter(([, level]) => level === 'preferred').map(([technology]) => technology),
    missingOptionalTechnologies: missingEntries
      .filter(([, level]) => level === 'optional' || level === 'mentioned')
      .map(([technology]) => technology),
    technologyUnits: units.map((unit) => ({
      technologies: unit.technologies,
      requirementLevel: unit.requirementLevel,
      relationship: unit.relationship,
      evidence: unit.evidence,
    })),
  };
}

function buildTechnologyUnits(claims = [], offerTechnologies = []) {
  if (!Array.isArray(claims) || !claims.length) {
    return [];
  }

  const units = [];
  const alternativeGroups = new Map();

  for (const claim of claims) {
    const technology = normalizeTechnology(claim.technology);
    if (!technology) {
      continue;
    }

    if (claim.relationship === 'alternative' && claim.alternativeGroup) {
      const group = alternativeGroups.get(claim.alternativeGroup) ?? {
        technologies: [],
        requirementLevel: claim.requirementLevel,
        relationship: 'alternative',
        evidence: claim.evidence ?? null,
      };
      group.technologies.push(technology);
      group.requirementLevel = strongestRequirementLevel(group.requirementLevel, claim.requirementLevel);
      alternativeGroups.set(claim.alternativeGroup, group);
      continue;
    }

    units.push({
      technologies: [technology],
      requirementLevel: claim.requirementLevel ?? 'mentioned',
      relationship: 'all',
      evidence: claim.evidence ?? null,
    });
  }

  return dedupeTechnologyUnits([...units, ...alternativeGroups.values()], offerTechnologies);
}

function addMentionedTechnologyUnits(claimUnits, offerTechnologies) {
  const claimed = new Set(claimUnits.flatMap((unit) => unit.technologies.map((technology) => normalizeTechnology(technology).toLowerCase())));
  const mentioned = offerTechnologies
    .filter((technology) => !claimed.has(normalizeTechnology(technology).toLowerCase()))
    .map((technology) => ({
      technologies: [technology],
      requirementLevel: 'mentioned',
      relationship: 'all',
      evidence: null,
    }));

  return [...claimUnits, ...mentioned];
}

function dedupeTechnologyUnits(units) {
  const seen = new Set();
  return units.filter((unit) => {
    const key = `${unit.requirementLevel}:${unit.relationship}:${unit.technologies
      .map((technology) => normalizeTechnology(technology).toLowerCase())
      .sort()
      .join('|')}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function strongestRequirementLevel(currentLevel, nextLevel) {
  const rank = {
    optional: 1,
    mentioned: 1,
    preferred: 2,
    required: 3,
  };
  return (rank[nextLevel] ?? 1) > (rank[currentLevel] ?? 1) ? nextLevel : currentLevel;
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
  if (level === 'unknown' || level === 'basic' || level === 'intermediate') {
    return matchingRules.weights.language;
  }
  if (level === 'fluent') {
    return matchingRules.weights.language * 0.3;
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
  const lowerTitle = String(title ?? '').toLowerCase();
  const matches = targets.filter((target) =>
    lowerTitle.includes(target.toLowerCase().split(' ')[0]),
  ).length;
  return matches ? matchingRules.weights.roleAlignment : matchingRules.weights.roleAlignment * 0.3;
}

function computeProjectScore(projects, title) {
  if (!projects?.length) {
    return 0;
  }

  const lowerTitle = String(title ?? '').toLowerCase();
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

  return JOB_STATUS.REJECTED;
}

function dedupeTechnologies(values = []) {
  const ordered = [];
  const seen = new Set();

  for (const value of values) {
    const canonical = normalizeTechnology(value);
    const key = canonical.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    ordered.push(canonical);
  }

  return ordered;
}
