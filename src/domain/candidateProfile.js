import { randomUUID } from 'node:crypto';
import { CERTAINTY } from '../constants/certainty.js';

export const defaultCandidateProfileInput = {
  name: 'Bryan Marquez',
  headlineTargets: [
    'Full Stack Developer',
    'Backend Developer',
    'Frontend Developer',
    'Junior Software Developer',
  ],
  location: 'Buenos Aires, Argentina',
  availability: 'Full time',
  modalities: ['remote', 'hybrid', 'onsite'],
  englishLevel: 'B1',
  salaryExpectation: {
    amount: 1000,
    currency: 'USD',
    period: 'monthly',
  },
  publicLinks: {
    github: 'https://github.com/bryanamg1',
    linkedin: 'https://www.linkedin.com/in/bryan-marquez-dev/',
  },
  contact: {
    email: 'bryanamg181@gmail.com',
  },
  projects: ['Social App', 'PronostIA', 'Venezuela SOS', 'TechStore'],
  technologies: [
    'JavaScript ES6+',
    'Node.js',
    'Express',
    'React',
    'Vite',
    'React Router',
    'Context API',
    'MySQL',
    'MongoDB',
    'Socket.io',
    'Redis',
    'Jest',
    'Supertest',
    'Docker',
    'JWT',
    'Multer',
    'Cloudinary',
    'Winston',
    'CORS',
    'dotenv',
    'bcrypt',
    'express-validator',
    'Git',
    'GitHub',
    'Railway',
    'Vercel',
    'Postman',
    'MySQL Workbench',
  ],
  knowledgeAreas: ['AI agents'],
  prohibitedClaims: [
    'English C1',
    'Advanced WordPress',
    'Advanced PHP',
    'AWS experience',
    'Terraform experience',
    'Unverified years of experience',
  ],
};

export function createCandidateProfile(input, options = {}) {
  const source = options.source ?? 'candidate_profile_seed';
  const id = options.id ?? 'candidate-bryan-marquez';
  const salaryCertainty = options.salaryCertainty ?? CERTAINTY.REQUIRES_APPROVAL;

  const normalized = {
    id,
    name: input.name,
    headlineTargets: dedupeStrings(input.headlineTargets),
    location: input.location,
    availability: input.availability,
    modalities: dedupeStrings(input.modalities),
    englishLevel: input.englishLevel,
    salaryExpectation: {
      amount: Number(input.salaryExpectation.amount),
      currency: String(input.salaryExpectation.currency).toUpperCase(),
      period: input.salaryExpectation.period,
      certainty: salaryCertainty,
      source,
    },
    publicLinks: {
      github: input.publicLinks.github,
      linkedin: input.publicLinks.linkedin,
    },
    contact: {
      email: input.contact.email,
    },
    projects: dedupeStrings(input.projects),
    technologies: dedupeStrings(input.technologies),
    knowledgeAreas: dedupeStrings(input.knowledgeAreas ?? []),
    prohibitedClaims: dedupeStrings(input.prohibitedClaims ?? []),
  };

  normalized.facts = createCandidateFacts(normalized, source);
  return normalized;
}

export function createCandidateFacts(profile, source) {
  return [
    fact('location', profile.location, source),
    fact('availability', profile.availability, source),
    fact('englishLevel', profile.englishLevel, source),
    ...profile.modalities.map((value) => fact('modality', value, source)),
    ...profile.technologies.map((value) => fact('technology', value, source)),
    ...profile.knowledgeAreas.map((value) => fact('knowledge', value, source)),
  ];
}

export function createCandidateFactRows(profileId, facts) {
  return facts.map((entry) => ({
    id: randomUUID(),
    candidateProfileId: profileId,
    factKey: entry.key,
    factValue: entry.value,
    certainty: entry.certainty,
    source: entry.source,
  }));
}

function fact(key, value, source) {
  return {
    key,
    value,
    source,
    certainty: CERTAINTY.CONFIRMED,
  };
}

function dedupeStrings(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}
