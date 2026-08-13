import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { BROWSER_SESSION_PROVIDER, BROWSER_SESSION_STATUS } from '../../constants/browserSessions.js';
import { HttpError } from '../../lib/httpError.js';
import { retryOperation } from '../../lib/retry.js';
import { createDesktopAgentBrowserRuntime } from './desktopAgentBrowserRuntime.js';
import { createPlaywrightBrowserRuntime } from './playwrightBrowserRuntime.js';
import { buildStructuredCaptureText } from './linkedinSnapshotExtractor.js';

const LINKEDIN_JOBS_START_URL = 'https://www.linkedin.com/jobs/';
const LINKEDIN_FEED_START_URL = 'https://www.linkedin.com/feed/';
const LINKEDIN_POST_SEARCH_START_URL = 'https://www.linkedin.com/search/results/content/';
const PROVIDER_CONFIG = {
  [BROWSER_SESSION_PROVIDER.LINKEDIN_JOBS]: {
    defaultStartUrl: LINKEDIN_JOBS_START_URL,
    sourceLabel: 'LinkedIn Jobs supervised session',
    captureAction: 'JOB_CAPTURED',
    minimumVisibleTextLength: 120,
    requiresHiringSignals: false,
    matchesSurface(snapshot) {
      return Boolean(snapshot.isJobsSection || snapshot.isJobView);
    },
    invalidSurfaceMessage: 'Open LinkedIn Jobs before capturing a visible offer',
  },
  [BROWSER_SESSION_PROVIDER.LINKEDIN_FEED]: {
    defaultStartUrl: LINKEDIN_FEED_START_URL,
    sourceLabel: 'LinkedIn Feed supervised session',
    captureAction: 'POST_CAPTURED',
    minimumVisibleTextLength: 160,
    requiresHiringSignals: true,
    matchesSurface(snapshot) {
      return Boolean(snapshot.isFeedSection || snapshot.isPostDetail);
    },
    invalidSurfaceMessage: 'Open the LinkedIn feed or a visible post before capturing a publication',
  },
  [BROWSER_SESSION_PROVIDER.LINKEDIN_POST_SEARCH]: {
    defaultStartUrl: LINKEDIN_POST_SEARCH_START_URL,
    sourceLabel: 'LinkedIn post search supervised session',
    captureAction: 'POST_CAPTURED',
    minimumVisibleTextLength: 160,
    requiresHiringSignals: true,
    matchesSurface(snapshot) {
      return Boolean(snapshot.isPostSearchSection || snapshot.isPostDetail);
    },
    invalidSurfaceMessage:
      'Open LinkedIn content search results or a visible post before capturing a publication',
  },
};

