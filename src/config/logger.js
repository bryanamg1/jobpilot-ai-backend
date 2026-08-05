import pino from 'pino';
import { env } from './env.js';
import { getRequestScope } from '../lib/requestScope.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  enabled: !env.isTest,
  base: undefined,
  mixin() {
    const scope = getRequestScope();

    return scope?.requestId ? { requestId: scope.requestId } : {};
  },
});
