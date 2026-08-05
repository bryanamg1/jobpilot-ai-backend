import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
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
    asyncHandler(async (req, res) => {
      const input = answerLibraryItemSchema.parse(req.body);
      const answer = await answerLibraryService.createAnswer(input);
      res.status(201).json({ data: answer });
    }),
  );

  router.put(
    '/:answerId',
    asyncHandler(async (req, res) => {
      const params = answerLibraryParamsSchema.parse(req.params);
      const input = answerLibraryItemSchema.parse(req.body);
      const answer = await answerLibraryService.updateAnswer(params.answerId, input);
      res.json({ data: answer });
    }),
  );

  router.delete(
    '/:answerId',
    asyncHandler(async (req, res) => {
      const params = answerLibraryParamsSchema.parse(req.params);
      const result = await answerLibraryService.deleteAnswer(params.answerId);
      res.json({ data: result });
    }),
  );

  return router;
}