export function createBrowserSessionService(repository, auditService, jobOfferService, options = {}) {
  const config = options.config ?? env;
  const runtimeRetryOptions =
    options.runtimeRetryOptions ??
    (config.BROWSER_RUNTIME === 'desktop_agent'
      ? { attempts: 1, baseDelayMs: 0 }
      : { attempts: 2, baseDelayMs: 100 });
  const runtime =
    options.runtime ??
    (config.BROWSER_RUNTIME === 'desktop_agent'
      ? createDesktopAgentBrowserRuntime(repository, {
          pollIntervalMs: config.DESKTOP_AGENT_POLL_INTERVAL_MS,
        })
      : createPlaywrightBrowserRuntime(options.runtimeOptions));
  const activeSessions = options.activeSessions ?? new Map();
  const breaker = options.breaker ?? null;

  return {
    async listSessions() {
      const sessions = await repository.listBrowserSessions();
      return sessions.map((session) => hydrateSessionRuntimeState(session, activeSessions));
    },

    async getSession(sessionId) {
      const session = await repository.getBrowserSessionById(sessionId);
      if (!session) {
        throw new HttpError(404, 'Browser session not found');
      }

      return hydrateSessionRuntimeState(session, activeSessions);
    },

    async getRemoteControlUrl(sessionId) {
      const { record, handle } = await getManagedSession(repository, activeSessions, sessionId);

      if (record.metadata?.runtimeKind !== 'browserless') {
        throw new HttpError(409, 'La sesion supervisada activa no usa Browserless remoto.', {
          sessionId,
          runtimeKind: record.metadata?.runtimeKind ?? 'local',
        });
      }

      if (typeof runtime.getRemoteControlUrl !== 'function') {
        throw new HttpError(503, 'El runtime actual no soporta apertura remota supervisada.', {
          sessionId,
        });
      }

      try {
        return await executeRuntimeCall(
          breaker,
          () => retryOperation(() => runtime.getRemoteControlUrl(handle), { attempts: 2, baseDelayMs: 100 }),
        );
      } catch (error) {
        const remoteControlError = describeBrowserRemoteControlError(error);
        throw new HttpError(503, remoteControlError.message, {
          errorCode: remoteControlError.errorCode,
          reason: remoteControlError.reason,
          suggestion: remoteControlError.suggestion,
        });
      }
    },

    async startSession(input) {
      const providerConfig = PROVIDER_CONFIG[input.provider];
      if (!providerConfig) {
        throw new HttpError(400, 'Unsupported browser session provider');
      }

      const sessionId = randomUUID();
      const startedAt = new Date().toISOString();
      const startUrl = normalizeLinkedInUrl(input.startUrl || providerConfig.defaultStartUrl);

      let runtimeResult;
      try {
        runtimeResult = await executeRuntimeCall(
          breaker,
          () =>
            retryOperation(
              () =>
        runtime.startSession({
                  sessionId,
                  provider: input.provider,
                  startUrl,
                }),
              runtimeRetryOptions,
            ),
        );
      } catch (error) {
        const launchError = describeBrowserLaunchError(error);
        throw new HttpError(503, launchError.message, {
          errorCode: launchError.errorCode,
          reason: launchError.reason,
          suggestion: launchError.suggestion,
        });
      }

      activeSessions.set(sessionId, runtimeResult.handle);

      const record = {
        id: sessionId,
        provider: input.provider,
        status: deriveBrowserSessionStatus(runtimeResult.snapshot),
        startedAt,
        endedAt: null,
        createdAt: startedAt,
        updatedAt: startedAt,
        metadata: buildSessionMetadata(runtimeResult.snapshot, {
          mode: 'SUPERVISED_VISIBLE',
          navigationCount: 1,
          lastAction: 'SESSION_STARTED',
          runtimeAvailable: true,
          reusedStoredSession: Boolean(runtimeResult.reusedStoredSession),
          providerMode: input.provider,
          lastCapturedJobId: null,
          lastCapturedAt: null,
        }),
      };

      await repository.saveBrowserSession(record);
      await auditService.record('browser_session.started', 'browser_session', sessionId, {
        provider: record.provider,
        startUrl,
        status: record.status,
      });

      return record;
    },

    async refreshSession(sessionId) {
      const startedAt = Date.now();
      const { record, handle } = await getManagedSession(repository, activeSessions, sessionId);
      logBrowserSessionEvent('refresh.start', {
        sessionId,
        runtimeKind: record.metadata?.runtimeKind ?? 'local',
        status: record.status,
      });

      let snapshot;
      try {
        snapshot = await executeRuntimeCall(
          breaker,
          () => retryOperation(() => runtime.getSnapshot(handle), runtimeRetryOptions),
        );
      } catch (error) {
        logBrowserSessionEvent('refresh.failed', {
          sessionId,
          runtimeKind: record.metadata?.runtimeKind ?? 'local',
          status: record.status,
          durationMs: Date.now() - startedAt,
          errorCode: error?.code ?? 'UNKNOWN',
          errorMessage: error?.message ?? 'Error desconocido',
        });

        if (config.BROWSER_RUNTIME === 'desktop_agent') {
          const refreshError = describeDesktopAgentRefreshError(error);
          throw new HttpError(503, refreshError.message, {
            code: refreshError.errorCode,
            cause: refreshError.reason,
            action: refreshError.suggestion,
            sessionId,
            runtimeKind: record.metadata?.runtimeKind ?? 'desktop_agent',
            jobId: error?.details?.jobId ?? null,
          });
        }

        throw error;
      }
      const updated = updateSessionFromSnapshot(record, snapshot, {
        navigationCount: record.metadata?.navigationCount ?? 0,
        lastAction: 'REFRESHED',
      });

      await repository.updateBrowserSession(updated);
      await auditService.record('browser_session.refreshed', 'browser_session', sessionId, {
        status: updated.status,
        currentUrl: updated.metadata.currentUrl,
      });

      logBrowserSessionEvent('refresh.completed', {
        sessionId,
        runtimeKind: updated.metadata?.runtimeKind ?? 'local',
        status: updated.status,
        durationMs: Date.now() - startedAt,
      });

      return updated;
    },

    async navigateSession(sessionId, input) {
      const { record, handle } = await getManagedSession(repository, activeSessions, sessionId);
      const targetUrl = normalizeLinkedInUrl(input.url);
      const snapshot = await executeRuntimeCall(
        breaker,
        () => retryOperation(() => runtime.navigate(handle, targetUrl), runtimeRetryOptions),
      );
      const updated = updateSessionFromSnapshot(record, snapshot, {
        navigationCount: (record.metadata?.navigationCount ?? 0) + 1,
        lastAction: 'NAVIGATED',
      });

      await repository.updateBrowserSession(updated);
      await auditService.record('browser_session.navigated', 'browser_session', sessionId, {
        targetUrl,
        status: updated.status,
      });

      return updated;
    },

    async captureCurrentJob(sessionId) {
      const { record, handle } = await getManagedSession(repository, activeSessions, sessionId);
      const snapshot = await executeRuntimeCall(
        breaker,
        () => retryOperation(() => runtime.getSnapshot(handle), runtimeRetryOptions),
      );
      const providerConfig = PROVIDER_CONFIG[record.provider];

      if (snapshot.requiresAttention) {
        throw new HttpError(409, 'Browser session requires human attention before capturing the job', {
          attentionReasons: snapshot.attentionReasons,
          currentUrl: snapshot.url,
        });
      }

      if (!providerConfig?.matchesSurface(snapshot)) {
        throw new HttpError(409, providerConfig?.invalidSurfaceMessage ?? 'Open a supported LinkedIn page before capturing', {
          currentUrl: snapshot.url,
        });
      }

      if (snapshot.visibleText.length < (providerConfig?.minimumVisibleTextLength ?? 120)) {
        throw new HttpError(409, 'The visible job content is too short to capture safely', {
          currentUrl: snapshot.url,
          length: snapshot.visibleText.length,
        });
      }

      if (
        providerConfig?.requiresHiringSignals &&
        snapshot.hiringSignals.length === 0 &&
        snapshot.visibleEmails.length === 0
      ) {
        throw new HttpError(409, 'The visible LinkedIn publication does not expose enough hiring signals to capture safely', {
          currentUrl: snapshot.url,
          provider: record.provider,
        });
      }

      const job = await jobOfferService.createFromManualInput({
        rawText: buildCaptureText(snapshot, providerConfig),
        sourceUrl: snapshot.url,
        sourceLabel: providerConfig?.sourceLabel ?? 'LinkedIn supervised session',
        sourceType: mapProviderToSourceType(record.provider),
      });

      const updated = updateSessionFromSnapshot(record, snapshot, {
        navigationCount: record.metadata?.navigationCount ?? 0,
        lastAction: providerConfig?.captureAction ?? 'JOB_CAPTURED',
        lastCapturedJobId: job.id,
        lastCapturedAt: new Date().toISOString(),
      });

      await repository.updateBrowserSession(updated);
      await auditService.record('browser_session.job_captured', 'browser_session', sessionId, {
        jobId: job.id,
        currentUrl: snapshot.url,
        status: updated.status,
      });

      return {
        session: updated,
        job,
      };
    },

    async closeSession(sessionId) {
      const record = await repository.getBrowserSessionById(sessionId);
      if (!record) {
        throw new HttpError(404, 'Browser session not found');
      }

      const handle = activeSessions.get(sessionId);
      if (handle) {
        await executeRuntimeCall(
          breaker,
          () => retryOperation(() => runtime.close(handle), runtimeRetryOptions),
        );
        activeSessions.delete(sessionId);
      }

      if (record.status === BROWSER_SESSION_STATUS.CLOSED) {
        return record;
      }

      const updated = {
        ...structuredClone(record),
        status: BROWSER_SESSION_STATUS.CLOSED,
        endedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {
          ...structuredClone(record.metadata ?? {}),
          runtimeAvailable: false,
          lastAction: 'SESSION_CLOSED',
        },
      };

      await repository.updateBrowserSession(updated);
      await auditService.record('browser_session.closed', 'browser_session', sessionId, {
        provider: updated.provider,
      });

      return updated;
    },
  };
}

