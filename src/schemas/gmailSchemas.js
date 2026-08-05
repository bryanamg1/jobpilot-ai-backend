import { z } from 'zod';

export const gmailCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const gmailAlertsQuerySchema = z.object({
  query: z.string().optional(),
  maxResults: z.coerce.number().int().min(1).max(25).optional(),
});
