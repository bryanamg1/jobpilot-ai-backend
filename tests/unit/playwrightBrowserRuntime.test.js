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
    });

    await expect(runtime.startSession({ startUrl: 'https://www.linkedin.com/jobs/' })).rejects.toThrow(
      'launch failed',
    );
  });
});
