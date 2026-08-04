import { ZodError } from 'zod';
import { HttpError } from '../lib/httpError.js';

export function notFoundHandler(_req, _res, next) {
  next(new HttpError(404, 'Resource not found'));
}

export function errorHandler(error, req, res) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Invalid request payload',
      requestId: req.requestId,
      details: error.flatten(),
    });
  }

  if (error instanceof HttpError) {
    return res.status(error.statusCode).json({
      error: 'HttpError',
      message: error.message,
      requestId: req.requestId,
      details: error.details ?? null,
    });
  }

  return res.status(500).json({
    error: 'InternalServerError',
    message: 'Unexpected server error',
    requestId: req.requestId,
  });
}
