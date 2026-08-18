import { chromium } from 'playwright';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { captureLinkedInSnapshot } from '../src/services/browser/linkedinSnapshotExtractor.js';

const MAX_CAPTURE_CHARS = 20_000;
let runtimeDebugSequence = 0;

export function createWorkerPlaywrightRuntime(options = {}) {
  const launcher = options.launcher ?? chromium;
  const accessFn = options.accessFn ?? access;
  const mkdirFn = options.mkdirFn ?? mkdir;
  const config = options.config;

  return {
    async startSession({ sessionId, provider, startUrl }) {
      const stateFilePath = resolveStateFilePath(config.BROWSER_SESSION_STATE_DIR, provider);
      const existingStatePath = await resolveExistingStatePath(stateFilePath, accessFn);
      const browser = await launcher.launch({
        headless: config.PLAYWRIGHT_HEADLESS,
      });
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        ...(existingStatePath ? { storageState: existingStatePath } : {}),
      });
      const page = await context.newPage();
      await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

      const handle = {
        browser,
        context,
        page,
        sessionId,
        provider,
        stateFilePath,
        browserDebugId: createRuntimeDebugId('browser'),
        contextDebugId: createRuntimeDebugId('context'),
      };
      attachTrackedPageListeners(handle);

      await persistStorageState(handle, mkdirFn);
      logWorkerRuntimeEvent('info', 'browser.connected', {
        sessionId: handle.sessionId ?? null,
        browserId: handle.browserDebugId,
        contextId: handle.contextDebugId,
        provider,
        currentUrl: page.url(),
      });

      return {
        handle,
        reusedStoredSession: Boolean(existingStatePath),
        snapshot: await readSnapshot(handle, config),
      };
    },

    async navigate(handle, url) {
      const page = resolveTrackedPage(handle, 'browser.page.navigate');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await persistStorageState(handle, mkdirFn);
      return readSnapshot(handle, config);
    },

    async getSnapshot(handle, options = {}) {
      await persistStorageState(handle, mkdirFn);
      return readSnapshot(handle, config, options);
    },

    async captureSnapshot(handle) {
      await persistStorageState(handle, mkdirFn);
      return readSnapshot(handle, config, { captureMode: 'job_capture' });
    },

    async close(handle) {
      await persistStorageState(handle, mkdirFn);
      await handle.context.close();
      await handle.browser.close();
      logWorkerRuntimeEvent('info', 'browser.disconnected', {
        provider: handle.provider ?? null,
      });
    },
  };
}

async function readSnapshot(handle, config, options = {}) {
  const page = resolveTrackedPage(handle, options.captureMode === 'job_capture' ? 'browser.page.capture' : 'browser.page.snapshot');
  return captureLinkedInSnapshot(page, {
    maxCaptureChars: MAX_CAPTURE_CHARS,
    provider: handle?.provider ?? null,
    captureMode: options.captureMode ?? 'passive',
    debug:
      config?.LOG_LEVEL === 'debug'
        ? (stage, payload) => {
            logWorkerRuntimeEvent('debug', stage, payload, config?.LOG_LEVEL);
          }
        : null,
    logger: (level, stage, payload) => logWorkerRuntimeEvent(level, stage, payload, config?.LOG_LEVEL),
  });
}

function attachTrackedPageListeners(handle) {
  if (typeof handle.context?.on === 'function') {
    handle.context.on('page', (page) => {
      handle.page = page;
      attachPageCloseListener(handle, page);
      logTrackedPageState('debug', 'browser.page.tracked', handle, page);
    });
  }

  attachPageCloseListener(handle, handle.page);
}

function attachPageCloseListener(handle, page) {
  if (!page || typeof page.on !== 'function') {
    return;
  }

  page.on('close', () => {
    const fallbackPage = resolveTrackedPage(handle, 'browser.page.closed', { preferExistingHandlePage: false });
    logTrackedPageState('debug', 'browser.page.fallback_selected', handle, fallbackPage);
  });
}

function resolveTrackedPage(handle, stage, options = {}) {
  const pages = Array.isArray(handle.context?.pages?.()) ? handle.context.pages() : [];
  const preferExistingHandlePage = options.preferExistingHandlePage ?? true;
  let selectedPage =
    preferExistingHandlePage && handle.page && !isClosedPage(handle.page) && pages.includes(handle.page)
      ? handle.page
      : [...pages].reverse().find((page) => !isClosedPage(page)) ?? null;

  if (!selectedPage && handle.page && !isClosedPage(handle.page)) {
    selectedPage = handle.page;
  }

  if (selectedPage) {
    handle.page = selectedPage;
  }

  logTrackedPageState('debug', stage, handle, selectedPage, pages);
  return selectedPage ?? handle.page;
}

function logTrackedPageState(level, stage, handle, selectedPage, pagesInput = null) {
  const pages = Array.isArray(pagesInput) ? pagesInput : Array.isArray(handle.context?.pages?.()) ? handle.context.pages() : [];
  const openPages = pages.map((page, index) => ({
    index,
    url: readPageUrl(page),
    isClosed: isClosedPage(page),
  }));
  const selectedPageIndex = selectedPage ? pages.indexOf(selectedPage) : -1;

  logWorkerRuntimeEvent(level, stage, {
    sessionId: handle.sessionId ?? null,
    browserId: handle.browserDebugId ?? null,
    contextId: handle.contextDebugId ?? null,
    openPageCount: pages.length,
    openPages,
    selectedPageIndex,
    selectedPageClosed: selectedPage ? isClosedPage(selectedPage) : null,
    selectedPageUrl: selectedPage ? readPageUrl(selectedPage) : null,
  });
}

function isClosedPage(page) {
  try {
    return Boolean(page?.isClosed?.());
  } catch {
    return true;
  }
}

function readPageUrl(page) {
  try {
    return String(page?.url?.() ?? '');
  } catch {
    return '';
  }
}

function createRuntimeDebugId(prefix) {
  runtimeDebugSequence += 1;
  return `${prefix}-${runtimeDebugSequence}`;
}

function resolveStateFilePath(baseDir, provider) {
  const safeProvider = String(provider || 'default')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-');

  return path.resolve(process.cwd(), baseDir, `${safeProvider}.json`);
}

async function resolveExistingStatePath(stateFilePath, accessFn) {
  try {
    await accessFn(stateFilePath);
    return stateFilePath;
  } catch {
    return null;
  }
}

async function persistStorageState(handle, mkdirFn) {
  try {
    await mkdirFn(path.dirname(handle.stateFilePath), { recursive: true });
    await handle.context.storageState({ path: handle.stateFilePath });
  } catch {
    // best effort
  }
}

function logWorkerRuntimeEvent(level, stage, payload, currentLogLevel = 'info') {
  if (!shouldLog(level, currentLogLevel)) {
    return;
  }
  const writer = typeof console[level] === 'function' ? console[level].bind(console) : console.info.bind(console);
  writer(
    `[desktop-worker-playwright-runtime] ${JSON.stringify({
      stage,
      timestamp: new Date().toISOString(),
      ...payload,
    })}`,
  );
}

function shouldLog(level, currentLogLevel) {
  const weights = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };

  return (weights[level] ?? weights.info) >= (weights[currentLogLevel] ?? weights.info);
}
