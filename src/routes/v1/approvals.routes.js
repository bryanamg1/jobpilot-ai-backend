import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { approvalRequestListQuerySchema } from '../../schemas/approvalRequestQuerySchemas.js';
import {
  approvalRequestDecisionInputSchema,
  approvalRequestDecisionParamsSchema,
} from '../../schemas/approvalRequestSchemas.js';

export function createApprovalsRouter({ approvalRequestService }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const filters = approvalRequestListQuerySchema.parse(req.query);
      const approvals = await approvalRequestService.listRequests(filters);
      res.json({ data: approvals });
    }),
  );

  router.post(
    '/:requestId/approve',
    asyncHandler(async (req, res) => {
      const params = approvalRequestDecisionParamsSchema.parse(req.params);
      const input = approvalRequestDecisionInputSchema.parse(req.body);
      const approval = await approvalRequestService.approve(params.requestId, input);
      res.json({ data: approval });
    }),
  );

  router.post(
    '/:requestId/reject',
    asyncHandler(async (req, res) => {
      const params = approvalRequestDecisionParamsSchema.parse(req.params);
      const input = approvalRequestDecisionInputSchema.parse(req.body);
      const approval = await approvalRequestService.reject(params.requestId, input);
      res.json({ data: approval });
    }),
  );

  return router;
}
