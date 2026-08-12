export function createHeartbeat(client, options = {}) {
  const intervalMs = options.intervalMs ?? 30_000;
  let timer = null;

  return {
    start(getPayload) {
      if (timer) {
        return;
      }

      timer = setInterval(() => {
        Promise.resolve(getPayload()).then((payload) => client.heartbeat(payload)).catch(() => {});
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
