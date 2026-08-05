import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { jobDraftPreviewParamsSchema, manualJobInputSchema } from '../../schemas/jobSchemas.js';

export function createJobsRouter({ jobOfferService, jobDraftService, gmailIntegrationService }) {
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

  router.post(
    '/:jobId/draft-preview',
    asyncHandler(async (req, res) => {
      const params = jobDraftPreviewParamsSchema.parse(req.params);
      const preview = await jobDraftService.createPreview(params.jobId);
      res.json({ data: preview });
    }),
  );

  router.post(
    '/:jobId/gmail-draft',
    asyncHandler(async (req, res) => {
      const params = jobDraftPreviewParamsSchema.parse(req.params);
      const payload = await gmailIntegrationService.createDraftFromJob(params.jobId);
      res.status(201).json({ data: payload });
    }),
  );

  return router;
}
