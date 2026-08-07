import { z } from 'zod';

export const approvalRequestDecisionParamsSchema = z.object({
  requestId: z.string().trim().min(1, 'El id de la aprobacion es obligatorio.'),
});

export const approvalRequestDecisionInputSchema = z.object({
  note: z.string().trim().max(300, 'Decision note is too long').optional().default(''),
});
