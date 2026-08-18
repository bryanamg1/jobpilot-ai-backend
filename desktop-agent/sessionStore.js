export function createSessionStore(runtime) {
  const sessions = new Map();

  return {
    async startSession(input) {
      const result = await runtime.startSession(input);
      sessions.set(input.sessionId, result.handle);
      return result;
    },

    async navigate(sessionId, url) {
      return runtime.navigate(requireHandle(sessions, sessionId), url);
    },

    async getSnapshot(sessionId, options = {}) {
      return runtime.getSnapshot(requireHandle(sessions, sessionId), options);
    },

    async closeSession(sessionId) {
      const handle = requireHandle(sessions, sessionId);
      await runtime.close(handle);
      sessions.delete(sessionId);
    },
  };
}

function requireHandle(store, sessionId) {
  const handle = store.get(sessionId);
  if (!handle) {
    throw new Error(`No existe una sesion local activa para ${sessionId}.`);
  }
  return handle;
}
