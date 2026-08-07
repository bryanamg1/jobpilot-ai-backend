export function createDashboardService(repository, options = {}) {
  const automationSettingsService = options.automationSettingsService ?? null;

  return {
    async getSummary() {
      const summary = await repository.getDashboardSummary();
      const settings =
        (await automationSettingsService?.getSettings?.()) ??
        (await repository.getAutomationSettings?.()) ??
        null;
      const applications = (await repository.listApplications?.({ limit: 10 })) ?? [];
      const agentRuns = (await repository.listAgentRuns?.({ limit: 10 })) ?? [];
      const dailyCompleted = settings
        ? await repository.countCompletedApplicationsForDate?.(buildDateKey(settings.timezone))
        : 0;

      return {
        ...summary,
        automation: {
          settings,
          dailyCompleted: Number(dailyCompleted ?? 0),
        },
        applications,
        agentRuns,
      };
    },
  };
}

function buildDateKey(timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
