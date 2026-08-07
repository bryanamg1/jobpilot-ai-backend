import { randomUUID } from 'node:crypto';
import { BROWSER_SESSION_PROVIDER, BROWSER_SESSION_STATUS } from '../../constants/browserSessions.js';
import { HttpError } from '../../lib/httpError.js';
import { retryOperation } from '../../lib/retry.js';
import { createPlaywrightBrowserRuntime } from './playwrightBrowserRuntime.js';

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
  const runtime = options.runtime ?? createPlaywrightBrowserRuntime(options.runtimeOptions);
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
                  startUrl,
                }),
              { attempts: 2, baseDelayMs: 100 },
            ),
        );
      } catch (error) {
        throw new HttpError(503, 'Could not launch the supervised browser session', {
          reason: error.message,
          suggestion: 'Verify that Playwright Chromium is installed locally and try again.',
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
      const { record, handle } = await getManagedSession(repository, activeSessions, sessionId);
      const snapshot = await executeRuntimeCall(
        breaker,
        () => retryOperation(() => runtime.getSnapshot(handle), { attempts: 2, baseDelayMs: 100 }),
      );
      const updated = updateSessionFromSnapshot(record, snapshot, {
        navigationCount: record.metadata?.navigationCount ?? 0,
        lastAction: 'REFRESHED',
      });

      await repository.updateBrowserSession(updated);
      await auditService.record('browser_session.refreshed', 'browser_session', sessionId, {
        status: updated.status,
        currentUrl: updated.metadata.currentUrl,
      });

      return updated;
    },

    async navigateSession(sessionId, input) {
      const { record, handle } = await getManagedSession(repository, activeSessions, sessionId);
      const targetUrl = normalizeLinkedInUrl(input.url);
      const snapshot = await executeRuntimeCall(
        breaker,
        () => retryOperation(() => runtime.navigate(handle, targetUrl), { attempts: 2, baseDelayMs: 100 }),
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
        () => retryOperation(() => runtime.getSnapshot(handle), { attempts: 2, baseDelayMs: 100 }),
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
          () => retryOperation(() => runtime.close(handle), { attempts: 2, baseDelayMs: 100 }),
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
  return {
    ...baseMetadata,
    currentUrl: snapshot.url,
    pageTitle: snapshot.title,
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
  const sections = [
    `Source: ${providerConfig?.sourceLabel ?? 'LinkedIn supervised session'}`,
    `Captured URL: ${snapshot.url}`,
  ];

  if (snapshot.hiringSignals.length) {
    sections.push(`Visible hiring signals: ${snapshot.hiringSignals.join(', ')}`);
  }

  if (snapshot.visibleEmails.length) {
    sections.push(`Visible contact emails: ${snapshot.visibleEmails.join(', ')}`);
  }

  sections.push(snapshot.visibleText);

  return sections.join('\n');
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
