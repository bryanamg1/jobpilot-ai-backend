import { randomUUID } from 'node:crypto';
import {
  AGENT_RUN_STATUS,
  APPLICATION_STATUS,
  APPLICATION_TRIGGER,
  AUTOMATION_MODE,
  DEFAULT_AUTOMATION_SETTINGS,
  SOURCE_POLICY,
} from '../../constants/automation.js';
import { JOB_STATUS } from '../../constants/jobStatus.js';
import { userFacingText } from '../../constants/userFacingText.js';
import { HttpError } from '../../lib/httpError.js';

export function createApplicationRunnerService(
  repository,
  auditService,
  jobDraftService,
  automationSettingsService,
) {
  return {
    async runJobDryRun(jobId, input = {}) {
      const jobAnalysis = await repository.getJobAnalysisById(jobId);
      if (!jobAnalysis) {
        throw new HttpError(404, 'Job analysis not found');
      }

      const settings = await automationSettingsService.getSettings();
      const sourceType = jobAnalysis.source?.type ?? 'MANUAL';
      const sourcePolicy = resolveSourcePolicy(settings, sourceType);
      const existing = await repository.findLatestApplicationByJobId(jobId);
      if (existing && !isTerminalApplicationStatus(existing.status)) {
        throw new HttpError(409, 'There is already an active application run for this job', {
          applicationId: existing.id,
          status: existing.status,
        });
      }

      const application = buildApplicationRecord(jobAnalysis, {
        mode: AUTOMATION_MODE.DRY_RUN,
        trigger: input.trigger ?? APPLICATION_TRIGGER.MANUAL,
        runId: input.runId ?? null,
        dateKey: buildDateKey(settings.timezone),
      });

      advanceApplication(application, APPLICATION_STATUS.DISCOVERED, 'Job selected for dry run');
      advanceApplication(application, APPLICATION_STATUS.DEDUPLICATING, 'Checking existing applications for duplicates');

      if (existing && isTerminalApplicationStatus(existing.status)) {
        advanceApplication(application, APPLICATION_STATUS.BLOCKED_BY_CONFIGURATION, 'Duplicate application already recorded');
        application.metadata.result = 'DUPLICATE';
        const saved = await repository.saveApplication(application);
        await recordApplicationAudit(auditService, saved, 'application.duplicate_detected');
        return saved;
      }

      if (input.trigger === APPLICATION_TRIGGER.SCHEDULED && sourcePolicy === SOURCE_POLICY.MANUAL_ONLY) {
        advanceApplication(application, APPLICATION_STATUS.BLOCKED_BY_SOURCE_POLICY, 'Source policy blocks automatic preparation');
        application.metadata.result = 'BLOCKED_BY_SOURCE_POLICY';
        const saved = await repository.saveApplication(application);
        await recordApplicationAudit(auditService, saved, 'application.blocked_source_policy');
        return saved;
      }

      advanceApplication(application, APPLICATION_STATUS.ELIGIBILITY_CHECK, 'Evaluating score, rules and automation filters');
      const eligibility = evaluateEligibility(jobAnalysis, settings);
      application.metadata.eligibility = eligibility;

      if (!eligibility.eligible) {
        advanceApplication(application, eligibility.status, eligibility.reason);
        application.metadata.result = eligibility.status;
        const saved = await repository.saveApplication(application);
        await recordApplicationAudit(auditService, saved, 'application.rejected_by_rules');
        return saved;
      }

      advanceApplication(application, APPLICATION_STATUS.PREPARING_APPLICATION, 'Generating preview, answers and resume selection');
      const preview = await jobDraftService.createPreview(jobId);
      const resumeSelection = await resolveResumeSelection(repository, jobAnalysis);
      application.metadata.preview = summarizePreview(preview);
      application.metadata.selectedResume = resumeSelection;

      if (!preview.recipient) {
        advanceApplication(application, APPLICATION_STATUS.BLOCKED_BY_CONFIGURATION, userFacingText.applicationRunner.recipientMissing);
        application.metadata.result = 'RECIPIENT_MISSING';
        const saved = await repository.saveApplication(application);
        await recordApplicationAudit(auditService, saved, 'application.blocked_missing_recipient');
        return saved;
      }

      if ((preview.pendingApprovalRequests ?? []).length || (preview.rejectedApprovalRequests ?? []).length) {
        advanceApplication(application, APPLICATION_STATUS.AWAITING_APPROVAL, 'Sensitive approvals must be resolved before dry-run completion');
        application.metadata.result = 'AWAITING_APPROVAL';
        const saved = await repository.saveApplication(application);
        await recordApplicationAudit(auditService, saved, 'application.awaiting_approval');
        return saved;
      }

      advanceApplication(application, APPLICATION_STATUS.READY_TO_SUBMIT, 'Dry-run produced a complete outbound preview');
      advanceApplication(application, APPLICATION_STATUS.VERIFYING, 'Recording dry-run evidence and simulated submission');
      advanceApplication(application, APPLICATION_STATUS.COMPLETED, 'Dry-run completed without sending a real application');
      application.metadata.result = 'COMPLETED';
      application.metadata.dryRunEvidence = {
        recipient: preview.recipient,
        subject: preview.subject,
        warningCount: preview.generation?.warnings?.length ?? 0,
        suggestedAnswers: preview.suggestedAnswers?.length ?? 0,
      };

      const saved = await repository.saveApplication(application);
      await recordApplicationAudit(auditService, saved, 'application.dry_run_completed');
      return saved;
    },

    async runScheduledCycle(input = {}) {
      const settings = await automationSettingsService.getSettings();
      const run = buildAgentRunRecord(settings, input.reason);
      await repository.saveAgentRun(run);
      await auditService.record('automation.run_started', 'agent_run', run.id, {
        trigger: input.trigger ?? APPLICATION_TRIGGER.SCHEDULED,
        mode: settings.mode,
      });

      try {
        if (!settings.enabled) {
          run.status = AGENT_RUN_STATUS.SKIPPED;
          run.finishedAt = new Date().toISOString();
          run.metadata.summary = { reason: 'Automation is disabled' };
          return repository.updateAgentRun(run);
        }

        if (settings.mode !== AUTOMATION_MODE.DRY_RUN) {
          throw new HttpError(409, 'Scheduled execution is limited to DRY_RUN in Phase 9', {
            mode: settings.mode,
          });
        }

        const allJobs = await repository.listJobAnalyses();
        const dailyCount = await repository.countCompletedApplicationsForDate(buildDateKey(settings.timezone));
        const remainingSlots = Math.max(0, settings.dailyApplicationLimit - dailyCount);

        run.metadata.discoveredJobs = allJobs.length;
        run.metadata.dailyCompletedBeforeRun = dailyCount;
        run.metadata.remainingSlots = remainingSlots;

        if (remainingSlots === 0) {
          run.status = AGENT_RUN_STATUS.SKIPPED;
          run.finishedAt = new Date().toISOString();
          run.metadata.summary = { reason: 'Daily application limit already reached' };
          const saved = await repository.updateAgentRun(run);
          await automationSettingsService.markTriggered({ triggeredAt: run.finishedAt });
          return saved;
        }

        const candidates = selectEligibleJobsForBatch(allJobs, settings).slice(
          0,
          Math.min(settings.dailyDiscoveryLimit, remainingSlots),
        );

        run.metadata.candidateJobIds = candidates.map((job) => job.id);
        run.metadata.processed = [];

        for (const job of candidates) {
          const application = await this.runJobDryRun(job.id, {
            trigger: APPLICATION_TRIGGER.SCHEDULED,
            runId: run.id,
          });
          run.metadata.processed.push({
            jobId: job.id,
            applicationId: application.id,
            status: application.status,
            result: application.metadata?.result ?? null,
          });
        }

        run.status = AGENT_RUN_STATUS.COMPLETED;
        run.finishedAt = new Date().toISOString();
        run.metadata.summary = summarizeRun(run.metadata.processed);
        const saved = await repository.updateAgentRun(run);
        await automationSettingsService.markTriggered({ triggeredAt: run.finishedAt });
        await auditService.record('automation.run_completed', 'agent_run', saved.id, saved.metadata.summary);
        return saved;
      } catch (error) {
        run.status = AGENT_RUN_STATUS.FAILED;
        run.finishedAt = new Date().toISOString();
        run.metadata.summary = {
          error: error.message,
        };
        const saved = await repository.updateAgentRun(run);
        await auditService.record('automation.run_failed', 'agent_run', saved.id, {
          message: error.message,
        });
        throw error;
      }
    },
  };
}

