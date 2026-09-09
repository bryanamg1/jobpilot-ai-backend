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
  Python: ['python'],
  Java: ['java'],
  Jest: ['jest'],
  Supertest: ['supertest', 'super test'],
  'Socket.io': ['socket.io', 'socket io', 'socketio'],
  PHP: ['php'],
  WordPress: ['wordpress', 'word press'],
  AWS: ['aws', 'amazon web services'],
  GCP: ['gcp', 'google cloud platform', 'google cloud'],
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
const requirementSectionPatterns = {
  required: [
    /^(requirements?|must have|required|minimum requirements?|minimum qualifications?|qualifications?)\s*:?\s*$/i,
    /^(requisitos?|excluyentes?|obligatorios?)\s*:?\s*$/i,
  ],
  preferred: [
    /^(preferred qualifications?|nice to have|preferred|bonus points?|plus|desirable)\s*:?\s*$/i,
  ],
  responsibilities: [
    /^(responsibilities|what you'?ll do|you will|about the role|role overview)\s*:?\s*$/i,
  ],
  benefits: [
    /^(benefits?|perks?|what we offer|why join|why you'?ll love|our offer)\s*:?\s*$/i,
  ],
  optional: [/^(optional|nice to have|bonus points?|plus|desirable)\s*:?\s*$/i],
};
const inlinePreferredPatterns = [
  /\bpreferred qualifications?\b/i,
  /\bnice to have\b/i,
  /\bpreferred\b/i,
  /\bbonus\b/i,
  /\bplus\b/i,
  /\bfamiliarity with\b/i,
  /\bexposure to\b/i,
  /\bdesirable\b/i,
];
const inlineOptionalPatterns = [/\boptional\b/i];
const inlineRequiredPatterns = [
  /\brequired\b/i,
  /\bmust\b/i,
  /\bminimum\b/i,
  /\byou need\b/i,
  /\bmust have\b/i,
  /\bqualifications?\b/i,
  /\brequisitos?\b/i,
  /\bobligatorio\b/i,
  /\bexcluyente\b/i,
  /\bfluency in english\b/i,
];
const inlineResponsibilityPatterns = [/\bresponsib/i, /\byou will\b/i, /\bwhat you'?ll do\b/i, /\btareas?\b/i];
const inlineBenefitPatterns = [/\bbenefit\b/i, /\bperk\b/i, /\bwe offer\b/i, /\bwhy join\b/i, /\bour offer\b/i];
const labelOnlyPatterns = [
  /^requirements?\s*:?\s*$/i,
  /^requisitos?\s*:?\s*$/i,
  /^responsibilities\s*:?\s*$/i,
  /^benefits?\s*:?\s*$/i,
  /^preferred qualifications?\s*:?\s*$/i,
  /^nice to have\s*:?\s*$/i,
  /^optional\s*:?\s*$/i,
  /^qualifications?\s*:?\s*$/i,
];
const englishRequirementPatterns = [
  { level: 'advanced', patterns: [/\bc1\b/i, /\bc2\b/i, /\bnative english\b/i, /\badvanced english\b/i] },
  {
    level: 'fluent',
    patterns: [
      /\bb2\b/i,
      /\bupper[- ]intermediate english\b/i,
      /\bfluent english\b/i,
      /\bfluency in english\b/i,
      /\bfluent in english\b/i,
    ],
  },
  {
    level: 'intermediate',
    patterns: [/\bb1\b/i, /\bintermediate english\b/i, /\bconversational english\b/i],
  },
  { level: 'basic', patterns: [/\ba1\b/i, /\ba2\b/i, /\bbasic english\b/i] },
];

export function parseManualJob({ rawText, sourceUrl, sourceLabel, sourceType, structuredJob }) {
  const lines = toLines(rawText);

  const structuredHints = normalizeStructuredJobHints(structuredJob);
  const analysisText = buildAnalysisText(rawText, structuredHints);
  const analysisLines = toLines(analysisText);
  const titleCandidateLines = selectTitleCandidateLines(lines);
  const lowerText = analysisText.toLowerCase();
  const title = structuredHints.title ?? extractJobTitle(titleCandidateLines);
  const company = structuredHints.company ?? extractCompany(titleCandidateLines, title);
  const location = structuredHints.location ?? extractField(lines, ['ubicacion', 'ubicación', 'location']);
  const recruiterEmail = extractEmail(rawText);
  const technologies = structuredHints.technologies.length
    ? structuredHints.technologies
    : extractTechnologies(lowerText);
  const seniority = chooseKnownValue(structuredHints.seniority, extractSeniority(lowerText));
  const englishRequirement = extractEnglishRequirement(lowerText);
  const modality = structuredHints.modality.length ? structuredHints.modality : extractModality(lowerText);
  const salary = extractSalary(rawText);
  const sections = buildStructuredSections({
    analysisLines,
    structuredHints,
  });
  const technologyClaims = buildTechnologyClaims(sections.requirementItems);
  const requirements = sections.requirements.slice(0, 12);
  const flags = extractFlags(rawText.toLowerCase());

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
      preferredRequirements: sections.preferredRequirements.slice(0, 12),
      optionalRequirements: sections.optionalRequirements.slice(0, 12),
      responsibilities: sections.responsibilities.slice(0, 12),
      benefits: sections.benefits.slice(0, 12),
      requirementItems: sections.requirementItems.slice(0, 24),
      technologyClaims,
      instructions: extractInstructions(lines),
      certaintyMap: [
        certaintyFact(
          'title',
          title,
          title ? (structuredHints.title ? CERTAINTY.CONFIRMED : CERTAINTY.INFERRED) : CERTAINTY.UNKNOWN,
          structuredHints.title ? 'supervised_structured_capture' : 'manual_text_first_line',
        ),
        certaintyFact(
          'company',
          company,
          company ? (structuredHints.company ? CERTAINTY.CONFIRMED : CERTAINTY.INFERRED) : CERTAINTY.UNKNOWN,
          structuredHints.company ? 'supervised_structured_capture' : 'manual_text',
        ),
        certaintyFact(
          'location',
          location,
          location ? (structuredHints.location ? CERTAINTY.CONFIRMED : CERTAINTY.INFERRED) : CERTAINTY.UNKNOWN,
          structuredHints.location ? 'supervised_structured_capture' : 'manual_text',
        ),
        certaintyFact(
          'modality',
          modality.join(', '),
          modality.length
            ? structuredHints.modality.length
              ? CERTAINTY.CONFIRMED
              : CERTAINTY.INFERRED
            : CERTAINTY.UNKNOWN,
          structuredHints.modality.length ? 'supervised_structured_capture' : 'manual_text_keyword',
        ),
        certaintyFact(
          'seniority',
          seniority,
          seniority === 'unknown'
            ? CERTAINTY.UNKNOWN
            : structuredHints.seniority && structuredHints.seniority !== 'unknown'
              ? CERTAINTY.CONFIRMED
              : CERTAINTY.INFERRED,
          structuredHints.seniority && structuredHints.seniority !== 'unknown'
            ? 'supervised_structured_capture'
            : 'manual_text_keyword',
        ),
        certaintyFact(
          'englishRequirement',
          englishRequirement,
          englishRequirement === 'unknown' ? CERTAINTY.UNKNOWN : CERTAINTY.INFERRED,
          structuredHints.description ? 'structured_description_keyword' : 'manual_text_keyword',
        ),
        ...technologies.map((technology) =>
          certaintyFact(
            'technology',
            technology,
            structuredHints.technologies.length ? CERTAINTY.CONFIRMED : CERTAINTY.INFERRED,
            structuredHints.technologies.length ? 'supervised_structured_capture' : 'manual_text_keyword',
          ),
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

function selectTitleCandidateLines(lines) {
  const firstSectionIndex = lines.findIndex((line) => /^(description|responsibilities|requirements|benefits)\s*:/i.test(line));
  return firstSectionIndex > 0 ? lines.slice(0, firstSectionIndex) : lines;
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
  for (const entry of englishRequirementPatterns) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.level;
    }
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

function normalizeStructuredJobHints(structuredJob) {
  if (!structuredJob || typeof structuredJob !== 'object') {
    return {
      title: null,
      company: null,
      location: null,
      modality: [],
      seniority: null,
      technologies: [],
      requirements: [],
      description: null,
      responsibilities: [],
      benefits: [],
    };
  }

  return {
    title: cleanScalar(structuredJob.title),
    company: cleanCompany(structuredJob.company),
    location: cleanScalar(structuredJob.location),
    modality: cleanStringArray(structuredJob.modality),
    seniority: cleanScalar(structuredJob.seniority),
    technologies: cleanStringArray(structuredJob.technologies).map(normalizeTechnology),
    requirements: cleanStringArray(structuredJob.requirements),
    description: cleanMultilineText(structuredJob.description),
    responsibilities: cleanStringArray(structuredJob.responsibilities),
    benefits: cleanStringArray(structuredJob.benefits),
  };
}

function buildAnalysisText(rawText, structuredHints) {
  const prioritized = [
    structuredHints.description,
    ...structuredHints.requirements,
    ...structuredHints.responsibilities,
    ...structuredHints.benefits,
  ].filter(Boolean);

  return prioritized.length ? prioritized.join('\n') : rawText;
}

function toLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildStructuredSections({ analysisLines, structuredHints }) {
  const buckets = {
    requirements: [],
    preferredRequirements: [],
    optionalRequirements: [],
    responsibilities: [],
    benefits: [],
    requirementItems: [],
  };

  for (const value of structuredHints.requirements) {
    appendRequirementCandidate(buckets, value, inferRequirementLevel(value, 'required'));
  }
  for (const value of structuredHints.responsibilities) {
    appendUnique(buckets.responsibilities, value);
  }
  for (const value of structuredHints.benefits) {
    appendUnique(buckets.benefits, value);
  }

  let currentSection = 'general';
  for (const line of analysisLines) {
    const headingCandidate = cleanScalar(line);
    const sectionType = headingCandidate ? classifySectionHeading(headingCandidate) : null;
    if (sectionType) {
      currentSection = sectionType;
      continue;
    }

    const cleaned = cleanRequirementLikeText(line);
    if (!cleaned) {
      continue;
    }

    if (isLabelOnly(cleaned)) {
      continue;
    }

    if (currentSection === 'responsibilities' || inlineResponsibilityPatterns.some((pattern) => pattern.test(cleaned))) {
      appendUnique(buckets.responsibilities, cleaned);
      continue;
    }

    if (currentSection === 'benefits' || inlineBenefitPatterns.some((pattern) => pattern.test(cleaned))) {
      appendUnique(buckets.benefits, cleaned);
      continue;
    }

    const requirementLevel = inferRequirementLevel(cleaned, currentSection);
    if (requirementLevel !== 'none') {
      appendRequirementCandidate(buckets, cleaned, requirementLevel);
    }
  }

  buckets.requirementItems = dedupeRequirementItems(buckets.requirementItems);
  buckets.requirements = dedupeStrings(buckets.requirementItems.filter((item) => item.level === 'required').map((item) => item.text));
  buckets.preferredRequirements = dedupeStrings(
    buckets.requirementItems.filter((item) => item.level === 'preferred').map((item) => item.text),
  );
  buckets.optionalRequirements = dedupeStrings(
    buckets.requirementItems.filter((item) => item.level === 'optional').map((item) => item.text),
  );
  buckets.responsibilities = dedupeStrings(buckets.responsibilities);
  buckets.benefits = dedupeStrings(buckets.benefits);

  return buckets;
}

function classifySectionHeading(line) {
  for (const [section, patterns] of Object.entries(requirementSectionPatterns)) {
    if (patterns.some((pattern) => pattern.test(line))) {
      return section;
    }
  }
  return null;
}

function isLabelOnly(line) {
  return labelOnlyPatterns.some((pattern) => pattern.test(line));
}

function inferRequirementLevel(line, currentSection) {
  if (currentSection === 'optional') {
    return 'optional';
  }
  if (currentSection === 'preferred') {
    return 'preferred';
  }
  if (currentSection === 'required') {
    return 'required';
  }
  if (inlineOptionalPatterns.some((pattern) => pattern.test(line))) {
    return 'optional';
  }
  if (inlinePreferredPatterns.some((pattern) => pattern.test(line))) {
    return 'preferred';
  }
  if (inlineRequiredPatterns.some((pattern) => pattern.test(line))) {
    return 'required';
  }
  if (/\bexperience\b/i.test(line) && !inlineBenefitPatterns.some((pattern) => pattern.test(line))) {
    return currentSection === 'general' ? 'optional' : 'required';
  }
  return 'none';
}

function appendRequirementCandidate(buckets, text, level) {
  const cleaned = cleanRequirementLikeText(text);
  if (!cleaned || level === 'none') {
    return;
  }

  buckets.requirementItems.push({
    text: cleaned,
    level,
  });
}

function cleanRequirementLikeText(value) {
  const cleaned = cleanScalar(String(value ?? '').replace(/^[-*•]\s*/, ''));
  if (!cleaned) {
    return null;
  }
  if (labelOnlyPatterns.some((pattern) => pattern.test(cleaned))) {
    return null;
  }
  if (cleaned.length > 280) {
    return null;
  }
  return cleaned;
}

function appendUnique(target, value) {
  const cleaned = cleanRequirementLikeText(value);
  if (!cleaned) {
    return;
  }
  if (!target.includes(cleaned)) {
    target.push(cleaned);
  }
}

function dedupeRequirementItems(items) {
  return items.filter(
    (entry, index, list) =>
      index === list.findIndex((candidate) => candidate.text.toLowerCase() === entry.text.toLowerCase() && candidate.level === entry.level),
  );
}

function buildTechnologyClaims(requirementItems) {
  const claims = [];
  let alternativeGroupIndex = 0;

  for (const item of requirementItems) {
    const technologies = extractTechnologies(item.text.toLowerCase());
    if (!technologies.length) {
      continue;
    }

    const relationship = isAlternativeRequirement(item.text, technologies) ? 'alternative' : 'all';
    const alternativeGroup = relationship === 'alternative' ? `alt-${++alternativeGroupIndex}` : null;
    for (const technology of technologies) {
      claims.push({
        technology,
        requirementLevel: item.level,
        certainty: CERTAINTY.INFERRED,
        relationship,
        alternativeGroup,
        evidence: item.text,
      });
    }
  }

  return claims.filter(
    (entry, index, list) =>
      index ===
      list.findIndex(
        (candidate) =>
          candidate.technology === entry.technology &&
          candidate.requirementLevel === entry.requirementLevel &&
          candidate.relationship === entry.relationship &&
          candidate.evidence === entry.evidence,
      ),
  );
}

function isAlternativeRequirement(text, technologies) {
  if (technologies.length < 2) {
    return false;
  }

  return /\/|\bor\b|\betc\.?\b|\bsuch as\b|\blike\b/i.test(text);
}

function dedupeStrings(values = []) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function cleanStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map(cleanScalar).filter(Boolean))];
}

function normalizeToken(value) {
  return String(value)
    .toLowerCase()
    .replace(/[.\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chooseKnownValue(currentValue, nextValue) {
  if (currentValue && currentValue !== 'unknown') {
    return currentValue;
  }

  return nextValue && nextValue !== 'unknown' ? nextValue : currentValue;
}

function cleanScalar(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function cleanMultilineText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

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
