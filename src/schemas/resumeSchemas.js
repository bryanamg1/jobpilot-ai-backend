import { z } from 'zod';

export const resumeUploadSchema = z.object({
  label: z.string().trim().min(1, 'Resume label is required').max(120, 'Resume label is too long'),
  fileName: z.string().trim().min(1, 'Original file name is required').max(255, 'File name is too long'),
  mimeType: z.string().trim().max(160, 'Mime type is too long').optional().default(''),
  contentBase64: z.string().trim().min(1, 'Resume content is required'),
});

export const jobResumeSelectionSchema = z.object({
  resumeId: z.union([z.string().trim().min(1, 'Resume id is required'), z.null()]).default(null),
});