function buildApplicationRecord(jobAnalysis, options) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    jobOfferId: jobAnalysis.id,
    status: APPLICATION_STATUS.SCHEDULE_TRIGGERED,
    submittedAt: null,
    createdAt: now,
    updatedAt: now,
    mode: options.mode,
    trigger: options.trigger,
    metadata: {
      dryRun: true,
      runId: options.runId ?? null,
      jobTitle: jobAnalysis.jobOffer.title,
      company: jobAnalysis.jobOffer.company,
      sourceType: jobAnalysis.source?.type ?? 'MANUAL',
      sourceLabel: jobAnalysis.source?.label ?? 'Unknown source',
      sourceUrl: jobAnalysis.source?.originalUrl ?? null,
      score: jobAnalysis.match.score,
      matchStatus: jobAnalysis.match.status,
      dateKey: options.dateKey,
      timeline: [
        {
          status: APPLICATION_STATUS.SCHEDULE_TRIGGERED,
          at: now,
          note: 'Application runner started',
        },
      ],
    },
  };
}

function buildAgentRunRecord(settings, reason) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    sourceType: 'AUTOMATION',
    status: AGENT_RUN_STATUS.STARTED,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    metadata: {
      reason: reason || null,
      mode: settings.mode,
      timezone: settings.timezone,
      settingsSnapshot: {
        enabled: settings.enabled,
        dailyApplicationLimit: settings.dailyApplicationLimit,
        dailyDiscoveryLimit: settings.dailyDiscoveryLimit,
        minimumMatchScore: settings.minimumMatchScore,
      },
    },
  };
}

