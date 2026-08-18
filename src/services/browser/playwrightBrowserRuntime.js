import { chromium } from 'playwright';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { captureLinkedInSnapshot } from './linkedinSnapshotExtractor.js';

const MAX_CAPTURE_CHARS = 20_000;
const BROWSER_RUNTIME = {
  LOCAL: 'local',
  BROWSERLESS: 'browserless',
};
const BROWSERLESS_NATIVE_PLAYWRIGHT_SUFFIX = '/playwright';
let runtimeDebugSequence = 0;

export function createPlaywrightBrowserRuntime(options = {}) {
  const launcher = options.launcher ?? chromium;
  const config = options.config ?? env;
  const launchOptions = options.launchOptions ?? {};
  const accessFn = options.accessFn ?? access;
  const mkdirFn = options.mkdirFn ?? mkdir;
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);

  if (config.BROWSER_RUNTIME === BROWSER_RUNTIME.BROWSERLESS) {
    return createBrowserlessRuntime({
      launcher,
      config,
      accessFn,
      mkdirFn,
      fetchFn,
    });
  }

  return createLocalRuntime({
    launcher,
    config,
    launchOptions,
    accessFn,
    mkdirFn,
  });
}

function createLocalRuntime({ launcher, config, launchOptions, accessFn, mkdirFn }) {
  return {
    async startSession({ sessionId, provider, startUrl }) {
      const stateFilePath = resolveStateFilePath(
        config.BROWSER_SESSION_STATE_DIR ?? env.BROWSER_SESSION_STATE_DIR,
        provider,
      );
      const existingStatePath = await resolveExistingStatePath(stateFilePath, accessFn);
      const browser = await launcher.launch({
        ...launchOptions,
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
        sessionId: sessionId ?? null,
        provider,
        stateFilePath,
        runtimeKind: BROWSER_RUNTIME.LOCAL,
        debugEnabled: config.LOG_LEVEL === 'debug',
        closePolicy: 'close_context_and_browser',
        browserDebugId: createRuntimeDebugId('browser'),
        contextDebugId: createRuntimeDebugId('context'),
      };
      attachTrackedPageListeners(handle);
      await persistStorageState(handle, mkdirFn);
      logPlaywrightRuntimeEvent('info', 'browser.connected', {
        sessionId: handle.sessionId,
        browserId: handle.browserDebugId,
        contextId: handle.contextDebugId,
        runtimeKind: handle.runtimeKind,
        provider,
        currentUrl: page.url(),
      });

      return {
        handle,
        snapshot: await buildSnapshot(handle),
        reusedStoredSession: Boolean(existingStatePath),
      };
    },

    async navigate(handle, url) {
      const page = resolveTrackedPage(handle, 'browser.page.navigate');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await persistStorageState(handle, mkdirFn);
      return buildSnapshot(handle);
    },

    async getSnapshot(handle) {
      await persistStorageState(handle, mkdirFn);
      return buildSnapshot(handle);
    },

    async captureSnapshot(handle) {
      await persistStorageState(handle, mkdirFn);
      return buildSnapshot(handle, { captureMode: 'job_capture' });
    },

    async close(handle) {
      await closeLocalHandle(handle, mkdirFn);
    },

    async getRemoteControlUrl() {
      return null;
    },
  };
}

function createBrowserlessRuntime({ launcher, config, accessFn, mkdirFn, fetchFn }) {
  return {
    async startSession({ sessionId, provider, startUrl }) {
      const stateFilePath = resolveStateFilePath(
        config.BROWSER_SESSION_STATE_DIR ?? env.BROWSER_SESSION_STATE_DIR,
        provider,
      );
      const existingStatePath = await resolveExistingStatePath(stateFilePath, accessFn);
      const browserlessUrl = buildBrowserlessWebSocketUrl(config, sessionId);
      const connectionMode = resolveBrowserlessConnectionMode(browserlessUrl);
      const browser =
        connectionMode === 'playwright-native'
          ? await launcher.connect(browserlessUrl.toString())
          : await launcher.connectOverCDP(browserlessUrl.toString());
      const context = await resolveBrowserlessContext(browser, existingStatePath);
      const page = await resolveBrowserlessPage(context);

      await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

      const handle = {
        browser,
        context,
        page,
        sessionId,
        provider,
        stateFilePath,
        runtimeKind: BROWSER_RUNTIME.BROWSERLESS,
        browserlessConnectionMode: connectionMode,
        browserlessSessionId: sessionId,
        browserlessWsUrl: browserlessUrl.toString(),
        debugEnabled: config.LOG_LEVEL === 'debug',
        closePolicy: 'explicit_browser_close_only',
        browserDebugId: createRuntimeDebugId('browser'),
        contextDebugId: createRuntimeDebugId('context'),
      };
      attachTrackedPageListeners(handle);
      await persistStorageState(handle, mkdirFn);
      logPlaywrightRuntimeEvent('info', 'browser.connected', {
        sessionId: handle.sessionId,
        browserId: handle.browserDebugId,
        contextId: handle.contextDebugId,
        runtimeKind: handle.runtimeKind,
        provider,
        currentUrl: page.url(),
      });

      return {
        handle,
        snapshot: await buildSnapshot(handle),
        reusedStoredSession: Boolean(existingStatePath || config.BROWSERLESS_PROFILE_NAME),
      };
    },

    async navigate(handle, url) {
      const page = resolveTrackedPage(handle, 'browser.page.navigate');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await persistStorageState(handle, mkdirFn);
      return buildSnapshot(handle);
    },

    async getSnapshot(handle) {
      await persistStorageState(handle, mkdirFn);
      return buildSnapshot(handle);
    },

    async captureSnapshot(handle) {
      await persistStorageState(handle, mkdirFn);
      return buildSnapshot(handle, { captureMode: 'job_capture' });
    },

    async close(handle) {
      await closeBrowserlessHandle(handle, mkdirFn);
    },

    async getRemoteControlUrl(handle) {
      if (!fetchFn) {
        throw buildBrowserlessRemoteControlError(
          'Este entorno no soporta fetch para resolver la sesion remota de Browserless.',
          'Actualiza Node.js o verifica el runtime del backend.',
        );
      }

      const sessionsUrl = buildBrowserlessSessionsUrl(handle.browserlessWsUrl);
      const response = await fetchFn(sessionsUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw buildBrowserlessRemoteControlError(
          'Browserless no devolvio la lista de sesiones activas.',
          'Confirma que Browserless exponga /sessions y que EXTERNAL este configurado correctamente.',
        );
      }

      const sessions = await response.json();
      if (!Array.isArray(sessions)) {
        throw buildBrowserlessRemoteControlError(
          'Browserless devolvio una respuesta invalida al consultar /sessions.',
          'Verifica la version y configuracion del servicio Browserless.',
        );
      }

      const matchedSession = sessions.find((entry) =>
        matchesBrowserlessSession(entry, handle.browserlessSessionId),
      );

      if (!matchedSession?.devtoolsFrontendUrl) {
        throw buildBrowserlessRemoteControlError(
          'No se encontro un visor remoto disponible para la sesion activa.',
          'Confirma que la sesion siga abierta y que Browserless tenga EXTERNAL configurado.',
        );
      }

      return buildBrowserlessRemoteControlUrl(sessionsUrl, matchedSession.devtoolsFrontendUrl);
    },
  };
}

async function buildSnapshot(handle, options = {}) {
  const page = resolveTrackedPage(
    handle,
    options.captureMode === 'job_capture' ? 'browser.page.capture' : 'browser.page.snapshot',
  );
  const snapshot = await captureLinkedInSnapshot(page, {
    maxCaptureChars: MAX_CAPTURE_CHARS,
    provider: handle?.provider ?? null,
    captureMode: options.captureMode ?? 'passive',
    debug:
      handle?.debugEnabled
        ? (stage, payload) => {
            logPlaywrightRuntimeEvent('debug', stage, payload);
          }
        : null,
    logger: (level, stage, payload) => logPlaywrightRuntimeEvent(level, stage, payload),
  });

  return {
    ...snapshot,
    runtimeKind: handle.runtimeKind,
    browserlessConnectionMode: handle.browserlessConnectionMode ?? null,
  };
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

  logPlaywrightRuntimeEvent(level, stage, {
    sessionId: handle.sessionId ?? null,
    browserId: handle.browserDebugId ?? null,
    contextId: handle.contextDebugId ?? null,
    runtimeKind: handle.runtimeKind ?? null,
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
    const targetPath = handle?.stateFilePath;
    if (!targetPath || typeof handle?.context?.storageState !== 'function') {
      return;
    }

    await mkdirFn(path.dirname(targetPath), { recursive: true });
    await handle.context.storageState({ path: targetPath });
  } catch {
    // Best effort: supervised browsing should still work even if state persistence fails.
  }
}

async function closeLocalHandle(handle, mkdirFn) {
  await persistStorageState(handle, mkdirFn);
  await handle.context.close();
  await handle.browser.close();
  logPlaywrightRuntimeEvent('info', 'browser.disconnected', {
    runtimeKind: handle.runtimeKind ?? BROWSER_RUNTIME.LOCAL,
    provider: handle.provider ?? null,
  });
}

async function closeBrowserlessHandle(handle, mkdirFn) {
  await persistStorageState(handle, mkdirFn);
  await handle.browser.close();
  logPlaywrightRuntimeEvent('info', 'browser.disconnected', {
    runtimeKind: handle.runtimeKind ?? BROWSER_RUNTIME.BROWSERLESS,
    provider: handle.provider ?? null,
  });
}

function buildBrowserlessWebSocketUrl(config, sessionId) {
  const rawUrl = String(config.BROWSERLESS_WS_URL ?? '').trim();
  if (!rawUrl) {
    throw buildBrowserlessConfigError(
      'BROWSERLESS_WS_URL no esta configurado para el runtime remoto.',
      'Completa BROWSERLESS_WS_URL o vuelve a BROWSER_RUNTIME=local.',
    );
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw buildBrowserlessConfigError(
      'BROWSERLESS_WS_URL no tiene un formato valido.',
      'Usa un endpoint WebSocket valido de Browserless.',
    );
  }

  if (!['ws:', 'wss:'].includes(url.protocol)) {
    throw buildBrowserlessConfigError(
      'BROWSERLESS_WS_URL debe usar ws:// o wss://.',
      'Corrige el protocolo del endpoint remoto de Browserless.',
    );
  }

  if (!url.searchParams.get('token')) {
    const token = String(config.BROWSERLESS_TOKEN ?? '').trim();
    if (!token) {
      throw buildBrowserlessConfigError(
        'Browserless requiere un token y no se encontro en la configuracion.',
        'Completa BROWSERLESS_TOKEN o usa un endpoint que ya incluya ?token=.',
      );
    }

    url.searchParams.set('token', token);
  }

  if (!url.searchParams.get('id')) {
    url.searchParams.set('id', sessionId);
  }

  if (config.BROWSERLESS_PROFILE_NAME && !url.searchParams.get('profile')) {
    url.searchParams.set('profile', config.BROWSERLESS_PROFILE_NAME);
  }

  return url;
}

function resolveBrowserlessConnectionMode(browserlessUrl) {
  return browserlessUrl.pathname.toLowerCase().endsWith(BROWSERLESS_NATIVE_PLAYWRIGHT_SUFFIX)
    ? 'playwright-native'
    : 'cdp';
}

async function resolveBrowserlessContext(browser, existingStatePath) {
  const defaultContext = browser.contexts?.()[0];
  if (defaultContext) {
    return defaultContext;
  }

  if (existingStatePath) {
    return browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: existingStatePath,
    });
  }

  return browser.newContext({
    ignoreHTTPSErrors: true,
  });
}

