import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

const app = buildApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'JobPilot backend listening');
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, 'Shutting down JobPilot backend');
  server.close((error) => {
    if (error) {
      logger.error({ error }, 'Failed to close JobPilot backend gracefully');
      process.exit(1);
      return;
    }

    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
