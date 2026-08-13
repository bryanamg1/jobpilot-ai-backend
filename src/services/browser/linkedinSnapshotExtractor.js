import { normalizeTechnology } from '../manualIntake/manualJobParser.js';

const DEFAULT_MAX_CAPTURE_CHARS = 20_000;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const HIRING_SIGNAL_PATTERNS = [
  { token: 'hiring', pattern: /\bhiring\b/u },
  { token: 'send_your_resume', pattern: /send (your )?(resume|cv)/u },
  { token: 'enviar_cv', pattern: /enviar (cv|resume|curriculum)/u },
  { token: 'oportunidad_laboral', pattern: /oportunidad laboral/u },
  { token: 'estamos_buscando', pattern: /estamos buscando/u },
  { token: 'busqueda_activa', pattern: /\bbusqueda activa\b/u },
  { token: 'escribeme_por_privado', pattern: /escribeme por privado/u },
  { token: 'apply_here', pattern: /apply here/u },
  { token: 'dm_me', pattern: /\b(dm|direct message|message me)\b/u },
];

const NOISE_PATTERNS = [
  /\bpremium\b/i,
  /\bmeet the hiring team\b/i,
  /\bpeople you can reach out to\b/i,
  /\bset alert\b/i,
  /\bshow more\b/i,
  /\bshow less\b/i,
  /\bsee who linkedin knows\b/i,
  /\btry premium\b/i,
  /\bpromoted\b/i,
  /\badvertisement\b/i,
  /\bjobs you may be interested in\b/i,
];

const TECHNOLOGY_GROUPS = {
  frameworks: new Set(['React', 'Express', 'Vite', 'React Router', 'Socket.io', 'WordPress']),
  databases: new Set(['MySQL', 'MongoDB', 'Redis']),
  tools: new Set(['Docker', 'Jest', 'Supertest', 'Git', 'GitHub', 'Figma', 'AWS', 'Terraform']),
};

export async function captureLinkedInSnapshot(page, options = {}) {
  const maxCaptureChars = options.maxCaptureChars ?? DEFAULT_MAX_CAPTURE_CHARS;
  const debug = typeof options.debug === 'function' ? options.debug : null;
  const raw = await page.evaluate(extractSnapshotPayloadInPage, maxCaptureChars);
  const snapshot = normalizeSnapshotPayload(raw, maxCaptureChars);

  if (debug && snapshot.extractedJob) {
    debug('linkedin_snapshot.extracted', {
      url: snapshot.url,
      fields: summarizeFieldQuality(snapshot.extractedJob.quality),
      technologies: snapshot.extractedJob.technologies.length,
    });
  }

  return snapshot;
}

export function buildStructuredCaptureText(snapshot, providerLabel) {
  const sections = [
    `Source: ${providerLabel ?? 'LinkedIn supervised session'}`,
    `Captured URL: ${snapshot.url}`,
  ];

  if (snapshot.extractedJob) {
    const job = snapshot.extractedJob;
    appendLabeledLine(sections, 'Title', job.title);
    appendLabeledLine(sections, 'Company', job.company);
    appendLabeledLine(sections, 'Location', job.location);
    appendLabeledLine(sections, 'Modality', joinValues(job.modality));
    appendLabeledLine(sections, 'Employment type', job.employmentType);
    appendLabeledLine(sections, 'Seniority', job.seniority);
    appendLabeledLine(sections, 'Technologies', joinValues(job.technologies));
    appendLabeledLine(sections, 'Frameworks', joinValues(job.frameworks));
    appendLabeledLine(sections, 'Databases', joinValues(job.databases));
    appendLabeledLine(sections, 'Tools', joinValues(job.tools));
    appendLabeledLine(sections, 'Languages', joinValues(job.languages));
    appendLabeledLine(sections, 'Recruiter', job.recruiter);
    appendLabeledLine(sections, 'Posted at', job.postedAt);
    appendLabeledLine(sections, 'Applicants', job.applicantsCount);
    appendLabeledLine(sections, 'Apply mode', job.applyMode);
    appendLabeledLine(sections, 'Salary', job.salary);

    appendListSection(sections, 'Responsibilities', job.responsibilities);
    appendListSection(sections, 'Requirements', job.requirements);
    appendListSection(sections, 'Benefits', job.benefits);
  }

  if (snapshot.hiringSignals.length) {
    sections.push(`Visible hiring signals: ${snapshot.hiringSignals.join(', ')}`);
  }

  if (snapshot.visibleEmails.length) {
    sections.push(`Visible contact emails: ${snapshot.visibleEmails.join(', ')}`);
  }

  if (snapshot.extractedJob?.description) {
    sections.push('Description:');
    sections.push(snapshot.extractedJob.description);
  } else {
    sections.push(snapshot.visibleText);
  }

  return sections.join('\n');
}

