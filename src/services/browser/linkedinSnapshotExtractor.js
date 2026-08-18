import { normalizeTechnology } from '../manualIntake/manualJobParser.js';

const DEFAULT_MAX_CAPTURE_CHARS = 20_000;
const CAPTURE_MODE = {
  PASSIVE: 'passive',
  JOB_CAPTURE: 'job_capture',
};
const MIN_JOB_DESCRIPTION_TEXT_LENGTH = 80;
const JOB_CAPTURE_GLOBAL_TIMEOUT_MS = 10_000;
const JOB_CAPTURE_POLL_INTERVAL_MS = 250;
const JOB_DOM_MIN_TEXT_LENGTH = 200;
const JOB_DOM_CANDIDATE_LIMIT = 12;
const JOB_DESCRIPTION_STRATEGIES = [
  'semantic_aria_details',
  'attribute_current_job',
  'semantic_detail_panel',
  'class_support',
  'right_panel_fallback',
];
const JOB_DESCRIPTION_SELECTORS = [
  '[class*="jobs-search__job-details"] .jobs-box__html-content',
  '[class*="jobs-search__job-details"] [class*="jobs-description-content"]',
  '[class*="job-details"] .jobs-box__html-content',
  '[class*="job-details"] [class*="jobs-description-content"]',
  '[aria-label*="job details" i] .jobs-box__html-content',
  '[aria-label*="detalles del empleo" i] .jobs-box__html-content',
  '.jobs-box__html-content',
  '.jobs-description',
  '[class*="jobs-description-content"]',
  '[data-job-id] [class*="description"]',
];
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
const LINKEDIN_LISTING_CARD_PATTERNS = [
  /\bseleccionado\b/i,
  /\bvisto\b/i,
  /\badel[a-záéíóú]+\s+a\s+solicitar\s+el\s+empleo\b/i,
  /\bfigurar[ií]as\s+entre\b/i,
  /\bpublicado\s+hace\b/i,
  /\bposted\s+\d+\s+\w+\s+ago\b/i,
  /\bmeet the hiring team\b/i,
];

const TECHNOLOGY_GROUPS = {
  frameworks: new Set(['React', 'Express', 'Vite', 'React Router', 'Socket.io', 'WordPress']),
  databases: new Set(['MySQL', 'MongoDB', 'Redis']),
  tools: new Set(['Docker', 'Jest', 'Supertest', 'Git', 'GitHub', 'Figma', 'AWS', 'Terraform']),
};

export async function captureLinkedInSnapshot(page, options = {}) {
  const maxCaptureChars = options.maxCaptureChars ?? DEFAULT_MAX_CAPTURE_CHARS;
  const debug = typeof options.debug === 'function' ? options.debug : null;
  const logger = typeof options.logger === 'function' ? options.logger : null;
  const provider = options.provider ?? null;
  const captureMode = options.captureMode ?? CAPTURE_MODE.PASSIVE;
  let jobDescriptionMatch = null;
  const currentUrl = safePageUrl(page);
  const { currentJobId } = parseLinkedInJobCaptureUrl(currentUrl);

  if (captureMode === CAPTURE_MODE.JOB_CAPTURE && provider === 'LINKEDIN_JOBS') {
    jobDescriptionMatch = await prepareLinkedInJobCaptureResilient(page, logger);
  }

  let raw;
  try {
    raw = await page.evaluate(extractSnapshotPayloadInPage, {
      maxCaptureChars,
      provider,
      jobDescriptionSelectors: JOB_DESCRIPTION_SELECTORS,
      selectedJobDescriptionSelector: jobDescriptionMatch?.selector ?? null,
    });
  } catch (error) {
    logCaptureEvent(logger, 'error', 'linkedin_job.snapshot_failed', {
      stage: 'extract_snapshot_payload',
      currentUrl,
      currentJobId,
      errorName: error?.name ?? 'Error',
      errorMessage: error?.message ?? 'Unknown error',
    });
    throw error;
  }
  const snapshot = normalizeSnapshotPayload(raw, maxCaptureChars);
  if (snapshot.extractedJob && jobDescriptionMatch) {
    snapshot.extractedJob.debugSources = {
      ...(snapshot.extractedJob.debugSources ?? {}),
      descriptionSelection: {
        strategy: jobDescriptionMatch.strategy ?? null,
        cssPath: jobDescriptionMatch.selector ?? null,
        tag: jobDescriptionMatch.tag ?? null,
        role: jobDescriptionMatch.role ?? null,
        className: jobDescriptionMatch.className ?? null,
        textLength: String(snapshot.extractedJob.description ?? '').trim().length,
      },
    };
  }

  if (logger && snapshot.extractedJob) {
    const { currentJobId } = parseLinkedInJobCaptureUrl(snapshot.url);
    logCaptureEvent(logger, 'info', 'linkedin_job.header_selected', {
      currentUrl: snapshot.url,
      currentJobId,
      title: snapshot.extractedJob.title ?? null,
      company: snapshot.extractedJob.company ?? null,
      titleLength: String(snapshot.extractedJob.title ?? '').trim().length,
      descriptionLength: String(snapshot.extractedJob.description ?? '').trim().length,
      headerStrategy: snapshot.extractedJob.debugSources?.title ?? null,
      descriptionStrategy: snapshot.extractedJob.debugSources?.descriptionSelection?.strategy ?? null,
    });
  }

  if (debug && snapshot.extractedJob) {
    debug('linkedin_snapshot.extracted', {
      url: snapshot.url,
      fields: summarizeFieldQuality(snapshot.extractedJob.quality),
      technologies: snapshot.extractedJob.technologies.length,
    });
  }

  return snapshot;
}

