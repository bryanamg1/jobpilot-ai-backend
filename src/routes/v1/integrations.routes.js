import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { gmailAlertsQuerySchema, gmailCallbackQuerySchema } from '../../schemas/gmailSchemas.js';

export async function handleGmailCallbackRequest(req, res, gmailIntegrationService) {
  const query = gmailCallbackQuerySchema.parse(req.query);
  const payload = await gmailIntegrationService.handleCallback(query);
  res.redirect(payload.redirectUrl);
}

export function createIntegrationsRouter({ gmailIntegrationService }) {
  const router = Router();

  router.get(
    '/gmail/status',
    asyncHandler(async (_req, res) => {
      const status = await gmailIntegrationService.getStatus();
      res.json({ data: status });
    }),
  );

  router.get(
    '/gmail/auth-url',
    asyncHandler(async (_req, res) => {
      const payload = await gmailIntegrationService.getAuthUrl();
      res.json({ data: payload });
    }),
  );

  router.get(
    '/gmail/callback',
    asyncHandler(async (req, res) => handleGmailCallbackRequest(req, res, gmailIntegrationService)),
  );

  router.delete(
    '/gmail/connection',
    asyncHandler(async (_req, res) => {
      const payload = await gmailIntegrationService.disconnect();
      res.json({ data: payload });
    }),
  );

  router.get(
    '/gmail/alerts',
    asyncHandler(async (req, res) => {
      const query = gmailAlertsQuerySchema.parse(req.query);
      const payload = await gmailIntegrationService.listAlerts(query.query, query.maxResults);
      res.json({ data: payload });
    }),
  );

  return router;
}
