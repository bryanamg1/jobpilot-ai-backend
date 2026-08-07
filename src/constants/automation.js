export const AUTOMATION_SETTINGS_ID = 'default';

export const AUTOMATION_MODE = {
  MANUAL: 'MANUAL',
  ASSISTED: 'ASSISTED',
  AUTOMATIC: 'AUTOMATIC',
  DRY_RUN: 'DRY_RUN',
};

export const SOURCE_POLICY = {
  MANUAL_ONLY: 'MANUAL_ONLY',
  AUTO_DISCOVER: 'AUTO_DISCOVER',
  AUTO_PREPARE: 'AUTO_PREPARE',
  AUTO_FILL: 'AUTO_FILL',
  AUTO_SUBMIT_ALLOWED: 'AUTO_SUBMIT_ALLOWED',
};

export const APPLICATION_TRIGGER = {
  MANUAL: 'MANUAL',
  SCHEDULED: 'SCHEDULED',
};

export const APPLICATION_STATUS = {
  SCHEDULE_TRIGGERED: 'SCHEDULE_TRIGGERED',
  DISCOVERED: 'DISCOVERED',
  DEDUPLICATING: 'DEDUPLICATING',
  ELIGIBILITY_CHECK: 'ELIGIBILITY_CHECK',
  PREPARING_APPLICATION: 'PREPARING_APPLICATION',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  READY_TO_SUBMIT: 'READY_TO_SUBMIT',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  BLOCKED_BY_CONFIGURATION: 'BLOCKED_BY_CONFIGURATION',
  BLOCKED_BY_SOURCE_POLICY: 'BLOCKED_BY_SOURCE_POLICY',
  REJECTED_BY_RULES: 'REJECTED_BY_RULES',
  FAILED: 'FAILED',
};

export const AGENT_RUN_STATUS = {
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
};

export const DEFAULT_AUTOMATION_SETTINGS = {
  id: AUTOMATION_SETTINGS_ID,
  enabled: false,
  mode: AUTOMATION_MODE.DRY_RUN,
  timezone: 'America/Argentina/Buenos_Aires',
  dailyApplicationLimit: 5,
  dailyDiscoveryLimit: 25,
  minimumMatchScore: 75,
  requireHumanApproval: true,
  unknownQuestionPolicy: 'PAUSE',
  captchaPolicy: 'PAUSE',
  mfaPolicy: 'PAUSE',
  salaryRequiresApproval: true,
  startTime: '09:00',
  daysOfWeek: [1, 2, 3, 4, 5],
  version: 1,
  filters: {
    allowedSources: [
      'LINKEDIN_JOBS_SUPERVISED',
      'LINKEDIN_FEED_SUPERVISED',
      'LINKEDIN_POST_SEARCH_SUPERVISED',
    ],
    allowedRoles: [],
    allowedSeniorities: ['junior', 'unknown'],
    allowedWorkModes: ['remote', 'hybrid', 'onsite'],
    blockedCompanies: [],
    blockedKeywords: [],
  },
  sourcePolicies: {
    MANUAL: SOURCE_POLICY.MANUAL_ONLY,
    LINKEDIN_JOBS_SUPERVISED: SOURCE_POLICY.AUTO_PREPARE,
    LINKEDIN_FEED_SUPERVISED: SOURCE_POLICY.AUTO_PREPARE,
    LINKEDIN_POST_SEARCH_SUPERVISED: SOURCE_POLICY.AUTO_PREPARE,
  },
  lastTriggeredAt: null,
  createdAt: null,
  updatedAt: null,
};

