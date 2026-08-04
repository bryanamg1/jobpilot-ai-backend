import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';

export function createHealthRouter({ healthService }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const status = await healthService.getStatus();
      res.json(status);
    }),
  );

  return router;
}
