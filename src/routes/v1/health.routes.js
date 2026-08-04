import { Router } from 'express';

export function createHealthRouter({ repository }) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      storageMode: repository.mode,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
