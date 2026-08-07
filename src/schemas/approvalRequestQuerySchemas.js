import { z } from 'zod';

const approvalStatusValues = ['PENDING', 'APPROVED', 'REJECTED'];

export const approvalRequestListQuerySchema = z.object({
  entityId: z.string().trim().min(1).optional(),
  entityType: z.string().trim().min(1).optional(),
  approvalKind: z.string().trim().min(1).optional(),
  status: z.enum(approvalStatusValues).optional(),
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
