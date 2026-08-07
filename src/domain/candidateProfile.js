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
  answerLibrary: [
    {
      id: 'answer-location-buenos-aires',
      kind: 'location',
      question: 'Cual es tu ubicacion actual?',
      answer: 'Bryan Marquez vive en Buenos Aires, Argentina.',
      certainty: CERTAINTY.CONFIRMED,
      source: 'candidate_profile_seed',
      tags: ['location', 'argentina', 'remote'],
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
    {
      id: 'answer-availability-full-time',
      kind: 'availability',
      question: 'Cual es tu disponibilidad actual?',
      answer: 'Bryan Marquez esta disponible para oportunidades full time.',
      certainty: CERTAINTY.CONFIRMED,
      source: 'candidate_profile_seed',
      tags: ['availability', 'full-time', 'schedule'],
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
    {
      id: 'answer-english-b1',
      kind: 'englishLevel',
      question: 'Cual es tu nivel de ingles?',
      answer: 'Nivel de ingles confirmado: B1.',
      certainty: CERTAINTY.REQUIRES_APPROVAL,
      source: 'candidate_profile_seed',
      tags: ['english', 'language', 'b1'],
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
    {
      id: 'answer-salary-usd-1000',
      kind: 'salaryExpectation',
      question: 'Cuales son tus expectativas salariales?',
      answer: 'Expectativa salarial inicial: USD 1000 mensuales.',
      certainty: CERTAINTY.REQUIRES_APPROVAL,
      source: 'candidate_profile_seed',
      tags: ['salary', 'compensation', 'usd'],
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
    {
      id: 'answer-work-authorization-unknown',
      kind: 'workAuthorization',
      question: 'Tienes autorizacion para trabajar en este pais?',
      answer: 'Requiere confirmacion manual. No respondas autorizacion laboral de forma automatica.',
      certainty: CERTAINTY.UNKNOWN,
      source: 'candidate_profile_seed',
      tags: ['visa', 'work authorization', 'legal'],
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    },
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
    answerLibrary: normalizeAnswerLibrary(input.answerLibrary ?? [], source),
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

export function createAnswerLibraryEntry(input, options = {}) {
  const timestamp = options.timestamp ?? new Date().toISOString();

  return {
    id: options.id ?? input.id ?? randomUUID(),
    kind: String(input.kind ?? 'custom').trim() || 'custom',
    question: String(input.question ?? '').trim(),
    answer: String(input.answer ?? '').trim(),
    certainty: input.certainty ?? CERTAINTY.REQUIRES_APPROVAL,
    source: String(input.source ?? options.source ?? 'candidate_profile_seed').trim(),
    tags: dedupeStrings(input.tags ?? []),
    createdAt: input.createdAt ?? options.createdAt ?? timestamp,
    updatedAt: options.updatedAt ?? input.updatedAt ?? timestamp,
  };
}

function normalizeAnswerLibrary(values, source) {
  return values.map((entry) =>
    createAnswerLibraryEntry(entry, {
      source,
    }),
  );
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