// Legacy fallback kept temporarily for reference while the resilient DOM strategy remains active.
// eslint-disable-next-line no-unused-vars
async function prepareLinkedInJobCapture(page, logger) {
  const currentUrl = safePageUrl(page);
  logCaptureEvent(logger, 'info', 'linkedin_job.current_url', {
    currentUrl,
  });

  if (!isLinkedInJobOfferUrl(currentUrl)) {
    throw buildCaptureValidationError(
      'LINKEDIN_JOB_NOT_OPEN',
      'No se detectó una oferta de empleo abierta. Abra una vacante antes de iniciar la captura.',
      {
        currentUrl,
      },
    );
  }

  logCaptureEvent(logger, 'info', 'linkedin_job.detected', {
    currentUrl,
  });

  const descriptionMatch = await findLinkedInJobDescriptionLocator(page, logger);
  if (!descriptionMatch) {
    throw buildCaptureValidationError(
      'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
      'La oferta aún no terminó de cargar o no contiene una descripción visible.',
      {
        currentUrl,
        attemptedSelectors: JOB_DESCRIPTION_SELECTORS,
        matchedSelectors: [],
        length: 0,
      },
    );
  }

  const descriptionLocator = descriptionMatch.locator;
  logCaptureEvent(logger, 'info', 'linkedin_job.waiting_description', {
    currentUrl,
    selector: descriptionMatch.selector,
  });

  try {
    await descriptionLocator.waitFor({ state: 'visible' });
  } catch {
    throw buildCaptureValidationError(
      'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
      'La oferta aún no terminó de cargar o no contiene una descripción visible.',
      {
        currentUrl,
        attemptedSelectors: descriptionMatch.attemptedSelectors,
        matchedSelectors: descriptionMatch.matchedSelectors,
        selector: descriptionMatch.selector,
        length: 0,
      },
    );
  }

  try {
    await page.waitForFunction(
      ({ selector, minLength }) => {
        const documentRef = globalThis.document;
        const node = documentRef.querySelector(selector);
        const text = String(node?.innerText ?? node?.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim();

        return text.length >= minLength;
      },
      {
        selector: descriptionMatch.selector,
        minLength: MIN_JOB_DESCRIPTION_TEXT_LENGTH,
      },
    );
  } catch {
    throw buildCaptureValidationError(
      'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
      'La oferta aún no terminó de cargar o no contiene una descripción visible.',
      {
        currentUrl,
        attemptedSelectors: descriptionMatch.attemptedSelectors,
        matchedSelectors: descriptionMatch.matchedSelectors,
        selector: descriptionMatch.selector,
        length: 0,
      },
    );
  }

  const descriptionLength = await readLocatorTextLength(descriptionLocator);
  if (descriptionLength < MIN_JOB_DESCRIPTION_TEXT_LENGTH) {
    throw buildCaptureValidationError(
      'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
      'La oferta aún no terminó de cargar o no contiene una descripción visible.',
      {
        currentUrl,
        attemptedSelectors: descriptionMatch.attemptedSelectors,
        matchedSelectors: descriptionMatch.matchedSelectors,
        selector: descriptionMatch.selector,
        length: descriptionLength,
      },
    );
  }

  logCaptureEvent(logger, 'info', 'linkedin_job.description.selector_selected', {
    selector: descriptionMatch.selector,
    length: descriptionLength,
  });
  logCaptureEvent(logger, 'info', 'linkedin_job.description_loaded', {
    currentUrl,
    selector: descriptionMatch.selector,
    length: descriptionLength,
  });

  return descriptionMatch;
}

async function prepareLinkedInJobCaptureResilient(page, logger) {
  const currentUrl = safePageUrl(page);
  const { currentJobId } = parseLinkedInJobCaptureUrl(currentUrl);

  logCaptureEvent(logger, 'info', 'linkedin_job.current_url', {
    currentUrl,
  });

  if (!isLinkedInJobOfferUrl(currentUrl)) {
    throw buildCaptureValidationError(
      'LINKEDIN_JOB_NOT_OPEN',
      'No se detectó una oferta de empleo abierta. Abra una vacante antes de iniciar la captura.',
      {
        currentUrl,
        currentJobId,
      },
    );
  }

  logCaptureEvent(logger, 'info', 'linkedin_job.detected', {
    currentUrl,
    currentJobId,
  });

  const descriptionMatch = await waitForLinkedInJobDescriptionMatch(page, {
    currentJobId,
  });

  const inspection = await inspectLinkedInJobDom(page, logger, {
    currentJobId,
  });

  if (!descriptionMatch) {
    throw buildCaptureValidationError(
      'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
      'La oferta aún no terminó de cargar o no contiene una descripción visible.',
      {
        currentUrl,
        currentJobId,
        bodyTextLength: inspection.bodyTextLength,
        mainFound: inspection.mainFound,
        iframeCount: inspection.iframeCount,
        attemptedStrategies: inspection.attemptedStrategies,
        candidateCount: inspection.candidateCount,
        length: 0,
      },
    );
  }

  const descriptionLocator = page.locator(descriptionMatch.cssPath).first();
  await descriptionLocator.waitFor({ state: 'visible' });
  const descriptionLength = await readLocatorTextLength(descriptionLocator);

  if (descriptionLength < MIN_JOB_DESCRIPTION_TEXT_LENGTH) {
    throw buildCaptureValidationError(
      'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
      'La oferta aún no terminó de cargar o no contiene una descripción visible.',
      {
        currentUrl,
        currentJobId,
        bodyTextLength: inspection.bodyTextLength,
        mainFound: inspection.mainFound,
        iframeCount: inspection.iframeCount,
        attemptedStrategies: inspection.attemptedStrategies,
        candidateCount: inspection.candidateCount,
        length: descriptionLength,
      },
    );
  }

  logCaptureEvent(logger, 'info', 'linkedin_job.description.strategy_selected', {
    strategy: descriptionMatch.strategy,
    tag: descriptionMatch.tag,
    role: descriptionMatch.role,
    className: descriptionMatch.className,
    textLength: descriptionLength,
  });
  logCaptureEvent(logger, 'info', 'linkedin_job.description_loaded', {
    currentUrl,
    currentJobId,
    strategy: descriptionMatch.strategy,
    cssPath: descriptionMatch.cssPath,
    length: descriptionLength,
  });

  return {
    selector: descriptionMatch.cssPath,
    strategy: descriptionMatch.strategy,
    tag: descriptionMatch.tag,
    role: descriptionMatch.role,
    className: descriptionMatch.className,
  };
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

function extractSnapshotPayloadInPage(options) {
  const DEFAULT_CAPTURE_CHAR_LIMIT = 20_000;
  const DEFAULT_JOB_DESCRIPTION_SELECTORS = [
    '[class*="jobs-search__job-details"] .jobs-box__html-content',
    '[class*="jobs-search__job-details"] [class*="jobs-description-content"]',
    '[class*="job-details"] .jobs-box__html-content',
    '[class*="job-details"] [class*="jobs-description-content"]',
    '[aria-label*="job details" i] .jobs-box__html-content',
    '[aria-label*="detalles del empleo" i] .jobs-box__html-content',
    '.jobs-box__html-content',
    '.jobs-description',
    '[class*="jobs-description-content"]',
    '[data-job-id] [class*="description"]',
  ];
  const LISTING_CARD_PATTERNS = [
    /\bseleccionado\b/i,
    /\bvisto\b/i,
    /\badel[a-záéíóú]+\s+a\s+solicitar\s+el\s+empleo\b/i,
    /\bfigurar[ií]as\s+entre\b/i,
    /\bpublicado\s+hace\b/i,
    /\bposted\s+\d+\s+\w+\s+ago\b/i,
    /\bmeet the hiring team\b/i,
  ];
  const maxCaptureChars =
    typeof options === 'number' ? options : Number(options?.maxCaptureChars ?? DEFAULT_CAPTURE_CHAR_LIMIT);
  const provider = typeof options === 'object' ? options?.provider ?? null : null;
  const jobDescriptionSelectors =
    typeof options === 'object' && Array.isArray(options?.jobDescriptionSelectors)
      ? options.jobDescriptionSelectors
      : DEFAULT_JOB_DESCRIPTION_SELECTORS;
  const selectedJobDescriptionSelector =
    typeof options === 'object' ? String(options?.selectedJobDescriptionSelector ?? '').trim() : '';
  const documentRef = globalThis.document;
  const main = documentRef.querySelector('main') ?? documentRef.body;

  const toText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const readText = (selector, root = documentRef) => {
    const node = root.querySelector(selector);
    return toText(node?.textContent ?? '');
  };
  const readTexts = (selectors, root = documentRef) => {
    const values = [];
    for (const selector of selectors) {
      for (const node of root.querySelectorAll(selector)) {
        const text = toText(node.textContent);
        if (text) {
          values.push(text);
        }
      }
    }
    return [...new Set(values)];
  };
  const readFirstText = (selectors, root = documentRef) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      const text = toText(node?.innerText ?? node?.textContent ?? '');
      if (text) {
        return text;
      }
    }
    return '';
  };
  const readFirstNode = (selectors, root = documentRef) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) {
        return node;
      }
    }
    return null;
  };
  const readNodeText = (node) => toText(node?.innerText ?? node?.textContent ?? '');
  const readNodeTexts = (node, selectors) => {
    if (!node) {
      return [];
    }

    const values = [];
    for (const selector of selectors) {
      for (const child of node.querySelectorAll(selector)) {
        const text = readNodeText(child);
        if (text) {
          values.push(text);
        }
      }
    }

    return [...new Set(values)];
  };
  const looksLikeListingCardText = (value) => {
    const text = toText(value);
    return LISTING_CARD_PATTERNS.some((pattern) => pattern.test(text));
  };
  const isListingCardNode = (node) => {
    if (!node) {
      return false;
    }

    const role = toText(node.getAttribute?.('role') ?? '');
    const text = readNodeText(node);
    const jobLinkCount = node.querySelectorAll?.('a[href*="/jobs/view/"], a[href*="currentJobId="]').length ?? 0;
    const listItemCount = node.querySelectorAll?.('li, [role="listitem"]').length ?? 0;

    return role === 'button' || looksLikeListingCardText(text) || jobLinkCount > 1 || listItemCount >= 2;
  };
  const findDetailRoot = (node) => {
    if (!node) {
      return null;
    }

    const mainRect = main.getBoundingClientRect?.() ?? { left: 0, width: 0 };
    let current = node;
    let best = null;

    while (current && current !== main) {
      const rect = current.getBoundingClientRect?.() ?? { left: 0, width: 0 };
      const width = Number(rect.width ?? 0);
      const left = Number(rect.left ?? 0);
      const rightPanelLike =
        width >= Number(mainRect.width ?? 0) * 0.35 || left >= Number(mainRect.left ?? 0) + Number(mainRect.width ?? 0) * 0.28;
      const headingCount = current.querySelectorAll?.('h1, h2, h3').length ?? 0;
      const paragraphCount = current.querySelectorAll?.('p, li').length ?? 0;
      const text = readNodeText(current);
      const hasAboutHeading = /about the job|acerca del empleo|job description|descripci[oó]n del empleo/i.test(text);

      if (rightPanelLike && !isListingCardNode(current) && (headingCount > 0 || paragraphCount >= 2 || hasAboutHeading)) {
        best = current;
      }

      current = current.parentElement;
    }

    return best;
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

  const selectedDescriptionNode = selectedJobDescriptionSelector
    ? documentRef.querySelector(selectedJobDescriptionSelector)
    : null;
  const detailRoot =
    findDetailRoot(selectedDescriptionNode) ??
    readFirstNode(
      [
        '[aria-label*="job details" i]',
        '[aria-label*="detalles del empleo" i]',
        '[class*="jobs-search__job-details"]',
        '[class*="job-details"]',
      ],
      main,
    ) ??
    main;
  const headerRoot = detailRoot ?? main;

  const titleCandidates = readTexts([
    'main h1',
    '[data-test-job-title]',
    '[class*="job-details-jobs-unified-top-card__job-title"]',
    '[class*="jobs-unified-top-card__job-title"]',
  ], headerRoot);
  const companyCandidates = readTexts([
    '[class*="job-details-jobs-unified-top-card__company-name"]',
    '[class*="jobs-unified-top-card__company-name"]',
    '[class*="job-details-jobs-unified-top-card__primary-description"] a',
    '[class*="jobs-unified-top-card__primary-description"] a',
    'a[href*="/company/"]',
  ], headerRoot);
  const metadataItems = readTexts([
    '[class*="job-details-jobs-unified-top-card__primary-description-container"] span',
    '[class*="job-details-jobs-unified-top-card__tertiary-description-container"] span',
    '[class*="job-details-jobs-unified-top-card__job-insight"]',
    '[class*="jobs-unified-top-card__subtitle-primary-grouping"] span',
    '[class*="jobs-unified-top-card__subtitle-secondary-grouping"] span',
    'span',
  ], headerRoot);
  const descriptionNode =
    (selectedDescriptionNode && findDetailRoot(selectedDescriptionNode) ? selectedDescriptionNode : null) ??
    readFirstNode(jobDescriptionSelectors, detailRoot) ??
    selectedDescriptionNode;
  const description = readNodeText(descriptionNode) || readFirstText(jobDescriptionSelectors, detailRoot);
  const descriptionBlocks = readNodeTexts(descriptionNode, ['li', 'p', 'h2', 'h3']).concat(
    readNodeTexts(descriptionNode, ['span']),
  );
  const recruiter = readText('[href*="/in/"][class*="app-aware-link"], [href*="/in/"]', headerRoot);
  const applyButtons = readApplyButtons();
  const panelText = toText(
    [
      readText('h1', headerRoot),
      ...titleCandidates,
      ...companyCandidates,
      ...metadataItems,
      description,
      ...descriptionBlocks,
      recruiter,
      ...applyButtons,
    ].join('\n'),
  );

  return {
    title: toText(documentRef.title),
    url: String(globalThis.location?.href ?? ''),
    visibleText:
      (provider === 'LINKEDIN_JOBS' ? panelText || toText(main.innerText) : toText(main.innerText)).slice(
        0,
        maxCaptureChars,
      ),
    selectors: {
      h1: readText('main h1'),
      detailRootTag: String(detailRoot?.tagName ?? '').toUpperCase(),
      titleCandidates,
      companyCandidates,
      metadataItems,
      description,
      descriptionBlocks,
      recruiter,
      ariaLabels: readAriaLabels(),
      applyButtons,
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
    candidate(sanitizeStructuredDescription(selectors.description), 'HIGH', 'selector:description'),
    candidate(sanitizeStructuredDescription(jsonLd.description), 'MEDIUM', 'metadata:jsonld'),
    candidate(sanitizeStructuredDescription(fallbackText), 'LOW', 'visible_text'),
  ]);
  const title = chooseText([
    candidate(sanitizeStructuredTitle(selectors.h1), 'HIGH', 'selector:h1'),
    ...selectors.titleCandidates.map((value) => candidate(sanitizeStructuredTitle(value), 'HIGH', 'selector:title')),
    candidate(sanitizeStructuredTitle(normalizeDocumentJobTitle(raw?.title)), 'MEDIUM', 'document:title'),
    candidate(sanitizeStructuredTitle(jsonLd.title), 'MEDIUM', 'metadata:jsonld'),
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

function findLocation(text) {
  const value = cleanText(text);
  const specificLocationMatch = value.match(
    /(buenos aires|argentina|latam|latin america|mexico|colombia|spain|usa|united states|estados unidos)/i,
  );
  if (specificLocationMatch) {
    return cleanText(specificLocationMatch[0]);
  }

  const modalityAsLocation = value.match(/(remote|remoto|hybrid|hibrido|onsite|presencial)/i);
  return modalityAsLocation ? cleanText(modalityAsLocation[0]) : null;
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

function sanitizeStructuredTitle(value) {
  const text = cleanText(value);
  if (!text || text.length > 180 || looksLikeListingCardText(text)) {
    return null;
  }

  const normalized = text.toLowerCase();
  if (/(^|[\s,])(visto|selected|seleccionado|figurar[ií]as|publicado|posted)([\s,]|$)/i.test(text)) {
    return null;
  }

  if (hasRepeatedLeadingSegment(normalized)) {
    return null;
  }

  return text;
}

function sanitizeStructuredDescription(value) {
  const text = cleanText(value);
  if (!text || text.length < MIN_JOB_DESCRIPTION_TEXT_LENGTH) {
    return null;
  }

  if (looksLikeListingCardText(text)) {
    return null;
  }

  return text;
}

function normalizeDocumentJobTitle(value) {
  const text = cleanText(value).replace(/\s*\|\s*linkedin\s*$/i, '').trim();
  return text || null;
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

function looksLikeListingCardText(value) {
  const text = cleanText(value);
  return LINKEDIN_LISTING_CARD_PATTERNS.some((pattern) => pattern.test(text));
}

function hasRepeatedLeadingSegment(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return false;
  }

  const words = normalized.split(/\s+/);
  if (words.length < 6) {
    return false;
  }

  const prefix = words.slice(0, Math.min(6, Math.floor(words.length / 2))).join(' ');
  return prefix.length >= 12 && normalized.includes(`${prefix} ${prefix}`);
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

async function readLocatorTextLength(locator) {
  try {
    return await locator.evaluate((node) =>
      String(node?.innerText ?? node?.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim().length,
    );
  } catch {
    return 0;
  }
}

function safePageUrl(page) {
  try {
    return String(page.url?.() ?? '');
  } catch {
    return '';
  }
}

function parseLinkedInJobCaptureUrl(url) {
  const value = String(url ?? '').trim();
  try {
    const parsed = new URL(value);
    return {
      currentJobId: String(parsed.searchParams.get('currentJobId') ?? '').trim() || null,
    };
  } catch {
    return {
      currentJobId: null,
    };
  }
}

async function waitForLinkedInJobDescriptionMatch(page, options = {}) {
  try {
    const handle = await page.waitForFunction(
      inspectLinkedInJobDomInPage,
      {
        currentJobId: options.currentJobId ?? null,
        minTextLength: JOB_DOM_MIN_TEXT_LENGTH,
        minDescriptionLength: MIN_JOB_DESCRIPTION_TEXT_LENGTH,
        candidateLimit: JOB_DOM_CANDIDATE_LIMIT,
        attemptedStrategies: JOB_DESCRIPTION_STRATEGIES,
        supportSelectors: JOB_DESCRIPTION_SELECTORS,
        returnSelectedCandidate: true,
      },
      {
        timeout: JOB_CAPTURE_GLOBAL_TIMEOUT_MS,
        polling: JOB_CAPTURE_POLL_INTERVAL_MS,
      },
    );

    return safeJsonValue(handle);
  } catch {
    return null;
  }
}

async function inspectLinkedInJobDom(page, logger, options = {}) {
  const inspection = await page.evaluate(inspectLinkedInJobDomInPage, {
    currentJobId: options.currentJobId ?? null,
    minTextLength: JOB_DOM_MIN_TEXT_LENGTH,
    minDescriptionLength: MIN_JOB_DESCRIPTION_TEXT_LENGTH,
    candidateLimit: JOB_DOM_CANDIDATE_LIMIT,
    attemptedStrategies: JOB_DESCRIPTION_STRATEGIES,
    supportSelectors: JOB_DESCRIPTION_SELECTORS,
  });

  for (const candidate of inspection.candidates ?? []) {
    logCaptureEvent(logger, 'debug', 'linkedin_job.dom_candidate', {
      tag: candidate.tag,
      id: candidate.id,
      className: candidate.className,
      role: candidate.role,
      ariaLabel: candidate.ariaLabel,
      textLength: candidate.textLength,
      visible: candidate.visible,
      depth: candidate.depth,
    });
  }

  return inspection;
}

function inspectLinkedInJobDomInPage(options = {}) {
  const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const matchesListingCardNoise = (value) =>
    /seleccionado|visto|adel[a-záéíóú]+\s+a\s+solicitar\s+el\s+empleo|figurar[ií]as\s+entre|publicado\s+hace|posted\s+\d+\s+\w+\s+ago|meet the hiring team/i.test(
      normalizeText(value),
    );
  const isVisible = (node) => {
    if (!node) {
      return false;
    }

    const style = globalThis.getComputedStyle?.(node);
    if (!style) {
      return true;
    }

    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity ?? '1') === 0) {
      return false;
    }

    const rect = node.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  };
  const calculateDepth = (node, stopNode) => {
    let current = node;
    let depth = 0;

    while (current && current !== stopNode) {
      current = current.parentElement;
      depth += 1;
    }

    return depth;
  };
  const buildCssPath = (node, stopNode) => {
    const segments = [];
    let current = node;

    while (current && current !== stopNode && current.parentElement) {
      const tag = String(current.tagName ?? 'div').toLowerCase();
      const siblings = [...current.parentElement.children].filter(
        (entry) => String(entry.tagName ?? '').toLowerCase() === tag,
      );
      const index = siblings.indexOf(current) + 1;
      segments.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
      current = current.parentElement;
    }

    return ['main', ...segments].join(' > ');
  };
  const documentRef = globalThis.document;
  const windowRef = globalThis.window;
  const minTextLength = Number(options?.minTextLength ?? 200);
  const minDescriptionLength = Number(options?.minDescriptionLength ?? 80);
  const candidateLimit = Number(options?.candidateLimit ?? 12);
  const attemptedStrategies = Array.isArray(options?.attemptedStrategies)
    ? options.attemptedStrategies
    : [];
  const supportSelectors = Array.isArray(options?.supportSelectors)
    ? options.supportSelectors
    : [];
  const currentJobId = String(options?.currentJobId ?? '').trim();
  const main =
    documentRef.querySelector('main') ??
    documentRef.querySelector('[role="main"]') ??
    documentRef.body ??
    null;
  const bodyTextLength = normalizeText(documentRef.body?.innerText ?? documentRef.body?.textContent ?? '').length;
  const iframeCount = documentRef.querySelectorAll('iframe').length;
  const roleMainCount = documentRef.querySelectorAll('[role="main"]').length;
  const roleArticleCount = documentRef.querySelectorAll('[role="article"], article').length;
  const visibleSectionCount = [...documentRef.querySelectorAll('section')].filter((node) => isVisible(node)).length;

  if (!main) {
    return {
      mainFound: false,
      bodyTextLength,
      iframeCount,
      roleMainCount,
      roleArticleCount,
      visibleSectionCount,
      attemptedStrategies,
      candidateCount: 0,
      candidates: [],
      selectedCandidate: null,
    };
  }

  const titleText = normalizeText(
    main.querySelector('h1')?.innerText ?? main.querySelector('h1')?.textContent ?? '',
  );
  const mainRect = main.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
  const scanNodes = [main, ...main.querySelectorAll('section, article, div')].slice(0, 500);
  const rawCandidates = [];

  for (const node of scanNodes) {
    if (!isVisible(node)) {
      continue;
    }

    const textLength = normalizeText(node.innerText ?? node.textContent ?? '').length;
    if (textLength < minTextLength) {
      continue;
    }

    const rect = node.getBoundingClientRect?.() ?? {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    };
    const jobLinkCount = node.querySelectorAll?.('a[href*="/jobs/view/"], a[href*="currentJobId="]').length ?? 0;
    const applyControlCount = [...(node.querySelectorAll?.('button, a[role="button"], a') ?? [])]
      .map((child) => normalizeText(child.innerText ?? child.textContent ?? child.getAttribute?.('aria-label') ?? ''))
      .filter((text) => /apply|easy apply|postular|solicitar/i.test(text)).length;
    const listItemCount = node.querySelectorAll?.('li, [role="listitem"]').length ?? 0;
    const paragraphCount = node.querySelectorAll?.('p').length ?? 0;
    const headingCount = node.querySelectorAll?.('h1, h2, h3').length ?? 0;
    const className = normalizeText(node.className);
    const ariaLabel = normalizeText(node.getAttribute?.('aria-label') ?? '');
    const role = normalizeText(node.getAttribute?.('role') ?? '');
    const text = normalizeText(node.innerText ?? node.textContent ?? '');
    const hasAboutHeading = /about the job|acerca del empleo|job description|descripci[oó]n del empleo/i.test(text);
    const roleButtonLike = role === 'button';
    const listingNoise = matchesListingCardNoise(text);
    const hasTitle = Boolean(titleText && text.includes(titleText));
    const hasCurrentJobId =
      Boolean(currentJobId) &&
      (Boolean(node.querySelector?.(`[data-job-id="${currentJobId}"]`)) ||
        Boolean(node.querySelector?.(`[href*="currentJobId=${currentJobId}"]`)) ||
        Boolean(node.getAttributeNames?.().some((name) => {
          const value = String(node.getAttribute(name) ?? '');
          return value.includes(currentJobId);
        })));
    const listingLike = jobLinkCount >= 3 || listItemCount >= 6;
    const rightPanelLike =
      Number(rect.left ?? 0) >= Number(mainRect.left ?? 0) + Number(mainRect.width ?? 1) * 0.25 ||
      Number(rect.width ?? 0) >= Number(mainRect.width ?? windowRef?.innerWidth ?? 1) * 0.35;

    let score = 0;
    let strategy = 'right_panel_fallback';

    if (!roleButtonLike && /job details|detalles del empleo|description|descripci/i.test(ariaLabel)) {
      score += 70;
      strategy = 'semantic_aria_details';
    }

    if (hasCurrentJobId) {
      score += rightPanelLike && !roleButtonLike ? 35 : 10;
      if (rightPanelLike && !roleButtonLike) {
        strategy = strategy === 'semantic_aria_details' ? strategy : 'attribute_current_job';
      }
    }

    if (hasTitle && applyControlCount > 0 && (paragraphCount > 0 || hasAboutHeading) && rightPanelLike) {
      score += 55;
      strategy =
        strategy === 'semantic_aria_details' || strategy === 'attribute_current_job'
          ? strategy
          : 'semantic_detail_panel';
    }

    if (/detail|description|job-details|jobs-search__job-details/i.test(className)) {
      score += 25;
      strategy =
        strategy === 'semantic_aria_details' ||
        strategy === 'attribute_current_job' ||
        strategy === 'semantic_detail_panel'
          ? strategy
          : 'class_support';
    }

    if (rightPanelLike && (paragraphCount > 0 || hasAboutHeading) && textLength >= minDescriptionLength) {
      score += 30;
    }

    if (headingCount > 0) {
      score += 10;
    }

    if (hasAboutHeading) {
      score += 20;
    }

    if (Number(rect.width ?? 0) >= Number(mainRect.width ?? windowRef?.innerWidth ?? 1) * 0.45) {
      score += 15;
    }

    if (listingLike) {
      score -= 90;
    }

    if (listingNoise) {
      score -= 90;
    }

    if (node.closest?.('aside')) {
      score -= 40;
    }

    if (roleButtonLike) {
      score -= 120;
    }

    if (!rightPanelLike && jobLinkCount > 1) {
      score -= 50;
    }

    if (!rightPanelLike) {
      score -= 25;
    }

    if (!hasAboutHeading && paragraphCount === 0) {
      score -= 30;
    }

    if (score <= 0) {
      continue;
    }

    rawCandidates.push({
      tag: String(node.tagName ?? '').toUpperCase(),
      id: normalizeText(node.id),
      className: className.slice(0, 140),
      role,
      ariaLabel: ariaLabel.slice(0, 140),
      textLength,
      visible: true,
      depth: calculateDepth(node, main),
      candidateTextLength: textLength,
      jobLinkCount,
      listItemCount,
      applyControlCount,
      paragraphCount,
      headingCount,
      listingLike,
      listingNoise,
      roleButtonLike,
      hasAboutHeading,
      rightPanelLike,
      strategy,
      score,
      cssPath: buildCssPath(node, main),
    });
  }

  const sortedCandidates = rawCandidates
    .sort((left, right) => right.score - left.score || right.textLength - left.textLength)
    .slice(0, candidateLimit);
  const selectedCandidate =
    sortedCandidates.find(
      (candidate) =>
        !candidate.listingLike &&
        !candidate.listingNoise &&
        !candidate.roleButtonLike &&
        candidate.rightPanelLike &&
        candidate.textLength >= minDescriptionLength,
    ) ??
    null;

  if (options?.returnSelectedCandidate) {
    return selectedCandidate;
  }

  return {
    mainFound: true,
    bodyTextLength,
    iframeCount,
    roleMainCount,
    roleArticleCount,
    visibleSectionCount,
    attemptedStrategies,
    candidateCount: rawCandidates.length,
    candidates: sortedCandidates,
    selectedCandidate,
    supportSelectors,
  };
}

async function safeJsonValue(handle) {
  if (!handle) {
    return null;
  }

  if (typeof handle.jsonValue === 'function') {
    return handle.jsonValue();
  }

  return handle;
}

async function findLinkedInJobDescriptionLocator(page, logger) {
  const attemptedSelectors = [];
  const matchedSelectors = [];

  for (const selector of JOB_DESCRIPTION_SELECTORS) {
    attemptedSelectors.push(selector);
    const locator = page.locator(selector);
    const count = await safeLocatorCount(locator);
    const candidate = typeof locator.first === 'function' ? locator.first() : locator;
    const visible = count > 0 ? await safeLocatorVisible(candidate) : false;

    logCaptureEvent(logger, 'info', 'linkedin_job.description.selector_probe', {
      selector,
      count,
      visible,
    });

    if (!visible) {
      continue;
    }

    matchedSelectors.push(selector);
    return {
      locator: candidate,
      selector,
      attemptedSelectors,
      matchedSelectors,
    };
  }

  return null;
}

function isLinkedInJobOfferUrl(url) {
  const value = String(url ?? '').trim();
  if (!value) {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (!parsed.hostname.toLowerCase().endsWith('linkedin.com')) {
    return false;
  }

  const pathname = parsed.pathname.toLowerCase();
  const currentJobId = String(parsed.searchParams.get('currentJobId') ?? '').trim();

  if (pathname.includes('/jobs/view/')) {
    return true;
  }

  if (!pathname.startsWith('/jobs/')) {
    return false;
  }

  return currentJobId.length > 0;
}

async function safeLocatorCount(locator) {
  try {
    return Number(await locator.count());
  } catch {
    return 0;
  }
}

async function safeLocatorVisible(locator) {
  try {
    return Boolean(await locator.isVisible());
  } catch {
    return false;
  }
}

function buildCaptureValidationError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function logCaptureEvent(logger, level, stage, payload) {
  if (!logger) {
    return;
  }

  logger(level, stage, payload);
}
