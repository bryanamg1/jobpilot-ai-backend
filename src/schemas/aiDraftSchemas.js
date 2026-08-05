import { z } from 'zod';
import { CERTAINTY } from '../constants/certainty.js';

const certaintyValues = Object.values(CERTAINTY);

const factSchema = z
  .object({
    field: z.string().min(1),
    value: z.string(),
    certainty: z.enum(certaintyValues),
    source: z.string().min(1),
  })
  .strict();

export const aiDraftPreviewSchema = z
  .object({
    subject: z.string().min(1),
    body: z.string().min(40),
    highlights: z.array(z.string()).max(6).default([]),
    factsUsed: z.array(factSchema).max(20).default([]),
    warnings: z.array(z.string()).max(10).default([]),
  })
  .strict();
