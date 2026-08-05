import { env } from '../config/env.js';
import { createCircuitBreaker } from './circuitBreaker.js';

export function createReliabilityRegistry(options = {}) {
  const config = options.config ?? env;
  const breakers = new Map();

  for (const name of ['openai', 'gmail', 'playwright']) {
    breakers.set(
      name,
      createCircuitBreaker(name, {
        failureThreshold: config.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
        cooldownMs: config.CIRCUIT_BREAKER_COOLDOWN_MS,
      }),
    );
  }

  return {
    getBreaker(name) {
      return breakers.get(name) ?? null;
    },

    getStatus() {
      return Object.fromEntries(
        [...breakers.entries()].map(([name, breaker]) => [name, breaker.getSnapshot()]),
      );
    },
  };
}
