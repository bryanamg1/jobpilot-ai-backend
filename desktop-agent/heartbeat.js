export function createHeartbeat(client, options = {}) {
  const intervalMs = options.intervalMs ?? 30_000;
  let timer = null;
  let rateLimitedUntil = 0;

  return {
    start(getPayload) {
      if (timer) {
        return;
      }

      timer = setInterval(() => {
        if (Date.now() < rateLimitedUntil) {
          return;
        }

        Promise.resolve(getPayload())
          .then((payload) => client.heartbeat(payload))
          .then(() => {
            rateLimitedUntil = 0;
          })
          .catch((error) => {
            if (error?.code === 'DESKTOP_AGENT_RATE_LIMITED') {
              const retryAfterMs = resolveRetryDelayMs(error, intervalMs);
              rateLimitedUntil = Date.now() + retryAfterMs;
              logHeartbeatEvent('warn', 'heartbeat.rate_limited', {
                retryAfterMs,
                requestLabel: error.requestLabel ?? null,
              });
              return;
            }

            logHeartbeatEvent('error', 'heartbeat.failed', {
              errorMessage: error?.message ?? 'Error desconocido',
            });
          });
      }, intervalMs);
    },

    stop() {
      if (!timer) {
        return;
      }

      clearInterval(timer);
      timer = null;
    },
  };
}

function resolveRetryDelayMs(error, fallbackDelayMs) {
  const retryAfterMs = Number(error?.retryAfterMs ?? NaN);
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return retryAfterMs;
  }

  return Math.max(250, fallbackDelayMs);
}

function logHeartbeatEvent(level, stage, payload) {
  const writer = typeof console[level] === 'function' ? console[level].bind(console) : console.warn.bind(console);
  writer(
    `[desktop-heartbeat] ${JSON.stringify({
      stage,
      timestamp: new Date().toISOString(),
      ...payload,
    })}`,
  );
}
