import { ZodError } from 'zod';
import { HttpError } from '../lib/httpError.js';

export function notFoundHandler(_req, _res, next) {
  next(new HttpError(404, 'No se encontro el recurso solicitado.'));
}

export function errorHandler(error, req, res, next) {
  void next;

  if (error instanceof ZodError) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      title: 'Solicitud invalida',
      message: 'Los datos enviados no son válidos.',
      cause: null,
      action: 'Revisa los campos obligatorios e intenta nuevamente.',
      errors: formatZodErrors(error),
      requestId: req.requestId,
    });
  }

  if (error instanceof HttpError) {
    const details = error.details ?? {};
    return res.status(error.statusCode).json({
      success: false,
      error: 'HttpError',
      code: details.code ?? mapHttpStatusToCode(error.statusCode),
      title: details.title ?? mapHttpStatusToTitle(error.statusCode),
      message: error.message,
      cause: details.cause ?? null,
      action: details.action ?? null,
      requestId: req.requestId,
      details: sanitizeDetails(details),
    });
  }

  return res.status(500).json({
    error: 'InternalServerError',
    message: 'Ocurrio un error inesperado en el servidor.',
    requestId: req.requestId,
  });
}

function formatZodErrors(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

function mapHttpStatusToCode(statusCode) {
  if (statusCode === 400) {
    return 'BAD_REQUEST';
  }

  if (statusCode === 404) {
    return 'NOT_FOUND';
  }

  if (statusCode === 409) {
    return 'CONFLICT';
  }

  return 'HTTP_ERROR';
}

function mapHttpStatusToTitle(statusCode) {
  if (statusCode === 400) {
    return 'Solicitud invalida';
  }

  if (statusCode === 404) {
    return 'Recurso no encontrado';
  }

  if (statusCode === 409) {
    return 'Conflicto de estado';
  }

  return 'Error de la solicitud';
}

function sanitizeDetails(details) {
  if (!details || typeof details !== 'object') {
    return null;
  }

  const sanitized = { ...details };
  delete sanitized.code;
  delete sanitized.title;
  delete sanitized.cause;
  delete sanitized.action;

  return Object.keys(sanitized).length ? sanitized : null;
}

