import { describe, expect, it, vi } from 'vitest';
import { createWorkerPlaywrightRuntime } from '../../desktop-agent/playwrightRuntime.js';

function createLauncherMock() {
  const page = {
    goto: vi.fn(async () => ({})),
    title: vi.fn(async () => 'LinkedIn Jobs'),
    url: vi.fn(() => 'https://www.linkedin.com/jobs/'),
    evaluate: vi.fn(async () => 'Visible jobs text'),
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

  return { launcher, browser, context };
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
});