async function getManagedSession(repository, activeSessions, sessionId) {
  const record = await repository.getBrowserSessionById(sessionId);
  if (!record) {
    throw new HttpError(404, 'Browser session not found');
  }

  const handle = activeSessions.get(sessionId);
  if (!handle) {
    throw new HttpError(409, 'Browser session is not active in the current backend process', {
      sessionId,
      status: record.status,
    });
  }

  return { record, handle };
}

function hydrateSessionRuntimeState(session, activeSessions) {
  return {
    ...session,
    metadata: {
      ...structuredClone(session.metadata ?? {}),
      runtimeAvailable: activeSessions.has(session.id),
    },
  };
}

function updateSessionFromSnapshot(record, snapshot, overrides = {}) {
  return {
    ...structuredClone(record),
    status: deriveBrowserSessionStatus(snapshot),
    updatedAt: new Date().toISOString(),
    metadata: buildSessionMetadata(snapshot, {
      ...structuredClone(record.metadata ?? {}),
      ...overrides,
      runtimeAvailable: true,
    }),
  };
}

function buildSessionMetadata(snapshot, baseMetadata = {}) {
  const extractedJob = snapshot.extractedJob
    ? {
        title: snapshot.extractedJob.title,
        company: snapshot.extractedJob.company,
        location: snapshot.extractedJob.location,
        modality: snapshot.extractedJob.modality,
        employmentType: snapshot.extractedJob.employmentType,
        seniority: snapshot.extractedJob.seniority,
        technologies: snapshot.extractedJob.technologies,
        frameworks: snapshot.extractedJob.frameworks,
        databases: snapshot.extractedJob.databases,
        tools: snapshot.extractedJob.tools,
        languages: snapshot.extractedJob.languages,
        applyMode: snapshot.extractedJob.applyMode,
        recruiter: snapshot.extractedJob.recruiter,
        postedAt: snapshot.extractedJob.postedAt,
        applicantsCount: snapshot.extractedJob.applicantsCount,
        salary: snapshot.extractedJob.salary,
      }
    : null;

  return {
    ...baseMetadata,
    currentUrl: snapshot.url,
    pageTitle: snapshot.title,
    runtimeKind: snapshot.runtimeKind ?? baseMetadata.runtimeKind ?? 'local',
    browserlessConnectionMode:
      snapshot.browserlessConnectionMode ?? baseMetadata.browserlessConnectionMode ?? null,
    lastSeenAt: snapshot.capturedAt,
    visibleTextLength: snapshot.visibleText.length,
    visibleTextExcerpt: snapshot.visibleText.slice(0, 500),
    isLinkedIn: snapshot.isLinkedIn,
    isJobsSection: snapshot.isJobsSection,
    isJobView: snapshot.isJobView,
    isFeedSection: snapshot.isFeedSection,
    isPostSearchSection: snapshot.isPostSearchSection,
    isPostDetail: snapshot.isPostDetail,
    hiringSignals: snapshot.hiringSignals,
    visibleEmails: snapshot.visibleEmails,
    requiresAttention: snapshot.requiresAttention,
    attentionReasons: snapshot.attentionReasons,
    hasStructuredExtraction: Boolean(snapshot.extractedJob),
    extractionQuality: snapshot.extractedJob?.quality ?? null,
    extractionDebugSources: snapshot.extractedJob?.debugSources ?? null,
    extractedJob,
  };
}