function extractSnapshotPayloadInPage(limit) {
  const documentRef = globalThis.document;
  const main = documentRef.querySelector('main') ?? documentRef.body;

  const toText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const readText = (selector) => {
    const node = documentRef.querySelector(selector);
    return toText(node?.textContent ?? '');
  };
  const readTexts = (selectors) => {
    const values = [];
    for (const selector of selectors) {
      for (const node of documentRef.querySelectorAll(selector)) {
        const text = toText(node.textContent);
        if (text) {
          values.push(text);
        }
      }
    }
    return [...new Set(values)];
  };
  const readAriaLabels = () =>
    [...main.querySelectorAll('[aria-label]')]
      .map((node) => toText(node.getAttribute('aria-label')))
      .filter(Boolean)
      .slice(0, 80);
  const readApplyButtons = () =>
    [...main.querySelectorAll('button, a[role="button"], a')]
      .map((node) => toText(node.textContent || node.getAttribute('aria-label')))
      .filter(Boolean)
      .filter((text) => /apply|postular|solicitud|easy apply/i.test(text))
      .slice(0, 20);
  const readJsonLd = () => {
    for (const node of documentRef.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(node.textContent ?? '{}');
        const collection = Array.isArray(parsed) ? parsed : [parsed];
        const match = collection.find((item) => {
          const type = String(item?.['@type'] ?? '').toLowerCase();
          return type.includes('jobposting');
        });
        if (match) {
          return {
            title: toText(match.title),
            company: toText(match.hiringOrganization?.name),
            location: toText(
              match.jobLocation?.address?.addressLocality ||
                match.jobLocation?.address?.addressRegion ||
                match.jobLocation?.address?.addressCountry,
            ),
            employmentType: toText(
              Array.isArray(match.employmentType) ? match.employmentType.join(', ') : match.employmentType,
            ),
            datePosted: toText(match.datePosted),
            description: toText(match.description),
            salary: toText(match.baseSalary?.value?.value || match.baseSalary?.value?.minValue || match.baseSalary),
          };
        }
      } catch {
        // ignore invalid json-ld
      }
    }

    return null;
  };

  return {
    title: toText(documentRef.title),
    url: String(globalThis.location?.href ?? ''),
    visibleText: toText(main.innerText).slice(0, limit),
    selectors: {
      h1: readText('main h1'),
      titleCandidates: readTexts([
        'main h1',
        '[data-test-job-title]',
        '[class*="job-details-jobs-unified-top-card__job-title"]',
        '[class*="jobs-unified-top-card__job-title"]',
      ]),
      companyCandidates: readTexts([
        '[class*="job-details-jobs-unified-top-card__company-name"]',
        '[class*="jobs-unified-top-card__company-name"]',
        '[class*="job-details-jobs-unified-top-card__primary-description"] a',
      ]),
      metadataItems: readTexts([
        '[class*="job-details-jobs-unified-top-card__primary-description-container"] span',
        '[class*="job-details-jobs-unified-top-card__tertiary-description-container"] span',
        '[class*="job-details-jobs-unified-top-card__job-insight"]',
        '[class*="jobs-unified-top-card__subtitle-primary-grouping"] span',
        '[class*="jobs-unified-top-card__subtitle-secondary-grouping"] span',
      ]),
      description: readText(
        '.jobs-description, .jobs-box__html-content, [class*="jobs-description-content"], [data-job-id] [class*="description"]',
      ),
      descriptionBlocks: readTexts([
        '.jobs-description li',
        '.jobs-description p',
        '.jobs-box__html-content li',
        '.jobs-box__html-content p',
        '[class*="jobs-description-content"] li',
        '[class*="jobs-description-content"] p',
      ]),
      recruiter: readText('[href*="/in/"][class*="app-aware-link"], [href*="/in/"]'),
      ariaLabels: readAriaLabels(),
      applyButtons: readApplyButtons(),
    },
    jsonLd: readJsonLd(),
  };
}

