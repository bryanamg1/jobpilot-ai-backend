import { z } from 'zod';

export const manualJobInputSchema = z.object({
  rawText: z.string().min(30, 'Job text must contain enough detail for parsing'),
  sourceUrl: z.string().url().optional().or(z.literal('')),
  sourceLabel: z.string().min(2).max(80).default('Manual input'),
  sourceType: z.string().trim().min(2).max(80).optional(),
});

export const jobDraftPreviewParamsSchema = z.object({
  jobId: z.string().min(1, 'Job id is required'),
});

export const jobApprovalInputSchema = z.object({
  reason: z.string().trim().max(300).optional().default(''),
});

export const jobDraftPreviewParamsSchema = z.object({
  jobId: z.string().min(1, 'Job id is required'),
});

export const jobApprovalInputSchema = z.object({
  reason: z.string().trim().max(300).optional().default(''),
});
