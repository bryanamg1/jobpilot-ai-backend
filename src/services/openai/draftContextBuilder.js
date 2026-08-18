import { defaultCandidateProfile } from '../../config/candidateProfileSeed.js';
import { CERTAINTY } from '../../constants/certainty.js';
import { normalizeTechnology } from '../manualIntake/manualJobParser.js';

const MAX_TECHNOLOGIES = 4;
const MAX_PROJECTS = 2;
const MAX_EXPERIENCES = 3;

const PROJECT_CATALOG = [
  {
    name: 'Social App',
    roleTags: ['backend', 'fullstack'],
    affinityTags: ['api', 'realtime', 'product'],
  },
  {
    name: 'PronostIA',
    roleTags: ['backend', 'fullstack'],
    affinityTags: ['product', 'ai', 'analysis'],
  },
  {
    name: 'Venezuela SOS',
    roleTags: ['frontend', 'fullstack'],
    affinityTags: ['ui', 'web', 'product'],
  },
  {
    name: 'TechStore',
    roleTags: ['frontend', 'fullstack'],
    affinityTags: ['ui', 'product', 'web'],
  },
];

const EXPERIENCE_CATALOG = [
  {
    id: 'backend-services',
    roleTags: ['backend', 'fullstack'],
    technologies: ['Node.js', 'Express'],
    summary: 'desarrollo de APIs y servicios con Node.js y Express',
  },
  {
    id: 'data-persistence',
    roleTags: ['backend', 'fullstack'],
    technologies: ['MySQL', 'MongoDB', 'Redis'],
    summary: 'trabajo con persistencia de datos y consultas usando MySQL, MongoDB y Redis',
  },
  {
    id: 'quality-and-testing',
    roleTags: ['backend', 'fullstack'],
    technologies: ['Jest', 'Supertest'],
    summary: 'pruebas de endpoints y validacion tecnica con Jest y Supertest',
  },
  {
    id: 'frontend-interfaces',
    roleTags: ['frontend', 'fullstack'],
    technologies: ['React', 'Vite', 'React Router'],
    summary: 'desarrollo de interfaces web con React, Vite y React Router',
  },
  {
    id: 'product-delivery',
    roleTags: ['frontend', 'fullstack', 'backend'],
    technologies: ['Docker', 'Railway', 'Vercel'],
    summary: 'puesta en marcha y entrega de aplicaciones web con herramientas de despliegue y contenedores',
  },
  {
    id: 'realtime-collaboration',
    roleTags: ['backend', 'fullstack'],
    technologies: ['Socket.io', 'Redis'],
    summary: 'implementacion de flujos en tiempo real y comunicacion entre cliente y servidor',
  },
];

export function buildDraftContext(jobAnalysis, options = {}) {
  const candidateProfile = normalizeCandidateProfile(options.candidateProfile);
  const title = sanitizeDraftTitle(jobAnalysis?.jobOffer?.title);
  const company = sanitizeDraftCompany(jobAnalysis?.jobOffer?.company);
  const roleFamily = detectRoleFamily(title);
  const matchedTechnologies = selectRelevantTechnologies(candidateProfile, jobAnalysis?.jobOffer, jobAnalysis?.match);
  const relevantProjects = selectRelevantProjects(candidateProfile, jobAnalysis?.jobOffer, matchedTechnologies, roleFamily);
  const relevantExperience = selectRelevantExperience(
    candidateProfile,
    jobAnalysis?.jobOffer,
    matchedTechnologies,
    roleFamily,
  );
  const templateVariant = resolveTemplateVariant(Boolean(company), Boolean(title));

  return {
    candidate: {
      name: candidateProfile.name,
      location: candidateProfile.location,
      availability: candidateProfile.availability,
      modalities: dedupeStrings(candidateProfile.modalities),
      headlineTargets: dedupeStrings(candidateProfile.headlineTargets),
      publicLinks: candidateProfile.publicLinks,
      relevantTechnologies: matchedTechnologies,
      relevantProjects,
      relevantExperience,
    },
    job: {
      title,
      company,
      recruiterEmail: sanitizeEmail(jobAnalysis?.jobOffer?.recruiterEmail),
      location: jobAnalysis?.jobOffer?.location ?? null,
      modality: dedupeStrings(jobAnalysis?.jobOffer?.modality ?? []),
      technologies: dedupeTechnologies(jobAnalysis?.jobOffer?.technologies ?? []),
      sourceUrl: jobAnalysis?.source?.originalUrl ?? null,
    },
    match: {
      score: jobAnalysis?.match?.score ?? null,
      recommendation: jobAnalysis?.match?.recommendation ?? null,
      status: jobAnalysis?.match?.status ?? null,
      matchedTechnologies,
      approvals: jobAnalysis?.match?.approvals ?? [],
      blockedReasons: jobAnalysis?.match?.excludedByRules ?? [],
    },
    templateVariant,
    highlights: dedupeStrings([...matchedTechnologies, ...relevantProjects]).slice(0, 6),
    factsUsed: buildFactsUsed(jobAnalysis, title, company, matchedTechnologies, relevantProjects),
    constraints: {
      minWords: 150,
      maxWords: 250,
      bannedPhrases: [
        'Mi stack confirmado',
        'Empresa desconocida',
        'Rol inferido',
        'Candidate facts',
        'Perfil confirmado',
        'Inferido',
        'Confirmado',
      ],
    },
  };
}

