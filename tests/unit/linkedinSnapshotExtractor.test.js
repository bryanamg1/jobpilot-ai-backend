import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { captureLinkedInSnapshot } from '../../src/services/browser/linkedinSnapshotExtractor.js';

const SEARCH_RESULTS_URL =
  'https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421&keywords=backend';
const JOB_VIEW_URL = 'https://www.linkedin.com/jobs/view/12345';
const DETAIL_SELECTOR = 'main > section:nth-of-type(2) > div';
const LIST_SELECTOR = 'main > section:nth-of-type(1) > div';
const DETAIL_DESCRIPTION =
  'We are hiring a Backend Developer with strong Node.js, Express, MySQL and Jest experience. You will work with APIs, testing, observability and remote collaboration across LATAM teams.';
const LISTING_ONLY_TEXT =
  'Other openings Senior QA Engineer Product Designer DevOps Engineer Apply now Browse more jobs Save Easy Apply';
const ATTEMPTED_STRATEGIES = [
  'semantic_aria_details',
  'attribute_current_job',
  'semantic_detail_panel',
  'class_support',
  'right_panel_fallback',
];

function buildCandidate(overrides = {}) {
  return {
    cssPath: DETAIL_SELECTOR,
    strategy: 'semantic_detail_panel',
    tag: 'DIV',
    role: 'region',
    className: 'detail-panel surface',
    textLength: DETAIL_DESCRIPTION.length,
    visible: true,
    depth: 2,
    ...overrides,
  };
}

function buildInspection(overrides = {}) {
  const selectedCandidate =
    Object.prototype.hasOwnProperty.call(overrides, 'selectedCandidate')
      ? overrides.selectedCandidate
      : buildCandidate();
  const candidates = Object.prototype.hasOwnProperty.call(overrides, 'candidates')
    ? overrides.candidates
    : selectedCandidate
      ? [selectedCandidate]
      : [];

  return {
    mainFound: true,
    bodyTextLength: 6800,
    iframeCount: 0,
    roleMainCount: 1,
    roleArticleCount: 0,
    visibleSectionCount: 3,
    attemptedStrategies: ATTEMPTED_STRATEGIES,
    candidateCount: candidates.length,
    candidates,
    selectedCandidate,
    ...overrides,
  };
}

function buildSnapshot({
  url = SEARCH_RESULTS_URL,
  visibleText = `Backend Developer Acme Labs Remote LATAM ${DETAIL_DESCRIPTION}`,
  description = DETAIL_DESCRIPTION,
} = {}) {
  return {
    title: 'Backend Developer | LinkedIn',
    url,
    visibleText,
    selectors: {
      h1: 'Backend Developer',
      titleCandidates: ['Backend Developer'],
      companyCandidates: ['Acme Labs'],
      metadataItems: ['Remote', 'LATAM', 'Full-time', 'Junior'],
      description,
      descriptionBlocks: [
        'Requirements: Node.js, Express, MySQL, Jest.',
        'Benefits: remote work and product ownership.',
      ],
      recruiter: 'Jane Recruiter',
      ariaLabels: ['Job details', 'Easy Apply'],
      applyButtons: ['Easy Apply'],
    },
    jsonLd: {
      title: 'Backend Developer',
      company: 'Acme Labs',
      description,
    },
  };
}