function advanceApplication(application, status, note) {
  application.status = status;
  application.updatedAt = new Date().toISOString();
  application.metadata.timeline.push({
    status,
    at: application.updatedAt,
    note,
  });
}

function evaluateEligibility(jobAnalysis, settings) {
  if (
    jobAnalysis.match.status === JOB_STATUS.REJECTED_BY_RULES ||
    jobAnalysis.match.status === JOB_STATUS.REJECTED
  ) {
    return {
      eligible: false,
      status: APPLICATION_STATUS.REJECTED_BY_RULES,
      reason: 'Job was already rejected by rules or manual review',
    };
  }

  if (jobAnalysis.match.score < settings.minimumMatchScore) {
    return {
      eligible: false,
      status: APPLICATION_STATUS.BLOCKED_BY_CONFIGURATION,
      reason: `Job score ${jobAnalysis.match.score} is below the automation minimum`,
    };
  }

  const company = String(jobAnalysis.jobOffer.company ?? '').trim().toLowerCase();
  if (settings.filters.blockedCompanies.some((item) => company === item.toLowerCase())) {
    return {
      eligible: false,
      status: APPLICATION_STATUS.BLOCKED_BY_CONFIGURATION,
      reason: 'Company is blocked by automation settings',
    };
  }

  const title = `${jobAnalysis.jobOffer.title} ${jobAnalysis.jobOffer.requirements.join(' ')}`.toLowerCase();
  if (settings.filters.blockedKeywords.some((item) => title.includes(item.toLowerCase()))) {
    return {
      eligible: false,
      status: APPLICATION_STATUS.BLOCKED_BY_CONFIGURATION,
      reason: 'Job contains blocked keywords',
    };
  }

  return {
    eligible: true,
    status: APPLICATION_STATUS.ELIGIBILITY_CHECK,
    reason: 'Job passed automation filters',
  };
}

async function resolveResumeSelection(repository, jobAnalysis) {
  if (jobAnalysis.resumeSelection) {
    return jobAnalysis.resumeSelection;
  }

  const resumes = (await repository.listResumes?.()) ?? [];
  if (!resumes.length) {
    return null;
  }

  const lowerTitle = String(jobAnalysis.jobOffer.title ?? '').toLowerCase();
  const matched =
    resumes.find((resume) => String(resume.label).toLowerCase().includes('backend') && lowerTitle.includes('backend')) ??
    resumes.find((resume) => String(resume.label).toLowerCase().includes('frontend') && lowerTitle.includes('frontend')) ??
    resumes[0];

  return {
    id: matched.id,
    label: matched.label,
    originalFileName: matched.metadata?.originalFileName ?? matched.originalFileName ?? null,
    mimeType: matched.metadata?.mimeType ?? matched.mimeType ?? null,
    extension: matched.metadata?.extension ?? matched.extension ?? null,
    sizeBytes: matched.metadata?.sizeBytes ?? matched.sizeBytes ?? null,
    uploadedAt: matched.metadata?.uploadedAt ?? matched.uploadedAt ?? matched.createdAt ?? null,
    checksumSha256: matched.metadata?.checksumSha256 ?? matched.checksumSha256 ?? null,
    attachmentStatus: matched.metadata?.attachmentStatus ?? matched.attachmentStatus ?? 'MANUAL_REQUIRED',
    selectedAt: new Date().toISOString(),
    autoSelected: true,
  };
}

