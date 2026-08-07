import { chromium } from 'playwright';

const MAX_CAPTURE_CHARS = 20_000;
const HIRING_SIGNAL_PATTERNS = [
  { token: 'hiring', pattern: /\bhiring\b/u },
  { token: 'send_your_resume', pattern: /send (your )?(resume|cv)/u },
  { token: 'enviar_cv', pattern: /enviar (cv|resume|curriculum)/u },
  { token: 'oportunidad_laboral', pattern: /oportunidad laboral/u },
  { token: 'estamos_buscando', pattern: /estamos buscando/u },
  { token: 'busqueda_activa', pattern: /b[uú]squeda activa/u },
  { token: 'escribeme_por_privado', pattern: /escr[ií]beme por privado/u },
  { token: 'apply_here', pattern: /apply here/u },
  { token: 'dm_me', pattern: /\b(dm|direct message|message me)\b/u },
];
const VISIBLE_EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;

export function createPlaywrightBrowserRuntime(options = {}) {
  const launcher = options.launcher ?? chromium;

  return {
    async startSession({ startUrl }) {
      const browser = await launcher.launch({
        headless: false,
      });
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
      });
      const page = await context.newPage();
      await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

      return {
        handle: {
          browser,
          context,
          page,
        },
        snapshot: await readSnapshot(page),
      };
    },

    async navigate(handle, url) {
      await handle.page.goto(url, { waitUntil: 'domcontentloaded' });
      return readSnapshot(handle.page);
    },

    async getSnapshot(handle) {
      return readSnapshot(handle.page);
    },

    async close(handle) {
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
