import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestContext } from './middleware/requestContext.js';
import { getRepository } from './repositories/repositoryFactory.js';
import { createAuditService } from './services/audit/auditService.js';
import { createDashboardService } from './services/dashboard/dashboardService.js';
import { createHealthService } from './services/health/healthService.js';
import { createJobOfferService } from './services/jobs/jobOfferService.js';
import { createOpenAiEnrichmentService } from './services/openai/openAiEnrichmentService.js';
import { createProfileService } from './services/profile/profileService.js';
import { createDashboardRouter } from './routes/v1/dashboard.routes.js';
import { createDocsRouter } from './routes/v1/docs.routes.js';
import { createHealthRouter } from './routes/v1/health.routes.js';
import { createJobsRouter } from './routes/v1/jobs.routes.js';
import { createProfileRouter } from './routes/v1/profile.routes.js';

export function buildApp(options = {}) {
  const repository = options.repository ?? getRepository();
  const auditService = options.auditService ?? createAuditService(repository);
  const openAiEnrichmentService =
    options.openAiEnrichmentService ?? createOpenAiEnrichmentService();
  const jobOfferService =
    options.jobOfferService ??
    createJobOfferService(repository, auditService, {
      openAiEnrichmentService,
    });
  const dashboardService = options.dashboardService ?? createDashboardService(repository);
  const healthService = options.healthService ?? createHealthService(repository);
  const profileService = options.profileService ?? createProfileService(repository, auditService);

  const app = express();

  app.use(requestContext);
  app.use(pinoHttp({ logger, quietReqLogger: env.isTest }));
  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_ORIGIN,
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 60,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/v1/health', createHealthRouter({ healthService }));
  app.use('/api/v1/profile', createProfileRouter({ profileService }));
  app.use('/api/v1/jobs', createJobsRouter({ jobOfferService }));
  app.use('/api/v1/dashboard', createDashboardRouter({ dashboardService }));
  app.use('/api/v1/docs', createDocsRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
