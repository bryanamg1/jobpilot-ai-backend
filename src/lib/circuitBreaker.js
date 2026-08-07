export class CircuitBreakerOpenError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.code = 'CIRCUIT_OPEN';
    this.details = details;
  }
}

export function createCircuitBreaker(name, options = {}) {
  const failureThreshold = Math.max(1, options.failureThreshold ?? 3);
  const cooldownMs = Math.max(0, options.cooldownMs ?? 30_000);

  let state = 'closed';
  let consecutiveFailures = 0;
  let openedAt = null;
  let lastError = null;

  return {
    async execute(operation) {
      const now = Date.now();

      if (state === 'open') {
        if (openedAt !== null && now - openedAt >= cooldownMs) {
          state = 'half_open';
        } else {
          throw new CircuitBreakerOpenError(`Circuit ${name} is open`, {
            state,
            openedAt,
            retryAfterMs: openedAt === null ? cooldownMs : Math.max(0, cooldownMs - (now - openedAt)),
          });
        }
      }

      try {
        const result = await operation();
        state = 'closed';
        consecutiveFailures = 0;
        openedAt = null;
        return result;
      } catch (error) {
        consecutiveFailures += 1;
        lastError = {
          name: error?.name ?? 'Error',
          message: error?.message ?? 'Unknown error',
          recordedAt: new Date().toISOString(),
        };

        if (state === 'half_open' || consecutiveFailures >= failureThreshold) {
          state = 'open';
          openedAt = Date.now();
        }

        throw error;
      }
    },

    getSnapshot() {
      return {
        name,
        state,
        failureThreshold,
        cooldownMs,
        consecutiveFailures,
        openedAt: openedAt ? new Date(openedAt).toISOString() : null,
        lastError,
      };
    },
  };
}
