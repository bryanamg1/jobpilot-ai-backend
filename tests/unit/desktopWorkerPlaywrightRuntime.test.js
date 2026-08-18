import { describe, expect, it, vi } from 'vitest';
import { createWorkerPlaywrightRuntime } from '../../desktop-agent/playwrightRuntime.js';

const PRIMARY_SELECTOR = '[class*="jobs-search__job-details"] .jobs-box__html-content';

function createPageMock(url = 'https://www.linkedin.com/jobs/view/12345') {
  const descriptionText =
    'We are hiring a Backend Developer with Node.js, Express, MySQL and Jest. English B2 is required.';
  const locators = new Map();
  const getLocator = (selector) => {
    if (locators.has(selector)) {
      return locators.get(selector);
    }

    const locator = {
      first: vi.fn(function first() {
        return locator;
      }),
      count: vi.fn(async () => (selector === PRIMARY_SELECTOR ? 1 : 0)),
      isVisible: vi.fn(async () => selector === PRIMARY_SELECTOR),
      waitFor: vi.fn(async () => ({})),
      evaluate: vi.fn(async () => descriptionText.length),
    };
    locators.set(selector, locator);
    return locator;
  };

  return {
    goto: vi.fn(async () => ({})),
    url: vi.fn(() => url),
    isClosed: vi.fn(() => false),
    on: vi.fn(),
    locator: vi.fn((selector) => getLocator(selector)),
    waitForFunction: vi.fn(async () => ({})),
    evaluate: vi.fn(async () => ({
      title: 'Backend Developer | LinkedIn',
      url,
      visibleText:
        'Backend Developer Acme Labs Remote LATAM Node.js Express MySQL Jest English B2 This description is intentionally long enough to satisfy the supervised capture threshold and mimic a visible LinkedIn Jobs detail page.',
      selectors: {
        h1: 'Backend Developer',
        titleCandidates: ['Backend Developer'],
        companyCandidates: ['Acme Labs'],
        metadataItems: ['Remote', 'LATAM', 'Full-time', 'Junior', '34 applicants'],
        description:
          'We are hiring a Backend Developer with Node.js, Express, MySQL and Jest. English B2 is required.',
        descriptionBlocks: [
          'Requirements: Node.js, Express, MySQL, Jest.',
          'Responsibilities: Build backend services and APIs.',
        ],
        recruiter: 'Jane Recruiter',
        ariaLabels: ['Node.js', 'Express', 'MySQL', 'Jest', 'English B2'],
        applyButtons: ['Easy Apply'],
      },
      jsonLd: {
        title: 'Backend Developer',
        company: 'Acme Labs',
        location: 'Remote',
        employmentType: 'FULL_TIME',
        datePosted: '2026-08-01',
        description:
          'We are hiring a Backend Developer with Node.js, Express, MySQL and Jest. English B2 is required.',
      },
    })),
  };
}

function createLauncherMock() {
  const page = createPageMock();
  let pages = [page];
  const contextEvents = new Map();
  const context = {
    newPage: vi.fn(async () => page),
    pages: vi.fn(() => pages),
    on: vi.fn((event, handler) => {
      contextEvents.set(event, handler);
    }),
    storageState: vi.fn(async () => ({})),
    close: vi.fn(async () => ({})),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => ({})),
  };
  const launcher = {
    launch: vi.fn(async () => browser),
  };

  return {
    launcher,
    browser,
    context,
    page,
    setPages(nextPages) {
      pages = nextPages;
    },
    emitNewPage(nextPage) {
      pages = [...pages, nextPage];
      contextEvents.get('page')?.(nextPage);
    },
  };
}

describe('desktop worker playwright runtime', () => {
  it('abre una sesion visible reutilizando storageState cuando existe', async () => {
    const { launcher, browser } = createLauncherMock();
    const runtime = createWorkerPlaywrightRuntime({
      launcher,
      config: {
        PLAYWRIGHT_HEADLESS: false,
        BROWSER_SESSION_STATE_DIR: 'storage/browser-sessions',
      },
      accessFn: vi.fn(async () => ({})),
      mkdirFn: vi.fn(async () => ({})),
    });

    const result = await runtime.startSession({
      provider: 'LINKEDIN_JOBS',
      startUrl: 'https://www.linkedin.com/jobs/',
    });

    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: false,
      }),
    );
    expect(browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        storageState: expect.stringContaining('linkedin_jobs.json'),
      }),
    );
    expect(result.reusedStoredSession).toBe(true);
    expect(result.snapshot.extractedJob).toEqual(
      expect.objectContaining({
        title: 'Backend Developer',
        company: 'Acme Labs',
        applyMode: 'EASY_APPLY',
      }),
    );
  });

  it('cierra context y browser al finalizar la sesion local del worker', async () => {
    const { launcher, browser, context } = createLauncherMock();
    const runtime = createWorkerPlaywrightRuntime({
      launcher,
      config: {
        PLAYWRIGHT_HEADLESS: false,
        BROWSER_SESSION_STATE_DIR: 'storage/browser-sessions',
      },
      accessFn: vi.fn(async () => {
        throw new Error('missing');
      }),
      mkdirFn: vi.fn(async () => ({})),
    });

    const result = await runtime.startSession({
      provider: 'LINKEDIN_JOBS',
      startUrl: 'https://www.linkedin.com/jobs/',
    });

    await runtime.close(result.handle);

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('captura usando la pestaña nueva cuando el usuario abre otra Page en el mismo contexto', async () => {
    const { launcher, emitNewPage, page } = createLauncherMock();
    const runtime = createWorkerPlaywrightRuntime({
      launcher,
      config: {
        PLAYWRIGHT_HEADLESS: false,
        BROWSER_SESSION_STATE_DIR: 'storage/browser-sessions',
      },
      accessFn: vi.fn(async () => {
        throw new Error('missing');
      }),
      mkdirFn: vi.fn(async () => ({})),
    });

    const result = await runtime.startSession({
      sessionId: 'session-tabs-1',
      provider: 'LINKEDIN_JOBS',
      startUrl: 'https://www.linkedin.com/jobs/',
    });
    const jobPage = createPageMock('https://www.linkedin.com/jobs/view/67890');
    emitNewPage(jobPage);

    const snapshot = await runtime.captureSnapshot(result.handle);

    expect(jobPage.evaluate).toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(snapshot.url).toBe('https://www.linkedin.com/jobs/view/67890');
  });

  it('recupera una pestaña abierta del contexto si la guardada en handle.page quedó cerrada', async () => {
    const { launcher, setPages } = createLauncherMock();
    const runtime = createWorkerPlaywrightRuntime({
      launcher,
      config: {
        PLAYWRIGHT_HEADLESS: false,
        BROWSER_SESSION_STATE_DIR: 'storage/browser-sessions',
      },
      accessFn: vi.fn(async () => {
        throw new Error('missing');
      }),
      mkdirFn: vi.fn(async () => ({})),
    });

    const result = await runtime.startSession({
      sessionId: 'session-fallback-1',
      provider: 'LINKEDIN_JOBS',
      startUrl: 'https://www.linkedin.com/jobs/',
    });
    const fallbackPage = createPageMock('https://www.linkedin.com/jobs/view/99999');
    result.handle.page.isClosed.mockReturnValue(true);
    setPages([result.handle.page, fallbackPage]);

    const snapshot = await runtime.captureSnapshot(result.handle);

    expect(fallbackPage.evaluate).toHaveBeenCalled();
    expect(snapshot.url).toBe('https://www.linkedin.com/jobs/view/99999');
  });
});