function deriveBrowserSessionStatus(snapshot) {
  if (snapshot.requiresAttention) {
    return BROWSER_SESSION_STATUS.ATTENTION_REQUIRED;
  }

  return BROWSER_SESSION_STATUS.ACTIVE;
}

function normalizeLinkedInUrl(value) {
  const parsed = new URL(value);
  const normalizedHost = parsed.hostname.toLowerCase();

  if (!normalizedHost.endsWith('linkedin.com')) {
    throw new HttpError(400, 'Supervised browser navigation is limited to LinkedIn domains');
  }

  return parsed.toString();
}

function buildCaptureText(snapshot, providerConfig) {
  return buildStructuredCaptureText(snapshot, providerConfig?.sourceLabel);
}

async function executeRuntimeCall(breaker, operation) {
  if (!breaker) {
    return operation();
  }

  return breaker.execute(operation);
}

function mapProviderToSourceType(provider) {
  switch (provider) {
    case BROWSER_SESSION_PROVIDER.LINKEDIN_JOBS:
      return 'LINKEDIN_JOBS_SUPERVISED';
    case BROWSER_SESSION_PROVIDER.LINKEDIN_FEED:
      return 'LINKEDIN_FEED_SUPERVISED';
    case BROWSER_SESSION_PROVIDER.LINKEDIN_POST_SEARCH:
      return 'LINKEDIN_POST_SEARCH_SUPERVISED';
    default:
      return 'MANUAL';
  }
}

