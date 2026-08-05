import { CERTAINTY } from '../../constants/certainty.js';
import { normalizeUrl } from '../../lib/fingerprint.js';

const technologyDictionary = [
  'javascript',
  'typescript',
  'node.js',
  'node',
  'express',
  'react',
  'vite',
  'react router',
  'mysql',
  'mongodb',
  'redis',
  'docker',
  'jest',
  'supertest',
  'socket.io',
  'php',
  'wordpress',
  'aws',
  'terraform',
  'figma',
];

const modalityPatterns = [
  { value: 'remote', patterns: ['remote', 'remoto'] },
  { value: 'hybrid', patterns: ['hybrid', 'hibrido', 'híbrido'] },
  { value: 'onsite', patterns: ['onsite', 'presencial', 'on site'] },
];

export function parseManualJob({ rawText, sourceUrl, sourceLabel }) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const lowerText = rawText.toLowerCase();
  const title = extractField(lines, ['puesto', 'role', 'position', 'job title']) || lines[0] || 'Unknown role';
  const company =
    extractField(lines, ['empresa', 'company']) ||
    extractCompanyFromSentence(lines[0]) ||
    'Unknown company';
  const location = extractField(lines, ['ubicacion', 'ubicación', 'location']);
  const recruiterEmail = extractEmail(rawText);
  const technologies = technologyDictionary
    .filter((term) => lowerText.includes(term))
    .map(normalizeTechnology);
  const seniority = extractSeniority(lowerText);
  const englishRequirement = extractEnglishRequirement(lowerText);
  const modality = extractModality(lowerText);
  const salary = extractSalary(rawText);
  const requirements = extractRequirements(lines);
  const flags = extractFlags(lowerText);

  return {
    source: {
      type: 'MANUAL',
      label: sourceLabel,
      originalUrl: normalizeUrl(sourceUrl),
      originalText: rawText,
    },
    jobOffer: {
      title,
      company,
      recruiterEmail,
      location: location || null,
      modality,
      salary,
      seniority,
      englishRequirement,
      technologies,
      requirements,
      instructions: extractInstructions(lines),
      certaintyMap: [
        certaintyFact(
          'title',
          title,
          title === 'Unknown role' ? CERTAINTY.UNKNOWN : CERTAINTY.INFERRED,
          'manual_text_first_line',
        ),
        certaintyFact(
          'company',
          company,
          company === 'Unknown company' ? CERTAINTY.UNKNOWN : CERTAINTY.INFERRED,
          'manual_text',
        ),
        certaintyFact(
          'location',
          location,
          location ? CERTAINTY.INFERRED : CERTAINTY.UNKNOWN,
          'manual_text',
        ),
        certaintyFact(
          'modality',
          modality.join(', '),
          modality.length ? CERTAINTY.INFERRED : CERTAINTY.UNKNOWN,
          'manual_text_keyword',
        ),
        certaintyFact(
          'seniority',
          seniority,
          seniority === 'unknown' ? CERTAINTY.UNKNOWN : CERTAINTY.INFERRED,
          'manual_text_keyword',
        ),
        certaintyFact(
          'englishRequirement',
          englishRequirement,
          englishRequirement === 'unknown' ? CERTAINTY.UNKNOWN : CERTAINTY.INFERRED,
          'manual_text_keyword',
        ),
        certaintyFact(
          'recruiterEmail',
          recruiterEmail,
          recruiterEmail ? CERTAINTY.CONFIRMED : CERTAINTY.UNKNOWN,
          'manual_text_regex',
        ),
        certaintyFact(
          'salary',
          salary?.display ?? null,
          salary ? CERTAINTY.REQUIRES_APPROVAL : CERTAINTY.UNKNOWN,
          'manual_text_regex',
        ),
      ],
      flags,
    },
  };
}

function extractField(lines, labels) {
  for (const line of lines) {
    for (const label of labels) {
      const pattern = new RegExp(`^${label}\\s*[:|-]\\s*(.+)$`, 'i');
      const match = line.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
  }
  return null;
}

function extractCompanyFromSentence(line = '') {
  const match = line.match(/\bat\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function extractEmail(text) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

export function normalizeTechnology(term) {
  const mapping = {
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    'node.js': 'Node.js',
    node: 'Node.js',
    react: 'React',
    express: 'Express',
    vite: 'Vite',
    'react router': 'React Router',
    mysql: 'MySQL',
    mongodb: 'MongoDB',
    redis: 'Redis',
    docker: 'Docker',
    jest: 'Jest',
    supertest: 'Supertest',
    'socket.io': 'Socket.io',
    php: 'PHP',
    wordpress: 'WordPress',
    aws: 'AWS',
    terraform: 'Terraform',
    figma: 'Figma',
  };
  return mapping[term.toLowerCase()] ?? term;
}

function extractSeniority(text) {
  if (/(lead|staff|principal)/i.test(text)) {
    return 'lead';
  }
  if (/(senior|sr\.)/i.test(text)) {
    return 'senior';
  }
  if (/(semi.?senior|mid|ssr)/i.test(text)) {
    return 'mid';
  }
  if (/(junior|jr\.)/i.test(text)) {
    return 'junior';
  }
  return 'unknown';
}

function extractEnglishRequirement(text) {
  if (/(c1|c2|native english|fluent english|advanced english)/i.test(text)) {
    return 'advanced';
  }
  if (/(b2|intermediate english)/i.test(text)) {
    return 'intermediate';
  }
  if (/(b1|basic english)/i.test(text)) {
    return 'basic';
  }
  return 'unknown';
}

function extractModality(text) {
  return modalityPatterns
    .filter((entry) => entry.patterns.some((pattern) => text.includes(pattern)))
    .map((entry) => entry.value);
}

function extractSalary(text) {
  const match = text.match(/(usd|us\$|\$)\s?(\d{3,5})(?:\s?[-–]\s?(usd|us\$|\$)?\s?(\d{3,5}))?/i);
  if (!match) {
    return null;
  }

  return {
    currency: 'USD',
    min: Number(match[2]),
    max: match[4] ? Number(match[4]) : Number(match[2]),
    display: match[0],
  };
}

function extractRequirements(lines) {
  return lines
    .filter((line) => /^[-*•]/.test(line) || /(must|required|requisito|requirement)/i.test(line))
    .slice(0, 12);
}

function extractInstructions(lines) {
  return lines.filter((line) =>
    /(send your resume|send resume|enviar cv|enviar resume|apply here|postulate|postular)/i.test(line),
  );
}

function extractFlags(text) {
  return {
    requiresVisa: /(visa|work authorization|permiso de trabajo)/i.test(text),
    asksForSalary: /(salary expectation|pretension salarial|salary expectations)/i.test(text),
    legalQuestions: /(authorized to work|background check|drug test)/i.test(text),
    visibleContactCallToAction: /(hiring|send your resume|enviar cv|oportunidad laboral|estamos buscando)/i.test(text),
    requiresRelocation: /(relocation|relocate|reubicación)/i.test(text),
    requiresTravel: /(travel required|ability to travel|viajes?|travel occasionally)/i.test(text),
    requiresImmediateAvailability: /(immediate availability|join immediately|available asap|incorporación inmediata)/i.test(text),
  };
}

function certaintyFact(field, value, certainty, source) {
  return {
    field,
    value,
    certainty,
    source,
  };
}
