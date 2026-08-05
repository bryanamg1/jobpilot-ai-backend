function defaultShouldRetry() {
  return true;
}

function wait(delayMs) {
  if (!delayMs) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export async function retryOperation(operation, options = {}) {
  const attempts = Math.max(1, options.attempts ?? 1);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 0);
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;

      if (attempt >= attempts || !shouldRetry(error, attempt)) {
        throw error;
      }

      await wait(baseDelayMs * attempt);
    }
  }

  throw lastError;
}
