import { Router } from 'express';
import { openApiDocument } from '../../docs/openapi.js';

export function createDocsRouter() {
  const router = Router();

  router.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });

  return router;
}
