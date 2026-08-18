import os from 'node:os';
import { env } from '../src/config/env.js';
import { createHeartbeat } from './heartbeat.js';
import { createWorkerClient } from './workerClient.js';
import { createWorkerPlaywrightRuntime } from './playwrightRuntime.js';
import { createSessionStore } from './sessionStore.js';
import { createWorkerService } from './workerService.js';

async function main() {
  if (!env.DESKTOP_AGENT_TOKEN) {
    throw new Error('DESKTOP_AGENT_TOKEN es obligatorio para iniciar el Desktop Worker.');
  }

  const client = createWorkerClient({
    apiUrl: env.JOBPILOT_API_URL,
    token: env.DESKTOP_AGENT_TOKEN,
  });
  const runtime = createWorkerPlaywrightRuntime({
    config: env,
  });
  const sessionStore = createSessionStore(runtime);
  const workerService = createWorkerService(client, sessionStore, {
    pollIntervalMs: env.DESKTOP_AGENT_POLL_INTERVAL_MS,
    logLevel: env.LOG_LEVEL,
    agentMeta: {
      version: '1.0.0',
      os: `${os.platform()} ${os.release()}`,
      hostname: os.hostname(),
      capabilities: ['PLAYWRIGHT', 'BROWSER_SESSIONS'],
    },
  });

  await workerService.register();

  const heartbeat = createHeartbeat(client, {
    intervalMs: env.DESKTOP_AGENT_HEARTBEAT_MS,
  });

  heartbeat.start(() => ({
    agentId: workerService.getAgentId(),
    status: workerService.getActiveJobId() ? 'BUSY' : 'ONLINE',
    activeJobId: workerService.getActiveJobId() ?? undefined,
  }));

  await workerService.runLoop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
