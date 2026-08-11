import { describe, expect, it, vi } from 'vitest';
import { createAutomationSchedulerService } from '../../src/services/automation/automationSchedulerService.js';

describe('automationSchedulerService', () => {
  it('runs a scheduled DRY_RUN cycle when the settings are due', async () => {
    const runScheduledCycle = vi.fn(async () => ({ id: 'run-1', status: 'COMPLETED' }));
    const settingsService = {
      async getSettings() {
        return {
          enabled: true,
          mode: 'DRY_RUN',
          timezone: 'America/Argentina/Buenos_Aires',
          startTime: '09:00',
          daysOfWeek: [3],
          lastTriggeredAt: null,
        };
      },
    };
    const scheduler = createAutomationSchedulerService(settingsService, { runScheduledCycle }, {
      nowFn: () => new Date('2026-08-05T12:30:00.000Z'),
    });

    const result = await scheduler.evaluate();

    expect(runScheduledCycle).toHaveBeenCalledTimes(1);
    expect(runScheduledCycle).toHaveBeenCalledWith({
      trigger: 'SCHEDULED',
      reason: 'Ciclo programado de simulacion segura',
    });
    expect(result).toEqual({ id: 'run-1', status: 'COMPLETED' });
  });

  it('does not run again on the same local day after a trigger was already recorded', async () => {
    const runScheduledCycle = vi.fn(async () => ({ id: 'run-1', status: 'COMPLETED' }));
    const settingsService = {
      async getSettings() {
        return {
          enabled: true,
          mode: 'DRY_RUN',
          timezone: 'America/Argentina/Buenos_Aires',
          startTime: '09:00',
          daysOfWeek: [3],
          lastTriggeredAt: '2026-08-05T10:00:00.000Z',
        };
      },
    };
    const scheduler = createAutomationSchedulerService(settingsService, { runScheduledCycle }, {
      nowFn: () => new Date('2026-08-05T18:00:00.000Z'),
    });

    const result = await scheduler.evaluate();

    expect(runScheduledCycle).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('reports whether the scheduler is running', () => {
    const scheduler = createAutomationSchedulerService(
      { getSettings: vi.fn() },
      { runScheduledCycle: vi.fn() },
      { intervalMs: 15_000 },
    );

    expect(scheduler.getStatus()).toEqual({ running: false, intervalMs: 15_000, killSwitchEnabled: false });

    scheduler.start();

    expect(scheduler.getStatus()).toEqual({ running: true, intervalMs: 15_000, killSwitchEnabled: false });

    scheduler.stop();

    expect(scheduler.getStatus()).toEqual({ running: false, intervalMs: 15_000, killSwitchEnabled: false });
  });

  it('does not start or evaluate when the kill switch is enabled', async () => {
    const runScheduledCycle = vi.fn(async () => ({ id: 'run-1', status: 'COMPLETED' }));
    const scheduler = createAutomationSchedulerService(
      {
        getSettings: vi.fn(async () => ({
          enabled: true,
          mode: 'DRY_RUN',
          timezone: 'America/Argentina/Buenos_Aires',
          startTime: '09:00',
          daysOfWeek: [5],
          lastTriggeredAt: null,
        })),
      },
      { runScheduledCycle },
      {
        intervalMs: 15_000,
        killSwitchEnabled: true,
      },
    );

    scheduler.start();
    const result = await scheduler.evaluate();

    expect(scheduler.getStatus()).toEqual({ running: false, intervalMs: 15_000, killSwitchEnabled: true });
    expect(runScheduledCycle).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