function normalizeSnapshotPayload(raw, maxCaptureChars) {
  const title = cleanText(raw?.title);
  const url = String(raw?.url ?? '');
  const visibleText = cleanText(raw?.visibleText).slice(0, maxCaptureChars);
  const normalizedUrl = url.toLowerCase();
  const normalizedText = `${title} ${visibleText}`.toLowerCase();
  const attentionReasons = [];
  const isLinkedIn = normalizedUrl.includes('linkedin.com');
  const isJobsSection = normalizedUrl.includes('linkedin.com/jobs');
  const isJobView = /linkedin\.com\/jobs\/view/u.test(normalizedUrl);
  const isFeedSection = normalizedUrl.includes('linkedin.com/feed');
  const isPostSearchSection = normalizedUrl.includes('linkedin.com/search/results/content');
  const isPostDetail =
    normalizedUrl.includes('linkedin.com/feed/update/') || normalizedUrl.includes('linkedin.com/posts/');
  const visibleEmails = [...new Set(visibleText.match(EMAIL_PATTERN)?.map((item) => item.toLowerCase()) ?? [])];
  const hiringSignals = HIRING_SIGNAL_PATTERNS.filter(({ pattern }) => pattern.test(normalizedText)).map(
    ({ token }) => token,
  );

  if (!isLinkedIn) {
    attentionReasons.push('UNSUPPORTED_DOMAIN');
  }

  if (/captcha|security verification|checkpoint|two-step|verification required/u.test(normalizedText)) {
    attentionReasons.push('CAPTCHA_OR_CHALLENGE');
  }

  if (/sign in|log in/u.test(normalizedText) && normalizedText.includes('linkedin')) {
    attentionReasons.push('LOGIN_REQUIRED');
  }

  const extractedJob = isJobsSection ? extractStructuredJob(raw, visibleText) : null;
  const usefulVisibleText = extractedJob
    ? buildUsefulVisibleText(extractedJob, visibleText, maxCaptureChars)
    : visibleText;

  return {
    title,
    url,
    visibleText: usefulVisibleText,
    capturedAt: new Date().toISOString(),
    isLinkedIn,
    isJobsSection,
    isJobView,
    isFeedSection,
    isPostSearchSection,
    isPostDetail,
    hiringSignals,
    visibleEmails,
    requiresAttention: attentionReasons.length > 0,
    attentionReasons,
    extractedJob,
  };
}

