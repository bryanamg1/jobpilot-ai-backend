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
];
const LINKEDIN_DESCRIPTION_NOISE_PATTERNS = [
  /\bestar[ií]as entre los candidatos destacados\b/i,
  /\bpodemos ayudarte a captar el inter[eé]s\b/i,
  /\bfigurar[ií]as entre los principales solicitantes\b/i,
  /\badel[aá]ntate a solicitar\b/i,
  /\bmeet the hiring team\b/i,
  /\bconoce al equipo de contrataci[oó]n\b/i,
  /\bapplicant insights\b/i,
  /\bcandidate insights\b/i,
  /\btry premium\b/i,
  /\bpremium\b/i,
  /\bpromocionado por\b/i,
  /\bpromoted by\b/i,
  /\ba[uú]n no hay informaci[oó]n disponible\b/i,
  /\bthere is no information available\b/i,
  /\bno information available\b/i,
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
  let jobCaptureTarget = null;
  const currentUrl = safePageUrl(page);
  const { currentJobId } = parseLinkedInJobCaptureUrl(currentUrl);

  if (captureMode === CAPTURE_MODE.JOB_CAPTURE && provider === 'LINKEDIN_JOBS') {
    jobCaptureTarget = await prepareLinkedInJobCaptureResilient(page, logger);
  }

  let raw;
  try {
    raw = await page.evaluate(extractSnapshotPayloadInPage, {
      maxCaptureChars,
      provider,
      jobDescriptionSelectors: JOB_DESCRIPTION_SELECTORS,
      selectedJobDescriptionSelector:
        jobCaptureTarget?.captureTarget?.detailRoot?.cssPath ?? jobCaptureTarget?.selector ?? null,
      resolvedCaptureTarget: jobCaptureTarget?.captureTarget ?? null,
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
  if (snapshot.extractedJob && jobCaptureTarget?.captureTarget) {
    snapshot.extractedJob.debugSources = {
      ...(snapshot.extractedJob.debugSources ?? {}),
      descriptionSelection: {
        strategy: jobCaptureTarget.captureTarget.description?.strategy ?? jobCaptureTarget.strategy ?? null,
        cssPath:
          jobCaptureTarget.captureTarget.description?.cssPath ??
          jobCaptureTarget.captureTarget.detailRoot?.cssPath ??
          null,
        tag: jobCaptureTarget.captureTarget.detailRoot?.tag ?? jobCaptureTarget.tag ?? null,
        role: jobCaptureTarget.captureTarget.detailRoot?.role ?? jobCaptureTarget.role ?? null,
        className: jobCaptureTarget.captureTarget.detailRoot?.className ?? jobCaptureTarget.className ?? null,
        textLength: String(snapshot.extractedJob.description ?? '').trim().length,
      },
    };
  }

  if (logger && captureMode === CAPTURE_MODE.JOB_CAPTURE && jobCaptureTarget?.captureTarget && raw?.selectors?.detailPaneSummary) {
    logCaptureEvent(logger, 'info', 'linkedin_job.detail_pane.selected', {
      strategy: raw.selectors.detailRootStrategy ?? jobCaptureTarget?.captureTarget?.detailRoot?.strategy ?? null,
      textLength: raw.selectors.detailPaneSummary.textLength ?? 0,
      headingCount: raw.selectors.detailPaneSummary.headingCount ?? 0,
      paragraphCount: raw.selectors.detailPaneSummary.paragraphCount ?? 0,
      linkCount: raw.selectors.detailPaneSummary.linkCount ?? 0,
      buttonCount: raw.selectors.detailPaneSummary.buttonCount ?? 0,
      geometry: raw.selectors.detailPaneSummary.geometry ?? null,
    });
  }

  if (
    logger &&
    captureMode === CAPTURE_MODE.JOB_CAPTURE &&
    jobCaptureTarget?.captureTarget &&
    raw?.selectors?.descriptionSummary
  ) {
    logCaptureEvent(logger, 'info', 'linkedin_job.description.selected', {
      strategy: raw.selectors.descriptionSummary.strategy ?? null,
      headingText: raw.selectors.descriptionSummary.headingText ?? null,
      textLength: raw.selectors.descriptionSummary.textLength ?? 0,
      paragraphCount: raw.selectors.descriptionSummary.paragraphCount ?? 0,
      listCount: raw.selectors.descriptionSummary.listCount ?? 0,
      cssPath: raw.selectors.descriptionSummary.cssPath ?? null,
    });
  }

  if (captureMode === CAPTURE_MODE.JOB_CAPTURE && provider === 'LINKEDIN_JOBS') {
    const captureValidationError = validateLinkedInJobCaptureSnapshot(snapshot, raw?.selectors ?? {}, logger);
    if (captureValidationError) {
      throw captureValidationError;
    }
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

function validateLinkedInJobCaptureSnapshot(snapshot, selectors, logger) {
  const description = cleanText(snapshot?.extractedJob?.description);
  if (description && !looksLikeDescriptionNoise(description)) {
    return null;
  }

  const { currentJobId } = parseLinkedInJobCaptureUrl(snapshot?.url);
  const detailPaneFound = Boolean(selectors?.detailPaneSummary);
  const details = {
    currentUrl: snapshot?.url ?? null,
    currentJobId,
    detailPaneFound,
    detailPaneTextLength: selectors?.detailPaneSummary?.textLength ?? 0,
    semanticHeadingMatches: selectors?.descriptionSummary?.semanticHeadingMatches ?? 0,
    descriptiveBlockCandidates: selectors?.descriptionSummary?.descriptiveBlockCandidates ?? 0,
    topRejectedCandidates: selectors?.descriptionSummary?.rejectedCandidates ?? [],
    selectedStrategy: selectors?.detailRootStrategy ?? null,
    descriptionStrategy: selectors?.descriptionSummary?.strategy ?? null,
    length: String(description ?? '').length,
  };

  logCaptureEvent(logger, 'info', 'linkedin_job.description.selection_failed', {
    currentJobId,
    detailPaneFound,
    detailPaneTextLength: details.detailPaneTextLength,
    semanticHeadingMatches: details.semanticHeadingMatches,
    descriptiveBlockCandidates: details.descriptiveBlockCandidates,
    topRejectedCandidates: details.topRejectedCandidates,
    reason: detailPaneFound ? 'not_found' : 'not_ready',
  });

  return buildCaptureValidationError(
    detailPaneFound ? 'LINKEDIN_JOB_DESCRIPTION_NOT_FOUND' : 'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
    detailPaneFound
      ? 'No se encontró una descripción laboral válida dentro del panel de detalle visible.'
      : 'La oferta aún no terminó de cargar o no contiene una descripción visible.',
    details,
  );
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

  const descriptionWaitResult = await waitForLinkedInJobDescriptionMatch(page, logger, {
    currentJobId,
  });
  const inspection = descriptionWaitResult.inspection ?? null;

  if (descriptionWaitResult.status === 'job_changed') {
    logCaptureEvent(logger, 'info', 'linkedin_job.capture_target.failed', {
      currentJobId,
      reason: 'job_changed',
      bestDetailRoot: inspection?.captureTarget?.detailRoot ?? null,
      bestDescriptionCandidate: inspection?.captureTarget?.description ?? null,
      rawCandidateCount: inspection?.rawCandidateCount ?? inspection?.candidateCount ?? 0,
      elapsedMs: descriptionWaitResult.waitedMs ?? JOB_CAPTURE_GLOBAL_TIMEOUT_MS,
    });
    logCaptureEvent(logger, 'info', 'linkedin_job.description.selection_failed', {
      currentJobId,
      candidateCount: inspection?.rawCandidateCount ?? inspection?.candidateCount ?? 0,
      detailRootFound: (inspection?.detailCandidateCount ?? 0) > 0,
      detailRootStrategy: inspection?.captureTarget?.detailRoot?.strategy ?? null,
      maxCandidateTextLength: inspection?.maxCandidateTextLength ?? 0,
      topRejectedCandidates: (inspection?.discardedNodes ?? []).slice(0, 3),
      reason: 'job_changed',
    });
    throw buildCaptureValidationError(
      'LINKEDIN_JOB_CAPTURE_CHANGED',
      'La vacante cambió mientras se preparaba la captura. Vuelve a abrir la oferta y reintenta.',
      {
        currentUrl: descriptionWaitResult.currentUrl ?? currentUrl,
        currentJobId: descriptionWaitResult.currentJobId ?? currentJobId,
        expectedJobId: currentJobId,
        candidateCount: descriptionWaitResult.candidateCount ?? inspection.candidateCount,
        length: descriptionWaitResult.length ?? 0,
        waitedMs: descriptionWaitResult.waitedMs ?? JOB_CAPTURE_GLOBAL_TIMEOUT_MS,
        selectedStrategy: descriptionWaitResult.selectedStrategy ?? null,
      },
    );
  }

  if (descriptionWaitResult.status !== 'ready' || !descriptionWaitResult.match) {
    logCaptureEvent(logger, 'info', 'linkedin_job.capture_target.failed', {
      currentJobId,
      reason: descriptionWaitResult.status ?? 'timeout',
      bestDetailRoot: inspection?.captureTarget?.detailRoot ?? null,
      bestDescriptionCandidate: inspection?.captureTarget?.description ?? null,
      rawCandidateCount: inspection?.rawCandidateCount ?? inspection?.candidateCount ?? 0,
      elapsedMs: descriptionWaitResult.waitedMs ?? JOB_CAPTURE_GLOBAL_TIMEOUT_MS,
    });
    logCaptureEvent(logger, 'info', 'linkedin_job.description_region.failed', {
      detailPaneFound: Boolean(inspection?.captureTarget?.detailRoot),
      detailPaneTextLength: inspection?.captureTarget?.detailRoot?.textLength ?? 0,
      semanticHeadingCount: inspection?.captureTarget?.description?.semanticHeadingMatches ?? 0,
      semanticHeadingCandidates: inspection?.captureTarget?.description?.semanticHeadingCandidates ?? [],
      descriptiveBlockCandidates: inspection?.captureTarget?.description?.descriptiveBlockCandidates ?? 0,
      stoppedBy: inspection?.captureTarget?.description?.stoppedBy ?? null,
      stopReason: inspection?.captureTarget?.description?.stopReason ?? null,
      stopCssPath: inspection?.captureTarget?.description?.stopCssPath ?? null,
      stopTextPreview: inspection?.captureTarget?.description?.stopTextPreview ?? null,
      traversalStartPath: inspection?.captureTarget?.description?.traversalStartPath ?? null,
      traversedNodeCount: inspection?.captureTarget?.description?.traversedNodeCount ?? 0,
      acceptedBlockCount: inspection?.captureTarget?.description?.acceptedBlockCount ?? 0,
      rejectedBlockCount: inspection?.captureTarget?.description?.rejectedBlockCount ?? 0,
      reason: descriptionWaitResult.status ?? 'timeout',
    });
    logCaptureEvent(logger, 'info', 'linkedin_job.description.selection_failed', {
      currentJobId,
      candidateCount: inspection?.rawCandidateCount ?? inspection?.candidateCount ?? 0,
      detailRootFound: (inspection?.detailCandidateCount ?? 0) > 0,
      detailRootStrategy: inspection?.captureTarget?.detailRoot?.strategy ?? null,
      maxCandidateTextLength: inspection?.maxCandidateTextLength ?? descriptionWaitResult.candidateMaxTextLength ?? 0,
      topRejectedCandidates: (inspection?.discardedNodes ?? []).slice(0, 3),
      reason: descriptionWaitResult.status ?? 'timeout',
    });
    throw buildCaptureValidationError(
      descriptionWaitResult.status === 'not_found'
        ? 'LINKEDIN_JOB_DESCRIPTION_NOT_FOUND'
        : 'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
      descriptionWaitResult.status === 'not_found'
        ? 'No se encontró una descripción laboral válida dentro del panel de detalle visible.'
        : 'La oferta aún no terminó de cargar o no contiene una descripción visible.',
      {
        currentUrl,
        currentJobId,
        bodyTextLength: inspection.bodyTextLength,
        mainFound: inspection.mainFound,
        iframeCount: inspection.iframeCount,
        attemptedStrategies: inspection.attemptedStrategies,
        candidateCount: descriptionWaitResult.candidateCount ?? inspection.candidateCount,
        rawCandidateCount: inspection.rawCandidateCount ?? inspection.candidateCount,
        detailCandidateCount: inspection.detailCandidateCount ?? 0,
        eligibleCandidateCount: inspection.eligibleCandidateCount ?? 0,
        length: descriptionWaitResult.length ?? 0,
        candidateMaxTextLength: descriptionWaitResult.candidateMaxTextLength ?? inspection.maxCandidateTextLength ?? 0,
        waitedMs: descriptionWaitResult.waitedMs ?? JOB_CAPTURE_GLOBAL_TIMEOUT_MS,
        selectedStrategy: descriptionWaitResult.selectedStrategy ?? null,
      },
    );
  }

  const descriptionMatch = descriptionWaitResult.match;
  const descriptionLength = descriptionWaitResult.length;
  const captureTarget = descriptionWaitResult.captureTarget ?? null;

  logCaptureEvent(logger, 'info', 'linkedin_job.capture_target.stable', {
    currentUrl,
    currentJobId,
    detailRootCssPath: captureTarget?.detailRoot?.cssPath ?? descriptionMatch.cssPath ?? null,
    detailRootTextLength: captureTarget?.detailRoot?.textLength ?? descriptionLength,
    detailRootWidth: captureTarget?.detailRoot?.width ?? 0,
    detailRootHeight: captureTarget?.detailRoot?.height ?? 0,
    descriptionCssPath: captureTarget?.description?.cssPath ?? descriptionMatch.cssPath ?? null,
    descriptionStrategy: captureTarget?.description?.strategy ?? descriptionMatch.strategy ?? null,
    descriptionTextLength: captureTarget?.description?.textLength ?? descriptionLength,
    elapsedMs: descriptionWaitResult.waitedMs ?? 0,
  });
  logCaptureEvent(logger, 'info', 'linkedin_job.semantic_heading.selected', {
    text: captureTarget?.description?.headingText ?? null,
    tag: captureTarget?.description?.headingTag ?? null,
    cssPath: captureTarget?.description?.headingCssPath ?? null,
  });
  logCaptureEvent(logger, 'info', 'linkedin_job.description_region.selected', {
    strategy: captureTarget?.description?.strategy ?? descriptionMatch.strategy ?? null,
    cssPath: captureTarget?.description?.cssPath ?? descriptionMatch.cssPath ?? null,
    rootPath: captureTarget?.description?.rootPath ?? captureTarget?.description?.cssPath ?? null,
    textLength: captureTarget?.description?.textLength ?? descriptionLength,
    paragraphCount: captureTarget?.description?.paragraphCount ?? 0,
    listItemCount: captureTarget?.description?.listItemCount ?? 0,
    stoppedBy: captureTarget?.description?.stoppedBy ?? null,
    stopReason: captureTarget?.description?.stopReason ?? null,
    stopCssPath: captureTarget?.description?.stopCssPath ?? null,
    stopTextPreview: captureTarget?.description?.stopTextPreview ?? null,
    traversalStartPath: captureTarget?.description?.traversalStartPath ?? null,
    traversedNodeCount: captureTarget?.description?.traversedNodeCount ?? 0,
    acceptedBlockCount: captureTarget?.description?.acceptedBlockCount ?? 0,
    rejectedBlockCount: captureTarget?.description?.rejectedBlockCount ?? 0,
    first80Chars: captureTarget?.description?.first80Chars ?? null,
    last80Chars: captureTarget?.description?.last80Chars ?? null,
  });
  logCaptureEvent(logger, 'info', 'linkedin_job.description.strategy_selected', {
    strategy: captureTarget?.description?.strategy ?? descriptionMatch.strategy,
    tag: captureTarget?.detailRoot?.tag ?? descriptionMatch.tag,
    role: captureTarget?.detailRoot?.role ?? descriptionMatch.role,
    className: captureTarget?.detailRoot?.className ?? descriptionMatch.className,
    textLength: descriptionLength,
  });
  logCaptureEvent(logger, 'info', 'linkedin_job.description_loaded', {
    currentUrl,
    currentJobId,
    strategy: captureTarget?.description?.strategy ?? descriptionMatch.strategy,
    cssPath: captureTarget?.description?.cssPath ?? descriptionMatch.cssPath,
    length: descriptionLength,
  });

  return {
    selector: captureTarget?.detailRoot?.cssPath ?? descriptionMatch.cssPath,
    strategy: captureTarget?.detailRoot?.strategy ?? descriptionMatch.strategy,
    tag: captureTarget?.detailRoot?.tag ?? descriptionMatch.tag,
    role: captureTarget?.detailRoot?.role ?? descriptionMatch.role,
    className: captureTarget?.detailRoot?.className ?? descriptionMatch.className,
    captureTarget,
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
  const resolvedCaptureTarget =
    typeof options === 'object' && options?.resolvedCaptureTarget && typeof options.resolvedCaptureTarget === 'object'
      ? options.resolvedCaptureTarget
      : null;
  const selectedJobDescriptionSelector =
    typeof options === 'object' ? String(options?.selectedJobDescriptionSelector ?? '').trim() : '';
  const documentRef = globalThis.document;
  const main = documentRef.querySelector('main') ?? documentRef.body;
  const minDescriptionLength = Number(options?.minDescriptionLength ?? 80);
  const ABOUT_HEADING_PATTERNS = [
    /\bacerca del empleo\b/i,
    /\bsobre el empleo\b/i,
    /\babout the job\b/i,
    /\bjob description\b/i,
    /\bdescripci[oó]n del empleo\b/i,
  ];
  const PROMOTION_PATTERNS = [
    /\bestar[ií]as entre los candidatos destacados\b/i,
    /\bpodemos ayudarte a captar el inter[eé]s\b/i,
    /\bfigurar[ií]as entre los principales solicitantes\b/i,
    /\badel[aá]ntate a solicitar\b/i,
    /\bmeet the hiring team\b/i,
    /\bconoce al equipo de contrataci[oó]n\b/i,
    /\bapplicant insights\b/i,
    /\bcandidate insights\b/i,
    /\btry premium\b/i,
    /\bpremium\b/i,
    /\bpromocionado por\b/i,
    /\bpromoted by\b/i,
    /\ba[uú]n no hay informaci[oó]n disponible\b/i,
    /\bthere is no information available\b/i,
    /\bno information available\b/i,
  ];

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
  const collectQueryNodes = (root, selectors) => {
    const nodes = [];
    const seen = new Set();

    for (const selector of selectors) {
      for (const node of root.querySelectorAll?.(selector) ?? []) {
        if (!seen.has(node)) {
          seen.add(node);
          nodes.push(node);
        }
      }
    }

    return nodes;
  };
  const buildCssPath = (node, stopNode = main) => {
    if (!node || node === stopNode) {
      return 'main';
    }

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
  const looksLikeListingCardText = (value) => {
    const text = toText(value);
    return LISTING_CARD_PATTERNS.some((pattern) => pattern.test(text));
  };
  const looksPromotional = (value) => {
    const text = toText(value);
    return PROMOTION_PATTERNS.some((pattern) => pattern.test(text));
  };
  const containsAboutHeading = (value) => {
    const text = toText(value);
    return ABOUT_HEADING_PATTERNS.some((pattern) => pattern.test(text));
  };
  const isListingCardNode = (node) => {
    if (!node) {
      return false;
    }

    const role = toText(node.getAttribute?.('role') ?? '');
    const text = readNodeText(node);
    const jobLinkCount = node.querySelectorAll?.('a[href*="/jobs/view/"], a[href*="currentJobId="]').length ?? 0;
    const listItemCount = node.querySelectorAll?.('li, [role="listitem"]').length ?? 0;
    const headingCount = node.querySelectorAll?.('h1, h2, h3').length ?? 0;
    const paragraphCount = node.querySelectorAll?.('p, li').length ?? 0;
    const structuralDetailSignals = headingCount > 0 || paragraphCount >= 2 || containsAboutHeading(text);

    return (
      role === 'button' ||
      jobLinkCount > 1 ||
      listItemCount >= 2 ||
      (looksLikeListingCardText(text) && !structuralDetailSignals)
    );
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
  const findBestDetailRoot = () => {
    const mainRect = main.getBoundingClientRect?.() ?? { left: 0, width: 0 };
    const candidates = [main, ...main.querySelectorAll('section, article, div')].slice(0, 400);
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const node of candidates) {
      const rect = node.getBoundingClientRect?.() ?? { left: 0, width: 0, height: 0 };
      const width = Number(rect.width ?? 0);
      const left = Number(rect.left ?? 0);
      const rightPanelLike =
        width >= Number(mainRect.width ?? 0) * 0.35 ||
        left >= Number(mainRect.left ?? 0) + Number(mainRect.width ?? 0) * 0.28;
      if (!rightPanelLike || isListingCardNode(node)) {
        continue;
      }

      const text = readNodeText(node);
      const headingCount = node.querySelectorAll?.('h1, h2, h3').length ?? 0;
      const paragraphCount = node.querySelectorAll?.('p, li').length ?? 0;
      const buttonCount = node.querySelectorAll?.('button, a[role="button"]').length ?? 0;
      const jobLinkCount = node.querySelectorAll?.('a[href*="/jobs/view/"], a[href*="currentJobId="]').length ?? 0;
      const hasHeader = Boolean(node.querySelector?.('h1'));
      const hasApplyControl = [...(node.querySelectorAll?.('button, a[role="button"], a') ?? [])]
        .map((child) => toText(child.textContent || child.getAttribute?.('aria-label')))
        .some((textValue) => /apply|postular|solicitud|easy apply/i.test(textValue));
      const aboutHeading = containsAboutHeading(text);

      let score = 0;
      if (hasHeader) {
        score += 80;
      }
      if (hasApplyControl) {
        score += 30;
      }
      if (aboutHeading) {
        score += 55;
      }
      if (paragraphCount >= 2) {
        score += 25;
      }
      if (headingCount >= 2) {
        score += 15;
      }
      if (looksPromotional(text) && !aboutHeading && paragraphCount === 0) {
        score -= 80;
      }
      score -= Math.min(jobLinkCount * 12, 60);
      score -= Math.min(buttonCount * 8, 32);

      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }

    return best;
  };
  const findHeaderRoot = (detailRoot) => {
    if (!detailRoot) {
      return main;
    }

    const heading = detailRoot.querySelector?.('h1');
    if (!heading) {
      return detailRoot;
    }

    let current = heading.parentElement;
    let best = detailRoot;
    while (current && current !== detailRoot && current !== main) {
      const text = readNodeText(current);
      const buttonCount = current.querySelectorAll?.('button, a[role="button"]').length ?? 0;
      if (buttonCount <= 4 && text.length <= 1200) {
        best = current;
      }
      current = current.parentElement;
    }

    return best;
  };
  const collectDescriptionRegionText = (headingNode, detailRoot) => {
    if (!headingNode || !detailRoot) {
      return '';
    }

    const blocks = [];
    const pushText = (text) => {
      if (!text || blocks.includes(text)) {
        return;
      }
      blocks.push(text);
    };
    const pushNode = (node) => {
      const text = readNodeText(node);
      if (!text || looksPromotional(text)) {
        return;
      }
      if (/apply|postular|premium|meet the hiring team|applicant insights|candidate insights/i.test(text)) {
        return;
      }
      pushText(text);
    };

    let sibling = headingNode.nextElementSibling;
    while (sibling) {
      const tag = String(sibling.tagName ?? '').toLowerCase();
      if (/^h[1-3]$/.test(tag) && !containsAboutHeading(readNodeText(sibling))) {
        break;
      }
      pushNode(sibling);
      sibling = sibling.nextElementSibling;
    }

    if (blocks.length === 0) {
      const parent = headingNode.parentElement;
      if (parent && detailRoot.contains(parent)) {
        for (const child of parent.children ?? []) {
          if (child === headingNode) {
            continue;
          }
          pushNode(child);
        }
      }
    }

    if (blocks.join('\n').length < minDescriptionLength) {
      const headingTop = Number(headingNode.getBoundingClientRect?.().top ?? 0);
      const descendants = collectQueryNodes(detailRoot, ['p', 'li', 'div', 'section, article, div', 'ul', 'ol', 'span']);

      for (const node of descendants) {
        if (!node || node === headingNode || headingNode.contains?.(node)) {
          continue;
        }

        const tag = String(node.tagName ?? '').toLowerCase();
        if (tag === 'a' || tag === 'button') {
          continue;
        }

        const nodeTop = Number(node.getBoundingClientRect?.().top ?? 0);
        if (nodeTop && headingTop && nodeTop < headingTop) {
          continue;
        }

        const text = readNodeText(node);
        const paragraphCount = node.querySelectorAll?.('p, li').length ?? 0;
        const listCount = node.querySelectorAll?.('li').length ?? 0;
        const linkCount = node.querySelectorAll?.('a').length ?? 0;
        const buttonCount = node.querySelectorAll?.('button, a[role="button"]').length ?? 0;
        const descriptiveEnough =
          tag === 'p' ||
          tag === 'li' ||
          paragraphCount + listCount >= 1 ||
          (text.length >= 80 && linkCount <= 4 && buttonCount <= 2);

        if (!descriptiveEnough) {
          continue;
        }

        pushNode(node);
      }
    }

    return toText(blocks.join('\n'));
  };
  const summarizeTextNode = (node, text = readNodeText(node)) => ({
    textLength: text.length,
    headingCount: node?.querySelectorAll?.('h1, h2, h3, h4, h5, h6').length ?? 0,
    paragraphCount: node?.querySelectorAll?.('p').length ?? 0,
    listCount: node?.querySelectorAll?.('li').length ?? 0,
    linkCount: node?.querySelectorAll?.('a').length ?? 0,
    buttonCount: node?.querySelectorAll?.('button, a[role="button"]').length ?? 0,
    geometry: node
      ? {
          left: Number(node.getBoundingClientRect?.().left ?? 0),
          width: Number(node.getBoundingClientRect?.().width ?? 0),
          height: Number(node.getBoundingClientRect?.().height ?? 0),
        }
      : null,
  });
  const findDescriptionRegion = (detailRoot) => {
    if (!detailRoot) {
      return {
        node: null,
        text: '',
        strategy: null,
        headingText: null,
        semanticHeadingMatches: 0,
        descriptiveBlockCandidates: 0,
        rejectedCandidates: [],
      };
    }

    const headings = collectQueryNodes(detailRoot, ['h1, h2, h3', 'span', 'div', 'p']).filter((node) =>
      containsAboutHeading(readNodeText(node)),
    );
    for (const headingNode of headings) {
      const text = collectDescriptionRegionText(headingNode, detailRoot);
      if (text.length >= minDescriptionLength && !looksPromotional(text)) {
        return {
          node: headingNode.parentElement ?? headingNode,
          text,
          strategy: 'about_heading_region',
          headingText: readNodeText(headingNode),
          semanticHeadingMatches: headings.length,
          descriptiveBlockCandidates: 1,
          rejectedCandidates: [],
        };
      }
    }

    const selectorNode = readFirstNode(jobDescriptionSelectors, detailRoot);
    const selectorText = readNodeText(selectorNode);
    if (
      selectorNode &&
      selectorNode !== detailRoot &&
      selectorText.length >= minDescriptionLength &&
      !looksPromotional(selectorText)
    ) {
      return {
        node: selectorNode,
        text: selectorText,
        strategy: 'selector_region',
        headingText: null,
        semanticHeadingMatches: headings.length,
        descriptiveBlockCandidates: 1,
        rejectedCandidates: [],
      };
    }

    const regionCandidates = collectQueryNodes(detailRoot, ['section, article, div', 'p, li', 'ul', 'ol'])
      .map((node) => {
        const text = readNodeText(node);
        const buttonCount = node.querySelectorAll?.('button, a[role="button"]').length ?? 0;
        const linkCount = node.querySelectorAll?.('a').length ?? 0;
        const paragraphCount = node.querySelectorAll?.('p, li').length ?? 0;
        const headingCount = node.querySelectorAll?.('h2, h3').length ?? 0;
        const aboutHeading = containsAboutHeading(text);
        const containsApplyControl = [...(node.querySelectorAll?.('button, a[role="button"], a') ?? [])]
          .map((child) => toText(child.textContent || child.getAttribute?.('aria-label')))
          .some((textValue) => /apply|postular|solicitud|easy apply/i.test(textValue));
        const containsPromotionNoise = looksPromotional(text);
        const score =
          text.length +
          paragraphCount * 120 +
          (aboutHeading ? 140 : 0) +
          headingCount * 40 -
          buttonCount * 90 -
          linkCount * 20 -
          (containsApplyControl ? 160 : 0) -
          (containsPromotionNoise ? 400 : 0) -
          (node === detailRoot && containsPromotionNoise ? 600 : 0);

        return {
          node,
          text,
          buttonCount,
          linkCount,
          paragraphCount,
          listCount: node.querySelectorAll?.('li').length ?? 0,
          headingCount,
          aboutHeading,
          containsApplyControl,
          containsPromotionNoise,
          score,
        };
      })
      .filter((candidate) => candidate.text.length >= minDescriptionLength)
      .sort((left, right) => right.score - left.score || right.text.length - left.text.length);

    const semanticFallback = regionCandidates.find(
      (candidate) =>
        !candidate.containsPromotionNoise &&
        (candidate.paragraphCount + candidate.headingCount > 0 || candidate.aboutHeading) &&
        candidate.buttonCount <= 3,
    );

    if (semanticFallback) {
      return {
        node: semanticFallback.node,
        text: semanticFallback.text,
        strategy: 'detail_root_semantic_fallback',
        headingText: null,
        semanticHeadingMatches: headings.length,
        descriptiveBlockCandidates: regionCandidates.length,
        rejectedCandidates: regionCandidates
          .filter((candidate) => candidate !== semanticFallback)
          .slice(0, 3)
          .map((candidate) => ({
            reason: candidate.containsPromotionNoise ? 'promotion_noise' : 'score_below_threshold',
            textLength: candidate.text.length,
            paragraphCount: candidate.paragraphCount,
            listCount: candidate.listCount,
            linkCount: candidate.linkCount,
            buttonCount: candidate.buttonCount,
            preview: candidate.text.slice(0, 120),
          })),
      };
    }

    return {
      node: null,
      text: '',
      strategy: null,
      headingText: null,
      semanticHeadingMatches: headings.length,
      descriptiveBlockCandidates: regionCandidates.length,
      rejectedCandidates: regionCandidates.slice(0, 3).map((candidate) => ({
        reason: candidate.containsPromotionNoise ? 'promotion_noise' : 'score_below_threshold',
        textLength: candidate.text.length,
        paragraphCount: candidate.paragraphCount,
        listCount: candidate.listCount,
        linkCount: candidate.linkCount,
        buttonCount: candidate.buttonCount,
        preview: candidate.text.slice(0, 120),
      })),
    };
  };
  const findCompanyNearTitle = (headerRoot) => {
    if (!headerRoot) {
      return '';
    }

    const anchors = [...headerRoot.querySelectorAll?.('a') ?? []]
      .map((node) => ({
        node,
        text: readNodeText(node),
        href: String(node.getAttribute?.('href') ?? ''),
      }))
      .filter((entry) => entry.text);

    const companyAnchor = anchors.find((entry) => entry.href.includes('/company/'));
    if (companyAnchor) {
      return companyAnchor.text;
    }

    return (
      anchors.find(
        (entry) =>
          !entry.href.includes('/jobs/') &&
          !/apply|postular|solicitud|easy apply/i.test(entry.text) &&
          entry.text.length <= 120,
      )?.text ?? ''
    );
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

  const selectedDetailRootNode = resolvedCaptureTarget?.detailRoot?.cssPath
    ? documentRef.querySelector(resolvedCaptureTarget.detailRoot.cssPath)
    : null;
  const selectedDescriptionNode = resolvedCaptureTarget?.description?.cssPath
    ? documentRef.querySelector(resolvedCaptureTarget.description.cssPath)
    : selectedJobDescriptionSelector
      ? documentRef.querySelector(selectedJobDescriptionSelector)
      : null;
  const selectedHeaderRootNode = resolvedCaptureTarget?.headerRoot?.cssPath
    ? documentRef.querySelector(resolvedCaptureTarget.headerRoot.cssPath)
    : null;
  const resolvedDescriptionText = toText(resolvedCaptureTarget?.description?.text);
  const resolvedDescriptionBlockTextsFromTarget =
    Array.isArray(resolvedCaptureTarget?.description?.blockTexts)
      ? resolvedCaptureTarget.description.blockTexts.map((value) => toText(value)).filter(Boolean)
      : [];
  const resolvedDescriptionBlockTexts =
    Array.isArray(resolvedCaptureTarget?.description?.blockPaths)
      ? resolvedCaptureTarget.description.blockPaths
          .map((cssPath) => readNodeText(documentRef.querySelector(cssPath)))
          .filter(Boolean)
      : [];
  const selectedDescriptionRoot = selectedDetailRootNode ?? findDetailRoot(selectedDescriptionNode);
  const semanticDetailRoot = selectedDescriptionRoot || resolvedCaptureTarget ? null : findBestDetailRoot();
  const selectorFallbackRoot = readFirstNode(
    [
      '[aria-label*="job details" i]',
      '[aria-label*="detalles del empleo" i]',
      '[class*="jobs-search__job-details"]',
      '[class*="job-details"]',
    ],
    main,
  );
  const detailRoot = selectedDescriptionRoot ?? semanticDetailRoot ?? selectorFallbackRoot ?? main;
  const detailRootStrategy = selectedDetailRootNode
    ? 'resolved_capture_target'
    : selectedDescriptionRoot
    ? 'selected_description_ancestor'
    : semanticDetailRoot
      ? 'semantic_detail_root'
      : 'selector_or_main_fallback';
  const headerRoot = selectedHeaderRootNode ?? findHeaderRoot(detailRoot) ?? detailRoot ?? main;
  const descriptionRegion = findDescriptionRegion(detailRoot);

  const titleCandidates = readTexts([
    'h1',
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
  if (companyCandidates.length === 0) {
    const fallbackCompany = findCompanyNearTitle(headerRoot);
    if (fallbackCompany) {
      companyCandidates.push(fallbackCompany);
    }
  }
  const metadataItems = readTexts([
    '[class*="job-details-jobs-unified-top-card__primary-description-container"] span',
    '[class*="job-details-jobs-unified-top-card__tertiary-description-container"] span',
    '[class*="job-details-jobs-unified-top-card__job-insight"]',
    '[class*="jobs-unified-top-card__subtitle-primary-grouping"] span',
    '[class*="jobs-unified-top-card__subtitle-secondary-grouping"] span',
    'span',
  ], headerRoot);
  const selectorDescriptionNode = readFirstNode(jobDescriptionSelectors, detailRoot);
  const selectorDescriptionText = readNodeText(selectorDescriptionNode);
  const safeSelectorDescriptionNode =
    selectorDescriptionNode &&
    selectorDescriptionNode !== detailRoot &&
    selectorDescriptionText.length >= minDescriptionLength &&
    !looksPromotional(selectorDescriptionText)
      ? selectorDescriptionNode
      : null;
  const safeSelectorDescriptionText = safeSelectorDescriptionNode ? selectorDescriptionText : '';
  const descriptionNode =
    selectedDescriptionNode ??
    descriptionRegion.node ??
    safeSelectorDescriptionNode ??
    detailRoot ??
    null;
  const descriptionBlocks = [...new Set(
    (resolvedDescriptionBlockTexts.length
      ? resolvedDescriptionBlockTexts
      : resolvedDescriptionBlockTextsFromTarget.length
        ? resolvedDescriptionBlockTextsFromTarget
        : resolvedDescriptionText
          ? [resolvedDescriptionText]
      : (resolvedCaptureTarget?.description?.textLength ?? 0) > 0 && selectedDescriptionNode
        ? [readNodeText(selectedDescriptionNode)]
        : descriptionRegion.text
          ? [descriptionRegion.text]
          : [])
      .concat(readNodeTexts(descriptionNode, ['li', 'p', 'h2', 'h3', 'h4', 'h5', 'h6']))
      .concat(readNodeTexts(descriptionNode, ['span']))
      .map((value) => toText(value))
      .filter(Boolean)
      .filter((value) => !containsAboutHeading(value))
      .filter((value) => !looksPromotional(value))
      .filter((value) => !/apply|postular|solicitud|easy apply|premium|meet the hiring team|applicant insights|candidate insights/i.test(value)),
  )];
  const fallbackDescription =
    (resolvedDescriptionBlockTexts.length
      ? resolvedDescriptionBlockTexts.join('\n')
      : resolvedDescriptionBlockTextsFromTarget.length
        ? resolvedDescriptionBlockTextsFromTarget.join('\n')
        : resolvedDescriptionText
          ? resolvedDescriptionText
      : (resolvedCaptureTarget?.description?.textLength ?? 0) > 0 && selectedDescriptionNode
        ? readNodeText(selectedDescriptionNode)
        : '') ||
    descriptionRegion.text ||
    descriptionBlocks.find((block) => block.length >= minDescriptionLength) ||
    safeSelectorDescriptionText ||
    '';
  const description = fallbackDescription;
  const detailPaneSummary =
    detailRoot && detailRoot !== main
      ? summarizeTextNode(detailRoot)
      : resolvedCaptureTarget?.detailRoot
        ? {
            textLength: resolvedCaptureTarget.detailRoot.textLength ?? 0,
            headingCount: resolvedCaptureTarget.detailRoot.headingCount ?? 0,
            paragraphCount: resolvedCaptureTarget.detailRoot.paragraphCount ?? 0,
            listCount: resolvedCaptureTarget.detailRoot.listCount ?? 0,
            linkCount: 0,
            buttonCount: resolvedCaptureTarget.detailRoot.buttonCount ?? 0,
            geometry: {
              left: 0,
              width: resolvedCaptureTarget.detailRoot.width ?? 0,
              height: resolvedCaptureTarget.detailRoot.height ?? 0,
            },
          }
        : summarizeTextNode(detailRoot);
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
      detailRootStrategy,
      detailPaneSummary,
      titleCandidates,
      companyCandidates,
      metadataItems,
      description,
      descriptionStrategy:
        resolvedCaptureTarget?.description?.strategy ??
        descriptionRegion.strategy ??
        (description ? 'detail_block_fallback' : null),
      descriptionSummary: {
        strategy:
          resolvedCaptureTarget?.description?.strategy ??
          descriptionRegion.strategy ??
          (description ? 'detail_block_fallback' : null),
        headingText: resolvedCaptureTarget?.description?.headingText ?? descriptionRegion.headingText ?? null,
        textLength: description.length,
        paragraphCount: resolvedCaptureTarget?.description?.paragraphCount ?? descriptionNode?.querySelectorAll?.('p').length ?? 0,
        listCount: resolvedCaptureTarget?.description?.listItemCount ?? descriptionNode?.querySelectorAll?.('li').length ?? 0,
        cssPath: resolvedCaptureTarget?.description?.cssPath ?? (descriptionNode ? buildCssPath(descriptionNode, main) : null),
        semanticHeadingMatches: resolvedCaptureTarget?.description?.semanticHeadingMatches ?? descriptionRegion.semanticHeadingMatches ?? 0,
        descriptiveBlockCandidates:
          resolvedCaptureTarget?.description?.descriptiveBlockCandidates ?? descriptionRegion.descriptiveBlockCandidates ?? 0,
        rejectedCandidates: resolvedCaptureTarget?.description?.rejectedCandidates ?? descriptionRegion.rejectedCandidates ?? [],
      },
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

  if (looksLikeListingCardText(text) || looksLikeDescriptionNoise(text)) {
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

function looksLikeDescriptionNoise(value) {
  const text = cleanText(value);
  return LINKEDIN_DESCRIPTION_NOISE_PATTERNS.some((pattern) => pattern.test(text));
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

async function waitForLinkedInJobDescriptionMatch(page, logger, options = {}) {
  const startedAt = Date.now();
  const expectedJobId = options.currentJobId ?? null;
  let stableCount = 0;
  let failureStableCount = 0;
  let previousSignature = null;
  let previousFailureSignature = null;
  let lastProbe = null;
  let lastInspection = null;
  let probeCount = 0;
  let maxCandidateCount = 0;
  let maxTextLength = 0;
  let maxSelectedTextLength = 0;

  logCaptureEvent(logger, 'debug', 'linkedin_job.description.wait_started', {
    currentJobId: expectedJobId,
    elapsedMs: 0,
  });

  while (Date.now() - startedAt < JOB_CAPTURE_GLOBAL_TIMEOUT_MS) {
    const currentUrl = safePageUrl(page);
    const { currentJobId } = parseLinkedInJobCaptureUrl(currentUrl);

    if (expectedJobId && currentJobId && currentJobId !== expectedJobId) {
      const waitedMs = Date.now() - startedAt;
      logCaptureEvent(logger, 'debug', 'linkedin_job.description.wait_probe', {
        currentJobId,
        candidateCount: lastProbe?.candidateCount ?? 0,
        selectedStrategy: lastProbe?.selectedStrategy ?? null,
        textLength: lastProbe?.selectedTextLength ?? 0,
        stableCount,
        elapsedMs: waitedMs,
      });
      logLinkedInJobWaitSummary(logger, {
        currentJobId,
        elapsedMs: waitedMs,
        probeCount,
        maxCandidateCount,
        lastCandidateCount: lastProbe?.candidateCount ?? 0,
        maxTextLength,
        maxSelectedTextLength,
        lastTextLength: lastProbe?.maxCandidateTextLength ?? 0,
        selectedTextLength: lastProbe?.selectedTextLength ?? 0,
        selectedStrategy: lastProbe?.selectedStrategy ?? null,
        inspection: lastInspection,
        reason: 'job_changed',
      });
      return {
        status: 'job_changed',
        currentUrl,
        currentJobId,
        candidateCount: lastProbe?.candidateCount ?? 0,
        selectedStrategy: lastProbe?.selectedStrategy ?? null,
        length: lastProbe?.length ?? 0,
        waitedMs,
        inspection: lastInspection,
      };
    }

    const inspection = await page.evaluate(inspectLinkedInJobDomInPage, {
      currentJobId: expectedJobId,
      minTextLength: JOB_DOM_MIN_TEXT_LENGTH,
      minDescriptionLength: MIN_JOB_DESCRIPTION_TEXT_LENGTH,
      candidateLimit: JOB_DOM_CANDIDATE_LIMIT,
      attemptedStrategies: JOB_DESCRIPTION_STRATEGIES,
      supportSelectors: JOB_DESCRIPTION_SELECTORS,
      returnSelectedCandidate: true,
    });
    probeCount += 1;
    lastInspection = inspection;

    const match = inspection?.selectedCandidate ?? null;
    const captureTarget = inspection?.captureTarget ?? null;
    const probe = {
      candidateCount: inspection?.candidateCount ?? 0,
      maxCandidateTextLength: inspection?.maxCandidateTextLength ?? 0,
      selectedStrategy: captureTarget?.description?.strategy ?? match?.strategy ?? null,
      selectedTextLength: captureTarget?.description?.textLength ?? match?.textLength ?? 0,
      currentUrl,
      currentJobId,
      match,
      captureTarget,
    };
    lastProbe = probe;
    maxCandidateCount = Math.max(maxCandidateCount, probe.candidateCount);
    maxTextLength = Math.max(maxTextLength, probe.maxCandidateTextLength);
    maxSelectedTextLength = Math.max(maxSelectedTextLength, probe.selectedTextLength);

    const waitedMs = Date.now() - startedAt;
    logCaptureEvent(logger, 'debug', 'linkedin_job.description.wait_probe', {
      currentJobId: currentJobId ?? expectedJobId,
      candidateCount: probe.candidateCount,
      selectedStrategy: probe.selectedStrategy,
      textLength: probe.selectedTextLength,
      stableCount,
      elapsedMs: waitedMs,
    });

    const readyDetailRootCssPath = captureTarget?.detailRoot?.cssPath ?? match?.cssPath ?? null;
    const readyDetailRootTextLength = captureTarget?.detailRoot?.textLength ?? match?.textLength ?? 0;
    const readyDescriptionCssPath = captureTarget?.description?.cssPath ?? match?.cssPath ?? null;
    const readyDescriptionTextLength = captureTarget?.description?.textLength ?? match?.textLength ?? 0;

    if (
      readyDetailRootCssPath &&
      readyDescriptionCssPath &&
      readyDescriptionTextLength >= MIN_JOB_DESCRIPTION_TEXT_LENGTH
    ) {
      const signature = [
        currentJobId ?? expectedJobId ?? '',
        readyDetailRootCssPath,
        readyDetailRootTextLength,
        readyDescriptionCssPath,
        readyDescriptionTextLength,
      ].join('|');
      stableCount = signature === previousSignature ? stableCount + 1 : 1;
      previousSignature = signature;

      if (stableCount >= 2) {
        logCaptureEvent(logger, 'debug', 'linkedin_job.description.stable', {
          currentJobId: currentJobId ?? expectedJobId,
          candidateCount: probe.candidateCount,
          selectedStrategy: probe.selectedStrategy,
          textLength: probe.selectedTextLength,
          stableCount,
          elapsedMs: waitedMs,
        });
        logLinkedInJobWaitSummary(logger, {
          currentJobId: currentJobId ?? expectedJobId,
          elapsedMs: waitedMs,
          probeCount,
          maxCandidateCount,
          lastCandidateCount: probe.candidateCount,
          maxTextLength,
          maxSelectedTextLength,
          lastTextLength: probe.maxCandidateTextLength,
          selectedTextLength: probe.selectedTextLength,
          selectedStrategy: probe.selectedStrategy,
          inspection,
          reason: 'ready',
        });
        return {
          status: 'ready',
          currentUrl,
          currentJobId,
          candidateCount: probe.candidateCount,
          selectedStrategy: probe.selectedStrategy,
          length: probe.selectedTextLength,
          waitedMs,
          match,
          captureTarget,
          inspection,
        };
      }
    } else {
      stableCount = 0;
      previousSignature = null;

      const failureDetailRootCssPath = captureTarget?.detailRoot?.cssPath ?? match?.cssPath ?? null;
      const failureDetailRootTextLength = captureTarget?.detailRoot?.textLength ?? match?.textLength ?? 0;
      const failureDescriptionCssPath = captureTarget?.description?.cssPath ?? null;
      const failureDescriptionTextLength = captureTarget?.description?.textLength ?? 0;
      const failureSignature = [
        currentJobId ?? expectedJobId ?? '',
        failureDetailRootCssPath ?? '',
        failureDetailRootTextLength,
        failureDescriptionCssPath ?? '',
        failureDescriptionTextLength,
      ].join('|');

      if (failureDetailRootCssPath && failureDetailRootTextLength >= MIN_JOB_DESCRIPTION_TEXT_LENGTH) {
        failureStableCount = failureSignature === previousFailureSignature ? failureStableCount + 1 : 1;
        previousFailureSignature = failureSignature;

        if (failureStableCount >= 2) {
          logLinkedInJobWaitSummary(logger, {
            currentJobId: currentJobId ?? expectedJobId,
            elapsedMs: waitedMs,
            probeCount,
            maxCandidateCount,
            lastCandidateCount: probe.candidateCount,
            maxTextLength,
            maxSelectedTextLength,
            lastTextLength: probe.maxCandidateTextLength,
            selectedTextLength: probe.selectedTextLength,
            selectedStrategy: probe.selectedStrategy,
            inspection,
            reason: 'not_found',
          });
          return {
            status: 'not_found',
            currentUrl,
            currentJobId,
            candidateCount: probe.candidateCount,
            selectedStrategy: probe.selectedStrategy,
            length: probe.selectedTextLength,
            candidateMaxTextLength: probe.maxCandidateTextLength,
            waitedMs,
            match,
            captureTarget,
            inspection,
          };
        }
      } else {
        failureStableCount = 0;
        previousFailureSignature = null;
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, JOB_CAPTURE_POLL_INTERVAL_MS);
    });
  }

  const waitedMs = Date.now() - startedAt;
  logCaptureEvent(logger, 'debug', 'linkedin_job.description.wait_timeout', {
    currentJobId: lastProbe?.currentJobId ?? expectedJobId,
    candidateCount: lastProbe?.candidateCount ?? 0,
    selectedStrategy: lastProbe?.selectedStrategy ?? null,
    textLength: lastProbe?.selectedTextLength ?? 0,
    stableCount,
    elapsedMs: waitedMs,
  });
  logLinkedInJobWaitSummary(logger, {
    currentJobId: lastProbe?.currentJobId ?? expectedJobId,
    elapsedMs: waitedMs,
    probeCount,
    maxCandidateCount,
    lastCandidateCount: lastProbe?.candidateCount ?? 0,
    maxTextLength,
    maxSelectedTextLength,
    lastTextLength: lastProbe?.maxCandidateTextLength ?? 0,
    selectedTextLength: lastProbe?.selectedTextLength ?? 0,
    selectedStrategy: lastProbe?.selectedStrategy ?? null,
    inspection: lastInspection,
    reason:
      (lastInspection?.detailCandidateCount ?? 0) > 0 && (lastInspection?.maxCandidateTextLength ?? 0) >= MIN_JOB_DESCRIPTION_TEXT_LENGTH
        ? 'not_found'
        : 'timeout',
  });

  return {
    status:
      (lastInspection?.detailCandidateCount ?? 0) > 0 && (lastInspection?.maxCandidateTextLength ?? 0) >= MIN_JOB_DESCRIPTION_TEXT_LENGTH
        ? 'not_found'
        : 'timeout',
    currentUrl: lastProbe?.currentUrl ?? safePageUrl(page),
    currentJobId: lastProbe?.currentJobId ?? expectedJobId,
    candidateCount: lastProbe?.candidateCount ?? 0,
    selectedStrategy: lastProbe?.selectedStrategy ?? null,
    length: lastProbe?.selectedTextLength ?? 0,
    candidateMaxTextLength: lastProbe?.maxCandidateTextLength ?? 0,
    waitedMs,
    match: null,
    captureTarget: lastInspection?.captureTarget ?? null,
    inspection: lastInspection,
  };
}

function logLinkedInJobWaitSummary(logger, summary) {
  const inspection = summary.inspection ?? null;
  const payload = {
    currentJobId: summary.currentJobId ?? null,
    elapsedMs: summary.elapsedMs ?? 0,
    probeCount: summary.probeCount ?? 0,
    maxCandidateCount: summary.maxCandidateCount ?? 0,
    rawCandidateCount: inspection?.rawCandidateCount ?? inspection?.candidateCount ?? 0,
    detailCandidateCount: inspection?.detailCandidateCount ?? 0,
    eligibleCandidateCount: inspection?.eligibleCandidateCount ?? 0,
    lastCandidateCount: summary.lastCandidateCount ?? 0,
    maxTextLength: summary.maxTextLength ?? 0,
    lastTextLength: summary.lastTextLength ?? 0,
    selectedTextLength: summary.selectedTextLength ?? 0,
    maxSelectedTextLength: summary.maxSelectedTextLength ?? 0,
    selectedStrategy: summary.selectedStrategy ?? null,
    bodyTextLength: inspection?.bodyTextLength ?? 0,
    mainTextLength: inspection?.mainTextLength ?? 0,
    visibleSectionCount: inspection?.visibleSectionCount ?? 0,
    visibleArticleCount: inspection?.visibleArticleCount ?? 0,
    visibleDivCount: inspection?.visibleDivCount ?? 0,
    iframeCount: inspection?.iframeCount ?? 0,
    reason: summary.reason ?? 'unknown',
  };

  if ((summary.maxCandidateCount ?? 0) === 0 && Array.isArray(inspection?.discardedNodes) && inspection.discardedNodes.length) {
    payload.discardedNodes = inspection.discardedNodes.slice(0, 5);
  }

  logCaptureEvent(logger, 'info', 'linkedin_job.description.wait_summary', payload);
}

function inspectLinkedInJobDomInPage(options = {}) {
  const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const parseCaptureUrl = (url) => {
    const value = String(url ?? '').trim();
    const currentJobIdMatch = value.match(/[?&]currentJobId=(\d+)/i);
    const currentJobId = currentJobIdMatch?.[1] ?? null;
    const isJobView = /\/jobs\/view\/\d+/i.test(value);
    const isSearchResultsJob = /\/jobs\/search-results\/?/i.test(value) && Boolean(currentJobId);
    return {
      currentUrl: value,
      currentJobId,
      isJobOfferUrl: isJobView || isSearchResultsJob,
    };
  };
  const strongListingCardPatterns = [
    /\bseleccionado\b/i,
    /\bvisto\b/i,
    /\badel[a-záéíóú]+\s+a\s+solicitar\s+el\s+empleo\b/i,
    /\bfigurar[ií]as\s+entre\b/i,
  ];
  const detailMetadataPatterns = [
    /\bpublicado\s+hace\b/i,
    /\bposted\s+\d+\s+\w+\s+ago\b/i,
    /\bmeet the hiring team\b/i,
  ];
  const hasStrongListingNoise = (value) =>
    strongListingCardPatterns.some((pattern) => pattern.test(normalizeText(value)));
  const hasDetailMetadataNoise = (value) =>
    detailMetadataPatterns.some((pattern) => pattern.test(normalizeText(value)));
  const readDirectText = (node) => {
    if (!node?.childNodes) {
      return '';
    }

    return [...node.childNodes]
      .filter((child) => child?.nodeType === 3)
      .map((child) => child?.textContent ?? '')
      .join(' ');
  };
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
  const activeJob = parseCaptureUrl(globalThis.location?.href ?? '');
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
  const visibleArticleCount = [...documentRef.querySelectorAll('article, [role="article"]')].filter((node) =>
    isVisible(node),
  ).length;
  const visibleDivCount = [...documentRef.querySelectorAll('div')].filter((node) => isVisible(node)).length;

  if (!main) {
    return {
      mainFound: false,
      activeJob,
      bodyTextLength,
      mainTextLength: 0,
      iframeCount,
      roleMainCount,
      roleArticleCount,
      visibleSectionCount,
      visibleArticleCount,
      visibleDivCount,
      attemptedStrategies,
      candidateCount: 0,
      candidates: [],
      selectedCandidate: null,
      discardedNodes: [],
      captureTarget: null,
    };
  }

  if (!activeJob.isJobOfferUrl) {
    return {
      mainFound: true,
      activeJob,
      bodyTextLength,
      mainTextLength: normalizeText(main.innerText ?? main.textContent ?? '').length,
      iframeCount,
      roleMainCount,
      roleArticleCount,
      visibleSectionCount,
      visibleArticleCount,
      visibleDivCount,
      attemptedStrategies,
      candidateCount: 0,
      rawCandidateCount: 0,
      detailCandidateCount: 0,
      eligibleCandidateCount: 0,
      maxCandidateTextLength: 0,
      candidates: [],
      selectedCandidate: null,
      discardedNodes: [],
      supportSelectors,
      captureTarget: null,
    };
  }

  const titleText = normalizeText(
    main.querySelector('h1')?.innerText ?? main.querySelector('h1')?.textContent ?? '',
  );
  const mainTextLength = normalizeText(main.innerText ?? main.textContent ?? '').length;
  const mainRect = main.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
  const scanNodes = [main, ...main.querySelectorAll('section, article, div')].slice(0, 500);
  const rawCandidates = [];
  const candidateNodeMap = new Map();
  const discardedNodes = [];

  for (const node of scanNodes) {
    if (!isVisible(node)) {
      continue;
    }

    const directText = normalizeText(readDirectText(node));
    const directTextLength = directText.length;
    const innerText = normalizeText(node.innerText ?? '');
    const innerTextLength = innerText.length;
    const textContent = normalizeText(node.textContent ?? '');
    const textContentLength = textContent.length;
    const aggregateTextLength = Math.max(innerTextLength, textContentLength, directTextLength);
    if (aggregateTextLength < minTextLength) {
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
    const text = innerText || textContent || directText;
    const hasAboutHeading = /about the job|acerca del empleo|job description|descripci[oó]n del empleo/i.test(text);
    const roleButtonLike = role === 'button';
    const strongListingNoise = hasStrongListingNoise(text);
    const detailMetadataNoise = hasDetailMetadataNoise(text);
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
    const hasDescriptiveStructure =
      hasAboutHeading ||
      paragraphCount > 0 ||
      (headingCount > 0 && applyControlCount > 0 && aggregateTextLength >= minDescriptionLength);
    const leftRatio = Number(mainRect.width ?? 0)
      ? Number(((Number(rect.left ?? 0) - Number(mainRect.left ?? 0)) / Number(mainRect.width ?? 1)).toFixed(3))
      : 0;
    const widthRatio = Number(mainRect.width ?? 0)
      ? Number((Number(rect.width ?? 0) / Number(mainRect.width ?? 1)).toFixed(3))
      : 0;
    const hasSignificantGeometry =
      Number(rect.width ?? 0) >= 250 &&
      Number(rect.height ?? 0) >= 120 &&
      widthRatio >= 0.25;
    const listingNoiseScore =
      (strongListingNoise ? 100 : 0) +
      (detailMetadataNoise ? 20 : 0) +
      (listingLike ? 50 : 0) +
      Math.min(jobLinkCount * 5, 25) +
      Math.min(listItemCount, 10);
    const rejectionReasons = [];

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

    if (hasTitle && applyControlCount > 0 && hasDescriptiveStructure && rightPanelLike) {
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

    if (rightPanelLike && hasDescriptiveStructure && aggregateTextLength >= minDescriptionLength) {
      score += 30;
    }

    if (hasSignificantGeometry) {
      score += 35;
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

    if (strongListingNoise) {
      score -= 90;
    }

    if (detailMetadataNoise && !hasDescriptiveStructure) {
      score -= 20;
    }

    if (node.closest?.('aside')) {
      score -= 40;
    }

    if (roleButtonLike) {
      score -= 120;
    }

    if (!hasSignificantGeometry) {
      score -= 140;
    }

    if (!rightPanelLike && jobLinkCount > 1) {
      score -= 50;
    }

    if (!rightPanelLike) {
      score -= 25;
      rejectionReasons.push('not_right_panel');
    }

    if (!hasDescriptiveStructure) {
      score -= 30;
      rejectionReasons.push('no_descriptive_blocks');
    }

    if (listingLike) {
      rejectionReasons.push('listing_like');
    }

    if (strongListingNoise) {
      rejectionReasons.push('listing_noise');
    }

    if (detailMetadataNoise) {
      rejectionReasons.push('detail_metadata_noise');
    }

    if (roleButtonLike) {
      rejectionReasons.push('role_button');
    }

    if (aggregateTextLength < minDescriptionLength) {
      rejectionReasons.push('description_too_short');
    }

    if (!hasCurrentJobId) {
      rejectionReasons.push('missing_current_job_marker');
    }

    if (!hasSignificantGeometry) {
      rejectionReasons.push('insufficient_geometry');
    }

    if (score <= 0) {
      discardedNodes.push({
        tag: String(node.tagName ?? '').toUpperCase(),
        role,
        ariaLabel: ariaLabel.slice(0, 80),
        directTextLength,
        innerTextLength,
        textContentLength,
        aggregateTextLength,
        leftRatio,
        left: Number(rect.left ?? 0),
        width: Number(rect.width ?? 0),
        height: Number(rect.height ?? 0),
        widthRatio,
        headingCount,
        paragraphCount,
        linkCount: node.querySelectorAll?.('a').length ?? 0,
        jobLinkCount,
        listItemCount,
        currentJobIdMatch: hasCurrentJobId,
        listingNoiseScore,
        preview: text.slice(0, 120),
        belongsToDetailRoot: rightPanelLike,
        rejectionReasons: [...new Set([...rejectionReasons, 'score_below_threshold'])].slice(0, 6),
        score,
        strategy,
      });
      continue;
    }

    rawCandidates.push({
      tag: String(node.tagName ?? '').toUpperCase(),
      id: normalizeText(node.id),
      className: className.slice(0, 140),
      role,
      ariaLabel: ariaLabel.slice(0, 140),
      textLength: aggregateTextLength,
      visible: true,
      depth: calculateDepth(node, main),
      directTextLength,
      innerTextLength,
      textContentLength,
      aggregateTextLength,
      jobLinkCount,
      linkCount: node.querySelectorAll?.('a').length ?? 0,
      listItemCount,
      applyControlCount,
      paragraphCount,
      headingCount,
      listingLike,
      strongListingNoise,
      detailMetadataNoise,
      roleButtonLike,
      hasAboutHeading,
      rightPanelLike,
      currentJobIdMatch: hasCurrentJobId,
      leftRatio,
      left: Number(rect.left ?? 0),
      width: Number(rect.width ?? 0),
      height: Number(rect.height ?? 0),
      widthRatio,
      listingNoiseScore,
      preview: text.slice(0, 120),
      rejectionReasons: [...new Set(rejectionReasons)].slice(0, 6),
      strategy,
      score,
      cssPath: buildCssPath(node, main),
    });
    candidateNodeMap.set(rawCandidates[rawCandidates.length - 1].cssPath, node);
  }

  const sortedCandidates = rawCandidates
    .sort((left, right) => right.score - left.score || right.textLength - left.textLength)
    .slice(0, candidateLimit);
  const selectedCandidate =
    sortedCandidates.find(
      (candidate) =>
        !candidate.listingLike &&
        !candidate.strongListingNoise &&
        !candidate.roleButtonLike &&
        candidate.rightPanelLike &&
        candidate.width >= 250 &&
        candidate.height >= 120 &&
        candidate.textLength >= minDescriptionLength,
    ) ??
    sortedCandidates.find(
      (candidate) =>
        !candidate.roleButtonLike &&
        candidate.rightPanelLike &&
        candidate.width >= 250 &&
        candidate.height >= 120 &&
        candidate.textLength >= minDescriptionLength,
    ) ??
    null;
  const maxCandidateTextLength = sortedCandidates.reduce(
    (maxLength, candidate) => Math.max(maxLength, Number(candidate.textLength ?? 0)),
    0,
  );
  const detailCandidates = sortedCandidates.filter((candidate) => candidate.rightPanelLike);
  const eligibleCandidates = sortedCandidates.filter(
    (candidate) =>
      !candidate.listingLike &&
      !candidate.strongListingNoise &&
      !candidate.roleButtonLike &&
      candidate.rightPanelLike &&
      candidate.width >= 250 &&
      candidate.height >= 120,
  );

  const selectedNode = selectedCandidate ? candidateNodeMap.get(selectedCandidate.cssPath) ?? null : null;
  const readNodeText = (node) => normalizeText(node?.innerText ?? node?.textContent ?? '');
  const readOwnText = (node) => {
    if (!node) {
      return '';
    }

    if (Array.isArray(node.childNodes)) {
      return normalizeText(
        node.childNodes
          .filter((child) => child?.nodeType === 3)
          .map((child) => child?.textContent ?? '')
          .join(' '),
      );
    }

    return '';
  };
  const collectQueryNodes = (root, selectors) => {
    const nodes = [];
    const seen = new Set();

    for (const selector of selectors) {
      for (const node of root?.querySelectorAll?.(selector) ?? []) {
        if (!seen.has(node)) {
          seen.add(node);
          nodes.push(node);
        }
      }
    }

    return nodes;
  };
  const SEMANTIC_HEADING_PATTERNS = [
    /^(acerca del empleo|acerca del puesto|sobre el empleo|sobre el puesto|descripci[oó]n del empleo)$/i,
    /^(about the job|about this job|job description)$/i,
  ];
  const DESCRIPTION_STOP_PATTERNS = [
    /\bmira una comparaci[oó]n con otras personas/i,
    /\bcandidatos que han hecho clic/i,
    /\bapplicant insights\b/i,
    /\bcandidate insights\b/i,
    /\bjob seeker insights\b/i,
    /\bestad[ií]sticas de solicitantes\b/i,
    /\bnivel de responsabilidad de los candidatos\b/i,
    /\bnivel educativo de los candidatos\b/i,
    /\bbasado en los datos de linkedin\b/i,
    /\binformaci[oó]n exclusiva sobre\b/i,
    /^(acerca de la empresa|about the company)$/i,
    /\bshow premium\b/i,
    /\bmostrar informaci[oó]n premium\b/i,
    /\bmeet the hiring team\b/i,
    /\bpeople you can reach out to\b/i,
    /\bconoce al equipo de contrataci[oó]n\b/i,
  ];
  const DESCRIPTION_NOISE_PATTERNS = [
    /\bpromocionado por\b/i,
    /\bpromoted by\b/i,
    /\ba[uú]n no hay informaci[oó]n disponible\b/i,
    /\bthere is no information available\b/i,
    /\bno information available\b/i,
    /\bestar[ií]as entre los candidatos destacados\b/i,
    /\bfigurar[ií]as entre los principales solicitantes\b/i,
    /\badel[aá]ntate a solicitar\b/i,
    /\btry premium\b/i,
    /\bpremium\b/i,
    /\bapplicant insights\b/i,
    /\bcandidate insights\b/i,
  ];
  const normalizeHeadingLabel = (value) => normalizeText(value).replace(/[:：]+$/u, '').trim();
  const isSemanticHeadingLabel = (value) =>
    SEMANTIC_HEADING_PATTERNS.some((pattern) => pattern.test(normalizeHeadingLabel(value)));
  const isDescriptionStopText = (value) =>
    DESCRIPTION_STOP_PATTERNS.some((pattern) => pattern.test(normalizeText(value)));
  const isDescriptionNoiseText = (value) =>
    DESCRIPTION_NOISE_PATTERNS.some((pattern) => pattern.test(normalizeText(value)));
  const summarizeCandidateText = (value) => normalizeText(value).slice(0, 80);
  const isStructuredLeafNode = (node) => {
    const tag = String(node?.tagName ?? '').toLowerCase();
    return /^(p|li|h1|h2|h3|h4|h5|h6)$/u.test(tag);
  };
  const hasNestedStructuredChildren = (node) =>
    (node?.querySelectorAll?.('p, li, h1, h2, h3, h4, h5, h6').length ?? 0) > 0;
  const findSemanticJobDescriptionHeading = (detailRoot) => {
    const candidates = collectQueryNodes(detailRoot, ['h1, h2, h3, h4, h5, h6', 'div', 'span', 'p'])
      .filter((node) => isVisible(node))
      .map((node) => {
        const directText = normalizeHeadingLabel(readOwnText(node));
        const fullText = normalizeHeadingLabel(readNodeText(node));
        const candidateText =
          directText && directText.length <= 80
            ? directText
            : fullText.length <= 80
              ? fullText
              : '';

        return {
          node,
          tag: String(node.tagName ?? '').toUpperCase(),
          cssPath: buildCssPath(node, main),
          text: candidateText,
          preview: summarizeCandidateText(candidateText || fullText),
          top: Number(node.getBoundingClientRect?.().top ?? 0),
          exact: isSemanticHeadingLabel(candidateText),
          fullTextLength: fullText.length,
        };
      })
      .filter((candidate) => candidate.text && candidate.exact)
      .sort((left, right) => {
        const leftHeadingPriority = /^H\d$/u.test(left.tag) ? 0 : 1;
        const rightHeadingPriority = /^H\d$/u.test(right.tag) ? 0 : 1;
        return (
          leftHeadingPriority - rightHeadingPriority ||
          left.top - right.top ||
          left.text.length - right.text.length
        );
      });

    return {
      selected: candidates[0] ?? null,
      candidates: candidates.slice(0, 5).map((candidate) => ({
        text: candidate.text,
        tag: candidate.tag,
        cssPath: candidate.cssPath,
      })),
    };
  };
  const collectDescendantsInDocumentOrder = (root) => {
    const ordered = [];
    const visit = (node) => {
      for (const child of node?.children ?? []) {
        ordered.push(child);
        visit(child);
      }
    };
    visit(root);
    return ordered;
  };
  const extractDescriptionRegionAfterHeading = (detailRoot, headingNode) => {
    if (!detailRoot || !headingNode) {
      return {
        rootNode: null,
        blockNodes: [],
        text: '',
        paragraphCount: 0,
        listItemCount: 0,
        blockCount: 0,
        stoppedBy: null,
        traversalStartPath: null,
        traversedNodeCount: 0,
        acceptedBlockCount: 0,
        rejectedBlockCount: 0,
      };
    }

    const orderedNodes = collectDescendantsInDocumentOrder(detailRoot);
    const headingIndex = orderedNodes.indexOf(headingNode);
    if (headingIndex < 0) {
      return {
        rootNode: null,
        blockNodes: [],
        text: '',
        paragraphCount: 0,
        listItemCount: 0,
        blockCount: 0,
        stoppedBy: null,
        traversalStartPath: null,
        traversedNodeCount: 0,
        acceptedBlockCount: 0,
        rejectedBlockCount: 0,
      };
    }

    const acceptedBlocks = [];
    const seenTexts = new Set();
    let stoppedBy = null;
    let stopReason = null;
    let stopCssPath = null;
    let stopTextPreview = null;
    let traversedNodeCount = 0;
    let rejectedBlockCount = 0;

    const buildTextEntry = (node, text, source = 'node') => ({
      node,
      text: normalizeText(text),
      source,
      cssPath: node ? buildCssPath(node, main) : null,
    });

    const findStopMarker = (node, ownText, text) => {
      if (node === headingNode || node.contains?.(headingNode)) {
        return null;
      }

      const tag = String(node.tagName ?? '').toLowerCase();
      const directCandidate =
        ownText ||
        (isStructuredLeafNode(node) || tag === 'button' || tag === 'a' || (node.children?.length ?? 0) === 0
          ? text
          : '');

      if (directCandidate && isDescriptionStopText(directCandidate)) {
        return {
          node,
          text: directCandidate,
          reason: 'self_stop_text',
        };
      }

      for (const descendant of collectDescendantsInDocumentOrder(node)) {
        if (!isVisible(descendant) || descendant === headingNode || descendant.contains?.(headingNode)) {
          continue;
        }

        const descendantOwnText = normalizeText(readOwnText(descendant));
        const descendantText = readNodeText(descendant);
        const descendantTag = String(descendant.tagName ?? '').toLowerCase();
        const candidate =
          descendantOwnText ||
          (isStructuredLeafNode(descendant) ||
          descendantTag === 'button' ||
          descendantTag === 'a' ||
          (descendant.children?.length ?? 0) === 0
            ? descendantText
            : '');

        if (candidate && isDescriptionStopText(candidate)) {
          return {
            node: descendant,
            text: candidate,
            reason: 'descendant_stop_text',
          };
        }
      }

      return null;
    };

    const shouldAcceptNode = (node, ownText, text, stopMarker) => {
      const tag = String(node.tagName ?? '').toLowerCase();
      const hasNestedStructuredDescendants = hasNestedStructuredChildren(node);
      const hasChildElements = (node.children?.length ?? 0) > 0;

      if (tag === 'ul' || tag === 'ol') {
        return false;
      }

      if (isStructuredLeafNode(node)) {
        return true;
      }

      if (stopMarker && stopMarker.node !== node) {
        return false;
      }

      if (hasNestedStructuredDescendants) {
        return false;
      }

      if (hasChildElements) {
        return false;
      }

      return (ownText || text).length >= 40;
    };

    const containsAcceptedDescendant = (node) =>
      acceptedBlocks.some(
        (accepted) =>
          accepted.node &&
          (accepted.node === node || node.contains?.(accepted.node) || accepted.node.contains?.(node)),
      );

    for (const node of orderedNodes.slice(headingIndex + 1)) {
      if (!node || !isVisible(node) || node === headingNode || node.contains?.(headingNode)) {
        continue;
      }

      traversedNodeCount += 1;

      const text = readNodeText(node);
      const ownText = normalizeText(readOwnText(node));
      const candidateText = ownText || text;

      if (!text) {
        rejectedBlockCount += 1;
        continue;
      }

      const stopMarker = findStopMarker(node, ownText, text);
      if (stopMarker && stopMarker.node === node) {
        stoppedBy = summarizeCandidateText(stopMarker.text);
        stopReason = stopMarker.reason;
        stopCssPath = buildCssPath(stopMarker.node, main);
        stopTextPreview = summarizeCandidateText(stopMarker.text);
        break;
      }

      if (
        isDescriptionNoiseText(candidateText) ||
        /easy apply|postular|solicitud|apply now|mostrar m[aá]s|show more/i.test(candidateText)
      ) {
        rejectedBlockCount += 1;
        continue;
      }

      const ownTextEntry =
        ownText &&
        ownText.length >= 40 &&
        !isDescriptionNoiseText(ownText) &&
        !(stopMarker && stopMarker.node === node && isDescriptionStopText(ownText))
          ? buildTextEntry(node, ownText, 'own_text')
          : null;

      if (stopMarker && stopMarker.node !== node && ownTextEntry && !seenTexts.has(ownTextEntry.text)) {
        seenTexts.add(ownTextEntry.text);
        acceptedBlocks.push(ownTextEntry);
      }

      if (!shouldAcceptNode(node, ownText, text, stopMarker) || containsAcceptedDescendant(node)) {
        rejectedBlockCount += 1;
        continue;
      }

      const acceptedEntry = buildTextEntry(node, ownText || text, ownText ? 'own_text' : 'node');
      if (seenTexts.has(acceptedEntry.text)) {
        rejectedBlockCount += 1;
        continue;
      }

      seenTexts.add(acceptedEntry.text);
      acceptedBlocks.push(acceptedEntry);
    }

    const findCommonAncestor = (entries) => {
      const nodes = entries.map((entry) => entry.node).filter(Boolean);
      if (!nodes.length) {
        return null;
      }

      let ancestor = nodes[0].parentElement ?? detailRoot;
      while (ancestor && ancestor !== detailRoot) {
        if (nodes.every((node) => ancestor.contains?.(node) || node === ancestor)) {
          return ancestor;
        }
        ancestor = ancestor.parentElement;
      }
      return detailRoot;
    };

    const text = acceptedBlocks.map((block) => block.text).join('\n');
    const paragraphCount = acceptedBlocks.filter((block) => /^p$/i.test(String(block.node?.tagName ?? ''))).length;
    const listItemCount = acceptedBlocks.filter((block) => /^li$/i.test(String(block.node?.tagName ?? ''))).length;

    return {
      rootNode: findCommonAncestor(acceptedBlocks),
      blockNodes: acceptedBlocks.map((block) => block.node).filter(Boolean),
      blockEntries: acceptedBlocks,
      text: normalizeText(text.replace(/\n+/g, '\n')),
      paragraphCount,
      listItemCount,
      blockCount: acceptedBlocks.length,
      stoppedBy,
      stopReason,
      stopCssPath,
      stopTextPreview,
      traversalStartPath: buildCssPath(headingNode, main),
      traversedNodeCount,
      acceptedBlockCount: acceptedBlocks.length,
      rejectedBlockCount,
    };
  };
  const buildTargetSummary = (node, candidate) => {
    if (!node || !candidate) {
      return null;
    }

    const semanticHeading = findSemanticJobDescriptionHeading(node);
    const descriptionRegion = semanticHeading.selected
      ? extractDescriptionRegionAfterHeading(node, semanticHeading.selected.node)
      : {
          rootNode: null,
        blockNodes: [],
        blockEntries: [],
        text: '',
        paragraphCount: 0,
        listItemCount: 0,
        blockCount: 0,
        stoppedBy: null,
        stopReason: null,
        stopCssPath: null,
        stopTextPreview: null,
      };

    return {
      detailRoot: {
        cssPath: candidate.cssPath,
        strategy: candidate.strategy,
        tag: candidate.tag,
        role: candidate.role,
        className: candidate.className,
        textLength: candidate.textLength,
        width: candidate.width,
        height: candidate.height,
        headingCount: candidate.headingCount,
        paragraphCount: candidate.paragraphCount,
        listCount: candidate.listItemCount,
        buttonCount: candidate.applyControlCount,
      },
      headerRoot: {
        cssPath: candidate.cssPath,
      },
      description: {
        cssPath: descriptionRegion.rootNode ? buildCssPath(descriptionRegion.rootNode, main) : null,
        rootPath: descriptionRegion.rootNode ? buildCssPath(descriptionRegion.rootNode, main) : null,
        blockPaths: (descriptionRegion.blockEntries ?? [])
          .map((block) => block.cssPath)
          .filter(Boolean),
        blockTexts: (descriptionRegion.blockEntries ?? []).map((block) => block.text).filter(Boolean),
        strategy: semanticHeading.selected ? 'about_heading_region' : null,
        headingText: semanticHeading.selected?.text ?? null,
        headingTag: semanticHeading.selected?.tag ?? null,
        headingCssPath: semanticHeading.selected?.cssPath ?? null,
        text: descriptionRegion.text,
        textLength: descriptionRegion.text.length,
        paragraphCount: descriptionRegion.paragraphCount,
        listItemCount: descriptionRegion.listItemCount,
        semanticHeadingMatches: semanticHeading.candidates.length,
        semanticHeadingCandidates: semanticHeading.candidates,
        descriptiveBlockCandidates: descriptionRegion.blockCount,
        rejectedCandidates: [],
        first80Chars: descriptionRegion.text.slice(0, 80),
        last80Chars: descriptionRegion.text.slice(-80),
        stoppedBy: descriptionRegion.stoppedBy,
        stopReason: descriptionRegion.stopReason,
        stopCssPath: descriptionRegion.stopCssPath,
        stopTextPreview: descriptionRegion.stopTextPreview,
        traversalStartPath: descriptionRegion.traversalStartPath,
        traversedNodeCount: descriptionRegion.traversedNodeCount,
        acceptedBlockCount: descriptionRegion.acceptedBlockCount,
        rejectedBlockCount: descriptionRegion.rejectedBlockCount,
      },
      semanticHeadingCandidates: semanticHeading.candidates,
    };
  };
  const captureTarget = buildTargetSummary(selectedNode, selectedCandidate);

  return {
    mainFound: true,
    activeJob,
    bodyTextLength,
    mainTextLength,
    iframeCount,
    roleMainCount,
    roleArticleCount,
    visibleSectionCount,
    visibleArticleCount,
    visibleDivCount,
    attemptedStrategies,
    candidateCount: rawCandidates.length,
    rawCandidateCount: rawCandidates.length,
    detailCandidateCount: detailCandidates.length,
    eligibleCandidateCount: eligibleCandidates.length,
    maxCandidateTextLength,
    candidates: sortedCandidates,
    selectedCandidate,
    captureTarget,
    discardedNodes: discardedNodes
      .sort((left, right) => right.score - left.score || right.textLength - left.textLength)
      .slice(0, 5),
    supportSelectors,
  };
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
