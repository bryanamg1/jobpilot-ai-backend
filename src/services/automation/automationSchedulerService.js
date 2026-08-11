import { AUTOMATION_MODE } from '../../constants/automation.js';
import { userFacingText } from '../../constants/userFacingText.js';

const DEFAULT_INTERVAL_MS = 60_000;

export function createAutomationSchedulerService(automationSettingsService, applicationRunnerService, options = {}) {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const nowFn = options.nowFn ?? (() => new Date());
  const killSwitchEnabled = Boolean(options.killSwitchEnabled);
  let timer = null;

  return {
    start() {
      if (timer || killSwitchEnabled) {
        return;
      }

      timer = setInterval(() => {
        this.evaluate().catch(() => {});
      }, intervalMs);
    },

    stop() {
      if (!timer) {
        return;
      }

      clearInterval(timer);
      timer = null;
    },

    async evaluate() {
      if (killSwitchEnabled) {
        return null;
      }

      const settings = await automationSettingsService.getSettings();
      if (!settings.enabled || settings.mode !== AUTOMATION_MODE.DRY_RUN) {
        return null;
      }

      if (!isDue(settings, nowFn())) {
        return null;
      }

      return applicationRunnerService.runScheduledCycle({
        trigger: 'SCHEDULED',
        reason: userFacingText.applicationRunner.scheduledCycle,
      });
    },

    getStatus() {
      return {
        running: Boolean(timer),
        intervalMs,
        killSwitchEnabled,
      };
    },
  };
}

function isDue(settings, now) {
  const localNow = toLocalParts(now, settings.timezone);
  if (!settings.daysOfWeek.includes(localNow.dayOfWeek)) {
    return false;
  }

  if (`${localNow.hours}:${localNow.minutes}` < settings.startTime) {
    return false;
  }

  if (!settings.lastTriggeredAt) {
    return true;
  }

  const lastLocal = toLocalParts(new Date(settings.lastTriggeredAt), settings.timezone);
  return localNow.date !== lastLocal.date;
}

function toLocalParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
    .formatToParts(date)
    .reduce((accumulator, item) => {
      if (item.type !== 'literal') {
        accumulator[item.type] = item.value;
      }
      return accumulator;
    }, {});

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hours: parts.hour,
    minutes: parts.minute,
    dayOfWeek: weekdayMap[parts.weekday] ?? 0,
  };
}

