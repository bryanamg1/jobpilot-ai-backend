import { randomUUID } from 'node:crypto';

export function requestContext(req, res, next) {
  req.requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