function extractStructuredJob(raw, fallbackText) {
  const selectors = raw?.selectors ?? {};
  const jsonLd = raw?.jsonLd ?? {};
  const metadataText = joinValues(selectors.metadataItems);
  const description = chooseText([
    candidate(selectors.description, 'HIGH', 'selector:description'),
    candidate(jsonLd.description, 'MEDIUM', 'metadata:jsonld'),
    candidate(fallbackText, 'LOW', 'visible_text'),
  ]);
  const title = chooseText([
    candidate(selectors.h1, 'HIGH', 'selector:h1'),
    ...selectors.titleCandidates.map((value) => candidate(value, 'HIGH', 'selector:title')),
    candidate(jsonLd.title, 'MEDIUM', 'metadata:jsonld'),
    candidate(findRoleFromText(fallbackText), 'LOW', 'visible_text'),
  ]);
  const company = chooseText([
    ...selectors.companyCandidates.map((value) => candidate(cleanCompany(value), 'HIGH', 'selector:company')),
    candidate(cleanCompany(jsonLd.company), 'MEDIUM', 'metadata:jsonld'),
  ]);
  const location = chooseText([
    candidate(findLocation(metadataText), 'HIGH', 'selector:metadata'),
    candidate(cleanText(jsonLd.location), 'MEDIUM', 'metadata:jsonld'),
    candidate(findLocation(description.value), 'LOW', 'description'),
  ]);
  const modality = dedupeStrings([
    ...extractModalities(metadataText),
    ...extractModalities(description.value),
  ]);
  const technologies = dedupeTechnologies(`${metadataText}\n${description.value}\n${joinValues(selectors.ariaLabels)}`);
  const frameworks = technologies.filter((item) => TECHNOLOGY_GROUPS.frameworks.has(item));
  const databases = technologies.filter((item) => TECHNOLOGY_GROUPS.databases.has(item));
  const tools = technologies.filter((item) => TECHNOLOGY_GROUPS.tools.has(item));
  const languages = dedupeStrings(extractLanguages(`${metadataText}\n${description.value}`));
  const seniority = chooseText([
    candidate(findSeniority(`${metadataText}\n${title.value}`), 'HIGH', 'selector:metadata'),
    candidate(findSeniority(description.value), 'LOW', 'description'),
  ]);
  const employmentType = chooseText([
    candidate(findEmploymentType(metadataText), 'HIGH', 'selector:metadata'),
    candidate(cleanText(jsonLd.employmentType), 'MEDIUM', 'metadata:jsonld'),
    candidate(findEmploymentType(description.value), 'LOW', 'description'),
  ]);
  const recruiter = chooseText([
    candidate(cleanPerson(selectors.recruiter), 'MEDIUM', 'selector:recruiter'),
  ]);
  const postedAt = chooseText([
    candidate(findPostedAt(metadataText), 'HIGH', 'selector:metadata'),
    candidate(cleanText(jsonLd.datePosted), 'MEDIUM', 'metadata:jsonld'),
  ]);
  const applicantsCount = chooseText([
    candidate(findApplicants(metadataText), 'HIGH', 'selector:metadata'),
    candidate(findApplicants(description.value), 'LOW', 'description'),
  ]);
  const salary = chooseText([
    candidate(findSalary(`${metadataText}\n${description.value}`), 'MEDIUM', 'text'),
    candidate(cleanText(jsonLd.salary), 'MEDIUM', 'metadata:jsonld'),
  ]);
  const applyMode = chooseApplyMode(selectors.applyButtons);
  const sections = splitDescriptionSections(description.value, selectors.descriptionBlocks);

  return {
    title: title.value,
    company: company.value,
    location: location.value,
    modality,
    employmentType: employmentType.value,
    seniority: seniority.value,
    technologies,
    frameworks,
    databases,
    tools,
    languages,
    responsibilities: sections.responsibilities,
    requirements: sections.requirements,
    benefits: sections.benefits,
    recruiter: recruiter.value,
    postedAt: postedAt.value,
    applyMode,
    applicantsCount: applicantsCount.value,
    salary: salary.value,
    description: description.value,
    quality: {
      title: pickQuality(title, technologies.length > 0),
      company: company.quality ?? 'LOW',
      location: location.quality ?? 'LOW',
      modality: modality.length ? 'MEDIUM' : 'LOW',
      description: description.quality ?? 'LOW',
      technologies: technologies.length >= 3 ? 'HIGH' : technologies.length ? 'MEDIUM' : 'LOW',
    },
    debugSources: {
      title: title.source ?? null,
      company: company.source ?? null,
      location: location.source ?? null,
      description: description.source ?? null,
      technologies: technologies.length ? 'description+metadata' : null,
    },
  };
}

