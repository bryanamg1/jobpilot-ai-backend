import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import {
  browserSessionNavigateSchema,
  browserSessionParamsSchema,
  browserSessionStartSchema,
} from '../../schemas/browserSessionSchemas.js';

export function createBrowserSessionsRouter({ browserSessionService }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const sessions = await browserSessionService.listSessions();
      res.json({ data: sessions });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = browserSessionStartSchema.parse(req.body ?? {});
      const session = await browserSessionService.startSession(input);
      res.status(201).json({ data: session });
    }),
  );

  router.get(
    '/:sessionId',
    asyncHandler(async (req, res) => {
      const params = browserSessionParamsSchema.parse(req.params);
      const session = await browserSessionService.getSession(params.sessionId);
      res.json({ data: session });
    }),
  );

  router.post(
    '/:sessionId/refresh',
    asyncHandler(async (req, res) => {
      const params = browserSessionParamsSchema.parse(req.params);
      const session = await browserSessionService.refreshSession(params.sessionId);
      res.json({ data: session });
    }),
  );

  router.get(
    '/:sessionId/remote-control',
    asyncHandler(async (req, res) => {
      const params = browserSessionParamsSchema.parse(req.params);
      const remoteControlUrl = await browserSessionService.getRemoteControlUrl(params.sessionId);
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, remoteControlUrl);
    }),
  );

  router.post(
    '/:sessionId/navigate',
    asyncHandler(async (req, res) => {
      const params = browserSessionParamsSchema.parse(req.params);
      const input = browserSessionNavigateSchema.parse(req.body);
      const session = await browserSessionService.navigateSession(params.sessionId, input);
      res.json({ data: session });
    }),
  );

  router.post(
    '/:sessionId/capture-job',
    asyncHandler(async (req, res) => {
      const params = browserSessionParamsSchema.parse(req.params);
      const payload = await browserSessionService.captureCurrentJob(params.sessionId);
      res.status(201).json({ data: payload });
    }),
  );

  router.post(
    '/:sessionId/close',
    asyncHandler(async (req, res) => {
      const params = browserSessionParamsSchema.parse(req.params);
      const session = await browserSessionService.closeSession(params.sessionId);
      res.json({ data: session });
    }),
  );

  return router;
}
