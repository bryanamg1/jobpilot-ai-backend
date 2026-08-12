import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createOperationalQueueService } from './lib/operationalQueueService.js';
import { createReliabilityRegistry } from './lib/reliabilityRegistry.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestContext } from './middleware/requestContext.js';
import { getRepository } from './repositories/repositoryFactory.js';
import { createApprovalsRouter } from './routes/v1/approvals.routes.js';
import { createAuditsRouter } from './routes/v1/audits.routes.js';
import { createAnswersRouter } from './routes/v1/answers.routes.js';
import { createAutomationRouter } from './routes/v1/automation.routes.js';
import { createBrowserSessionsRouter } from './routes/v1/browserSessions.routes.js';
import { createDesktopAgentRouter } from './routes/v1/desktopAgent.routes.js';
import { createAuditService } from './services/audit/auditService.js';
import { createAnswerLibraryService } from './services/answers/answerLibraryService.js';
import { createApplicationRunnerService } from './services/applications/applicationRunnerService.js';
import { createApprovalRequestService } from './services/approvals/approvalRequestService.js';
import { createAutomationSchedulerService } from './services/automation/automationSchedulerService.js';
import { createAutomationSettingsService } from './services/automation/automationSettingsService.js';
import { createBrowserSessionService } from './services/browser/browserSessionService.js';
import { createDashboardService } from './services/dashboard/dashboardService.js';
import { createDesktopAgentService } from './services/desktopAgent/desktopAgentService.js';
import { createGmailIntegrationService } from './services/gmail/gmailIntegrationService.js';
import { createHealthService } from './services/health/healthService.js';
import { createJobApprovalService } from './services/jobs/jobApprovalService.js';
import { createJobDraftService } from './services/jobs/jobDraftService.js';
import { createJobOfferService } from './services/jobs/jobOfferService.js';
import { createOpenAiDraftService } from './services/openai/openAiDraftService.js';
import { createOpenAiEnrichmentService } from './services/openai/openAiEnrichmentService.js';
import { createProfileService } from './services/profile/profileService.js';
import { createResumeService } from './services/resumes/resumeService.js';
import { createDashboardRouter } from './routes/v1/dashboard.routes.js';
import { createDocsRouter } from './routes/v1/docs.routes.js';
import { createHealthRouter } from './routes/v1/health.routes.js';
import { createIntegrationsRouter, handleGmailCallbackRequest } from './routes/v1/integrations.routes.js';
import { createJobsRouter } from './routes/v1/jobs.routes.js';
import { createProfileRouter } from './routes/v1/profile.routes.js';
import { createResumesRouter } from './routes/v1/resumes.routes.js';
import { asyncHandler } from './lib/asyncHandler.js';

