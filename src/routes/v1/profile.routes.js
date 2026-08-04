import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';

export function createProfileRouter({ profileService }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const profile = await profileService.getProfile();
      res.json({ data: profile });
    }),
  );

  return router;
}
