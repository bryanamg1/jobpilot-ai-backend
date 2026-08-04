export function createHealthService(repository) {
  return {
    async getStatus() {
      const dependency = await repository.ping();

      return {
        status: dependency.status === 'ok' ? 'ok' : 'degraded',
        storageMode: repository.mode,
        dependencies: {
          storage: dependency,
        },
        timestamp: new Date().toISOString(),
      };
    },
  };
}