export function buildApp(options = {}) {
  const repository = options.repository ?? getRepository();
  const operationsQueueService = options.operationsQueueService ?? createOperationalQueueService();
  const reliabilityRegistry = options.reliabilityRegistry ?? createReliabilityRegistry();
  const auditService =
    options.auditService ?? createAuditService(repository, { operationsQueueService });
  const answerLibraryService = options.answerLibraryService ?? createAnswerLibraryService(repository, auditService);
  const approvalRequestService =
    options.approvalRequestService ?? createApprovalRequestService(repository, auditService);
  const automationSettingsService =
    options.automationSettingsService ?? createAutomationSettingsService(repository, auditService);
  const openAiEnrichmentService =
    options.openAiEnrichmentService ??
    createOpenAiEnrichmentService({
      breaker: reliabilityRegistry.getBreaker('openai'),
    });
  const openAiDraftService =
    options.openAiDraftService ??
    createOpenAiDraftService({
      breaker: reliabilityRegistry.getBreaker('openai'),
    });
  const jobOfferService =
    options.jobOfferService ??
    createJobOfferService(repository, auditService, {
      openAiEnrichmentService,
      approvalRequestService,
    });
  const jobDraftService =
    options.jobDraftService ??
    createJobDraftService(repository, auditService, {
      openAiDraftService,
      answerLibraryService,
      approvalRequestService,
    });
  const applicationRunnerService =
    options.applicationRunnerService ??
    createApplicationRunnerService(repository, auditService, jobDraftService, automationSettingsService, {
      killSwitchEnabled: env.AUTOMATION_KILL_SWITCH,
    });
  const jobApprovalService =
    options.jobApprovalService ?? createJobApprovalService(repository, auditService);
  const browserSessionService =
    options.browserSessionService ??
    createBrowserSessionService(repository, auditService, jobOfferService, {
      breaker: reliabilityRegistry.getBreaker('playwright'),
      config: env,
    });
  const desktopAgentService =
    options.desktopAgentService ?? createDesktopAgentService(repository, auditService, { config: env });
  const gmailIntegrationService =
    options.gmailIntegrationService ??
    createGmailIntegrationService(repository, auditService, jobDraftService, {
      breaker: reliabilityRegistry.getBreaker('gmail'),
    });
  const automationSchedulerService =
    options.automationSchedulerService ??
    createAutomationSchedulerService(automationSettingsService, applicationRunnerService, {
      killSwitchEnabled: env.AUTOMATION_KILL_SWITCH,
    });
  const dashboardService =
    options.dashboardService ??
    createDashboardService(repository, {
      automationSettingsService,
    });
  const healthService =
    options.healthService ??
    createHealthService(repository, {
      gmailIntegrationService,
      operationsQueueService,
      reliabilityRegistry,
      automationSettingsService,
      automationSchedulerService,
      desktopAgentService,
    });
  const profileService = options.profileService ?? createProfileService(repository, auditService);
  const resumeService = options.resumeService ?? createResumeService(repository, auditService);

  const app = express();

  app.set('trust proxy', 1);
  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      quietReqLogger: true,
      customLogLevel(_req, res, error) {
        if (error || res.statusCode >= 500) {
          return 'error';
        }
        if (res.statusCode >= 400) {
          return 'warn';
        }
        return 'silent';
      },
      autoLogging: {
        ignore(req) {
          return req.method === 'OPTIONS';
        },
      },
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url,
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
        err(error) {
          return {
            type: error.name,
            message: error.message,
            stack: env.isProduction ? undefined : error.stack,
          };
        },
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_ORIGIN,
    }),
  );
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
    }),
  );
  app.use(express.json({ limit: '8mb' }));

  app.use('/api/v1/health', createHealthRouter({ healthService }));
  app.use(
    '/api/v1/desktop-agent',
    createDesktopAgentRouter({
      desktopAgentService,
      agentToken: options.desktopAgentToken ?? env.DESKTOP_AGENT_TOKEN,
    }),
  );
  app.use('/api/v1/approvals', createApprovalsRouter({ approvalRequestService }));
  app.use('/api/v1/audits', createAuditsRouter({ auditService }));
  app.use('/api/v1/automation', createAutomationRouter({ automationSettingsService, applicationRunnerService }));
  app.use('/api/v1/browser-sessions', createBrowserSessionsRouter({ browserSessionService }));
  app.use('/api/v1/answers', createAnswersRouter({ answerLibraryService }));
  app.use('/api/v1/profile', createProfileRouter({ profileService }));
  app.use(
    '/api/v1/jobs',
    createJobsRouter({
      jobOfferService,
      jobDraftService,
      gmailIntegrationService,
      jobApprovalService,
      resumeService,
      applicationRunnerService,
    }),
  );
  app.use('/api/v1/resumes', createResumesRouter({ resumeService }));
  app.use('/api/v1/integrations', createIntegrationsRouter({ gmailIntegrationService }));
  app.get(
    '/api/auth/google/callback',
    asyncHandler(async (req, res) => handleGmailCallbackRequest(req, res, gmailIntegrationService)),
  );
  app.use('/api/v1/dashboard', createDashboardRouter({ dashboardService }));
  app.use('/api/v1/docs', createDocsRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  if (!env.isTest && !env.AUTOMATION_KILL_SWITCH && options.startAutomationScheduler !== false) {
    automationSchedulerService.start();
  }

  return app;
}