export function selectRelevantTechnologies(candidateProfile, jobOffer, match = {}) {
  const candidateTechnologies = new Set(
    collectCandidateTechnologies(candidateProfile).map((entry) => normalizeTechnology(entry).toLowerCase()),
  );
  const preferred = dedupeTechnologies(match?.matchedTechnologies ?? []);
  if (preferred.length) {
    return preferred.slice(0, MAX_TECHNOLOGIES);
  }

  const directMatches = dedupeTechnologies(jobOffer?.technologies ?? []).filter((entry) =>
    candidateTechnologies.has(normalizeTechnology(entry).toLowerCase()),
  );

  return directMatches.slice(0, MAX_TECHNOLOGIES);
}

export function selectRelevantProjects(
  candidateProfile,
  jobOffer,
  matchedTechnologies = [],
  roleFamily = detectRoleFamily(jobOffer?.title),
) {
  const availableProjects = new Set(candidateProfile.projects ?? defaultCandidateProfile.projects);
  const techTags = inferTechnologyTags(matchedTechnologies);

  return PROJECT_CATALOG.filter((project) => availableProjects.has(project.name))
    .map((project) => ({
      name: project.name,
      score: scoreProject(project, roleFamily, techTags),
    }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, MAX_PROJECTS)
    .map((project) => project.name);
}

export function selectRelevantExperience(
  candidateProfile,
  jobOffer,
  matchedTechnologies = [],
  roleFamily = detectRoleFamily(jobOffer?.title),
) {
  const candidateTechnologies = new Set(
    collectCandidateTechnologies(candidateProfile).map((entry) => normalizeTechnology(entry).toLowerCase()),
  );
  const matchedTechnologySet = new Set(
    matchedTechnologies.map((entry) => normalizeTechnology(entry).toLowerCase()),
  );

  const selected = EXPERIENCE_CATALOG.map((entry) => ({
    summary: entry.summary,
    score: scoreExperience(entry, roleFamily, candidateTechnologies, matchedTechnologySet),
  }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_EXPERIENCES)
    .map((entry) => entry.summary);

  if (selected.length) {
    return selected;
  }

  if (roleFamily === 'frontend') {
    return ['desarrollo de interfaces web y funcionalidades orientadas a producto'];
  }

  if (roleFamily === 'backend') {
    return ['desarrollo de funcionalidades backend y resolucion de logica de negocio'];
  }

  return ['desarrollo de aplicaciones web con enfoque full stack'];
}

export function sanitizeDraftCompany(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || /^unknown\b/i.test(normalized) || /^empresa desconocida$/i.test(normalized)) {
    return null;
  }

  return normalized;
}

export function sanitizeDraftTitle(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || /^unknown\b/i.test(normalized) || /^puesto desconocido$/i.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeCandidateProfile(candidateProfile) {
  const profile = candidateProfile ?? defaultCandidateProfile;
  const facts = Array.isArray(profile.facts) ? profile.facts : defaultCandidateProfile.facts;

  return {
    ...defaultCandidateProfile,
    ...profile,
    facts,
    technologies: collectCandidateTechnologies(profile),
    projects: dedupeStrings(profile.projects ?? defaultCandidateProfile.projects),
    headlineTargets: dedupeStrings(profile.headlineTargets ?? defaultCandidateProfile.headlineTargets),
    modalities: dedupeStrings(profile.modalities ?? defaultCandidateProfile.modalities),
  };
}

function collectCandidateTechnologies(candidateProfile) {
  const direct = Array.isArray(candidateProfile?.technologies) ? candidateProfile.technologies : [];
  const fromFacts = Array.isArray(candidateProfile?.facts)
    ? candidateProfile.facts.filter((entry) => entry.key === 'technology').map((entry) => entry.value)
    : [];

  return dedupeTechnologies([...direct, ...fromFacts, ...defaultCandidateProfile.technologies]);
}

function buildFactsUsed(jobAnalysis, title, company, matchedTechnologies, relevantProjects) {
  const certaintyByField = new Map(
    (jobAnalysis?.jobOffer?.certaintyMap ?? []).map((entry) => [entry.field, entry]),
  );
  const facts = [];

  for (const technology of matchedTechnologies) {
    facts.push({
      field: 'technology',
      value: technology,
      certainty: CERTAINTY.CONFIRMED,
      source: 'candidate_profile',
    });
  }

  for (const project of relevantProjects) {
    facts.push({
      field: 'project',
      value: project,
      certainty: CERTAINTY.CONFIRMED,
      source: 'candidate_profile',
    });
  }

  if (title) {
    facts.push({
      field: 'targetRole',
      value: title,
      certainty: certaintyByField.get('title')?.certainty ?? CERTAINTY.INFERRED,
      source: certaintyByField.get('title')?.source ?? 'job_offer',
    });
  }

  if (company) {
    facts.push({
      field: 'company',
      value: company,
      certainty: certaintyByField.get('company')?.certainty ?? CERTAINTY.INFERRED,
      source: certaintyByField.get('company')?.source ?? 'job_offer',
    });
  }

  return dedupeFacts(facts).filter(
    (entry) => entry.certainty !== CERTAINTY.UNKNOWN && entry.certainty !== CERTAINTY.PROHIBITED,
  );
}

function dedupeFacts(values) {
  return values.filter(
    (entry, index, list) =>
      index ===
      list.findIndex(
        (candidate) =>
          candidate.field === entry.field &&
          candidate.value === entry.value &&
          candidate.certainty === entry.certainty &&
          candidate.source === entry.source,
      ),
  );
}

function resolveTemplateVariant(companyKnown, titleKnown) {
  if (companyKnown && titleKnown) {
    return 'KNOWN_COMPANY_KNOWN_TITLE';
  }
  if (companyKnown) {
    return 'KNOWN_COMPANY_UNKNOWN_TITLE';
  }
  if (titleKnown) {
    return 'UNKNOWN_COMPANY_KNOWN_TITLE';
  }
  return 'UNKNOWN_COMPANY_UNKNOWN_TITLE';
}

function scoreProject(project, roleFamily, technologyTags) {
  let score = project.roleTags.includes(roleFamily) ? 4 : 0;
  if (project.roleTags.includes('fullstack') && roleFamily === 'fullstack') {
    score += 2;
  }
  for (const tag of technologyTags) {
    if (project.affinityTags.includes(tag)) {
      score += 1;
    }
  }
  return score;
}

function scoreExperience(entry, roleFamily, candidateTechnologies, matchedTechnologySet) {
  let score = entry.roleTags.includes(roleFamily) ? 3 : 0;

  for (const technology of entry.technologies) {
    const key = normalizeTechnology(technology).toLowerCase();
    if (candidateTechnologies.has(key)) {
      score += 1;
    }
    if (matchedTechnologySet.has(key)) {
      score += 2;
    }
  }

  return score;
}

function detectRoleFamily(title) {
  const normalized = String(title ?? '').toLowerCase();
  if (/(front|react|ui)/i.test(normalized)) {
    return 'frontend';
  }
  if (/(back|node|api|server)/i.test(normalized)) {
    return 'backend';
  }
  return 'fullstack';
}

function inferTechnologyTags(technologies) {
  const normalized = technologies.map((entry) => normalizeTechnology(entry).toLowerCase());
  const tags = [];

  if (normalized.some((entry) => ['node.js', 'express', 'mysql', 'redis', 'mongodb'].includes(entry))) {
    tags.push('api');
  }
  if (normalized.some((entry) => ['socket.io', 'redis'].includes(entry))) {
    tags.push('realtime');
  }
  if (normalized.some((entry) => ['react', 'vite', 'react router'].includes(entry))) {
    tags.push('ui');
  }
  if (normalized.length) {
    tags.push('product');
  }

  return dedupeStrings(tags);
}

function sanitizeEmail(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function dedupeTechnologies(values = []) {
  return dedupeStrings(values.map((entry) => normalizeTechnology(entry)));
}

function dedupeStrings(values = []) {
  return [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))];
}
