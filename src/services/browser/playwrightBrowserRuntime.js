import { chromium } from 'playwright';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';

const MAX_CAPTURE_CHARS = 20_000;
const BROWSER_RUNTIME = {
  LOCAL: 'local',
  BROWSERLESS: 'browserless',
};
const BROWSERLESS_NATIVE_PLAYWRIGHT_SUFFIX = '/playwright';
const HIRING_SIGNAL_PATTERNS = [
  { token: 'hiring', pattern: /\bhiring\b/u },
  { token: 'send_your_resume', pattern: /send (your )?(resume|cv)/u },
  { token: 'enviar_cv', pattern: /enviar (cv|resume|curriculum)/u },
  { token: 'oportunidad_laboral', pattern: /oportunidad laboral/u },
  { token: 'estamos_buscando', pattern: /estamos buscando/u },
  { token: 'busqueda_activa', pattern: /b[uÃº]squeda activa/u },
  { token: 'escribeme_por_privado', pattern: /escr[iÃ­]beme por privado/u },
  { token: 'apply_here', pattern: /apply here/u },
  { token: 'dm_me', pattern: /\b(dm|direct message|message me)\b/u },
];
const VISIBLE_EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;

export function createPlaywrightBrowserRuntime(options = {}) {
  const launcher = options.launcher ?? chromium;
  const config = options.config ?? env;
  const launchOptions = options.launchOptions ?? {};
  const accessFn = options.accessFn ?? access;
  const mkdirFn = options.mkdirFn ?? mkdir;

  if (config.BROWSER_RUNTIME === BROWSER_RUNTIME.BROWSERLESS) {
    return createBrowserlessRuntime({
      launcher,
      config,
      accessFn,
      mkdirFn,
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
    async startSession({ provider, startUrl }) {
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
        stateFilePath,
        runtimeKind: BROWSER_RUNTIME.LOCAL,
      };
      await persistStorageState(handle, mkdirFn);

      return {
        handle,
        snapshot: await buildSnapshot(handle, page),
        reusedStoredSession: Boolean(existingStatePath),
      };
    },

    async navigate(handle, url) {
      await handle.page.goto(url, { waitUntil: 'domcontentloaded' });
      await persistStorageState(handle, mkdirFn);
      return buildSnapshot(handle, handle.page);
    },

    async getSnapshot(handle) {
      await persistStorageState(handle, mkdirFn);
      return buildSnapshot(handle, handle.page);
    },

    async close(handle) {
      await persistStorageState(handle, mkdirFn);
      await handle.context.close();
      await handle.browser.close();
    },
  };
}

function createBrowserlessRuntime({ launcher, config, accessFn, mkdirFn }) {
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
        stateFilePath,
        runtimeKind: BROWSER_RUNTIME.BROWSERLESS,
        browserlessConnectionMode: connectionMode,
      };
      await persistStorageState(handle, mkdirFn);

      return {
        handle,
        snapshot: await buildSnapshot(handle, page),
        reusedStoredSession: Boolean(existingStatePath || config.BROWSERLESS_PROFILE_NAME),
      };
    },

    async navigate(handle, url) {
      await handle.page.goto(url, { waitUntil: 'domcontentloaded' });
      await persistStorageState(handle, mkdirFn);
      return buildSnapshot(handle, handle.page);
    },

    async getSnapshot(handle) {
      await persistStorageState(handle, mkdirFn);
      return buildSnapshot(handle, handle.page);
    },

    async close(handle) {
      await persistStorageState(handle, mkdirFn);
      await handle.browser.close();
    },
  };
}

async function buildSnapshot(handle, page) {
  const [title, url, visibleText] = await Promise.all([
    page.title(),
    Promise.resolve(page.url()),
    page.evaluate((limit) => {
      const sourceNode =
        globalThis.document.querySelector('main') ?? globalThis.document.body;
      return String(sourceNode?.innerText ?? '')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, limit);
    }, MAX_CAPTURE_CHARS),
  ]);

  const snapshot = inspectLinkedInPage({
    title,
    url,
    visibleText,
  });

  return {
    title,
    url,
    visibleText,
    capturedAt: new Date().toISOString(),
    runtimeKind: handle.runtimeKind,
    browserlessConnectionMode: handle.browserlessConnectionMode ?? null,
    ...snapshot,
  };
}

function inspectLinkedInPage({ title, url, visibleText }) {
  const normalizedText = `${title} ${visibleText}`.toLowerCase();
  const normalizedUrl = String(url).toLowerCase();
  const attentionReasons = [];

  const isLinkedIn = normalizedUrl.includes('linkedin.com');
  const isJobsSection = normalizedUrl.includes('linkedin.com/jobs');
  const isJobView = /linkedin\.com\/jobs\/view/u.test(normalizedUrl);
  const isFeedSection = normalizedUrl.includes('linkedin.com/feed');
  const isPostSearchSection = normalizedUrl.includes('linkedin.com/search/results/content');
  const isPostDetail =
    normalizedUrl.includes('linkedin.com/feed/update/') || normalizedUrl.includes('linkedin.com/posts/');
  const hiringSignals = HIRING_SIGNAL_PATTERNS.filter(({ pattern }) => pattern.test(normalizedText)).map(
    ({ token }) => token,
  );
  const visibleEmails = [...new Set(visibleText.match(VISIBLE_EMAIL_PATTERN)?.map((item) => item.toLowerCase()) ?? [])];

  if (!isLinkedIn) {
    attentionReasons.push('UNSUPPORTED_DOMAIN');
  }

  if (/captcha|security verification|checkpoint|two-step|verification required/u.test(normalizedText)) {
    attentionReasons.push('CAPTCHA_OR_CHALLENGE');
  }

  if (/sign in|log in/u.test(normalizedText) && normalizedText.includes('linkedin')) {
    attentionReasons.push('LOGIN_REQUIRED');
  }

  return {
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
  };
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
