import { chromium } from 'playwright';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { captureLinkedInSnapshot } from '../src/services/browser/linkedinSnapshotExtractor.js';

const MAX_CAPTURE_CHARS = 20_000;

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
        snapshot: await readSnapshot(page, config),
      };
    },

    async navigate(handle, url) {
      await handle.page.goto(url, { waitUntil: 'domcontentloaded' });
      await persistStorageState(handle, mkdirFn);
      return readSnapshot(handle.page, config);
    },

    async getSnapshot(handle) {
      await persistStorageState(handle, mkdirFn);
      return readSnapshot(handle.page, config);
    },

    async close(handle) {
      await persistStorageState(handle, mkdirFn);
      await handle.context.close();
      await handle.browser.close();
    },
  };
}

async function readSnapshot(page, config) {
  return captureLinkedInSnapshot(page, {
    maxCaptureChars: MAX_CAPTURE_CHARS,
    debug:
      config?.LOG_LEVEL === 'debug'
        ? (stage, payload) => {
            console.info(
              `[desktop-worker-playwright-runtime] ${JSON.stringify({
                stage,
                timestamp: new Date().toISOString(),
                ...payload,
              })}`,
            );
          }
        : null,
  });
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
