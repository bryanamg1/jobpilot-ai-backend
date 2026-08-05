import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { profileUpdateSchema } from '../../schemas/profileSchemas.js';

export function createProfileRouter({ profileService }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const profile = await profileService.getProfile();
      res.json({ data: profile });
    }),
  );

  router.put(
    '/',
    asyncHandler(async (req, res) => {
      const input = profileUpdateSchema.parse(req.body);
      const profile = await profileService.updateProfile(input);
      res.json({ data: profile });
    }),
  );

  return router;
}
