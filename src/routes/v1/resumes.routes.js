import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { resumeUploadSchema } from '../../schemas/resumeSchemas.js';

export function createResumesRouter({ resumeService }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const resumes = await resumeService.listResumes();
      res.json({ data: resumes });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = resumeUploadSchema.parse(req.body);
      const resume = await resumeService.uploadResume(input);
      res.status(201).json({ data: resume });
    }),
  );

  return router;
}
