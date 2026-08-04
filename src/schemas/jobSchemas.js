import { z } from 'zod';

export const manualJobInputSchema = z.object({
  rawText: z.string().min(30, 'Job text must contain enough detail for parsing'),
  sourceUrl: z.string().url().optional().or(z.literal('')),
  sourceLabel: z.string().min(2).max(80).default('Manual input'),
});
