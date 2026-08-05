import { ZodError } from 'zod';
import { HttpError } from '../lib/httpError.js';

export function notFoundHandler(_req, _res, next) {
  next(new HttpError(404, 'Resource not found'));
}

export function errorHandler(error, req, res, next) {
  void next;

  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Los datos enviados no son válidos.',
      errors: formatZodErrors(error),
      requestId: req.requestId,
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

function formatZodErrors(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}
