import { describe, expect, it, vi } from 'vitest';
import { createWorkerPlaywrightRuntime } from '../../desktop-agent/playwrightRuntime.js';

function createLauncherMock() {
  const page = {
    goto: vi.fn(async () => ({})),
    title: vi.fn(async () => 'LinkedIn Jobs'),
    url: vi.fn(() => 'https://www.linkedin.com/jobs/view/12345'),
    evaluate: vi.fn(async () => ({
      title: 'Backend Developer | LinkedIn',
      url: 'https://www.linkedin.com/jobs/view/12345',
      visibleText:
        'Backend Developer Acme Labs Remote LATAM Node.js Express MySQL Jest English B2 This description is intentionally long enough to satisfy the supervised capture threshold and mimic a visible LinkedIn Jobs detail page.',
      selectors: {
        h1: 'Backend Developer',
        titleCandidates: ['Backend Developer'],
        companyCandidates: ['Acme Labs'],
        metadataItems: ['Remote', 'LATAM', 'Full-time', 'Junior', '34 applicants'],
        description:
          'We are hiring a Backend Developer with Node.js, Express, MySQL and Jest. English B2 is required.',
        descriptionBlocks: [
          'Requirements: Node.js, Express, MySQL, Jest.',
          'Responsibilities: Build backend services and APIs.',
        ],
        recruiter: 'Jane Recruiter',
        ariaLabels: ['Node.js', 'Express', 'MySQL', 'Jest', 'English B2'],
        applyButtons: ['Easy Apply'],
      },
      jsonLd: {
        title: 'Backend Developer',
        company: 'Acme Labs',
        location: 'Remote',
        employmentType: 'FULL_TIME',
        datePosted: '2026-08-01',
        description:
          'We are hiring a Backend Developer with Node.js, Express, MySQL and Jest. English B2 is required.',
      },
    })),
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
    expect(result.snapshot.extractedJob).toEqual(
      expect.objectContaining({
        title: 'Backend Developer',
        company: 'Acme Labs',
        applyMode: 'EASY_APPLY',
      }),
    );
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
