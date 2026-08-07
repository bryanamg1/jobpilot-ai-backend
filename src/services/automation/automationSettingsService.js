import { randomUUID } from 'node:crypto';
import {
  AUTOMATION_MODE,
  AUTOMATION_SETTINGS_ID,
  DEFAULT_AUTOMATION_SETTINGS,
} from '../../constants/automation.js';
import { HttpError } from '../../lib/httpError.js';

export function createAutomationSettingsService(repository, auditService) {
  return {
    async getSettings() {
      const settings = await repository.getAutomationSettings();
      if (settings) {
        return settings;
      }

      const defaultSettings = createDefaultSettingsRecord();
      return repository.saveAutomationSettings(defaultSettings);
    },

    async updateSettings(input) {
      const current = (await repository.getAutomationSettings()) ?? createDefaultSettingsRecord();
      validateRequestedMode(input.mode);

      const next = {
        ...current,
        ...structuredClone(input),
        id: AUTOMATION_SETTINGS_ID,
        version: Number(current.version ?? 0) + 1,
        createdAt: current.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastTriggeredAt: current.lastTriggeredAt ?? null,
      };

      const saved = await repository.saveAutomationSettings(next);
      await auditService.record('automation.settings_updated', 'automation_settings', saved.id, {
        enabled: saved.enabled,
        mode: saved.mode,
        dailyApplicationLimit: saved.dailyApplicationLimit,
        dailyDiscoveryLimit: saved.dailyDiscoveryLimit,
        minimumMatchScore: saved.minimumMatchScore,
      });

      return saved;
    },

    async markTriggered(metadata = {}) {
      const current = await this.getSettings();
      const next = {
        ...current,
        lastTriggeredAt: metadata.triggeredAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return repository.saveAutomationSettings(next);
    },
  };
}

function createDefaultSettingsRecord() {
  const now = new Date().toISOString();
  return {
    ...structuredClone(DEFAULT_AUTOMATION_SETTINGS),
    id: AUTOMATION_SETTINGS_ID,
    createdAt: now,
    updatedAt: now,
    requestNonce: randomUUID(),
  };
}

function validateRequestedMode(mode) {
  if (mode === AUTOMATION_MODE.AUTOMATIC) {
    throw new HttpError(409, 'AUTOMATIC mode is not enabled in Phase 9', {
      supportedModes: [AUTOMATION_MODE.MANUAL, AUTOMATION_MODE.ASSISTED, AUTOMATION_MODE.DRY_RUN],
    });
  }
}
