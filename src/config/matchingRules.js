export const matchingRules = {
  weights: {
    technologies: 35,
    seniority: 15,
    language: 10,
    location: 10,
    roleAlignment: 10,
    projects: 10,
    salary: 10,
  },
  thresholds: {
    recommended: { min: 80, max: 100, recommendation: 'RECOMMENDED' },
    review: { min: 65, max: 79, recommendation: 'REVIEW' },
    conditional: { min: 50, max: 64, recommendation: 'CONDITIONAL' },
    discard: { min: 0, max: 49, recommendation: 'DISCARD' },
  },
};
