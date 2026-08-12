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
    contexts: vi.fn(() => [context]),
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => ({})),
  };
  const launcher = {
    launch: vi.fn(async () => browser),
    connectOverCDP: vi.fn(async () => browser),
    connect: vi.fn(async () => browser),
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
      connectOverCDP: vi.fn(),
      connect: vi.fn(),
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

  it('usa connectOverCDP cuando Browserless expone un endpoint CDP', async () => {
    const { launcher, browser } = createLauncherMock();
    const runtime = createPlaywrightBrowserRuntime({
      launcher,
      config: {
        BROWSER_RUNTIME: 'browserless',
        BROWSERLESS_WS_URL: 'wss://browserless.example.com',
        BROWSERLESS_TOKEN: 'secret-token',
        PLAYWRIGHT_HEADLESS: true,
        BROWSER_SESSION_STATE_DIR: 'storage/browser-sessions',
      },
      accessFn: vi.fn(async () => {
        throw new Error('missing');
      }),
      mkdirFn: vi.fn(async () => ({})),
    });

    const result = await runtime.startSession({
      sessionId: 'session-cdp-1',
      provider: 'LINKEDIN_JOBS',
      startUrl: 'https://www.linkedin.com/jobs/',
    });

    expect(launcher.connectOverCDP).toHaveBeenCalledWith(
      expect.stringContaining('wss://browserless.example.com/?token=secret-token&id=session-cdp-1'),
    );
    expect(launcher.connect).not.toHaveBeenCalled();
    expect(browser.newContext).not.toHaveBeenCalled();
    expect(result.snapshot.runtimeKind).toBe('browserless');
    expect(result.snapshot.browserlessConnectionMode).toBe('cdp');
  });

  it('usa connect cuando el endpoint Browserless es Playwright nativo', async () => {
    const { launcher } = createLauncherMock();
    const runtime = createPlaywrightBrowserRuntime({
      launcher,
      config: {
        BROWSER_RUNTIME: 'browserless',
        BROWSERLESS_WS_URL: 'wss://browserless.example.com/chromium/playwright',
        BROWSERLESS_TOKEN: 'secret-token',
        BROWSERLESS_PROFILE_NAME: 'linkedin-jobpilot',
        PLAYWRIGHT_HEADLESS: true,
        BROWSER_SESSION_STATE_DIR: 'storage/browser-sessions',
      },
      accessFn: vi.fn(async () => {
        throw new Error('missing');
      }),
      mkdirFn: vi.fn(async () => ({})),
    });

    const result = await runtime.startSession({
      sessionId: 'session-native-1',
      provider: 'LINKEDIN_JOBS',
      startUrl: 'https://www.linkedin.com/jobs/',
    });

    expect(launcher.connect).toHaveBeenCalledWith(
      expect.stringContaining('/chromium/playwright?token=secret-token&id=session-native-1&profile=linkedin-jobpilot'),
    );
    expect(launcher.connectOverCDP).not.toHaveBeenCalled();
    expect(result.reusedStoredSession).toBe(true);
    expect(result.snapshot.browserlessConnectionMode).toBe('playwright-native');
  });

  it('respeta el token ya incluido en el endpoint Browserless', async () => {
    const { launcher } = createLauncherMock();
    const runtime = createPlaywrightBrowserRuntime({
      launcher,
      config: {
        BROWSER_RUNTIME: 'browserless',
        BROWSERLESS_WS_URL: 'wss://browserless.example.com/chromium/playwright?token=inline-token',
        BROWSERLESS_TOKEN: 'should-not-be-used',
        PLAYWRIGHT_HEADLESS: true,
        BROWSER_SESSION_STATE_DIR: 'storage/browser-sessions',
      },
      accessFn: vi.fn(async () => {
        throw new Error('missing');
      }),
      mkdirFn: vi.fn(async () => ({})),
    });

    await runtime.startSession({
      sessionId: 'session-inline-token',
      provider: 'LINKEDIN_JOBS',
      startUrl: 'https://www.linkedin.com/jobs/',
    });

    expect(launcher.connect).toHaveBeenCalledWith(
      expect.stringContaining('token=inline-token'),
    );
    expect(launcher.connect).not.toHaveBeenCalledWith(
      expect.stringContaining('should-not-be-used'),
    );
  });

  it('falla con un error claro cuando Browserless no esta configurado', async () => {
    const { launcher } = createLauncherMock();
    const runtime = createPlaywrightBrowserRuntime({
      launcher,
      config: {
        BROWSER_RUNTIME: 'browserless',
        BROWSERLESS_WS_URL: '',
        BROWSERLESS_TOKEN: '',
        PLAYWRIGHT_HEADLESS: true,
      },
      accessFn: vi.fn(async () => {
        throw new Error('missing');
      }),
      mkdirFn: vi.fn(async () => ({})),
    });

    await expect(
      runtime.startSession({
        sessionId: 'session-invalid',
        provider: 'LINKEDIN_JOBS',
        startUrl: 'https://www.linkedin.com/jobs/',
      }),
    ).rejects.toMatchObject({
      code: 'BROWSERLESS_CONFIG_ERROR',
      message: 'BROWSERLESS_WS_URL no esta configurado para el runtime remoto.',
    });
  });

  it('resuelve una URL temporal de control remoto usando /sessions de Browserless', async () => {
    const { launcher } = createLauncherMock();
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          trackingId: 'session-remote-1',
          devtoolsFrontendUrl:
            '/devtools/inspector.html?wss=browserless.example.com/devtools/page/abc123',
        },
      ],
    }));
    const runtime = createPlaywrightBrowserRuntime({
      launcher,
      fetchFn,
      config: {
        BROWSER_RUNTIME: 'browserless',
        BROWSERLESS_WS_URL: 'wss://browserless.example.com/chromium/playwright',
        BROWSERLESS_TOKEN: 'secret-token',
        PLAYWRIGHT_HEADLESS: true,
        BROWSER_SESSION_STATE_DIR: 'storage/browser-sessions',
      },
      accessFn: vi.fn(async () => {
        throw new Error('missing');
      }),
      mkdirFn: vi.fn(async () => ({})),
    });

    const result = await runtime.startSession({
      sessionId: 'session-remote-1',
      provider: 'LINKEDIN_JOBS',
      startUrl: 'https://www.linkedin.com/jobs/',
    });

    const remoteControlUrl = await runtime.getRemoteControlUrl(result.handle);

    expect(fetchFn).toHaveBeenCalledWith(
      'https://browserless.example.com/sessions?token=secret-token&id=session-remote-1',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(remoteControlUrl).toBe(
      'https://browserless.example.com/devtools/inspector.html?wss=browserless.example.com%2Fdevtools%2Fpage%2Fabc123&token=secret-token',
    );
  });

  it('falla con un error claro cuando Browserless no devuelve visor remoto', async () => {
    const { launcher } = createLauncherMock();
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    }));
    const runtime = createPlaywrightBrowserRuntime({
      launcher,
      fetchFn,
      config: {
        BROWSER_RUNTIME: 'browserless',
        BROWSERLESS_WS_URL: 'wss://browserless.example.com/chromium/playwright',
        BROWSERLESS_TOKEN: 'secret-token',
        PLAYWRIGHT_HEADLESS: true,
      },
      accessFn: vi.fn(async () => {
        throw new Error('missing');
      }),
      mkdirFn: vi.fn(async () => ({})),
    });

    const result = await runtime.startSession({
      sessionId: 'session-remote-missing',
      provider: 'LINKEDIN_JOBS',
      startUrl: 'https://www.linkedin.com/jobs/',
    });

    await expect(runtime.getRemoteControlUrl(result.handle)).rejects.toMatchObject({
      code: 'BROWSERLESS_REMOTE_CONTROL_ERROR',
      message: 'No se encontro un visor remoto disponible para la sesion activa.',
    });
  });
});
