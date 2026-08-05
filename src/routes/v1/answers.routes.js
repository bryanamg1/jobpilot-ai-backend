import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validateBody, validateParams } from '../../middleware/validateRequest.js';
import { answerLibraryItemSchema, answerLibraryParamsSchema } from '../../schemas/answerSchemas.js';

export function createAnswersRouter({ answerLibraryService }) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const answers = await answerLibraryService.listAnswers();
      res.json({ data: answers });
    }),
  );

  router.post(
    '/',
    validateBody(answerLibraryItemSchema),
    asyncHandler(async (req, res) => {
      const answer = await answerLibraryService.createAnswer(req.body);
      res.status(201).json({ data: answer });
    }),
  );

  router.put(
    '/:answerId',
    validateParams(answerLibraryParamsSchema),
    validateBody(answerLibraryItemSchema),
    asyncHandler(async (req, res) => {
      const answer = await answerLibraryService.updateAnswer(req.params.answerId, req.body);
      res.json({ data: answer });
    }),
  );

  router.delete(
    '/:answerId',
    validateParams(answerLibraryParamsSchema),
    asyncHandler(async (req, res) => {
      const result = await answerLibraryService.deleteAnswer(req.params.answerId);
      res.json({ data: result });
    }),
  );

  return router;
}