async function resolveBrowserlessPage(context) {
  const existingPage = context.pages?.()[0];
  if (existingPage) {
    return existingPage;
  }

  return context.newPage();
}

function buildBrowserlessConfigError(message, suggestion) {
  const error = new Error(message);
  error.code = 'BROWSERLESS_CONFIG_ERROR';
  error.suggestion = suggestion;
  return error;
}

function buildBrowserlessSessionsUrl(browserlessWsUrl) {
  const sourceUrl = new URL(browserlessWsUrl);
  sourceUrl.protocol = sourceUrl.protocol === 'wss:' ? 'https:' : 'http:';
  sourceUrl.pathname = '/sessions';
  sourceUrl.hash = '';
  return sourceUrl.toString();
}

function matchesBrowserlessSession(entry, sessionId) {
  if (!entry || !sessionId) {
    return false;
  }

  if (String(entry.trackingId ?? '').trim() === sessionId) {
    return true;
  }

  const initialConnectUrl = String(entry.initialConnectURL ?? '');
  return (
    initialConnectUrl.includes(`id=${encodeURIComponent(sessionId)}`) ||
    initialConnectUrl.includes(`id=${sessionId}`)
  );
}

function buildBrowserlessRemoteControlUrl(sessionsUrl, devtoolsFrontendUrl) {
  const baseUrl = new URL(sessionsUrl);
  const remoteUrl = new URL(devtoolsFrontendUrl, baseUrl.origin);
  const token = baseUrl.searchParams.get('token');

  if (token && !remoteUrl.searchParams.get('token')) {
    remoteUrl.searchParams.set('token', token);
  }

  return remoteUrl.toString();
}

function buildBrowserlessRemoteControlError(message, suggestion) {
  const error = new Error(message);
  error.code = 'BROWSERLESS_REMOTE_CONTROL_ERROR';
  error.suggestion = suggestion;
  return error;
}

function logPlaywrightRuntimeEvent(level, stage, payload) {
  const writer = typeof console[level] === 'function' ? console[level].bind(console) : console.info.bind(console);
  writer(
    `[playwright-browser-runtime] ${JSON.stringify({
      stage,
      timestamp: new Date().toISOString(),
      ...payload,
    })}`,
  );
}