function buildUsefulVisibleText(job, fallbackText, maxCaptureChars) {
  const sections = [
    job.title,
    job.company,
    job.location,
    joinValues(job.modality),
    job.employmentType,
    job.seniority,
    job.salary,
    job.postedAt,
    job.applicantsCount,
    job.applyMode,
    job.recruiter,
    joinValues(job.technologies),
    ...job.requirements,
    ...job.responsibilities,
    ...job.benefits,
    job.description,
    fallbackText,
  ];

  return dedupeStrings(
    sections
      .map(cleanText)
      .filter(Boolean)
      .filter((value) => !NOISE_PATTERNS.some((pattern) => pattern.test(value))),
  )
    .join('\n')
    .slice(0, maxCaptureChars);
}

function splitDescriptionSections(description, descriptionBlocks = []) {
  const lines = dedupeStrings(
    [description, ...descriptionBlocks]
      .flatMap((value) => String(value ?? '').split(/\n+/))
      .map(cleanText)
      .filter(Boolean)
      .filter((value) => !NOISE_PATTERNS.some((pattern) => pattern.test(value))),
  );

  const requirements = lines.filter((line) => /required|requirements|must|experience|requisit/i.test(line)).slice(0, 10);
  const responsibilities = lines.filter((line) => /responsib|you will|what you'?ll do|tareas/i.test(line)).slice(0, 10);
  const benefits = lines.filter((line) => /benefit|perk|offer|we provide|why you/i.test(line)).slice(0, 10);

  return { requirements, responsibilities, benefits };
}

function chooseApplyMode(values = []) {
  const joined = joinValues(values).toLowerCase();
  if (/easy apply|solicitud sencilla|solicitud simplificada/.test(joined)) {
    return 'EASY_APPLY';
  }
  if (/apply|postular|postulate|solicitar/.test(joined)) {
    return 'EXTERNAL_APPLY';
  }
  return null;
}

function extractModalities(text) {
  const normalized = String(text ?? '').toLowerCase();
  const modes = [];
  if (/\bremote\b|\bremoto\b/.test(normalized)) {
    modes.push('remote');
  }
  if (/\bhybrid\b|\bhibrido\b|\bhibrido\b/.test(normalized)) {
    modes.push('hybrid');
  }
  if (/\bonsite\b|\bon site\b|\bpresencial\b/.test(normalized)) {
    modes.push('onsite');
  }
  return modes;
}

function extractLanguages(text) {
  const normalized = String(text ?? '').toLowerCase();
  const languages = [];
  if (/\benglish\b|\bingles\b/.test(normalized)) {
    languages.push('English');
  }
  if (/\bspanish\b|\bespanol\b/.test(normalized)) {
    languages.push('Spanish');
  }
  return languages;
}

function dedupeTechnologies(text) {
  const values = new Set();
  const normalizedText = String(text ?? '').toLowerCase();

  for (const token of [
    'JavaScript',
    'TypeScript',
    'Node.js',
    'Express',
    'React',
    'Vite',
    'React Router',
    'MySQL',
    'MongoDB',
    'Redis',
    'Docker',
    'Jest',
    'Supertest',
    'Socket.io',
    'PHP',
    'WordPress',
    'AWS',
    'Terraform',
    'Figma',
    'Git',
    'GitHub',
  ]) {
    const canonical = normalizeTechnology(token);
    if (hasWholeTerm(normalizedText, canonical)) {
      values.add(canonical);
    }
  }

  for (const alias of normalizedText.match(/\b[a-z0-9.+#-]{2,30}\b/gu) ?? []) {
    const canonical = normalizeTechnology(alias);
    if (canonical !== alias || canonical === 'JavaScript' || canonical === 'Node.js' || canonical === 'React') {
      values.add(canonical);
    }
  }

  return [...values].filter(Boolean);
}

function hasWholeTerm(text, value) {
  const normalized = String(value ?? '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9+.#-])${normalized}([^a-z0-9+.#-]|$)`, 'i').test(text);
}

function findRoleFromText(text) {
  return dedupeStrings(String(text ?? '').split(/\n+/))
    .find((line) => /(developer|engineer|frontend|backend|full stack|software|devops|designer|analyst)/i.test(line));
}

function findLocation(text) {
  const value = cleanText(text);
  const match = value.match(/(remote|remoto|hybrid|hibrido|onsite|presencial|buenos aires|argentina|latam|latin america|mexico|colombia|spain|usa|united states)/i);
  return match ? cleanText(match[0]) : null;
}

function findSeniority(text) {
  const value = String(text ?? '');
  if (/\bjunior\b|\bjr\b/i.test(value)) {
    return 'junior';
  }
  if (/\bsemi\s?senior\b|\bssr\b|\bmid\b/i.test(value)) {
    return 'mid';
  }
  if (/\bsenior\b|\bsr\b/i.test(value)) {
    return 'senior';
  }
  if (/\blead\b|\bstaff\b|\bprincipal\b/i.test(value)) {
    return 'lead';
  }
  return null;
}

function findEmploymentType(text) {
  const value = String(text ?? '');
  if (/\bfull[- ]?time\b|\btiempo completo\b/i.test(value)) {
    return 'full-time';
  }
  if (/\bpart[- ]?time\b|\bmedio tiempo\b/i.test(value)) {
    return 'part-time';
  }
  if (/\bcontract\b|\bcontractor\b|\bcontrato\b/i.test(value)) {
    return 'contract';
  }
  if (/\bfreelance\b/i.test(value)) {
    return 'freelance';
  }
  return null;
}

function findPostedAt(text) {
  const value = cleanText(text);
  const match = value.match(/(\d+\+?\s+(applicants?|postulantes))|(posted\s+\d+\s+\w+\s+ago)|(\d+\s+(day|days|hour|hours|week|weeks)\s+ago)/i);
  return match ? cleanText(match[0]) : null;
}

function findApplicants(text) {
  const match = String(text ?? '').match(/\d+\+?\s+(applicants?|postulantes)/i);
  return match ? cleanText(match[0]) : null;
}

function findSalary(text) {
  const match = String(text ?? '').match(/(usd|us\$|\$)\s?\d{3,6}(?:\s?[-–]\s?(usd|us\$|\$)?\s?\d{3,6})?/i);
  return match ? cleanText(match[0]) : null;
}

function cleanCompany(value) {
  const text = cleanText(value);
  if (!text || /^(we are|estamos|somos|buscamos|hiring)\b/i.test(text)) {
    return null;
  }
  return text;
}

function cleanPerson(value) {
  const text = cleanText(value);
  if (!text || /^view all/i.test(text)) {
    return null;
  }
  return text;
}

function candidate(value, quality, source) {
  return {
    value: cleanText(value),
    quality,
    source,
  };
}

function chooseText(candidates) {
  return candidates.find((entry) => entry?.value) ?? { value: null, quality: 'LOW', source: null };
}

function appendLabeledLine(lines, label, value) {
  if (!value) {
    return;
  }
  lines.push(`${label}: ${value}`);
}

function appendListSection(lines, label, values = []) {
  if (!values.length) {
    return;
  }

  lines.push(`${label}:`);
  for (const value of values) {
    lines.push(`- ${value}`);
  }
}

function joinValues(values) {
  return Array.isArray(values) ? values.filter(Boolean).join(', ') : values ?? null;
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeStrings(values) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function pickQuality(field, hasSupportingSignals) {
  if (field.quality === 'HIGH' && hasSupportingSignals) {
    return 'HIGH';
  }
  return field.quality ?? 'LOW';
}

function summarizeFieldQuality(quality = {}) {
  return Object.fromEntries(Object.entries(quality).filter(([, value]) => value));
}
