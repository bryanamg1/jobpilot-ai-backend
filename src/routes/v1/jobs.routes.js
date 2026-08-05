import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import {
  jobApprovalInputSchema,
  jobDraftPreviewParamsSchema,
  manualJobInputSchema,
} from '../../schemas/jobSchemas.js';

export function createJobsRouter({
  jobOfferService,
  jobDraftService,
  gmailIntegrationService,
  jobApprovalService,
}) {
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

  router.post(
    '/:jobId/approve',
    asyncHandler(async (req, res) => {
      const params = jobDraftPreviewParamsSchema.parse(req.params);
      const input = jobApprovalInputSchema.parse(req.body);
      const payload = await jobApprovalService.approve(params.jobId, input);
      res.json({ data: payload });
    }),
  );

  router.post(
    '/:jobId/reject',
    asyncHandler(async (req, res) => {
      const params = jobDraftPreviewParamsSchema.parse(req.params);
      const input = jobApprovalInputSchema.parse(req.body);
      const payload = await jobApprovalService.reject(params.jobId, input);
      res.json({ data: payload });
    }),
  );

  return router;
}
