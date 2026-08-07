import { z } from 'zod';
import { AUTOMATION_MODE, SOURCE_POLICY } from '../constants/automation.js';

const sourcePolicyValues = Object.values(SOURCE_POLICY);
const automationModeValues = Object.values(AUTOMATION_MODE);

export const automationSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(automationModeValues),
  timezone: z.string().min(3).max(120),
  dailyApplicationLimit: z.coerce.number().int().min(1).max(100),
  dailyDiscoveryLimit: z.coerce.number().int().min(1).max(500),
  minimumMatchScore: z.coerce.number().int().min(0).max(100),
  requireHumanApproval: z.boolean(),
  unknownQuestionPolicy: z.string().trim().min(2).max(40),
  captchaPolicy: z.string().trim().min(2).max(40),
  mfaPolicy: z.string().trim().min(2).max(40),
  salaryRequiresApproval: z.boolean(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/u, 'Start time must use HH:MM format'),
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).min(1).max(7),
  filters: z.object({
    allowedSources: z.array(z.string().trim().min(1)).max(20),
    allowedRoles: z.array(z.string().trim().min(1)).max(30),
    allowedSeniorities: z.array(z.string().trim().min(1)).max(10),
    allowedWorkModes: z.array(z.string().trim().min(1)).max(10),
    blockedCompanies: z.array(z.string().trim().min(1)).max(50),
    blockedKeywords: z.array(z.string().trim().min(1)).max(50),
  }),
  sourcePolicies: z.record(z.string().trim().min(1), z.enum(sourcePolicyValues)),
});

export const automationRunTriggerSchema = z.object({
  reason: z.string().trim().max(200).optional().default(''),
});

export const jobDryRunParamsSchema = z.object({
  jobId: z.string().min(1, 'Job id is required'),
});

