import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureLinkedInSnapshot } from '../../src/services/browser/linkedinSnapshotExtractor.js';

const SEARCH_RESULTS_URL =
  'https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421&keywords=backend';
const JOB_VIEW_URL = 'https://www.linkedin.com/jobs/view/12345';
const DETAIL_SELECTOR = 'main > section:nth-of-type(2) > div';
const LIST_SELECTOR = 'main > section:nth-of-type(1) > div';
const DETAIL_DESCRIPTION =
  'We are hiring a Backend Developer with strong Node.js, Express, MySQL and Jest experience. You will work with APIs, testing, observability and remote collaboration across LATAM teams.';
const REAL_CASE_URL =
  'https://www.linkedin.com/jobs/search-results/?currentJobId=4445008588&keywords=backend';
const REAL_CASE_DESCRIPTION_BLOCKS = [
  'We are looking for an experienced Staff Backend Engineer to design and build high-performance backend for frontend services across multiple product lines.',
  'Key Responsibilities',
  'Build resilient APIs, collaborate with product teams, improve observability and lead architectural decisions across distributed systems.',
  'Core Requirements',
  'Strong Node.js or Nest.js experience, performance tuning, SQL fluency and proven ownership of production services.',
  'Nice-to-Have',
  'Experience with event-driven systems, CI/CD and mentoring senior engineers in high-growth environments.',
  'Additional Requirements',
  'Excellent communication, cross-functional collaboration and comfort operating in ambiguous product spaces.',
  'Why Join Kake?',
  'You will shape critical user journeys, influence architecture and work with a strong distributed engineering team.',
  'Please Note: Due to the high volume of applications, only shortlisted candidates will be contacted.',
];
const WRAPPED_DESCRIPTION_BLOCKS = [
  'We are hiring a Senior Backend Engineer to build resilient APIs and event-driven services for a distributed platform.',
  'Responsibilities',
  'Design backend services, review architecture, improve observability and collaborate with product and frontend teams.',
  'Qualifications',
  'Strong Node.js experience, SQL fluency, messaging patterns and ownership of production incidents.',
  'Benefits',
  'Remote-first culture, learning budget and direct impact on platform reliability.',
];
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

  const captureTarget =
    Object.prototype.hasOwnProperty.call(overrides, 'captureTarget')
      ? overrides.captureTarget
      : selectedCandidate
        ? {
            detailRoot: {
              cssPath: selectedCandidate.cssPath,
              strategy: selectedCandidate.strategy,
              tag: selectedCandidate.tag,
              role: selectedCandidate.role,
              className: selectedCandidate.className,
              textLength: selectedCandidate.textLength,
              width: selectedCandidate.width ?? 720,
              height: selectedCandidate.height ?? 900,
            },
            headerRoot: {
              cssPath: selectedCandidate.cssPath,
            },
            description: {
              cssPath: selectedCandidate.cssPath,
              strategy: selectedCandidate.strategy,
              headingText: null,
              textLength: selectedCandidate.textLength,
              semanticHeadingMatches: 0,
              descriptiveBlockCandidates: 1,
              rejectedCandidates: [],
            },
          }
        : null;

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
    captureTarget,
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
  const urlSequence = [...(options.urlSequence ?? [options.url ?? SEARCH_RESULTS_URL])];
  let urlIndex = 0;
  const selectedCandidate =
    Object.prototype.hasOwnProperty.call(options, 'selectedCandidate')
      ? options.selectedCandidate
      : buildCandidate();
  const inspectionOverrides = { selectedCandidate };
  if (Object.prototype.hasOwnProperty.call(options, 'candidates')) {
    inspectionOverrides.candidates = options.candidates;
  }
  const inspection = options.inspection ?? buildInspection(inspectionOverrides);
  const inspectionSequence = [...(options.inspectionSequence ?? [])];
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
    url: vi.fn(() => {
      const value = urlSequence[Math.min(urlIndex, urlSequence.length - 1)];
      urlIndex += 1;
      return value;
    }),
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
        if (typeof options.inspectEval === 'function') {
          return options.inspectEval(fn, args);
        }
        if (inspectionSequence.length) {
          return inspectionSequence.shift();
        }
        return inspection;
      }

      if (fn.name === 'extractSnapshotPayloadInPage') {
        page.lastExtractArgs = args;
        if (typeof options.captureEval === 'function') {
          return options.captureEval.length >= 2 ? options.captureEval(fn, args) : options.captureEval(args);
        }

        return (
          options.rawSnapshot ??
          buildSnapshot({
            url: urlSequence[Math.max(urlIndex - 1, 0)] ?? SEARCH_RESULTS_URL,
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

function createCapturePageForDetailChildren({ url, currentJobId, detailChildren, ...options }) {
  return createPageMock({
    url,
    ...options,
    inspectEval: (fn, args) =>
      executeSerializedBrowserFunction(fn, args, {
        currentJobId,
        url,
        detailChildren,
      }),
    captureEval: (fn, args) =>
      executeSerializedBrowserFunction(fn, args, {
        currentJobId,
        url,
        detailChildren,
      }),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

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
    childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
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
    get nextElementSibling() {
      const parent = node.parentElement;
      if (!parent) {
        return null;
      }

      const index = parent.children.indexOf(node);
      return parent.children[index + 1] ?? null;
    },
    contains(target) {
      if (!target) {
        return false;
      }
      if (target === node) {
        return true;
      }
      return node.children.some((child) => child.contains?.(target));
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

  if (selector === 'div') {
    return String(node.tagName).toLowerCase() === 'div';
  }

  if (selector === 'h1') {
    return String(node.tagName).toLowerCase() === 'h1';
  }

  if (selector === 'h2') {
    return String(node.tagName).toLowerCase() === 'h2';
  }

  if (selector === 'h3') {
    return String(node.tagName).toLowerCase() === 'h3';
  }

  if (selector === 'h4') {
    return String(node.tagName).toLowerCase() === 'h4';
  }

  if (selector === 'h5') {
    return String(node.tagName).toLowerCase() === 'h5';
  }

  if (selector === 'h6') {
    return String(node.tagName).toLowerCase() === 'h6';
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

  if (selector === 'p, li, h1, h2, h3, h4, h5, h6') {
    return ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(String(node.tagName).toLowerCase());
  }

  if (selector === 'ul') {
    return String(node.tagName).toLowerCase() === 'ul';
  }

  if (selector === 'ol') {
    return String(node.tagName).toLowerCase() === 'ol';
  }

  if (selector === 'h1, h2, h3') {
    return ['h1', 'h2', 'h3'].includes(String(node.tagName).toLowerCase());
  }

  if (selector === 'h1, h2, h3, h4, h5, h6') {
    return ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(String(node.tagName).toLowerCase());
  }

  if (selector === 'h1, h2, h3, span, div, p') {
    return ['h1', 'h2', 'h3', 'span', 'div', 'p'].includes(String(node.tagName).toLowerCase());
  }

  if (selector === 'h1, h2, h3, h4, h5, h6, span, div, p') {
    return ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'p'].includes(String(node.tagName).toLowerCase());
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
  const detailChildren =
    options.detailChildren ??
    [
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
      ...(options.withDetailJobLink === false
        ? []
        : [
            createBrowserNode({
              tagName: 'A',
              text: 'Selected job',
              rect: defaultRect,
              attrs: { href: `/jobs/search-results/?currentJobId=${currentJobId}` },
            }),
          ]),
    ];

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
    className: options.detailClassName ?? 'surface panel',
    rect: detailRect,
    children: detailChildren,
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

  it('does not log a job detail pane or job description selection on /jobs/ without an open vacancy', async () => {
    const logger = vi.fn();
    const { page } = createPageMock({
      url: 'https://www.linkedin.com/jobs/',
    });

    await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      logger,
    });

    expect(logger).not.toHaveBeenCalledWith(
      'info',
      'linkedin_job.detail_pane.selected',
      expect.anything(),
    );
    expect(logger).not.toHaveBeenCalledWith(
      'info',
      'linkedin_job.description.selected',
      expect.anything(),
    );
  });

  it('accepts modern search-results URLs and selects a semantic detail panel', async () => {
    const logger = vi.fn();
    const { page } = createPageMock({
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
    expect(page.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'inspectLinkedInJobDomInPage',
      }),
      expect.objectContaining({
        currentJobId: '4425937421',
        attemptedStrategies: ATTEMPTED_STRATEGIES,
        returnSelectedCandidate: true,
      }),
    );
    expect(page.lastExtractArgs.selectedJobDescriptionSelector).toContain('section:nth-of-type(2)');
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

    const inspectCall = page.evaluate.mock.calls.find(([fn]) => fn.name === 'inspectLinkedInJobDomInPage');
    const browserFn = inspectCall[0];
    const browserArgs = inspectCall[1];
    const inspection = executeSerializedBrowserFunction(browserFn, browserArgs);

    expect(inspection.selectedCandidate).toEqual(
      expect.objectContaining({
        strategy: expect.stringMatching(/semantic_|attribute_|class_|right_panel/),
        cssPath: expect.stringContaining('main > section:nth-of-type(2)'),
      }),
    );
    expect(inspection.selectedCandidate.textLength).toBeGreaterThan(80);
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

  it('keeps the real description blocks available even when promotional CTA coexists in the detail panel', async () => {
    const { page } = createPageMock();

    await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    const evaluateCall = page.evaluate.mock.calls.find(([fn]) => fn.name === 'extractSnapshotPayloadInPage');
    const payloadFn = evaluateCall[0];
    const payloadArgs = evaluateCall[1];
    const rawSnapshot = executeSerializedBrowserFunction(payloadFn, payloadArgs, {
      currentJobId: '4299909228',
      url: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4299909228&keywords=fullstack',
      detailChildren: [
        createBrowserNode({ tagName: 'H1', text: 'Fullstack Developer (React/Node.js)', rect: { left: 420, top: 0, width: 720, height: 120 } }),
        createBrowserNode({
          tagName: 'A',
          text: 'InvGate',
          rect: { left: 420, top: 40, width: 720, height: 40 },
          attrs: { href: '/company/invgate' },
        }),
        createBrowserNode({ tagName: 'DIV', text: 'Estarías entre los candidatos destacados si mejoras tu perfil y activas Premium.', rect: { left: 420, top: 120, width: 720, height: 80 } }),
        createBrowserNode({ tagName: 'SPAN', text: 'Meet the hiring team', rect: { left: 420, top: 200, width: 720, height: 40 } }),
        createBrowserNode({ tagName: 'H2', text: 'About the job', rect: { left: 420, top: 240, width: 720, height: 60 } }),
        createBrowserNode({ tagName: 'P', text: DETAIL_DESCRIPTION, rect: { left: 420, top: 300, width: 720, height: 80 } }),
        createBrowserNode({
          tagName: 'P',
          text: 'You will build APIs, improve observability, write automated tests and collaborate closely with product and design.',
          rect: { left: 420, top: 380, width: 720, height: 80 },
        }),
        createBrowserNode({ tagName: 'BUTTON', text: 'Easy Apply', rect: { left: 420, top: 460, width: 720, height: 60 } }),
        createBrowserNode({
          tagName: 'A',
          text: 'Selected job',
          rect: { left: 420, top: 520, width: 720, height: 40 },
          attrs: { href: '/jobs/search-results/?currentJobId=4299909228' },
        }),
      ],
    });

    expect(rawSnapshot.selectors.h1).toBe('Fullstack Developer (React/Node.js)');
    expect(rawSnapshot.selectors.detailRootStrategy).toBe('resolved_capture_target');
    expect(rawSnapshot.selectors.description).toContain('Node.js');
    expect(rawSnapshot.selectors.descriptionBlocks.some((block) => block.includes('Node.js'))).toBe(true);
  });

  it('extracts the full description region after the real "Acerca del empleo" heading and stops before company/applicant sections', async () => {
    const logger = vi.fn();
    const { page } = createPageMock({
      url: REAL_CASE_URL,
      inspectEval: (fn, args) =>
        executeSerializedBrowserFunction(fn, args, {
          currentJobId: '4445008588',
          url: REAL_CASE_URL,
          detailChildren: [
            createBrowserNode({ tagName: 'H1', text: 'Staff Backend For Frontend (Node/Nest.js) Engineer', rect: { left: 420, top: 0, width: 720, height: 80 } }),
            createBrowserNode({ tagName: 'A', text: 'Kake Staff', rect: { left: 420, top: 80, width: 720, height: 40 }, attrs: { href: '/company/kake-staff' } }),
            createBrowserNode({ tagName: 'SPAN', text: 'Argentina · hace 2 semanas · 64 personas han hecho clic', rect: { left: 420, top: 120, width: 720, height: 40 } }),
            createBrowserNode({ tagName: 'DIV', text: 'Premium: Estarías entre los candidatos destacados y verías información exclusiva sobre Kake.', rect: { left: 420, top: 160, width: 720, height: 60 } }),
            createBrowserNode({ tagName: 'H2', text: 'Acerca del empleo', rect: { left: 420, top: 240, width: 720, height: 40 } }),
            ...REAL_CASE_DESCRIPTION_BLOCKS.map((text, index) =>
              createBrowserNode({
                tagName: index % 2 === 1 ? 'H3' : 'P',
                text,
                rect: { left: 420, top: 300 + index * 44, width: 720, height: 40 },
              }),
            ),
            createBrowserNode({ tagName: 'H3', text: 'Mira una comparación con otras personas que han hecho clic en esta oferta', rect: { left: 420, top: 860, width: 720, height: 40 } }),
            createBrowserNode({ tagName: 'DIV', text: 'Candidatos que han hecho clic también suelen revisar vacantes similares.', rect: { left: 420, top: 900, width: 720, height: 40 } }),
            createBrowserNode({ tagName: 'DIV', text: 'Información exclusiva sobre Kake con Applicant insights y datos Premium.', rect: { left: 420, top: 940, width: 720, height: 40 } }),
            createBrowserNode({ tagName: 'H3', text: 'Acerca de la empresa', rect: { left: 420, top: 980, width: 720, height: 40 } }),
          ],
        }),
      captureEval: (fn, args) =>
        executeSerializedBrowserFunction(fn, args, {
          currentJobId: '4445008588',
          url: REAL_CASE_URL,
          detailChildren: [
            createBrowserNode({ tagName: 'H1', text: 'Staff Backend For Frontend (Node/Nest.js) Engineer', rect: { left: 420, top: 0, width: 720, height: 80 } }),
            createBrowserNode({ tagName: 'A', text: 'Kake Staff', rect: { left: 420, top: 80, width: 720, height: 40 }, attrs: { href: '/company/kake-staff' } }),
            createBrowserNode({ tagName: 'SPAN', text: 'Argentina · hace 2 semanas · 64 personas han hecho clic', rect: { left: 420, top: 120, width: 720, height: 40 } }),
            createBrowserNode({ tagName: 'DIV', text: 'Premium: Estarías entre los candidatos destacados y verías información exclusiva sobre Kake.', rect: { left: 420, top: 160, width: 720, height: 60 } }),
            createBrowserNode({ tagName: 'H2', text: 'Acerca del empleo', rect: { left: 420, top: 240, width: 720, height: 40 } }),
            ...REAL_CASE_DESCRIPTION_BLOCKS.map((text, index) =>
              createBrowserNode({
                tagName: index % 2 === 1 ? 'H3' : 'P',
                text,
                rect: { left: 420, top: 300 + index * 44, width: 720, height: 40 },
              }),
            ),
            createBrowserNode({ tagName: 'H3', text: 'Mira una comparación con otras personas que han hecho clic en esta oferta', rect: { left: 420, top: 860, width: 720, height: 40 } }),
            createBrowserNode({ tagName: 'DIV', text: 'Candidatos que han hecho clic también suelen revisar vacantes similares.', rect: { left: 420, top: 900, width: 720, height: 40 } }),
            createBrowserNode({ tagName: 'DIV', text: 'Información exclusiva sobre Kake con Applicant insights y datos Premium.', rect: { left: 420, top: 940, width: 720, height: 40 } }),
            createBrowserNode({ tagName: 'H3', text: 'Acerca de la empresa', rect: { left: 420, top: 980, width: 720, height: 40 } }),
          ],
        }),
    });

    const snapshot = await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
      logger,
    });

    expect(page.lastExtractArgs.resolvedCaptureTarget.detailRoot.cssPath).toBe(
      page.lastExtractArgs.selectedJobDescriptionSelector,
    );
    expect(page.lastExtractArgs.resolvedCaptureTarget.description.headingText).toBe('Acerca del empleo');
    expect(page.lastExtractArgs.resolvedCaptureTarget.description.textLength).toBeGreaterThan(300);
    expect(snapshot.extractedJob.description).toContain('We are looking for an experienced Staff Backend Engineer');
    expect(snapshot.extractedJob.description).toContain('Key Responsibilities');
    expect(snapshot.extractedJob.description).toContain('Core Requirements');
    expect(snapshot.extractedJob.description).toContain('Why Join Kake?');
    expect(snapshot.extractedJob.description).not.toContain('Candidatos que han hecho clic');
    expect(snapshot.extractedJob.description).not.toContain('Información exclusiva sobre Kake');
    expect(snapshot.extractedJob.description).not.toContain('Acerca de la empresa');
    expect(page.lastExtractArgs.resolvedCaptureTarget.description.blockPaths.length).toBeGreaterThan(3);
    expect(logger).toHaveBeenCalledWith(
      'info',
      'linkedin_job.semantic_heading.selected',
      expect.objectContaining({
        text: 'Acerca del empleo',
      }),
    );
    expect(logger).toHaveBeenCalledWith(
      'info',
      'linkedin_job.description_region.selected',
      expect.objectContaining({
        textLength: expect.any(Number),
        first80Chars: expect.stringContaining('We are looking'),
      }),
    );
  });

  it('extracts a wrapped description region after "Acerca del empleo" when the content lives in later descendant wrappers', async () => {
    const wrappedUrl =
      'https://www.linkedin.com/jobs/search-results/?currentJobId=4377820527&keywords=backend';
    const detailChildren = [
      createBrowserNode({ tagName: 'H1', text: 'Senior Backend Engineer', rect: { left: 420, top: 0, width: 720, height: 80 } }),
      createBrowserNode({ tagName: 'A', text: 'Acme Cloud', rect: { left: 420, top: 80, width: 720, height: 40 }, attrs: { href: '/company/acme-cloud' } }),
      createBrowserNode({
        tagName: 'DIV',
        rect: { left: 420, top: 160, width: 720, height: 460 },
        children: [
          createBrowserNode({
            tagName: 'DIV',
            rect: { left: 420, top: 200, width: 720, height: 60 },
            children: [
              createBrowserNode({ tagName: 'H2', text: 'Acerca del empleo', rect: { left: 430, top: 210, width: 700, height: 40 } }),
            ],
          }),
          createBrowserNode({
            tagName: 'DIV',
            rect: { left: 420, top: 270, width: 720, height: 320 },
            children: [
              createBrowserNode({
                tagName: 'DIV',
                rect: { left: 430, top: 280, width: 700, height: 280 },
                children: [
                  createBrowserNode({ tagName: 'P', text: WRAPPED_DESCRIPTION_BLOCKS[0], rect: { left: 440, top: 290, width: 680, height: 40 } }),
                  createBrowserNode({ tagName: 'H3', text: WRAPPED_DESCRIPTION_BLOCKS[1], rect: { left: 440, top: 334, width: 680, height: 32 } }),
                  createBrowserNode({ tagName: 'P', text: WRAPPED_DESCRIPTION_BLOCKS[2], rect: { left: 440, top: 372, width: 680, height: 40 } }),
                  createBrowserNode({ tagName: 'H3', text: WRAPPED_DESCRIPTION_BLOCKS[3], rect: { left: 440, top: 416, width: 680, height: 32 } }),
                  createBrowserNode({
                    tagName: 'UL',
                    rect: { left: 440, top: 454, width: 680, height: 70 },
                    children: [
                      createBrowserNode({ tagName: 'LI', text: WRAPPED_DESCRIPTION_BLOCKS[4], rect: { left: 450, top: 464, width: 660, height: 28 } }),
                      createBrowserNode({ tagName: 'LI', text: WRAPPED_DESCRIPTION_BLOCKS[5], rect: { left: 450, top: 496, width: 660, height: 28 } }),
                    ],
                  }),
                  createBrowserNode({ tagName: 'P', text: WRAPPED_DESCRIPTION_BLOCKS[6], rect: { left: 440, top: 532, width: 680, height: 40 } }),
                ],
              }),
            ],
          }),
        ],
      }),
      createBrowserNode({ tagName: 'H3', text: 'Applicant insights', rect: { left: 420, top: 640, width: 720, height: 40 } }),
      createBrowserNode({ tagName: 'DIV', text: 'Candidatos que han hecho clic también revisaron estas vacantes.', rect: { left: 420, top: 684, width: 720, height: 40 } }),
      createBrowserNode({ tagName: 'H3', text: 'Acerca de la empresa', rect: { left: 420, top: 728, width: 720, height: 40 } }),
    ];

    const { page } = createCapturePageForDetailChildren({
      url: wrappedUrl,
      currentJobId: '4377820527',
      detailChildren,
    });

    const snapshot = await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    expect(page.lastExtractArgs.resolvedCaptureTarget.description.headingText).toBe('Acerca del empleo');
    expect(page.lastExtractArgs.resolvedCaptureTarget.description.textLength).toBeGreaterThan(250);
    expect(page.lastExtractArgs.resolvedCaptureTarget.description.acceptedBlockCount).toBeGreaterThanOrEqual(6);
    expect(snapshot.extractedJob.description).toContain(WRAPPED_DESCRIPTION_BLOCKS[0]);
    expect(snapshot.extractedJob.description).toContain(WRAPPED_DESCRIPTION_BLOCKS[1]);
    expect(snapshot.extractedJob.description).toContain(WRAPPED_DESCRIPTION_BLOCKS[3]);
    expect(snapshot.extractedJob.description).toContain(WRAPPED_DESCRIPTION_BLOCKS[6]);
    expect(snapshot.extractedJob.description).not.toContain('Applicant insights');
    expect(snapshot.extractedJob.description).not.toContain('Candidatos que han hecho clic');
    expect(snapshot.extractedJob.description).not.toContain('Acerca de la empresa');
  });

  it('stops before candidate comparison and education statistics after a valid description', async () => {
    const url = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4377820527&keywords=backend';
    const logger = vi.fn();
    const detailChildren = [
      createBrowserNode({ tagName: 'H1', text: 'Backend Engineer', rect: { left: 420, top: 0, width: 720, height: 80 } }),
      createBrowserNode({ tagName: 'H2', text: 'Acerca del empleo', rect: { left: 420, top: 120, width: 720, height: 40 } }),
      createBrowserNode({ tagName: 'P', text: WRAPPED_DESCRIPTION_BLOCKS[0], rect: { left: 420, top: 180, width: 720, height: 40 } }),
      createBrowserNode({ tagName: 'H3', text: 'Requirements', rect: { left: 420, top: 228, width: 720, height: 32 } }),
      createBrowserNode({ tagName: 'P', text: WRAPPED_DESCRIPTION_BLOCKS[4], rect: { left: 420, top: 268, width: 720, height: 40 } }),
      createBrowserNode({ tagName: 'H3', text: 'Mira una comparación con otras personas que han hecho clic en «Solicitar»', rect: { left: 420, top: 320, width: 720, height: 40 } }),
      createBrowserNode({ tagName: 'DIV', text: 'Nivel educativo de los candidatos', rect: { left: 420, top: 364, width: 720, height: 40 } }),
      createBrowserNode({ tagName: 'DIV', text: 'Basado en los datos de LinkedIn', rect: { left: 420, top: 408, width: 720, height: 40 } }),
    ];

    const { page } = createCapturePageForDetailChildren({
      url,
      currentJobId: '4377820527',
      detailChildren,
    });

    const snapshot = await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
      logger,
    });

    expect(snapshot.extractedJob.description).toContain(WRAPPED_DESCRIPTION_BLOCKS[0]);
    expect(snapshot.extractedJob.description).toContain('Requirements');
    expect(snapshot.extractedJob.description).not.toContain('Mira una comparación');
    expect(snapshot.extractedJob.description).not.toContain('Nivel educativo de los candidatos');
    expect(snapshot.extractedJob.description).not.toContain('Basado en los datos de LinkedIn');
    expect(logger).toHaveBeenCalledWith(
      'info',
      'linkedin_job.description_region.selected',
      expect.objectContaining({
        stoppedBy: expect.stringContaining('Mira una comparación'),
        stopReason: expect.any(String),
        stopCssPath: expect.any(String),
        stopTextPreview: expect.stringContaining('Mira una comparación'),
      }),
    );
  });

  it('stops before applicant insights and about company while preserving internal headings', async () => {
    const url = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4377820527&keywords=backend';
    const detailChildren = [
      createBrowserNode({ tagName: 'H1', text: 'Backend Engineer', rect: { left: 420, top: 0, width: 720, height: 80 } }),
      createBrowserNode({ tagName: 'H2', text: 'Acerca del empleo', rect: { left: 420, top: 120, width: 720, height: 40 } }),
      createBrowserNode({ tagName: 'P', text: WRAPPED_DESCRIPTION_BLOCKS[0], rect: { left: 420, top: 180, width: 720, height: 40 } }),
      createBrowserNode({ tagName: 'H3', text: 'Benefits', rect: { left: 420, top: 228, width: 720, height: 32 } }),
      createBrowserNode({ tagName: 'P', text: WRAPPED_DESCRIPTION_BLOCKS[6], rect: { left: 420, top: 268, width: 720, height: 40 } }),
      createBrowserNode({ tagName: 'H3', text: 'Applicant insights', rect: { left: 420, top: 320, width: 720, height: 40 } }),
      createBrowserNode({ tagName: 'DIV', text: 'Job seeker insights', rect: { left: 420, top: 364, width: 720, height: 40 } }),
      createBrowserNode({ tagName: 'H3', text: 'Acerca de la empresa', rect: { left: 420, top: 408, width: 720, height: 40 } }),
    ];

    const { page } = createCapturePageForDetailChildren({
      url,
      currentJobId: '4377820527',
      detailChildren,
    });

    const snapshot = await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    expect(snapshot.extractedJob.description).toContain('Benefits');
    expect(snapshot.extractedJob.description).toContain(WRAPPED_DESCRIPTION_BLOCKS[6]);
    expect(snapshot.extractedJob.description).not.toContain('Applicant insights');
    expect(snapshot.extractedJob.description).not.toContain('Job seeker insights');
    expect(snapshot.extractedJob.description).not.toContain('Acerca de la empresa');
  });

  it('keeps the last valid own text from a mixed wrapper and cuts before the applicant insights subtree', async () => {
    const url = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4377820527&keywords=backend';
    const detailChildren = [
      createBrowserNode({ tagName: 'H1', text: 'Backend Engineer', rect: { left: 420, top: 0, width: 720, height: 80 } }),
      createBrowserNode({ tagName: 'H2', text: 'Acerca del empleo', rect: { left: 420, top: 120, width: 720, height: 40 } }),
      createBrowserNode({ tagName: 'P', text: WRAPPED_DESCRIPTION_BLOCKS[0], rect: { left: 420, top: 180, width: 720, height: 40 } }),
      createBrowserNode({
        tagName: 'DIV',
        text: 'Please note: this role requires strong written communication and ownership across backend delivery.',
        rect: { left: 420, top: 228, width: 720, height: 80 },
        children: [
          createBrowserNode({ tagName: 'H3', text: 'Applicant insights', rect: { left: 430, top: 260, width: 700, height: 32 } }),
          createBrowserNode({ tagName: 'DIV', text: 'Nivel de responsabilidad de los candidatos', rect: { left: 430, top: 296, width: 700, height: 32 } }),
        ],
      }),
    ];

    const { page } = createCapturePageForDetailChildren({
      url,
      currentJobId: '4377820527',
      detailChildren,
    });

    const snapshot = await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    expect(snapshot.extractedJob.description).toContain('Please note: this role requires strong written communication');
    expect(snapshot.extractedJob.description).not.toContain('Applicant insights');
    expect(snapshot.extractedJob.description).not.toContain('Nivel de responsabilidad de los candidatos');
  });

  it('does not confuse a long CTA container that merely mentions "Acerca del empleo" with the real semantic heading', async () => {
    vi.useFakeTimers();
    const { page } = createPageMock({
      url: REAL_CASE_URL,
      inspectEval: (fn, args) =>
        executeSerializedBrowserFunction(fn, args, {
          currentJobId: '4445008588',
          url: REAL_CASE_URL,
          detailChildren: [
            createBrowserNode({ tagName: 'H1', text: 'Staff Backend For Frontend (Node/Nest.js) Engineer', rect: { left: 420, top: 0, width: 720, height: 80 } }),
            createBrowserNode({
              tagName: 'DIV',
              text: 'Premium CTA con Acerca del empleo dentro del texto largo para mostrar información exclusiva, Applicant insights y más beneficios de LinkedIn Premium.',
              rect: { left: 420, top: 100, width: 720, height: 80 },
            }),
            createBrowserNode({ tagName: 'P', text: 'Texto corto aislado sin una descripción laboral real.', rect: { left: 420, top: 220, width: 720, height: 40 } }),
          ],
        }),
    });

    const capturePromise = captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });
    const captureAssertion = expect(capturePromise).rejects.toMatchObject({
      code: 'LINKEDIN_JOB_DESCRIPTION_NOT_FOUND',
    });
    await vi.advanceTimersByTimeAsync(1000);
    await captureAssertion;
  });

  it('rejects a selected left-card role button even when it carries currentJobId', async () => {
    const { page } = createPageMock();

    await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    const inspectCall = page.evaluate.mock.calls.find(([fn]) => fn.name === 'inspectLinkedInJobDomInPage');
    const browserFn = inspectCall[0];
    const browserArgs = inspectCall[1];
    const inspection = executeSerializedBrowserFunction(browserFn, browserArgs, {
      withSelectedListingButton: true,
      currentJobId: '4425937421',
    });

    expect(inspection.selectedCandidate).toEqual(
      expect.objectContaining({
        cssPath: expect.stringContaining('section:nth-of-type(2)'),
      }),
    );
    expect(inspection.selectedCandidate.roleButtonLike).toBe(false);
  });

  it('detects the right detail panel even when LinkedIn classes are fully hashed', async () => {
    const { page } = createPageMock();

    await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    const inspectCall = page.evaluate.mock.calls.find(([fn]) => fn.name === 'inspectLinkedInJobDomInPage');
    const inspection = executeSerializedBrowserFunction(inspectCall[0], inspectCall[1], {
      detailClassName: 'x7a91f q2lm0n r9af3v',
    });

    expect(inspection.selectedCandidate).toEqual(
      expect.objectContaining({
        strategy: expect.stringMatching(/semantic_|attribute_|right_panel/),
        cssPath: expect.stringContaining('section:nth-of-type(2)'),
      }),
    );
  });

  it('keeps a valid parent container when its descendants are individually short', async () => {
    const { page } = createPageMock();

    await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    const inspectCall = page.evaluate.mock.calls.find(([fn]) => fn.name === 'inspectLinkedInJobDomInPage');
    const inspection = executeSerializedBrowserFunction(inspectCall[0], inspectCall[1], {
      detailClassName: 'x7a91f q2lm0n r9af3v',
      detailChildren: [
        createBrowserNode({ tagName: 'H1', text: 'Backend Engineer (Node.js, SQL)', rect: { left: 420, top: 0, width: 720, height: 120 } }),
        createBrowserNode({ tagName: 'H2', text: 'About the job', rect: { left: 420, top: 120, width: 720, height: 80 } }),
        createBrowserNode({ tagName: 'SPAN', text: 'Node.js APIs, scalable services, observability, testing, MySQL and distributed teamwork across LATAM.', rect: { left: 420, top: 200, width: 720, height: 40 } }),
        createBrowserNode({ tagName: 'SPAN', text: 'Build maintainable backend features, collaborate remotely and improve delivery quality with automated tests.', rect: { left: 420, top: 240, width: 720, height: 40 } }),
        createBrowserNode({ tagName: 'SPAN', text: 'Work closely with product and engineering while documenting APIs and deployment workflows.', rect: { left: 420, top: 280, width: 720, height: 40 } }),
        createBrowserNode({ tagName: 'SPAN', text: 'English B2 and remote LATAM availability are required for this role.', rect: { left: 420, top: 320, width: 720, height: 40 } }),
        createBrowserNode({ tagName: 'BUTTON', text: 'Easy Apply', rect: { left: 420, top: 360, width: 720, height: 60 } }),
      ],
      withDetailJobLink: false,
    });

    expect(inspection.selectedCandidate).toEqual(
      expect.objectContaining({
        cssPath: expect.stringContaining('section:nth-of-type(2)'),
        rightPanelLike: true,
      }),
    );
    expect(inspection.selectedCandidate.directTextLength).toBe(0);
    expect(inspection.selectedCandidate.aggregateTextLength).toBeGreaterThan(80);
  });

  it('does not reject a valid right detail panel only because it includes Posted ago metadata', async () => {
    const { page } = createPageMock();

    await captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });

    const inspectCall = page.evaluate.mock.calls.find(([fn]) => fn.name === 'inspectLinkedInJobDomInPage');
    const inspection = executeSerializedBrowserFunction(inspectCall[0], inspectCall[1], {
      detailChildren: [
        createBrowserNode({ tagName: 'H1', text: 'Backend Engineer (Node.js, SQL)', rect: { left: 420, top: 0, width: 720, height: 120 } }),
        createBrowserNode({ tagName: 'SPAN', text: 'Publicado hace 14 horas', rect: { left: 420, top: 120, width: 720, height: 40 } }),
        createBrowserNode({ tagName: 'SPAN', text: 'Meet the hiring team', rect: { left: 420, top: 160, width: 720, height: 40 } }),
        createBrowserNode({ tagName: 'H2', text: 'About the job', rect: { left: 420, top: 200, width: 720, height: 80 } }),
        createBrowserNode({ tagName: 'P', text: DETAIL_DESCRIPTION, rect: { left: 420, top: 280, width: 720, height: 80 } }),
        createBrowserNode({ tagName: 'BUTTON', text: 'Easy Apply', rect: { left: 420, top: 360, width: 720, height: 60 } }),
      ],
      withDetailJobLink: false,
    });

    expect(inspection.candidateCount).toBeGreaterThan(0);
    expect(inspection.maxCandidateTextLength).toBeGreaterThan(80);
    expect(inspection.selectedCandidate).toEqual(
      expect.objectContaining({
        cssPath: expect.stringContaining('section:nth-of-type(2)'),
        detailMetadataNoise: true,
        strongListingNoise: false,
        textLength: expect.any(Number),
      }),
    );
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

    expect(page.lastExtractArgs.selectedJobDescriptionSelector).toContain('section:nth-of-type(2)');
    expect(page.lastExtractArgs.selectedJobDescriptionSelector).not.toBe(LIST_SELECTOR);
    expect(logger).toHaveBeenCalledWith(
      'info',
      'linkedin_job.capture_target.stable',
      expect.objectContaining({
        detailRootCssPath: DETAIL_SELECTOR,
        descriptionCssPath: DETAIL_SELECTOR,
      }),
    );
  });

  it('handles content that appears asynchronously within the global timeout', async () => {
    vi.useFakeTimers();
    const { page } = createPageMock({
      url: JOB_VIEW_URL,
      inspectionSequence: [
        buildInspection({
          selectedCandidate: null,
          candidates: [],
          candidateCount: 0,
        }),
        buildInspection({
          selectedCandidate: buildCandidate({
            strategy: 'semantic_aria_details',
            className: 'late-loaded-panel',
          }),
        }),
        buildInspection({
          selectedCandidate: buildCandidate({
            strategy: 'semantic_aria_details',
            className: 'late-loaded-panel',
          }),
        }),
      ],
    });

    const capturePromise = captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });
    await vi.advanceTimersByTimeAsync(600);
    const snapshot = await capturePromise;

    expect(snapshot.extractedJob.description).toContain('Node.js');
    expect(page.lastExtractArgs.selectedJobDescriptionSelector).toContain('section:nth-of-type(2)');
  });

  it('captures correctly when the inspection function runs serialized in the browser context', async () => {
    vi.useFakeTimers();
    const logger = vi.fn();
    const { page } = createPageMock({
      inspectEval: (fn, args) => executeSerializedBrowserFunction(fn, args, { url: SEARCH_RESULTS_URL }),
    });

    const capturePromise = captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
      logger,
    });
    await vi.advanceTimersByTimeAsync(300);
    const snapshot = await capturePromise;

    expect(snapshot.extractedJob.title).toBeTruthy();
    expect(page.lastExtractArgs.selectedJobDescriptionSelector).toContain('section:nth-of-type(2)');
    expect(logger).toHaveBeenCalledWith(
      'info',
      'linkedin_job.description.wait_summary',
      expect.objectContaining({
        currentJobId: '4425937421',
        maxCandidateCount: expect.any(Number),
        selectedStrategy: expect.any(String),
        reason: 'ready',
      }),
    );
  });

  it('returns full context when the detail panel never appears', async () => {
    vi.useFakeTimers();
    const { page } = createPageMock({
      inspection: buildInspection({
        selectedCandidate: null,
        candidates: [buildCandidate({ cssPath: LIST_SELECTOR, className: 'left-listing-only' })],
        candidateCount: 1,
        iframeCount: 2,
        bodyTextLength: 3900,
      }),
    });

    const capturePromise = captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });
    const captureAssertion = expect(capturePromise).rejects.toMatchObject({
      code: 'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
      details: expect.objectContaining({
        currentUrl: SEARCH_RESULTS_URL,
        currentJobId: '4425937421',
        bodyTextLength: 3900,
        iframeCount: 2,
        attemptedStrategies: ATTEMPTED_STRATEGIES,
        candidateCount: 1,
        length: 0,
        waitedMs: expect.any(Number),
      }),
    });
    await vi.advanceTimersByTimeAsync(10_250);
    await captureAssertion;
  });

  it('logs a compact wait summary with discarded candidates when no semantic panel survives', async () => {
    vi.useFakeTimers();
    const logger = vi.fn();
    const { page } = createPageMock({
      inspectEval: (fn, args) =>
        executeSerializedBrowserFunction(fn, args, {
          withSelectedListingButton: true,
          detailChildren: [],
          withDetailJobLink: false,
        }),
    });

    const capturePromise = captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
      logger,
    });
    const captureAssertion = expect(capturePromise).rejects.toMatchObject({
      code: 'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
      details: expect.objectContaining({
        candidateCount: 0,
      }),
    });
    await vi.advanceTimersByTimeAsync(10_250);
    await captureAssertion;

    const summaryCall = logger.mock.calls.find(([, stage]) => stage === 'linkedin_job.description.wait_summary');
    expect(summaryCall).toBeTruthy();
    expect(summaryCall[0]).toBe('info');
    expect(summaryCall[2].currentJobId).toBe('4425937421');
    expect(summaryCall[2].reason).toBe('timeout');
    expect(summaryCall[2].maxCandidateCount).toBe(0);
    expect(summaryCall[2].maxTextLength).toBe(0);
    expect(Array.isArray(summaryCall[2].discardedNodes)).toBe(true);
    expect(summaryCall[2].discardedNodes.length).toBeGreaterThan(0);
  });

  it('rejects descriptions that are visible but too short', async () => {
    vi.useFakeTimers();
    const { page } = createPageMock({
      inspection: buildInspection({
        selectedCandidate: buildCandidate({
          textLength: 32,
          strategy: 'semantic_detail_panel',
        }),
      }),
    });

    const capturePromise = captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });
    const captureAssertion = expect(capturePromise).rejects.toMatchObject({
      code: 'LINKEDIN_JOB_DESCRIPTION_NOT_READY',
      details: expect.objectContaining({
        length: 32,
        selectedStrategy: 'semantic_detail_panel',
      }),
    });
    await vi.advanceTimersByTimeAsync(10_250);
    await captureAssertion;
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
    vi.useFakeTimers();
    const { page } = createPageMock({
      inspection: buildInspection({
        selectedCandidate: null,
        candidates: [],
        candidateCount: 0,
      }),
    });

    const capturePromise = captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });
    const captureAssertion = expect(capturePromise).rejects.toMatchObject({
      message: 'La oferta aún no terminó de cargar o no contiene una descripción visible.',
    });
    await vi.advanceTimersByTimeAsync(10_250);
    await captureAssertion;
  });

  it('waits for a description that starts empty and then becomes stable', async () => {
    vi.useFakeTimers();
    const loadedCandidate = buildCandidate({
      strategy: 'semantic_aria_details',
      className: 'hydrated-panel',
    });
    const { page } = createPageMock({
      inspectionSequence: [
        buildInspection({ selectedCandidate: null, candidates: [], candidateCount: 0 }),
        buildInspection({ selectedCandidate: loadedCandidate }),
        buildInspection({ selectedCandidate: loadedCandidate }),
      ],
    });

    const capturePromise = captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });
    await vi.advanceTimersByTimeAsync(600);
    const snapshot = await capturePromise;

    expect(snapshot.extractedJob.description).toContain('Node.js');
    const inspectCalls = page.evaluate.mock.calls.filter(([fn]) => fn.name === 'inspectLinkedInJobDomInPage');
    expect(inspectCalls).toHaveLength(3);
  });

  it('re-resolves the detail candidate when LinkedIn replaces the node during hydration', async () => {
    vi.useFakeTimers();
    const firstCandidate = buildCandidate({
      cssPath: 'main > section:nth-of-type(2) > div:nth-of-type(1)',
      strategy: 'semantic_detail_panel',
      className: 'detail-shell',
    });
    const secondCandidate = buildCandidate({
      cssPath: 'main > section:nth-of-type(2) > div:nth-of-type(2)',
      strategy: 'semantic_detail_panel',
      className: 'detail-shell hydrated',
    });
    const { page } = createPageMock({
      inspectionSequence: [
        buildInspection({ selectedCandidate: firstCandidate }),
        buildInspection({ selectedCandidate: secondCandidate }),
        buildInspection({ selectedCandidate: secondCandidate }),
      ],
    });

    const capturePromise = captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });
    await vi.advanceTimersByTimeAsync(800);
    await capturePromise;

    expect(page.lastExtractArgs.selectedJobDescriptionSelector).toBe(secondCandidate.cssPath);
    expect(page.lastExtractArgs.resolvedCaptureTarget.detailRoot.cssPath).toBe(secondCandidate.cssPath);
    expect(page.lastExtractArgs.resolvedCaptureTarget.description.cssPath).toBe(secondCandidate.cssPath);
  });

  it('aborts with a specific conflict when currentJobId changes during the wait', async () => {
    vi.useFakeTimers();
    const changedUrl =
      'https://www.linkedin.com/jobs/search-results/?currentJobId=9999999999&keywords=backend';
    const { page } = createPageMock({
      urlSequence: [SEARCH_RESULTS_URL, SEARCH_RESULTS_URL, changedUrl],
      inspectionSequence: [
        buildInspection({ selectedCandidate: null, candidates: [], candidateCount: 0 }),
      ],
    });

    const capturePromise = captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });
    const captureAssertion = expect(capturePromise).rejects.toMatchObject({
      code: 'LINKEDIN_JOB_CAPTURE_CHANGED',
      details: expect.objectContaining({
        currentJobId: '9999999999',
        expectedJobId: '4425937421',
      }),
    });
    await vi.advanceTimersByTimeAsync(300);
    await captureAssertion;
  });

  it('does not add unnecessary delay when the description is already stable', async () => {
    vi.useFakeTimers();
    const { page } = createPageMock();

    const capturePromise = captureLinkedInSnapshot(page, {
      provider: 'LINKEDIN_JOBS',
      captureMode: 'job_capture',
    });
    await vi.advanceTimersByTimeAsync(300);
    await capturePromise;

    const inspectCalls = page.evaluate.mock.calls.filter(([fn]) => fn.name === 'inspectLinkedInJobDomInPage');
    expect(inspectCalls).toHaveLength(2);
  });
});
