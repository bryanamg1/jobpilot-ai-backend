import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';

export function createDashboardRouter({ dashboardService }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const summary = await dashboardService.getSummary();
      res.json({ data: summary });
    }),
  );

  return router;
}
