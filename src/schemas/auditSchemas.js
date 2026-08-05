import { z } from 'zod';

export const auditEventListQuerySchema = z.object({
  entityType: z.string().trim().min(1).optional(),
  entityId: z.string().trim().min(1).optional(),
  eventName: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});
