import { describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import { createPlaywrightBrowserRuntime } from '../../src/services/browser/playwrightBrowserRuntime.js';

function createLauncherMock() {
  const page = {
    goto: vi.fn(async () => ({})),
    title: vi.fn(async () => 'LinkedIn Jobs'),
    url: vi.fn(() => 'https://www.linkedin.com/jobs/'),
    evaluate: vi.fn(async () => 'Visible jobs text long enough for snapshot'),
  };
  const context = {
    newPage: vi.fn(async () => page),
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
  };
}

describe('playwrightBrowserRuntime', () => {
  it('usa headless true cuando la configuracion lo indica', async () => {
    const { launcher } = createLauncherMock();
    const runtime = createPlaywrightBrowserRuntime({
      launcher,
      config: { PLAYWRIGHT_HEADLESS: true },
      accessFn: vi.fn(async () => {
        throw new Error('missing');
      }),
      mkdirFn: vi.fn(async () => ({})),
    });

    await runtime.startSession({ startUrl: 'https://www.linkedin.com/jobs/' });

    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
      }),
    );
  });

  it('usa headless false cuando la configuracion lo indica', async () => {
    const { launcher } = createLauncherMock();
    const runtime = createPlaywrightBrowserRuntime({
      launcher,
      config: { PLAYWRIGHT_HEADLESS: false },
      accessFn: vi.fn(async () => {
        throw new Error('missing');
      }),
      mkdirFn: vi.fn(async () => ({})),
    });

    await runtime.startSession({ startUrl: 'https://www.linkedin.com/jobs/' });

    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: false,
      }),
    );
  });

  it('usa el valor default centralizado cuando no se pasa config explicita', async () => {
    const { launcher } = createLauncherMock();
    const runtime = createPlaywrightBrowserRuntime({ launcher });

    await runtime.startSession({ startUrl: 'https://www.linkedin.com/jobs/' });

    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: env.PLAYWRIGHT_HEADLESS,
      }),
    );
  });

  it('mantiene opciones existentes al lanzar Chromium', async () => {
    const { launcher } = createLauncherMock();
    const runtime = createPlaywrightBrowserRuntime({
      launcher,
      config: { PLAYWRIGHT_HEADLESS: true },
      launchOptions: {
        args: ['--no-sandbox'],
      },
      accessFn: vi.fn(async () => {
        throw new Error('missing');
      }),
      mkdirFn: vi.fn(async () => ({})),
    });

    await runtime.startSession({ startUrl: 'https://www.linkedin.com/jobs/' });

    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
        args: ['--no-sandbox'],
      }),
    );
  });

  it('propaga el error de launch para que el servicio lo clasifique', async () => {
    const launcher = {
      launch: vi.fn(async () => {
        throw new Error('launch failed');
      }),
    };
    const runtime = createPlaywrightBrowserRuntime({
      launcher,
      config: { PLAYWRIGHT_HEADLESS: true },
      accessFn: vi.fn(async () => {
        throw new Error('missing');
      }),
      mkdirFn: vi.fn(async () => ({})),
    });

    await expect(runtime.startSession({ startUrl: 'https://www.linkedin.com/jobs/' })).rejects.toThrow(
      'launch failed',
    );
  });

  it('reutiliza storageState guardado cuando existe una sesion previa', async () => {
    const { launcher, browser } = createLauncherMock();
    const accessFn = vi.fn(async () => ({}));
    const mkdirFn = vi.fn(async () => ({}));
    const runtime = createPlaywrightBrowserRuntime({
      launcher,
      config: {
        PLAYWRIGHT_HEADLESS: true,
        BROWSER_SESSION_STATE_DIR: 'storage/browser-sessions',
      },
      accessFn,
      mkdirFn,
    });

    const result = await runtime.startSession({
      provider: 'LINKEDIN_JOBS',
      startUrl: 'https://www.linkedin.com/jobs/',
    });

    expect(browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        ignoreHTTPSErrors: true,
        storageState: expect.stringContaining('linkedin_jobs.json'),
      }),
    );
    expect(result.reusedStoredSession).toBe(true);
  });

  it('guarda storageState al iniciar una sesion supervisada', async () => {
    const { launcher, context } = createLauncherMock();
    const accessFn = vi.fn(async () => {
      throw new Error('missing');
    });
    const mkdirFn = vi.fn(async () => ({}));
    const runtime = createPlaywrightBrowserRuntime({
      launcher,
      config: {
        PLAYWRIGHT_HEADLESS: true,
        BROWSER_SESSION_STATE_DIR: 'storage/browser-sessions',
      },
      accessFn,
      mkdirFn,
    });

    await runtime.startSession({
      provider: 'LINKEDIN_FEED',
      startUrl: 'https://www.linkedin.com/feed/',
    });

    expect(context.storageState).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining('linkedin_feed.json'),
      }),
    );
  });
});