function describeBrowserLaunchError(error) {
  if (error?.code === 'BROWSERLESS_CONFIG_ERROR') {
    return {
      errorCode: 'BROWSERLESS_CONFIG_ERROR',
      message: 'No se pudo iniciar la sesion supervisada remota porque Browserless no esta configurado correctamente.',
      reason: String(error?.message ?? 'Configuracion incompleta de Browserless.'),
      suggestion:
        error?.suggestion ??
        'Revisa BROWSER_RUNTIME, BROWSERLESS_WS_URL y BROWSERLESS_TOKEN antes de volver a intentar.',
    };
  }

  const rawMessage = String(error?.message ?? '').trim();
  const normalizedMessage = rawMessage.toLowerCase();

  if (
    normalizedMessage.includes('403') ||
    normalizedMessage.includes('401') ||
    normalizedMessage.includes('forbidden') ||
    normalizedMessage.includes('unauthorized')
  ) {
    return {
      errorCode: 'BROWSERLESS_AUTH_FAILED',
      message: 'No se pudo iniciar la sesion supervisada remota porque Browserless rechazo la autenticacion.',
      reason: rawMessage || 'Browserless devolvio un error de autenticacion.',
      suggestion: 'Verifica el token configurado y confirma que el endpoint remoto siga siendo valido.',
    };
  }

  if (
    normalizedMessage.includes('econnrefused') ||
    normalizedMessage.includes('enotfound') ||
    normalizedMessage.includes('fetch failed') ||
    normalizedMessage.includes('websocket') ||
    normalizedMessage.includes('socket hang up')
  ) {
    return {
      errorCode: 'BROWSERLESS_UNAVAILABLE',
      message: 'No se pudo conectar con Browserless para abrir la sesion supervisada remota.',
      reason: rawMessage || 'Browserless no responde o no es alcanzable desde este backend.',
      suggestion: 'Confirma que Browserless este activo, accesible desde Railway y configurado con la URL publica correcta.',
    };
  }

  if (
    normalizedMessage.includes("executable doesn't exist") ||
    normalizedMessage.includes('failed to launch browser') ||
    normalizedMessage.includes('please run the following command')
  ) {
    return {
      errorCode: 'PLAYWRIGHT_BROWSER_MISSING',
      message: 'No se pudo iniciar la sesion supervisada porque Chromium no esta instalado en este entorno.',
      reason: rawMessage || 'Chromium no esta disponible para Playwright.',
      suggestion: 'Instala Chromium para Playwright durante el build y vuelve a intentar.',
    };
  }

  if (
    normalizedMessage.includes('xserver') ||
    normalizedMessage.includes('headed browser without having a xserver') ||
    normalizedMessage.includes('missing x server') ||
    normalizedMessage.includes('no display')
  ) {
    return {
      errorCode: 'PLAYWRIGHT_DISPLAY_REQUIRED',
      message: 'No se pudo iniciar la sesion supervisada en modo visible porque este entorno no tiene display grafico.',
      reason: rawMessage || 'El entorno no dispone de XServer o display grafico.',
      suggestion: 'En Railway usa PLAYWRIGHT_HEADLESS=true. Solo usa un display virtual si realmente necesitas modo visible.',
    };
  }

  return {
    errorCode: 'PLAYWRIGHT_LAUNCH_FAILED',
    message: 'No se pudo iniciar la sesion supervisada del navegador.',
    reason: rawMessage || 'Fallo generico al iniciar Playwright.',
    suggestion: 'Revisa la configuracion de Playwright y vuelve a intentar.',
  };
}

