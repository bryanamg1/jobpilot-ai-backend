import { getInMemoryRuntime } from './inMemoryRuntime.js';

export function createMemoryRepository() {
  const runtime = getInMemoryRuntime();

  return {
    mode: 'memory',
    async getCandidateProfile() {
      return runtime.profile;
    },
    async updateCandidateProfile(profile) {
      runtime.profile = structuredClone(profile);
      return runtime.profile;
    },
    async listResumes() {
      return runtime.resumes.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    async getResumeById(resumeId) {
      return runtime.resumes.find((entry) => entry.id === resumeId) ?? null;
    },
    async saveResume(record) {
      runtime.resumes.push(structuredClone(record));
      return record;
    },
    async getAutomationSettings() {
      return runtime.automationSettings ? structuredClone(runtime.automationSettings) : null;
    },
    async saveAutomationSettings(record) {
      runtime.automationSettings = structuredClone(record);
      return structuredClone(record);
    },
    async listApplications(filters = {}) {
      const items = runtime.applications
        .filter((entry) => matchApplicationFilters(entry, filters))
        .toSorted((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
      return items.slice(0, filters.limit ?? 50);
    },
    async findLatestApplicationByJobId(jobId) {
      const items = runtime.applications
        .filter((entry) => entry.jobOfferId === jobId)
        .toSorted((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
      return items[0] ?? null;
    },
    async saveApplication(record) {
      runtime.applications.push(structuredClone(record));
      return structuredClone(record);
    },
    async countCompletedApplicationsForDate(dateKey) {
      return runtime.applications.filter(
        (entry) => entry.status === 'COMPLETED' && entry.metadata?.dateKey === dateKey,
      ).length;
    },
    async listAgentRuns(filters = {}) {
      const items = runtime.agentRuns.toSorted((left, right) =>
        String(right.startedAt).localeCompare(String(left.startedAt)),
      );
      return items.slice(0, filters.limit ?? 20);
    },
    async saveAgentRun(record) {
      runtime.agentRuns.push(structuredClone(record));
      return structuredClone(record);
    },
    async updateAgentRun(record) {
      const index = runtime.agentRuns.findIndex((entry) => entry.id === record.id);
      if (index === -1) {
        return null;
      }
      runtime.agentRuns[index] = structuredClone(record);
      return structuredClone(runtime.agentRuns[index]);
    },
    async listDesktopAgents(filters = {}) {
      const items = runtime.desktopAgents.toSorted((left, right) =>
        String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')),
      );
      return items.slice(0, filters.limit ?? 20);
    },
    async getDesktopAgentById(agentId) {
      return runtime.desktopAgents.find((entry) => entry.id === agentId) ?? null;
    },
    async saveDesktopAgent(record) {
      runtime.desktopAgents.push(structuredClone(record));
      return structuredClone(record);
    },
    async updateDesktopAgent(record) {
      const index = runtime.desktopAgents.findIndex((entry) => entry.id === record.id);
      if (index === -1) {
        return null;
      }
      runtime.desktopAgents[index] = structuredClone(record);
      return structuredClone(runtime.desktopAgents[index]);
    },
    async saveBrowserJob(record) {
      runtime.browserJobs.push(structuredClone(record));
      return structuredClone(record);
    },
    async getBrowserJobById(jobId) {
      return runtime.browserJobs.find((entry) => entry.id === jobId) ?? null;
    },
    async updateBrowserJob(record) {
      const index = runtime.browserJobs.findIndex((entry) => entry.id === record.id);
      if (index === -1) {
        return null;
      }
      runtime.browserJobs[index] = structuredClone(record);
      return structuredClone(runtime.browserJobs[index]);
    },
    async claimNextBrowserJob(agentId) {
      const nextJob = runtime.browserJobs
        .filter((entry) => entry.status === 'PENDING')
        .toSorted((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))[0];

      if (!nextJob) {
        return null;
      }

      nextJob.status = 'CLAIMED';
      nextJob.agentId = agentId;
      nextJob.claimedAt = new Date().toISOString();
      nextJob.updatedAt = nextJob.claimedAt;
      return structuredClone(nextJob);
    },
    async listBrowserSessions() {
      return runtime.browserSessions.toSorted(compareBrowserSessions);
    },
    async getBrowserSessionById(sessionId) {
      return runtime.browserSessions.find((entry) => entry.id === sessionId) ?? null;
    },
    async saveBrowserSession(record) {
      runtime.browserSessions.push(structuredClone(record));
      return record;
    },
    async updateBrowserSession(record) {
      const index = runtime.browserSessions.findIndex((entry) => entry.id === record.id);
      if (index === -1) {
        return null;
      }
      runtime.browserSessions[index] = structuredClone(record);
      return runtime.browserSessions[index];
    },
    async listApprovalRequests(filters = {}) {
      return runtime.approvalRequests
        .filter((entry) => matchApprovalRequestFilters(entry, filters))
        .toSorted(compareApprovalRequests)
        .slice(0, filters.limit ?? 200);
    },
    async listApprovalRequestsByEntity(entityType, entityId) {
      return runtime.approvalRequests
        .filter((entry) => entry.entityType === entityType && entry.entityId === entityId)
        .toSorted(compareApprovalRequests);
    },
    async findApprovalRequest(entityType, entityId, approvalKind) {
      return (
        runtime.approvalRequests.find(
          (entry) =>
            entry.entityType === entityType &&
            entry.entityId === entityId &&
            entry.approvalKind === approvalKind,
        ) ?? null
      );
    },
    async getApprovalRequestById(requestId) {
      return runtime.approvalRequests.find((entry) => entry.id === requestId) ?? null;
    },
    async saveApprovalRequest(record) {
      runtime.approvalRequests.push(structuredClone(record));
      return record;
    },
    async updateApprovalRequest(record) {
      const index = runtime.approvalRequests.findIndex((entry) => entry.id === record.id);
      if (index === -1) {
        return null;
      }
      runtime.approvalRequests[index] = structuredClone(record);
      return runtime.approvalRequests[index];
    },
    async listJobAnalyses() {
      return runtime.offers.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
    },
    async getJobAnalysisById(jobId) {
      return runtime.offers.find((entry) => entry.id === jobId) ?? null;
    },
    async updateJobAnalysis(record) {
      const index = runtime.offers.findIndex((entry) => entry.id === record.id);
      if (index === -1) {
        return null;
      }
      runtime.offers[index] = structuredClone(record);
      return runtime.offers[index];
    },
    async findByFingerprint(fingerprint) {
      return runtime.offers.find((entry) => entry.fingerprint === fingerprint) ?? null;
    },
    async saveJobAnalysis(record) {
      runtime.offers.push(record);
      return record;
    },
    async saveEmailDraft(record) {
      runtime.emailDrafts.push(record);
      return record;
    },
    async saveAuditEvent(event) {
      runtime.audits.push(event);
      return event;
    },
    async listAuditEvents(filters = {}) {
      return runtime.audits
        .filter((entry) => matchAuditEventFilters(entry, filters))
        .toSorted((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
        .slice(0, filters.limit ?? 50);
    },
    async getDashboardSummary() {
      const offers = await this.listJobAnalyses();
      const metrics = offers.reduce(
        (accumulator, entry) => {
          accumulator.total += 1;
          if (entry.match.status === 'READY_TO_PREPARE') {
            accumulator.readyToPrepare += 1;
          }
          if (entry.match.status === 'APPROVED') {
            accumulator.readyToPrepare += 1;
          }
          if (entry.match.status === 'AWAITING_APPROVAL') {
            accumulator.awaitingApproval += 1;
          }
          if (entry.match.excludedByRules.length || entry.match.status === 'REJECTED') {
            accumulator.blocked += 1;
          }
          return accumulator;
        },
        { total: 0, readyToPrepare: 0, awaitingApproval: 0, blocked: 0 },
      );

      return {
        storageMode: this.mode,
        metrics,
        latest: offers.slice(0, 10),
      };
    },
    async ping() {
      return {
        status: 'ok',
        mode: this.mode,
      };
    },
  };
}

function matchApprovalRequestFilters(entry, filters) {
  if (filters.entityId && entry.entityId !== filters.entityId) {
    return false;
  }

  if (filters.entityType && entry.entityType !== filters.entityType) {
    return false;
  }

  if (filters.approvalKind && entry.approvalKind !== filters.approvalKind) {
    return false;
  }

  if (filters.status && entry.status !== filters.status) {
    return false;
  }

  return true;
}

function matchAuditEventFilters(entry, filters) {
  if (filters.entityType && entry.entityType !== filters.entityType) {
    return false;
  }

  if (filters.entityId && entry.entityId !== filters.entityId) {
    return false;
  }

  if (filters.eventName && entry.eventName !== filters.eventName) {
    return false;
  }

  return true;
}

function matchApplicationFilters(entry, filters) {
  if (filters.jobOfferId && entry.jobOfferId !== filters.jobOfferId) {
    return false;
  }

  if (filters.status && entry.status !== filters.status) {
    return false;
  }

  return true;
}

function compareApprovalRequests(left, right) {
  const statusRank = statusPriority(left.status) - statusPriority(right.status);
  if (statusRank !== 0) {
    return statusRank;
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

function compareBrowserSessions(left, right) {
  const statusRank = browserSessionStatusPriority(left.status) - browserSessionStatusPriority(right.status);
  if (statusRank !== 0) {
    return statusRank;
  }

  return String(right.updatedAt).localeCompare(String(left.updatedAt));
}

function browserSessionStatusPriority(status) {
  if (status === 'ACTIVE') {
    return 0;
  }
  if (status === 'ATTENTION_REQUIRED') {
    return 1;
  }
  if (status === 'ERROR') {
    return 2;
  }
  return 3;
}

function statusPriority(status) {
  if (status === 'PENDING') {
    return 0;
  }
  if (status === 'REJECTED') {
    return 1;
  }
  return 2;
}