function summarizePreview(preview) {
  return {
    status: preview.status,
    recipient: preview.recipient,
    subject: preview.subject,
    blockedReasons: preview.blockedReasons ?? [],
    approvalsRequired: preview.approvalsRequired ?? [],
    warnings: preview.generation?.warnings ?? [],
    suggestedAnswers: (preview.suggestedAnswers ?? []).map((item) => ({
      kind: item.kind,
      certainty: item.certainty,
      usageStatus: item.usageStatus,
    })),
  };
}

function selectEligibleJobsForBatch(jobs, settings) {
  return jobs.filter((job) => {
    const sourceType = job.source?.type ?? 'MANUAL';
    const sourcePolicy = resolveSourcePolicy(settings, sourceType);
    if (sourcePolicy === SOURCE_POLICY.MANUAL_ONLY) {
      return false;
    }

    if (settings.filters.allowedSources.length && !settings.filters.allowedSources.includes(sourceType)) {
      return false;
    }

    if (settings.filters.allowedWorkModes.length) {
      const modalities = job.jobOffer.modality ?? [];
      if (modalities.length && !modalities.some((item) => settings.filters.allowedWorkModes.includes(item))) {
        return false;
      }
    }

    if (settings.filters.allowedSeniorities.length) {
      const seniority = job.jobOffer.seniority ?? 'unknown';
      if (!settings.filters.allowedSeniorities.includes(seniority)) {
        return false;
      }
    }

    if (settings.filters.allowedRoles.length) {
      const title = String(job.jobOffer.title ?? '').toLowerCase();
      if (!settings.filters.allowedRoles.some((item) => title.includes(String(item).toLowerCase()))) {
        return false;
      }
    }

    return true;
  });
}

function resolveSourcePolicy(settings, sourceType) {
  return (
    settings.sourcePolicies[sourceType] ??
    DEFAULT_AUTOMATION_SETTINGS.sourcePolicies[sourceType] ??
    SOURCE_POLICY.MANUAL_ONLY
  );
}

function isTerminalApplicationStatus(status) {
  return [
    APPLICATION_STATUS.COMPLETED,
    APPLICATION_STATUS.BLOCKED_BY_CONFIGURATION,
    APPLICATION_STATUS.BLOCKED_BY_SOURCE_POLICY,
    APPLICATION_STATUS.REJECTED_BY_RULES,
    APPLICATION_STATUS.FAILED,
  ].includes(status);
}

function summarizeRun(processed = []) {
  return processed.reduce(
    (summary, item) => {
      summary.total += 1;
      if (item.status === APPLICATION_STATUS.COMPLETED) {
        summary.completed += 1;
      }
      if (item.status === APPLICATION_STATUS.AWAITING_APPROVAL) {
        summary.awaitingApproval += 1;
      }
      if (item.status === APPLICATION_STATUS.BLOCKED_BY_SOURCE_POLICY) {
        summary.blockedByPolicy += 1;
      }
      if (item.status === APPLICATION_STATUS.REJECTED_BY_RULES) {
        summary.rejectedByRules += 1;
      }
      return summary;
    },
    {
      total: 0,
      completed: 0,
      awaitingApproval: 0,
      blockedByPolicy: 0,
      rejectedByRules: 0,
    },
  );
}

async function recordApplicationAudit(auditService, application, eventName) {
  await auditService.record(eventName, 'application', application.id, {
    jobId: application.jobOfferId,
    status: application.status,
    result: application.metadata?.result ?? null,
    mode: application.mode,
    trigger: application.trigger,
  });
}

function buildDateKey(timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