function createPageMock(options = {}) {
  const url = options.url ?? SEARCH_RESULTS_URL;
  const selectedCandidate =
    Object.prototype.hasOwnProperty.call(options, 'selectedCandidate')
      ? options.selectedCandidate
      : buildCandidate();
  const inspectionOverrides = { selectedCandidate };
  if (Object.prototype.hasOwnProperty.call(options, 'candidates')) {
    inspectionOverrides.candidates = options.candidates;
  }
  const inspection = options.inspection ?? buildInspection(inspectionOverrides);
  const defaultLength =
    options.descriptionLength ??
    selectedCandidate?.textLength ??
    options.descriptionText?.length ??
    DETAIL_DESCRIPTION.length;
  const locators = new Map();

  const getLocator = (selector) => {
    if (locators.has(selector)) {
      return locators.get(selector);
    }

    const state = options.locatorStates?.[selector] ?? {
      visible: true,
      length: defaultLength,
    };
    const locator = {
      first: vi.fn(() => locator),
      waitFor: vi.fn(async () => {
        if (state.waitForError) {
          throw state.waitForError;
        }
      }),
      evaluate: vi.fn(async () => state.length ?? 0),
    };
    locators.set(selector, locator);
    return locator;
  };

  const page = {
    url: vi.fn(() => url),
    locator: vi.fn((selector) => getLocator(selector)),
    waitForFunction: vi.fn(async (fn, args, pollOptions) => {
      if (options.waitForFunctionError) {
        throw options.waitForFunctionError;
      }

      if (typeof options.waitForFunctionResultFactory === 'function') {
        return options.waitForFunctionResultFactory({ fn, args, pollOptions });
      }

      const result = Object.prototype.hasOwnProperty.call(options, 'waitForFunctionResult')
        ? options.waitForFunctionResult
        : selectedCandidate;

      return {
        jsonValue: async () => result,
      };
    }),
    evaluate: vi.fn(async (fn, args) => {
      if (fn.name === 'inspectLinkedInJobDomInPage') {
        return inspection;
      }

      if (fn.name === 'extractSnapshotPayloadInPage') {
        page.lastExtractArgs = args;
        if (typeof options.captureEval === 'function') {
          return options.captureEval(args);
        }

        return (
          options.rawSnapshot ??
          buildSnapshot({
            url,
            visibleText: options.visibleText,
            description: options.descriptionText,
          })
        );
      }

      throw new Error(`Unexpected evaluate call: ${fn.name}`);
    }),
  };

  return { page, getLocator };
}

function createBrowserNode({ tagName, id = '', className = '', text = '', attrs = {}, rect, children = [] }) {
  const node = {
    tagName,
    id,
    className,
    parentElement: null,
    children: [],
    ownText: text,
    attrs: { ...attrs, id },
    rect,
    append(child) {
      child.parentElement = node;
      node.children.push(child);
    },
    get textContent() {
      return [node.ownText, ...node.children.map((child) => child.textContent)].filter(Boolean).join(' ').trim();
    },
    get innerText() {
      return node.textContent;
    },
    getAttribute(name) {
      return node.attrs[name] ?? null;
    },
    getAttributeNames() {
      return Object.keys(node.attrs).filter(Boolean);
    },
    getBoundingClientRect() {
      return node.rect;
    },
    closest(selector) {
      if (selector !== 'aside') {
        return null;
      }

      let current = node.parentElement;
      while (current) {
        if (String(current.tagName).toLowerCase() === 'aside') {
          return current;
        }
        current = current.parentElement;
      }

      return null;
    },
    querySelector(selector) {
      return node.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      const descendants = collectDescendants(node);
      return descendants.filter((entry) => matchesSelector(entry, selector));
    },
  };

  for (const child of children) {
    node.append(child);
  }

  return node;
}

function collectDescendants(node) {
  const entries = [];
  for (const child of node.children) {
    entries.push(child);
    entries.push(...collectDescendants(child));
  }
  return entries;
}

function matchesSelector(node, selector) {
  if (selector === 'section, article, div') {
    return ['section', 'article', 'div'].includes(String(node.tagName).toLowerCase());
  }

  if (selector === 'span') {
    return String(node.tagName).toLowerCase() === 'span';
  }

  if (selector === 'h1') {
    return String(node.tagName).toLowerCase() === 'h1';
  }

  if (selector === 'main h1') {
    return String(node.tagName).toLowerCase() === 'h1';
  }

  if (selector === 'a[href*="/jobs/view/"], a[href*="currentJobId="]') {
    const href = String(node.getAttribute('href') ?? '');
    return String(node.tagName).toLowerCase() === 'a' && (href.includes('/jobs/view/') || href.includes('currentJobId='));
  }

  if (selector === 'a[href*="/company/"]') {
    const href = String(node.getAttribute('href') ?? '');
    return String(node.tagName).toLowerCase() === 'a' && href.includes('/company/');
  }

  if (selector === 'button, a[role="button"], a') {
    const tag = String(node.tagName).toLowerCase();
    return tag === 'button' || tag === 'a';
  }

  if (selector === 'li, [role="listitem"]') {
    return String(node.tagName).toLowerCase() === 'li' || node.getAttribute('role') === 'listitem';
  }

  if (selector === 'p') {
    return String(node.tagName).toLowerCase() === 'p';
  }

  if (selector === 'p, li') {
    return ['p', 'li'].includes(String(node.tagName).toLowerCase());
  }

  if (selector === 'h1, h2, h3') {
    return ['h1', 'h2', 'h3'].includes(String(node.tagName).toLowerCase());
  }

  const dataJobIdMatch = selector.match(/^\[data-job-id="(.+)"\]$/u);
  if (dataJobIdMatch) {
    return node.getAttribute('data-job-id') === dataJobIdMatch[1];
  }

  const currentJobIdMatch = selector.match(/^\[href\*="currentJobId=(.+)"\]$/u);
  if (currentJobIdMatch) {
    return String(node.getAttribute('href') ?? '').includes(`currentJobId=${currentJobIdMatch[1]}`);
  }

  return false;
}

