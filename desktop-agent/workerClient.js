export function createWorkerClient(options) {
  const apiUrl = String(options.apiUrl).replace(/\/$/, '');
  const token = options.token;
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);

  if (!fetchFn) {
    throw new Error('Fetch no esta disponible para el Desktop Worker.');
  }

  return {
    async register(payload) {
      return request(fetchFn, `${apiUrl}/desktop-agent/register`, token, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    async heartbeat(payload) {
      return request(fetchFn, `${apiUrl}/desktop-agent/heartbeat`, token, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    async getNextJob(agentId) {
      return request(fetchFn, `${apiUrl}/desktop-agent/jobs/next?agentId=${encodeURIComponent(agentId)}`, token, {
        method: 'GET',
        allowNoContent: true,
      });
    },

    async reportResult(jobId, payload) {
      return request(fetchFn, `${apiUrl}/desktop-agent/jobs/${jobId}/result`, token, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    async reportError(jobId, payload) {
      return request(fetchFn, `${apiUrl}/desktop-agent/jobs/${jobId}/error`, token, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
  };
}

async function request(fetchFn, url, token, options) {
  const response = await fetchFn(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-desktop-agent-token': token,
    },
  });

  if (options.allowNoContent && response.status === 204) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Desktop Worker request failed: ${response.status}`);
  }

  const payload = await response.json();
  return payload.data;
}
