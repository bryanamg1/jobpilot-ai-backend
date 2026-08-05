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
    async listApprovalRequests() {
      return runtime.approvalRequests.toSorted(compareApprovalRequests);
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

function compareApprovalRequests(left, right) {
  const statusRank = statusPriority(left.status) - statusPriority(right.status);
  if (statusRank !== 0) {
    return statusRank;
  }

  return right.updatedAt.localeCompare(left.updatedAt);
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
