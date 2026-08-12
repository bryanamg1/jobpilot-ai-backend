import { chromium } from 'playwright';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_CAPTURE_CHARS = 20_000;
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

export function createWorkerPlaywrightRuntime(options = {}) {
  const launcher = options.launcher ?? chromium;
  const accessFn = options.accessFn ?? access;
  const mkdirFn = options.mkdirFn ?? mkdir;
  const config = options.config;

  return {
    async startSession({ provider, startUrl }) {
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
        stateFilePath,
      };

      await persistStorageState(handle, mkdirFn);

      return {
        handle,
        reusedStoredSession: Boolean(existingStatePath),
        snapshot: await readSnapshot(page),
      };
    },

    async navigate(handle, url) {
      await handle.page.goto(url, { waitUntil: 'domcontentloaded' });
      await persistStorageState(handle, mkdirFn);
      return readSnapshot(handle.page);
    },

    async getSnapshot(handle) {
      await persistStorageState(handle, mkdirFn);
      return readSnapshot(handle.page);
    },

    async close(handle) {
      await persistStorageState(handle, mkdirFn);
      await handle.context.close();
      await handle.browser.close();
    },
  };
}

async function readSnapshot(page) {
  const [title, url, visibleText] = await Promise.all([
    page.title(),
    Promise.resolve(page.url()),
    page.evaluate((limit) => {
      const sourceNode = globalThis.document.querySelector('main') ?? globalThis.document.body;
      return String(sourceNode?.innerText ?? '')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, limit);
    }, MAX_CAPTURE_CHARS),
  ]);

  return {
    title,
    url,
    visibleText,
    capturedAt: new Date().toISOString(),
    ...inspectLinkedInPage({ title, url, visibleText }),
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
    await mkdirFn(path.dirname(handle.stateFilePath), { recursive: true });
    await handle.context.storageState({ path: handle.stateFilePath });
  } catch {
    // best effort
  }
}
