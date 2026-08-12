import { describe, expect, it, vi } from 'vitest';
import { createBrowserSessionService } from '../../src/services/browser/browserSessionService.js';

function createRepositoryMock() {
  const browserSessions = [];

  return {
    listBrowserSessions: vi.fn(async () => browserSessions),
    getBrowserSessionById: vi.fn(async (sessionId) => browserSessions.find((item) => item.id === sessionId) ?? null),
    saveBrowserSession: vi.fn(async (record) => {
      browserSessions.push(record);
      return record;
    }),
    updateBrowserSession: vi.fn(async (record) => {
      const index = browserSessions.findIndex((item) => item.id === record.id);
      browserSessions[index] = record;
      return record;
    }),
  };
}

describe('browserSessionService', () => {
  it('starts a supervised LinkedIn Jobs session and persists it', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => ({
        handle: { id: 'runtime-handle-1' },
        snapshot: {
          title: 'LinkedIn Jobs',
          url: 'https://www.linkedin.com/jobs/',
          visibleText: 'LinkedIn Jobs Home',
          capturedAt: '2026-08-05T20:00:00.000Z',
          isLinkedIn: true,
          isJobsSection: true,
          isJobView: false,
          requiresAttention: false,
          attentionReasons: [],
        },
      })),
      getSnapshot: vi.fn(),
      navigate: vi.fn(),
      close: vi.fn(),
    };
    const service = createBrowserSessionService(repository, auditService, {}, { runtime });

    const session = await service.startSession({ provider: 'LINKEDIN_JOBS' });

    expect(session.provider).toBe('LINKEDIN_JOBS');
    expect(session.status).toBe('ACTIVE');
    expect(session.metadata.currentUrl).toBe('https://www.linkedin.com/jobs/');
    expect(repository.saveBrowserSession).toHaveBeenCalledTimes(1);
    expect(auditService.record).toHaveBeenCalledWith(
      'browser_session.started',
      'browser_session',
      session.id,
      expect.objectContaining({
        provider: 'LINKEDIN_JOBS',
      }),
    );
  });

  it('starts a supervised LinkedIn feed session with the feed default URL', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => ({
        handle: { id: 'runtime-handle-feed-1' },
        snapshot: {
          title: 'LinkedIn Feed',
          url: 'https://www.linkedin.com/feed/',
          visibleText: 'Feed home',
          capturedAt: '2026-08-05T20:00:00.000Z',
          isLinkedIn: true,
          isJobsSection: false,
          isJobView: false,
          isFeedSection: true,
          isPostSearchSection: false,
          isPostDetail: false,
          hiringSignals: [],
          visibleEmails: [],
          requiresAttention: false,
          attentionReasons: [],
        },
      })),
      getSnapshot: vi.fn(),
      navigate: vi.fn(),
      close: vi.fn(),
    };
    const service = createBrowserSessionService(repository, auditService, {}, { runtime });

    const session = await service.startSession({ provider: 'LINKEDIN_FEED' });

    expect(runtime.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        startUrl: 'https://www.linkedin.com/feed/',
      }),
    );
    expect(session.provider).toBe('LINKEDIN_FEED');
    expect(session.metadata.isFeedSection).toBe(true);
  });

  it('captures the visible LinkedIn Jobs offer into the manual intake pipeline', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => ({
        handle: { id: 'runtime-handle-2' },
        snapshot: {
          title: 'LinkedIn Jobs',
          url: 'https://www.linkedin.com/jobs/view/12345',
          visibleText: 'Placeholder visible text long enough to satisfy capture length requirements on LinkedIn Jobs.',
          capturedAt: '2026-08-05T20:00:00.000Z',
          isLinkedIn: true,
          isJobsSection: true,
          isJobView: true,
          isFeedSection: false,
          isPostSearchSection: false,
          isPostDetail: false,
          hiringSignals: [],
          visibleEmails: [],
          requiresAttention: false,
          attentionReasons: [],
        },
      })),
      getSnapshot: vi.fn(async () => ({
        title: 'Backend Developer | LinkedIn',
        url: 'https://www.linkedin.com/jobs/view/12345',
        visibleText:
          'Backend Developer Acme Labs Remote LATAM Node.js Express MySQL Jest English B2 This description is intentionally long enough to satisfy the supervised capture threshold and mimic a visible LinkedIn Jobs detail page.',
        capturedAt: '2026-08-05T20:05:00.000Z',
        isLinkedIn: true,
        isJobsSection: true,
        isJobView: true,
        isFeedSection: false,
        isPostSearchSection: false,
        isPostDetail: false,
        hiringSignals: [],
        visibleEmails: [],
        requiresAttention: false,
        attentionReasons: [],
      })),
      navigate: vi.fn(),
      close: vi.fn(),
    };
    const jobOfferService = {
      createFromManualInput: vi.fn(async () => ({
        id: 'job-captured-1',
      })),
    };
    const service = createBrowserSessionService(repository, auditService, jobOfferService, { runtime });

    const session = await service.startSession({ provider: 'LINKEDIN_JOBS' });
    const result = await service.captureCurrentJob(session.id);

    expect(result.job.id).toBe('job-captured-1');
    expect(result.session.metadata.lastCapturedJobId).toBe('job-captured-1');
    expect(jobOfferService.createFromManualInput).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLabel: 'LinkedIn Jobs supervised session',
        sourceUrl: 'https://www.linkedin.com/jobs/view/12345',
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      'browser_session.job_captured',
      'browser_session',
      session.id,
      expect.objectContaining({
        jobId: 'job-captured-1',
      }),
    );
  });

  it('captures a hiring publication from the supervised LinkedIn feed', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => ({
        handle: { id: 'runtime-handle-feed-2' },
        snapshot: {
          title: 'LinkedIn Feed',
          url: 'https://www.linkedin.com/feed/',
          visibleText: 'Placeholder feed text long enough to initialize the supervised session.',
          capturedAt: '2026-08-05T20:00:00.000Z',
          isLinkedIn: true,
          isJobsSection: false,
          isJobView: false,
          isFeedSection: true,
          isPostSearchSection: false,
          isPostDetail: false,
          hiringSignals: ['hiring'],
          visibleEmails: ['jobs@acme.dev'],
          requiresAttention: false,
          attentionReasons: [],
        },
      })),
      getSnapshot: vi.fn(async () => ({
        title: 'We are hiring backend engineers',
        url: 'https://www.linkedin.com/feed/update/urn:li:activity:123',
        visibleText:
          'We are hiring backend engineers for a remote LATAM role. Send your resume to jobs@acme.dev. Node.js, Express, MySQL and English B2 required for this opportunity.',
        capturedAt: '2026-08-05T20:10:00.000Z',
        isLinkedIn: true,
        isJobsSection: false,
        isJobView: false,
        isFeedSection: false,
        isPostSearchSection: false,
        isPostDetail: true,
        hiringSignals: ['hiring', 'send_your_resume'],
        visibleEmails: ['jobs@acme.dev'],
        requiresAttention: false,
        attentionReasons: [],
      })),
      navigate: vi.fn(),
      close: vi.fn(),
    };
    const jobOfferService = {
      createFromManualInput: vi.fn(async () => ({
        id: 'job-feed-1',
      })),
    };
    const service = createBrowserSessionService(repository, auditService, jobOfferService, { runtime });

    const session = await service.startSession({ provider: 'LINKEDIN_FEED' });
    const result = await service.captureCurrentJob(session.id);

    expect(result.job.id).toBe('job-feed-1');
    expect(result.session.metadata.lastCapturedJobId).toBe('job-feed-1');
    expect(jobOfferService.createFromManualInput).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLabel: 'LinkedIn Feed supervised session',
        sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:123',
        rawText: expect.stringContaining('Visible contact emails: jobs@acme.dev'),
      }),
    );
  });

  it('rejects a feed capture when no visible hiring signals are present', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => ({
        handle: { id: 'runtime-handle-feed-3' },
        snapshot: {
          title: 'LinkedIn Feed',
          url: 'https://www.linkedin.com/feed/',
          visibleText: 'Placeholder feed text long enough to initialize the supervised session.',
          capturedAt: '2026-08-05T20:00:00.000Z',
          isLinkedIn: true,
          isJobsSection: false,
          isJobView: false,
          isFeedSection: true,
          isPostSearchSection: false,
          isPostDetail: false,
          hiringSignals: [],
          visibleEmails: [],
          requiresAttention: false,
          attentionReasons: [],
        },
      })),
      getSnapshot: vi.fn(async () => ({
        title: 'Thoughts about backend architecture',
        url: 'https://www.linkedin.com/feed/update/urn:li:activity:999',
        visibleText:
          'Sharing some backend architecture notes and clean architecture reflections for developers working on distributed systems today, including service boundaries, observability tradeoffs, repository contracts, deployment workflows and API versioning decisions across multiple teams.',
        capturedAt: '2026-08-05T20:10:00.000Z',
        isLinkedIn: true,
        isJobsSection: false,
        isJobView: false,
        isFeedSection: false,
        isPostSearchSection: false,
        isPostDetail: true,
        hiringSignals: [],
        visibleEmails: [],
        requiresAttention: false,
        attentionReasons: [],
      })),
      navigate: vi.fn(),
      close: vi.fn(),
    };
    const jobOfferService = {
      createFromManualInput: vi.fn(),
    };
    const service = createBrowserSessionService(repository, auditService, jobOfferService, { runtime });

    const session = await service.startSession({ provider: 'LINKEDIN_FEED' });

    await expect(service.captureCurrentJob(session.id)).rejects.toMatchObject({
      statusCode: 409,
      message: 'The visible LinkedIn publication does not expose enough hiring signals to capture safely',
    });
    expect(jobOfferService.createFromManualInput).not.toHaveBeenCalled();
  });

  it('clasifica el error cuando Chromium no esta instalado', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => {
        throw new Error("browserType.launch: Executable doesn't exist at /ms-playwright/chromium");
      }),
    };
    const service = createBrowserSessionService(repository, auditService, {}, { runtime });

    await expect(service.startSession({ provider: 'LINKEDIN_JOBS' })).rejects.toMatchObject({
      statusCode: 503,
      message: 'No se pudo iniciar la sesion supervisada porque Chromium no esta instalado en este entorno.',
      details: expect.objectContaining({
        errorCode: 'PLAYWRIGHT_BROWSER_MISSING',
      }),
    });
  });

  it('clasifica el error cuando falta XServer o display grafico', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => {
        throw new Error(
          "browserType.launch: Looks like you launched a headed browser without having a XServer running.",
        );
      }),
    };
    const service = createBrowserSessionService(repository, auditService, {}, { runtime });

    await expect(service.startSession({ provider: 'LINKEDIN_JOBS' })).rejects.toMatchObject({
      statusCode: 503,
      message:
        'No se pudo iniciar la sesion supervisada en modo visible porque este entorno no tiene display grafico.',
      details: expect.objectContaining({
        errorCode: 'PLAYWRIGHT_DISPLAY_REQUIRED',
      }),
    });
  });

  it('clasifica el error generico de launch', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => {
        throw new Error('browserType.launch: Target page, context or browser has been closed');
      }),
    };
    const service = createBrowserSessionService(repository, auditService, {}, { runtime });

    await expect(service.startSession({ provider: 'LINKEDIN_JOBS' })).rejects.toMatchObject({
      statusCode: 503,
      message: 'No se pudo iniciar la sesion supervisada del navegador.',
      details: expect.objectContaining({
        errorCode: 'PLAYWRIGHT_LAUNCH_FAILED',
      }),
    });
  });

  it('clasifica el error cuando Browserless no esta configurado correctamente', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => {
        const error = new Error('BROWSERLESS_WS_URL no esta configurado para el runtime remoto.');
        error.code = 'BROWSERLESS_CONFIG_ERROR';
        error.suggestion = 'Completa BROWSERLESS_WS_URL o vuelve a BROWSER_RUNTIME=local.';
        throw error;
      }),
    };
    const service = createBrowserSessionService(repository, auditService, {}, { runtime });

    await expect(service.startSession({ provider: 'LINKEDIN_JOBS' })).rejects.toMatchObject({
      statusCode: 503,
      message:
        'No se pudo iniciar la sesion supervisada remota porque Browserless no esta configurado correctamente.',
      details: expect.objectContaining({
        errorCode: 'BROWSERLESS_CONFIG_ERROR',
      }),
    });
  });
});
