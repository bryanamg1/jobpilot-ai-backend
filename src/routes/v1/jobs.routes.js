import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { manualJobInputSchema } from '../../schemas/jobSchemas.js';

export function createJobsRouter({ jobOfferService }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const jobs = await jobOfferService.list();
      res.json({ data: jobs });
    }),
  );

  router.post(
    '/manual',
    asyncHandler(async (req, res) => {
      const input = manualJobInputSchema.parse(req.body);
      const record = await jobOfferService.createFromManualInput(input);
      res.status(201).json({ data: record });
    }),
  );

  return router;
}