function createBrowserDocumentFixture(options = {}) {
  const defaultRect = { left: 420, top: 0, width: 720, height: 120 };
  const listRect = { left: 0, top: 0, width: 280, height: 800 };
  const detailRect = { left: 420, top: 0, width: 720, height: 900 };
  const currentJobId = options.currentJobId ?? '4425937421';

  const listItems = Array.from({ length: 6 }, (_, index) =>
    createBrowserNode({
      tagName: 'LI',
      text: `Listing ${index + 1}`,
      rect: defaultRect,
      children: [
        createBrowserNode({
          tagName: 'A',
          text: `Job ${index + 1}`,
          rect: defaultRect,
          attrs: { href: `/jobs/view/${index + 1}` },
        }),
      ],
    }),
  );
  if (options.withSelectedListingButton) {
    listItems.unshift(
      createBrowserNode({
        tagName: 'DIV',
        text:
          'Seleccionado, Backend Engineer (Node.js, SQL) Backend Engineer (Node.js, SQL) Sundayy Estados Unidos En remoto Visto Adelantate a solicitar el empleo Publicado hace 12 horas',
        rect: listRect,
        attrs: {
          role: 'button',
          'data-job-id': currentJobId,
          'aria-label': 'Selected job card',
        },
        children: [
          createBrowserNode({
            tagName: 'A',
            text: 'Backend Engineer (Node.js, SQL)',
            rect: listRect,
            attrs: { href: `/jobs/search-results/?currentJobId=${currentJobId}` },
          }),
        ],
      }),
    );
  }

  const listPanel = createBrowserNode({
    tagName: 'DIV',
    className: 'jobs-search-results-list',
    text: LISTING_ONLY_TEXT.repeat(4),
    rect: listRect,
    children: listItems,
  });
  const leftSection = createBrowserNode({
    tagName: 'SECTION',
    id: 'left',
    rect: listRect,
    children: [listPanel],
  });

  const detailPanel = createBrowserNode({
    tagName: 'DIV',
    id: 'detail',
    className: 'surface panel',
    rect: detailRect,
    children: [
      createBrowserNode({ tagName: 'H1', text: 'Backend Engineer (Node.js, SQL)', rect: defaultRect }),
      createBrowserNode({
        tagName: 'A',
        text: 'Sundayy',
        rect: defaultRect,
        attrs: { href: '/company/sundayy' },
      }),
      createBrowserNode({ tagName: 'SPAN', text: 'Estados Unidos', rect: defaultRect }),
      createBrowserNode({ tagName: 'SPAN', text: 'En remoto', rect: defaultRect }),
      createBrowserNode({ tagName: 'H2', text: 'Acerca del empleo', rect: defaultRect }),
      createBrowserNode({ tagName: 'P', text: DETAIL_DESCRIPTION, rect: defaultRect }),
      createBrowserNode({ tagName: 'P', text: DETAIL_DESCRIPTION, rect: defaultRect }),
      createBrowserNode({ tagName: 'BUTTON', text: 'Easy Apply', rect: defaultRect }),
      createBrowserNode({
        tagName: 'A',
        text: 'Selected job',
        rect: defaultRect,
        attrs: { href: `/jobs/search-results/?currentJobId=${currentJobId}` },
      }),
    ],
  });
  const rightSection = createBrowserNode({
    tagName: 'SECTION',
    id: 'right',
    rect: detailRect,
    attrs: { 'aria-label': 'Job details' },
    children: [detailPanel],
  });

  const main = createBrowserNode({
    tagName: 'MAIN',
    rect: detailRect,
    attrs: { role: 'main' },
    children: [leftSection, rightSection],
  });
  const body = createBrowserNode({
    tagName: 'BODY',
    rect: { left: 0, top: 0, width: 1280, height: 900 },
    children: [main],
  });

  return {
    body,
    querySelector(selector) {
      if (selector === 'main' || selector === '[role="main"]') {
        return main;
      }
      if (selector === DETAIL_SELECTOR) {
        return detailPanel;
      }
      if (selector === LIST_SELECTOR) {
        return listPanel;
      }
      if (selector === 'main h1') {
        return detailPanel.querySelector('h1');
      }
      return main.querySelector(selector);
    },
    querySelectorAll(selector) {
      if (selector === 'iframe') {
        return [];
      }
      if (selector === 'script[type="application/ld+json"]') {
        return [];
      }
      if (selector === '[role="main"]') {
        return [main];
      }
      if (selector === '[role="article"], article') {
        return [];
      }
      if (selector === 'section') {
        return [leftSection, rightSection];
      }
      return main.querySelectorAll(selector);
    },
  };
}

