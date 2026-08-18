import { describe, expect, it, vi } from 'vitest';
import { createBrowserSessionService } from '../../src/services/browser/browserSessionService.js';

const DETAIL_TEXT =
  'We are hiring a Backend Engineer with Node.js, SQL, APIs, observability, testing and collaboration across distributed teams.';

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
        extractedJob: {
          title: 'Backend Developer',
          company: 'Acme Labs',
          location: 'Remote',
          modality: ['remote'],
          employmentType: 'full-time',
          seniority: 'junior',
          technologies: ['Node.js', 'Express', 'MySQL', 'Jest'],
          frameworks: ['Express'],
          databases: ['MySQL'],
          tools: ['Jest'],
          languages: ['English'],
          responsibilities: ['Build backend services and APIs.'],
          requirements: ['Node.js, Express, MySQL and Jest.'],
          benefits: [],
          recruiter: 'Jane Recruiter',
          postedAt: '2026-08-01',
          applyMode: 'EASY_APPLY',
          applicantsCount: '34 applicants',
          salary: null,
          description:
            'We are hiring a Backend Developer with Node.js, Express, MySQL and Jest. English B2 is required.',
          quality: {
            title: 'HIGH',
            company: 'HIGH',
            location: 'HIGH',
            modality: 'MEDIUM',
            description: 'HIGH',
            technologies: 'HIGH',
          },
          debugSources: {
            title: 'selector:h1',
            company: 'selector:company',
            location: 'selector:metadata',
            description: 'selector:description',
            technologies: 'description+metadata',
          },
        },
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
    expect(result.session.metadata.extractionQuality).toEqual(
      expect.objectContaining({
        title: 'HIGH',
        technologies: 'HIGH',
      }),
    );
    expect(jobOfferService.createFromManualInput).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLabel: 'LinkedIn Jobs supervised session',
        sourceUrl: 'https://www.linkedin.com/jobs/view/12345',
        rawText: expect.stringContaining('Title: Backend Developer'),
        structuredJob: expect.objectContaining({
          title: 'Backend Developer',
          company: 'Acme Labs',
        }),
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

  it('rechaza la captura cuando no hay una vacante abierta en LinkedIn Jobs', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => ({
        handle: { id: 'runtime-handle-invalid-job-1' },
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
      captureSnapshot: vi.fn(async () => {
        const error = new Error('No se detectó una oferta de empleo abierta. Abra una vacante antes de iniciar la captura.');
        error.code = 'LINKEDIN_JOB_NOT_OPEN';
        error.details = {
          currentUrl: 'https://www.linkedin.com/jobs/',
        };
        throw error;
      }),
      getSnapshot: vi.fn(),
      navigate: vi.fn(),
      close: vi.fn(),
    };
    const jobOfferService = {
      createFromManualInput: vi.fn(),
    };
    const service = createBrowserSessionService(repository, auditService, jobOfferService, { runtime });

    const session = await service.startSession({ provider: 'LINKEDIN_JOBS' });

    await expect(service.captureCurrentJob(session.id)).rejects.toMatchObject({
      statusCode: 409,
      message: 'No se detectó una oferta de empleo abierta. Abra una vacante antes de iniciar la captura.',
      details: expect.objectContaining({
        currentUrl: 'https://www.linkedin.com/jobs/',
      }),
    });
    expect(jobOfferService.createFromManualInput).not.toHaveBeenCalled();
  });

  it('rechaza la captura cuando la descripcion de la vacante aun no termino de cargar', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => ({
        handle: { id: 'runtime-handle-invalid-job-2' },
        snapshot: {
          title: 'LinkedIn Jobs',
          url: 'https://www.linkedin.com/jobs/view/12345',
          visibleText: 'LinkedIn Jobs detail',
          capturedAt: '2026-08-05T20:00:00.000Z',
          isLinkedIn: true,
          isJobsSection: true,
          isJobView: true,
          requiresAttention: false,
          attentionReasons: [],
        },
      })),
      captureSnapshot: vi.fn(async () => {
        const error = new Error('La oferta aún no terminó de cargar o no contiene una descripción visible.');
        error.code = 'LINKEDIN_JOB_DESCRIPTION_NOT_READY';
        error.details = {
          currentUrl: 'https://www.linkedin.com/jobs/view/12345',
          length: 0,
        };
        throw error;
      }),
      getSnapshot: vi.fn(),
      navigate: vi.fn(),
      close: vi.fn(),
    };
    const jobOfferService = {
      createFromManualInput: vi.fn(),
    };
    const service = createBrowserSessionService(repository, auditService, jobOfferService, { runtime });

    const session = await service.startSession({ provider: 'LINKEDIN_JOBS' });

    await expect(service.captureCurrentJob(session.id)).rejects.toMatchObject({
      statusCode: 409,
      message: 'La oferta aún no terminó de cargar o no contiene una descripción visible.',
      details: expect.objectContaining({
        currentUrl: 'https://www.linkedin.com/jobs/view/12345',
        length: 0,
      }),
    });
    expect(jobOfferService.createFromManualInput).not.toHaveBeenCalled();
  });

  it('rechaza una captura cuando el titulo estructurado parece una card del listado', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => ({
        handle: { id: 'runtime-handle-invalid-job-3' },
        snapshot: {
          title: 'LinkedIn Jobs',
          url: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421',
          visibleText: 'LinkedIn Jobs detail',
          capturedAt: '2026-08-05T20:00:00.000Z',
          isLinkedIn: true,
          isJobsSection: true,
          isJobView: false,
          isFeedSection: false,
          isPostSearchSection: false,
          isPostDetail: false,
          requiresAttention: false,
          attentionReasons: [],
        },
      })),
      captureSnapshot: vi.fn(async () => ({
        title: 'Backend Engineer (Node.js, SQL) | LinkedIn',
        url: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421',
        visibleText: 'Backend Engineer (Node.js, SQL) Sundayy Estados Unidos En remoto',
        capturedAt: '2026-08-05T20:05:00.000Z',
        isLinkedIn: true,
        isJobsSection: true,
        isJobView: false,
        isFeedSection: false,
        isPostSearchSection: false,
        isPostDetail: false,
        hiringSignals: [],
        visibleEmails: [],
        requiresAttention: false,
        attentionReasons: [],
        extractedJob: {
          title:
            'Seleccionado, Backend Engineer (Node.js, SQL) Backend Engineer (Node.js, SQL) Sundayy Estados Unidos En remoto Visto Publicado hace 12 horas',
          company: 'Sundayy',
          description: DETAIL_TEXT,
          quality: {
            title: 'LOW',
            company: 'LOW',
            description: 'LOW',
          },
          debugSources: {
            title: 'selector:title',
            descriptionSelection: {
              strategy: 'attribute_current_job',
            },
          },
        },
      })),
      getSnapshot: vi.fn(),
      navigate: vi.fn(),
      close: vi.fn(),
    };
    const jobOfferService = {
      createFromManualInput: vi.fn(),
    };
    const service = createBrowserSessionService(repository, auditService, jobOfferService, { runtime });

    const session = await service.startSession({ provider: 'LINKEDIN_JOBS' });

    await expect(service.captureCurrentJob(session.id)).rejects.toMatchObject({
      statusCode: 409,
      message:
        'No se pudo identificar con suficiente confianza el detalle de la vacante seleccionada. Verifica que el panel de la oferta esté abierto e inténtalo nuevamente.',
      details: expect.objectContaining({
        code: 'LINKEDIN_CAPTURE_INVALID_TITLE',
      }),
    });
    expect(jobOfferService.createFromManualInput).not.toHaveBeenCalled();
  });

  it('rechaza una captura cuando la descripcion estructurada todavia parece una card del listado', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => ({
        handle: { id: 'runtime-handle-invalid-job-4' },
        snapshot: {
          title: 'LinkedIn Jobs',
          url: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421',
          visibleText: 'LinkedIn Jobs detail',
          capturedAt: '2026-08-05T20:00:00.000Z',
          isLinkedIn: true,
          isJobsSection: true,
          isJobView: false,
          isFeedSection: false,
          isPostSearchSection: false,
          isPostDetail: false,
          requiresAttention: false,
          attentionReasons: [],
        },
      })),
      captureSnapshot: vi.fn(async () => ({
        title: 'Backend Engineer (Node.js, SQL) | LinkedIn',
        url: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421',
        visibleText: 'Backend Engineer (Node.js, SQL) Sundayy Estados Unidos En remoto',
        capturedAt: '2026-08-05T20:05:00.000Z',
        isLinkedIn: true,
        isJobsSection: true,
        isJobView: false,
        isFeedSection: false,
        isPostSearchSection: false,
        isPostDetail: false,
        hiringSignals: [],
        visibleEmails: [],
        requiresAttention: false,
        attentionReasons: [],
        extractedJob: {
          title: 'Backend Engineer (Node.js, SQL)',
          company: 'Sundayy',
          description:
            'Seleccionado, Backend Engineer (Node.js, SQL) Sundayy Estados Unidos En remoto Visto Adelantate a solicitar el empleo Publicado hace 12 horas',
          quality: {
            title: 'HIGH',
            company: 'MEDIUM',
            description: 'LOW',
          },
          debugSources: {
            title: 'selector:h1',
            descriptionSelection: {
              strategy: 'attribute_current_job',
            },
          },
        },
      })),
      getSnapshot: vi.fn(),
      navigate: vi.fn(),
      close: vi.fn(),
    };
    const jobOfferService = {
      createFromManualInput: vi.fn(),
    };
    const service = createBrowserSessionService(repository, auditService, jobOfferService, { runtime });

    const session = await service.startSession({ provider: 'LINKEDIN_JOBS' });

    await expect(service.captureCurrentJob(session.id)).rejects.toMatchObject({
      statusCode: 409,
      details: expect.objectContaining({
        code: 'LINKEDIN_CAPTURE_INVALID_DESCRIPTION',
      }),
    });
    expect(jobOfferService.createFromManualInput).not.toHaveBeenCalled();
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

  it('devuelve la URL temporal del navegador remoto para una sesion Browserless activa', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => ({
        handle: { id: 'runtime-handle-remote-1' },
        snapshot: {
          title: 'LinkedIn Jobs',
          url: 'https://www.linkedin.com/jobs/',
          visibleText: 'LinkedIn Jobs Home',
          capturedAt: '2026-08-05T20:00:00.000Z',
          runtimeKind: 'browserless',
          browserlessConnectionMode: 'playwright-native',
          isLinkedIn: true,
          isJobsSection: true,
          isJobView: false,
          requiresAttention: true,
          attentionReasons: ['LOGIN_REQUIRED'],
        },
      })),
      getRemoteControlUrl: vi.fn(async () => 'https://browserless.example.com/devtools/inspector.html?token=temp'),
      getSnapshot: vi.fn(),
      navigate: vi.fn(),
      close: vi.fn(),
    };
    const service = createBrowserSessionService(repository, auditService, {}, { runtime });
    const session = await service.startSession({ provider: 'LINKEDIN_JOBS' });

    const remoteControlUrl = await service.getRemoteControlUrl(session.id);

    expect(remoteControlUrl).toBe('https://browserless.example.com/devtools/inspector.html?token=temp');
    expect(runtime.getRemoteControlUrl).toHaveBeenCalledWith(expect.objectContaining({ id: 'runtime-handle-remote-1' }));
  });

  it('rechaza abrir control remoto si la sesion activa no usa Browserless', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => ({
        handle: { id: 'runtime-handle-local-1' },
        snapshot: {
          title: 'LinkedIn Jobs',
          url: 'https://www.linkedin.com/jobs/',
          visibleText: 'LinkedIn Jobs Home',
          capturedAt: '2026-08-05T20:00:00.000Z',
          runtimeKind: 'local',
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

    await expect(service.getRemoteControlUrl(session.id)).rejects.toMatchObject({
      statusCode: 409,
      message: 'La sesion supervisada activa no usa Browserless remoto.',
    });
  });

  it('mantiene el handle remoto activo hasta que el usuario cierre explicitamente la sesion', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => ({
        handle: { id: 'runtime-handle-browserless-close-1' },
        snapshot: {
          title: 'LinkedIn Jobs',
          url: 'https://www.linkedin.com/jobs/',
          visibleText: 'LinkedIn Jobs Home',
          capturedAt: '2026-08-05T20:00:00.000Z',
          runtimeKind: 'browserless',
          browserlessConnectionMode: 'playwright-native',
          isLinkedIn: true,
          isJobsSection: true,
          isJobView: false,
          requiresAttention: true,
          attentionReasons: ['LOGIN_REQUIRED'],
        },
      })),
      getRemoteControlUrl: vi.fn(async () => 'https://browserless.example.com/devtools/inspector.html?token=temp'),
      getSnapshot: vi.fn(),
      navigate: vi.fn(),
      close: vi.fn(async () => ({})),
    };
    const service = createBrowserSessionService(repository, auditService, {}, { runtime });
    const session = await service.startSession({ provider: 'LINKEDIN_JOBS' });

    await service.getRemoteControlUrl(session.id);
    expect(runtime.close).not.toHaveBeenCalled();

    await service.closeSession(session.id);
    expect(runtime.close).toHaveBeenCalledWith(expect.objectContaining({ id: 'runtime-handle-browserless-close-1' }));
  });

  it('no reintenta refresh en desktop agent cuando el primer GET_SNAPSHOT falla y devuelve 503 claro', async () => {
    const repository = createRepositoryMock();
    const auditService = { record: vi.fn(async () => ({})) };
    const runtime = {
      startSession: vi.fn(async () => ({
        handle: { sessionId: 'runtime-handle-desktop-1' },
        snapshot: {
          title: 'LinkedIn Jobs',
          url: 'https://www.linkedin.com/jobs/',
          visibleText: 'LinkedIn Jobs Home',
          capturedAt: '2026-08-05T20:00:00.000Z',
          runtimeKind: 'desktop_agent',
          isLinkedIn: true,
          isJobsSection: true,
          isJobView: false,
          requiresAttention: true,
          attentionReasons: ['LOGIN_REQUIRED'],
        },
      })),
      getSnapshot: vi.fn(async () => {
        const error = new Error(
          'Ningun Desktop Agent activo reclamo la sesion supervisada a tiempo. Verifica que el agente este conectado a este backend.',
        );
        error.code = 'DESKTOP_AGENT_JOB_NOT_CLAIMED';
        error.details = { jobId: 'job-timeout-1' };
        throw error;
      }),
      navigate: vi.fn(),
      close: vi.fn(),
    };
    const service = createBrowserSessionService(
      repository,
      auditService,
      {},
      {
        runtime,
        config: {
          BROWSER_RUNTIME: 'desktop_agent',
          DESKTOP_AGENT_POLL_INTERVAL_MS: 0,
        },
      },
    );
    const session = await service.startSession({ provider: 'LINKEDIN_JOBS' });

    await expect(service.refreshSession(session.id)).rejects.toMatchObject({
      statusCode: 503,
      message: 'No hay un Desktop Agent disponible para verificar la sesion supervisada.',
      details: expect.objectContaining({
        code: 'DESKTOP_AGENT_JOB_NOT_CLAIMED',
      }),
    });
    expect(runtime.getSnapshot).toHaveBeenCalledTimes(1);
  });
});
