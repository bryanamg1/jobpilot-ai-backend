import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { automationRunTriggerSchema, automationSettingsSchema } from '../../schemas/automationSchemas.js';

export function createAutomationRouter({ automationSettingsService, applicationRunnerService }) {
  const router = Router();

  router.get(
    '/settings',
    asyncHandler(async (_req, res) => {
      const settings = await automationSettingsService.getSettings();
      res.json({ data: settings });
    }),
  );

  router.put(
    '/settings',
    asyncHandler(async (req, res) => {
      const input = automationSettingsSchema.parse(req.body ?? {});
      const settings = await automationSettingsService.updateSettings(input);
      res.json({ data: settings });
    }),
  );

  router.post(
    '/runs',
    asyncHandler(async (req, res) => {
      const input = automationRunTriggerSchema.parse(req.body ?? {});
      const result = await applicationRunnerService.runScheduledCycle({
        trigger: 'MANUAL_BATCH',
        reason: input.reason,
      });
      res.status(201).json({ data: result });
    }),
  );

  return router;
}