function executeSerializedBrowserFunction(fn, options, fixtureOptions) {
  const document = createBrowserDocumentFixture(fixtureOptions);
  const window = {
    innerWidth: 1280,
  };
  const location = {
    href: fixtureOptions?.url ?? SEARCH_RESULTS_URL,
  };
  const getComputedStyle = () => ({
    display: 'block',
    visibility: 'visible',
    opacity: '1',
  });

  return vm.runInNewContext(`(${fn.toString()})(options)`, {
    options,
    window,
    document,
    location,
    globalThis: {
      window,
      document,
      location,
      getComputedStyle,
    },
  });
}

describe('linkedinSnapshotExtractor', () => {
  it('rejects capture when URL is not an open job offer', async () => {
    const { page } = createPageMock({
      url: 'https://www.linkedin.com/jobs/',
    });

    await expect(
      captureLinkedInSnapshot(page, {
        provider: 'LINKEDIN_JOBS',
        captureMode: 'job_capture',
      }),
    ).rejects.toMatchObject({
      code: 'LINKEDIN_JOB_NOT_OPEN',
    });
  });

  it('accepts modern search-results URLs and selects a semantic detail panel', async () => {
    const logger = vi.fn();
    const { page, getLocator } = createPageMock({
      selectedCandidate: buildCandidate({
        strategy: 'semantic_detail_panel',
        className: 'surface panel',
      }),
    });

    const snapshot = await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
      logger,
    });

    expect(snapshot.url).toBe(SEARCH_RESULTS_URL);
    expect(page.waitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        currentJobId: '4425937421',
        attemptedStrategies: ATTEMPTED_STRATEGIES,
        returnSelectedCandidate: true,
      }),
      expect.objectContaining({
        timeout: 10_000,
        polling: 250,
      }),
    );
    expect(getLocator(DETAIL_SELECTOR).waitFor).toHaveBeenCalledTimes(1);
    expect(page.lastExtractArgs.selectedJobDescriptionSelector).toBe(DETAIL_SELECTOR);
    expect(logger).toHaveBeenCalledWith(
      'info',
      'linkedin_job.description.strategy_selected',
      expect.objectContaining({
        strategy: 'semantic_detail_panel',
        className: 'surface panel',
      }),
    );
  });

  it('runs the serialized browser function without relying on module helpers', async () => {
    const { page } = createPageMock();

    await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    const browserFn = page.waitForFunction.mock.calls[0][0];
    const browserArgs = page.waitForFunction.mock.calls[0][1];
    const selectedCandidate = executeSerializedBrowserFunction(browserFn, browserArgs);

    expect(selectedCandidate).toEqual(
      expect.objectContaining({
        strategy: expect.stringMatching(/semantic_|attribute_|class_|right_panel/),
        cssPath: expect.stringContaining('main > section:nth-of-type(2)'),
      }),
    );
    expect(selectedCandidate.textLength).toBeGreaterThan(80);
  });

  it('runs the serialized extract payload function without relying on module constants or helpers', async () => {
    const { page } = createPageMock();

    await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    const evaluateCall = page.evaluate.mock.calls.find(([fn]) => fn.name === 'extractSnapshotPayloadInPage');
    const payloadFn = evaluateCall[0];
    const payloadArgs = evaluateCall[1];
    const rawSnapshot = executeSerializedBrowserFunction(payloadFn, payloadArgs, {
      withSelectedListingButton: true,
      currentJobId: '4425937421',
      url: SEARCH_RESULTS_URL,
    });

    expect(rawSnapshot.url).toBe(SEARCH_RESULTS_URL);
    expect(rawSnapshot.selectors.h1).toBe('Backend Engineer (Node.js, SQL)');
    expect(rawSnapshot.selectors.companyCandidates).toContain('Sundayy');
    expect(rawSnapshot.selectors.description).toContain('Node.js');
    expect(rawSnapshot.selectors.description).not.toContain('Seleccionado,');
  });

  it('rejects a selected left-card role button even when it carries currentJobId', async () => {
    const { page } = createPageMock();

    await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    const browserFn = page.waitForFunction.mock.calls[0][0];
    const browserArgs = page.waitForFunction.mock.calls[0][1];
    const selectedCandidate = executeSerializedBrowserFunction(browserFn, browserArgs, {
      withSelectedListingButton: true,
      currentJobId: '4425937421',
    });

    expect(selectedCandidate).toEqual(
      expect.objectContaining({
        cssPath: expect.stringContaining('section:nth-of-type(2)'),
      }),
    );
    expect(selectedCandidate.roleButtonLike).toBe(false);
  });

  it('distinguishes the left listing from the detail panel and keeps only the active detail', async () => {
    const logger = vi.fn();
    const listingCandidate = buildCandidate({
      cssPath: LIST_SELECTOR,
      strategy: 'right_panel_fallback',
      className: 'jobs-search-results-list',
      textLength: 2600,
    });
    const detailCandidate = buildCandidate({
      cssPath: DETAIL_SELECTOR,
      strategy: 'attribute_current_job',
      className: 'detail-pane',
    });
    const { page } = createPageMock({
      selectedCandidate: detailCandidate,
      inspection: buildInspection({
        selectedCandidate: detailCandidate,
        candidates: [listingCandidate, detailCandidate],
        candidateCount: 2,
      }),
    });

    await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
      logger,
    });

    expect(page.lastExtractArgs.selectedJobDescriptionSelector).toBe(DETAIL_SELECTOR);
    expect(page.lastExtractArgs.selectedJobDescriptionSelector).not.toBe(LIST_SELECTOR);
    expect(logger).toHaveBeenCalledWith(
      'debug',
      'linkedin_job.dom_candidate',
      expect.objectContaining({
        className: 'jobs-search-results-list',
      }),
    );
    expect(logger).toHaveBeenCalledWith(
      'debug',
      'linkedin_job.dom_candidate',
      expect.objectContaining({
        className: 'detail-pane',
      }),
    );
  });

  it('handles content that appears asynchronously within the global timeout', async () => {
    const { page } = createPageMock({
      url: JOB_VIEW_URL,
      waitForFunctionResultFactory: ({ pollOptions }) => {
        expect(pollOptions).toEqual(
          expect.objectContaining({
            timeout: 10_000,
            polling: 250,
          }),
        );

        return {
          jsonValue: async () =>
            buildCandidate({
              strategy: 'semantic_aria_details',
              className: 'late-loaded-panel',
            }),
        };
      },
    });

    const snapshot = await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    expect(snapshot.extractedJob.description).toContain('Node.js');
    expect(page.lastExtractArgs.selectedJobDescriptionSelector).toBe(DETAIL_SELECTOR);
  });

  it('returns full context when the detail panel never appears', async () => {
    const { page } = createPageMock({
      waitForFunctionResult: null,
      inspection: buildInspection({
        selectedCandidate: null,
        candidates: [buildCandidate({ cssPath: LIST_SELECTOR, className: 'left-listing-only' })],
        candidateCount: 1,
        iframeCount: 2,
        bodyTextLength: 3900,
      }),
    });

    await expect(
      captureLinkedInSnapshot(page, {
        provider: 'LINKEDIN_JOBS',
        captureMode: 'job_capture',
      }),
    ).rejects.toMatchObject({
      code: 'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
      details: expect.objectContaining({
        currentUrl: SEARCH_RESULTS_URL,
        currentJobId: '4425937421',
        bodyTextLength: 3900,
        iframeCount: 2,
        attemptedStrategies: ATTEMPTED_STRATEGIES,
        candidateCount: 1,
        length: 0,
      }),
    });
  });

  it('rejects descriptions that are visible but too short', async () => {
    const { page } = createPageMock({
      descriptionLength: 32,
      locatorStates: {
        [DETAIL_SELECTOR]: {
          visible: true,
          length: 32,
        },
      },
    });

    await expect(
      captureLinkedInSnapshot(page, {
        provider: 'LINKEDIN_JOBS',
        captureMode: 'job_capture',
      }),
    ).rejects.toMatchObject({
      code: 'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
      details: expect.objectContaining({
        length: 32,
      }),
    });
  });

  it('does not fall back to the full body when a detail selector is already known', async () => {
    const { page } = createPageMock({
      captureEval: (args) =>
        buildSnapshot({
          visibleText:
            args.selectedJobDescriptionSelector === DETAIL_SELECTOR
              ? `Backend Developer ${DETAIL_DESCRIPTION}`
              : `Backend Developer ${LISTING_ONLY_TEXT}`,
        }),
    });

    const snapshot = await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    expect(snapshot.visibleText).toContain('Node.js');
    expect(snapshot.visibleText).not.toContain('Other openings Senior QA Engineer');
    expect(page.lastExtractArgs.selectedJobDescriptionSelector).toBe(DETAIL_SELECTOR);
  });

  it('extracts exact title, company and description from the right detail panel', async () => {
    const { page } = createPageMock({
      selectedCandidate: buildCandidate({
        cssPath: DETAIL_SELECTOR,
        strategy: 'semantic_detail_panel',
      }),
      captureEval: (args) => {
        expect(args.selectedJobDescriptionSelector).toBe(DETAIL_SELECTOR);
        return {
          title: 'Backend Engineer (Node.js, SQL) | LinkedIn',
          url: SEARCH_RESULTS_URL,
          visibleText: `Backend Engineer (Node.js, SQL) Sundayy Estados Unidos ${DETAIL_DESCRIPTION}`,
          selectors: {
            h1: 'Backend Engineer (Node.js, SQL)',
            titleCandidates: ['Backend Engineer (Node.js, SQL)'],
            companyCandidates: ['Sundayy'],
            metadataItems: ['Estados Unidos', 'En remoto', 'Full-time'],
            description: DETAIL_DESCRIPTION,
            descriptionBlocks: ['Acerca del empleo', 'Requirements: Node.js and SQL'],
            recruiter: '',
            ariaLabels: ['Job details', 'Easy Apply'],
            applyButtons: ['Easy Apply'],
          },
          jsonLd: {},
        };
      },
    });

    const snapshot = await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    expect(snapshot.extractedJob.title).toBe('Backend Engineer (Node.js, SQL)');
    expect(snapshot.extractedJob.company).toBe('Sundayy');
    expect(snapshot.extractedJob.location).toBe('Estados Unidos');
    expect(snapshot.extractedJob.description).toBe(DETAIL_DESCRIPTION);
  });

  it('logs extractor runtime errors with stage, currentUrl and currentJobId', async () => {
    const logger = vi.fn();
    const { page } = createPageMock({
      captureEval: () => {
        throw new ReferenceError('LINKEDIN_LISTING_CARD_PATTERNS is not defined');
      },
    });

    await expect(
      captureLinkedInSnapshot(page, {
        provider: 'LINKEDIN_JOBS',
        captureMode: 'job_capture',
        logger,
      }),
    ).rejects.toBeInstanceOf(ReferenceError);

    expect(logger).toHaveBeenCalledWith(
      'error',
      'linkedin_job.snapshot_failed',
      expect.objectContaining({
        stage: 'extract_snapshot_payload',
        currentUrl: SEARCH_RESULTS_URL,
        currentJobId: '4425937421',
        errorName: 'ReferenceError',
        errorMessage: 'LINKEDIN_LISTING_CARD_PATTERNS is not defined',
      }),
    );
  });

  it('preserves UTF-8 in the visible error message', async () => {
    const { page } = createPageMock({
      waitForFunctionResult: null,
      inspection: buildInspection({
        selectedCandidate: null,
        candidates: [],
        candidateCount: 0,
      }),
    });

    await expect(
      captureLinkedInSnapshot(page, {
        provider: 'LINKEDIN_JOBS',
        captureMode: 'job_capture',
      }),
    ).rejects.toMatchObject({
      message: 'La oferta aún no terminó de cargar o no contiene una descripción visible.',
    });
  });
});
