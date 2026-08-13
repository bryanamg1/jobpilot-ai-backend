import { CERTAINTY } from '../../constants/certainty.js';
import { normalizeUrl } from '../../lib/fingerprint.js';

const technologyAliases = {
  'JavaScript': ['javascript', 'js', 'javascript es6+', 'ecmascript', 'es6'],
  'TypeScript': ['typescript', 'ts'],
  'Node.js': ['node.js', 'nodejs', 'node js', 'node'],
  Express: ['express', 'express.js', 'expressjs'],
  React: ['react', 'react.js', 'reactjs'],
  Vite: ['vite'],
  'React Router': ['react router', 'react-router', 'reactrouter'],
  MySQL: ['mysql', 'my sql'],
  MongoDB: ['mongodb', 'mongo db', 'mongo'],
  Redis: ['redis'],
  Docker: ['docker'],
  Jest: ['jest'],
  Supertest: ['supertest', 'super test'],
  'Socket.io': ['socket.io', 'socket io', 'socketio'],
  PHP: ['php'],
  WordPress: ['wordpress', 'word press'],
  AWS: ['aws', 'amazon web services'],
  Terraform: ['terraform'],
  Figma: ['figma'],
  Git: ['git'],
  GitHub: ['github', 'git hub'],
};

const ignoredTitlePatterns = [
  /^source:/i,
  /^captured url:/i,
  /^linkedin jobs$/i,
  /^linkedin$/i,
  /^empleos?$/i,
  /^jobs$/i,
  /^apply now$/i,
  /^easy apply$/i,
  /^hiring$/i,
];

const companyFallbackPatterns = [/^(we are|estamos|somos|buscamos|hiring)\b/i];

const modalityPatterns = [
  { value: 'remote', patterns: ['remote', 'remoto'] },
  { value: 'hybrid', patterns: ['hybrid', 'hibrido', 'híbrido'] },
  { value: 'onsite', patterns: ['onsite', 'presencial', 'on site'] },
];

export function parseManualJob({ rawText, sourceUrl, sourceLabel, sourceType }) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const lowerText = rawText.toLowerCase();
  const title = extractJobTitle(lines);
  const company = extractCompany(lines, title);
  const location = extractField(lines, ['ubicacion', 'ubicación', 'location']);
  const recruiterEmail = extractEmail(rawText);
  const technologies = extractTechnologies(lowerText);
  const seniority = extractSeniority(lowerText);
  const englishRequirement = extractEnglishRequirement(lowerText);
  const modality = extractModality(lowerText);
  const salary = extractSalary(rawText);
  const requirements = extractRequirements(lines);
  const flags = extractFlags(lowerText);

  return {
    source: {
      type: sourceType || sourceTypeOrDefault(sourceLabel),
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
          title ? CERTAINTY.INFERRED : CERTAINTY.UNKNOWN,
          'manual_text_first_line',
        ),
        certaintyFact(
          'company',
          company,
          company ? CERTAINTY.INFERRED : CERTAINTY.UNKNOWN,
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

function sourceTypeOrDefault(sourceLabel) {
  if (sourceLabel?.includes('LinkedIn Jobs')) {
    return 'LINKEDIN_JOBS_SUPERVISED';
  }
  if (sourceLabel?.includes('LinkedIn Feed')) {
    return 'LINKEDIN_FEED_SUPERVISED';
  }
  if (sourceLabel?.includes('LinkedIn post search')) {
    return 'LINKEDIN_POST_SEARCH_SUPERVISED';
  }
  return 'MANUAL';
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

function extractJobTitle(lines) {
  const labeledTitle = extractField(lines, ['puesto', 'role', 'position', 'job title', 'title', 'cargo']);
  if (labeledTitle) {
    return cleanScalar(labeledTitle);
  }

  const bestLine = lines.find((line) => isLikelyTitleLine(line));
  return cleanScalar(bestLine);
}

function extractCompany(lines, title) {
  const labeledCompany = extractField(lines, ['empresa', 'company', 'compania', 'compañía']);
  if (labeledCompany) {
    return cleanCompany(labeledCompany);
  }

  const lineWithAt = lines.find((line) => /\bat\s+.+/i.test(line));
  if (lineWithAt) {
    const match = lineWithAt.match(/\bat\s+(.+)$/i);
    const company = cleanCompany(match?.[1]);
    if (company && company !== title) {
      return company;
    }
  }

  return null;
}

function extractEmail(text) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

export function normalizeTechnology(term) {
  const normalizedKey = normalizeToken(term);

  for (const [canonical, aliases] of Object.entries(technologyAliases)) {
    if ([canonical, ...aliases].some((item) => normalizeToken(item) === normalizedKey)) {
      return canonical;
    }
  }

  return cleanScalar(term) ?? term;
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

function extractTechnologies(text) {
  const detected = [];

  for (const [canonical, aliases] of Object.entries(technologyAliases)) {
    const variants = [canonical, ...aliases];
    if (variants.some((variant) => hasWholeTerm(text, variant))) {
      detected.push(canonical);
    }
  }

  return detected;
}

function hasWholeTerm(text, value) {
  const escaped = escapeRegExp(value).replaceAll('\\ ', '\\s+');
  return new RegExp(`(^|[^a-z0-9+.#-])${escaped}([^a-z0-9+.#-]|$)`, 'i').test(text);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeToken(value) {
  return String(value)
    .toLowerCase()
    .replace(/[.\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanScalar(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function cleanCompany(value) {
  const cleaned = cleanScalar(value);
  if (!cleaned) {
    return null;
  }

  if (companyFallbackPatterns.some((pattern) => pattern.test(cleaned))) {
    return null;
  }

  return cleaned;
}

function isLikelyTitleLine(line) {
  const cleaned = cleanScalar(line);
  if (!cleaned || ignoredTitlePatterns.some((pattern) => pattern.test(cleaned))) {
    return false;
  }

  if (/^https?:\/\//i.test(cleaned)) {
    return false;
  }

  if (extractEmail(cleaned)) {
    return false;
  }

  if (cleaned.length < 6 || cleaned.length > 120) {
    return false;
  }

  if (/(send your resume|enviar cv|apply here|postulate|postular|benefits|responsibilities)/i.test(cleaned)) {
    return false;
  }

  return /(developer|engineer|frontend|backend|full stack|software|react|node|javascript|typescript|devops|analyst|designer)/i.test(
    cleaned,
  );
}
