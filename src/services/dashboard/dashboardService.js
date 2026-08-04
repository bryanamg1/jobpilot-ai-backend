export function createDashboardService(repository) {
  return {
    async getSummary() {
      return repository.getDashboardSummary();
    },
  };
}