function describeBrowserRemoteControlError(error) {
  if (error?.code === 'BROWSERLESS_REMOTE_CONTROL_ERROR') {
    return {
      errorCode: 'BROWSERLESS_REMOTE_CONTROL_ERROR',
      message: 'No se pudo abrir el navegador remoto de Browserless para esta sesion.',
      reason: String(error?.message ?? 'No hay visor remoto disponible para la sesion activa.'),
      suggestion:
        error?.suggestion ??
        'Confirma que la sesion siga activa y que Browserless exponga el endpoint /sessions con EXTERNAL configurado.',
    };
  }

  const rawMessage = String(error?.message ?? '').trim();
  const normalizedMessage = rawMessage.toLowerCase();

  if (
    normalizedMessage.includes('403') ||
    normalizedMessage.includes('401') ||
    normalizedMessage.includes('forbidden') ||
    normalizedMessage.includes('unauthorized')
  ) {
    return {
      errorCode: 'BROWSERLESS_REMOTE_CONTROL_AUTH_FAILED',
      message: 'Browserless rechazo la consulta del visor remoto para esta sesion.',
      reason: rawMessage || 'Browserless devolvio un error de autenticacion al consultar /sessions.',
      suggestion: 'Verifica el token configurado y confirma que la URL publica de Browserless siga siendo valida.',
    };
  }

  return {
    errorCode: 'BROWSERLESS_REMOTE_CONTROL_FAILED',
    message: 'No se pudo resolver el visor remoto para la sesion supervisada.',
    reason: rawMessage || 'Fallo generico al consultar el visor remoto de Browserless.',
    suggestion: 'Revisa la configuracion de Browserless y vuelve a intentar con la sesion aun activa.',
  };
}

function describeDesktopAgentRefreshError(error) {
  const rawMessage = String(error?.message ?? '').trim();

  if (error?.code === 'DESKTOP_AGENT_UNAVAILABLE' || error?.code === 'DESKTOP_AGENT_JOB_NOT_CLAIMED') {
    return {
      errorCode: error.code,
      message: 'No hay un Desktop Agent disponible para verificar la sesion supervisada.',
      reason: rawMessage || 'Ningun Desktop Agent reclamo el trabajo de verificacion.',
      suggestion:
        'Confirma que el Desktop Agent siga ONLINE y que este conectado al mismo backend donde abriste la sesion.',
    };
  }

  if (error?.code === 'DESKTOP_AGENT_JOB_TIMEOUT') {
    return {
      errorCode: error.code,
      message: 'El Desktop Agent no termino la verificacion de la sesion dentro del tiempo esperado.',
      reason: rawMessage || 'La captura del estado visible del navegador excedio el timeout.',
      suggestion:
        'Revisa la consola del Desktop Agent, espera a que LinkedIn termine de cargar y vuelve a intentar.',
    };
  }

  if (error?.code === 'DESKTOP_AGENT_JOB_FAILED') {
    return {
      errorCode: error.code,
      message: 'El Desktop Agent devolvio un error al verificar la sesion supervisada.',
      reason: rawMessage || 'El worker reporto un fallo durante GET_SNAPSHOT.',
      suggestion: 'Revisa la consola del Desktop Agent y corrige el error reportado antes de reintentar.',
    };
  }

  return {
    errorCode: 'DESKTOP_AGENT_REFRESH_FAILED',
    message: 'No se pudo verificar la sesion supervisada con el Desktop Agent.',
    reason: rawMessage || 'Fallo generico al refrescar la sesion supervisada.',
    suggestion: 'Vuelve a intentar y revisa los logs del backend y del Desktop Agent si el problema persiste.',
  };
}

function logBrowserSessionEvent(stage, payload) {
  console.info(
    `[browser-session-service] ${JSON.stringify({
      stage,
      timestamp: new Date().toISOString(),
      ...payload,
    })}`,
  );
}
