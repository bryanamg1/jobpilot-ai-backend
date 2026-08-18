import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { HttpError } from '../../lib/httpError.js';

const registerSchema = z.object({
  agentId: z.string().trim().min(1).optional(),
  version: z.string().trim().min(1).optional(),
  os: z.string().trim().min(1).optional(),
  hostname: z.string().trim().min(1).optional(),
  capabilities: z.array(z.string().trim().min(1)).default([]),
});

const heartbeatSchema = z.object({
  agentId: z.string().trim().min(1),
  status: z.enum(['ONLINE', 'OFFLINE', 'BUSY']).optional(),
  activeJobId: z.string().trim().min(1).optional(),
});

const jobResultSchema = z.object({
  agentId: z.string().trim().min(1),
  result: z.record(z.string(), z.any()),
});

const jobErrorSchema = z.object({
  agentId: z.string().trim().min(1),
  error: z.object({
    message: z.string().trim().min(1),
    code: z.string().trim().min(1).optional(),
    details: z.record(z.string(), z.any()).optional(),
  }),
});

const jobParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const nextJobQuerySchema = z.object({
  agentId: z.string().trim().min(1),
});

export function createDesktopAgentRouter({ desktopAgentService, agentToken, rateLimitOptions = {} }) {
  const router = Router();
  const desktopAgentRateLimiter = rateLimit({
    windowMs: rateLimitOptions.windowMs ?? 60_000,
    limit: rateLimitOptions.limit ?? 600,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator(req) {
      return req.header('x-desktop-agent-token')?.trim() || 'desktop-agent';
    },
  });

  router.use((req, _res, next) => {
    const token = req.header('x-desktop-agent-token');
    if (!agentToken || token !== agentToken) {
      next(new HttpError(401, 'Desktop agent unauthorized'));
      return;
    }
    next();
  });
  router.use(desktopAgentRateLimiter);

  router.post(
    '/register',
    asyncHandler(async (req, res) => {
      const input = registerSchema.parse(req.body ?? {});
      const payload = await desktopAgentService.register(input);
      res.status(201).json({ data: payload });
    }),
  );

  router.post(
    '/heartbeat',
    asyncHandler(async (req, res) => {
      const input = heartbeatSchema.parse(req.body ?? {});
      const payload = await desktopAgentService.heartbeat(input);
      res.json({ data: payload });
    }),
  );

  router.get(
    '/jobs/next',
    asyncHandler(async (req, res) => {
      const query = nextJobQuerySchema.parse(req.query ?? {});
      const job = await desktopAgentService.getNextJob(query.agentId);
      if (!job) {
        res.status(204).send();
        return;
      }
      res.json({ data: job });
    }),
  );

  router.post(
    '/jobs/:id/result',
    asyncHandler(async (req, res) => {
      const params = jobParamsSchema.parse(req.params);
      const input = jobResultSchema.parse(req.body ?? {});
      const payload = await desktopAgentService.completeJob(params.id, input);
      res.json({ data: payload });
    }),
  );

  router.post(
    '/jobs/:id/error',
    asyncHandler(async (req, res) => {
      const params = jobParamsSchema.parse(req.params);
      const input = jobErrorSchema.parse(req.body ?? {});
      const payload = await desktopAgentService.failJob(params.id, input);
      res.json({ data: payload });
    }),
  );

  return router;
}
