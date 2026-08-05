import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { auditEventListQuerySchema } from '../../schemas/auditSchemas.js';

export function createAuditsRouter({ auditService }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const filters = auditEventListQuerySchema.parse(req.query);
      const events = await auditService.listEvents(filters);
      res.json({ data: events });
    }),
  );

  return router;
}
