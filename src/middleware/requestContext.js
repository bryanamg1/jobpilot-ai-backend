import { randomUUID } from 'node:crypto';
import { runWithRequestScope } from '../lib/requestScope.js';

export function requestContext(req, res, next) {
  const requestId = req.headers['x-request-id'] || randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', req.requestId);

  runWithRequestScope(
    {
      requestId,
      method: req.method,
      url: req.originalUrl || req.url,
      startedAt: new Date().toISOString(),
    },
    () => next(),
  );
}
