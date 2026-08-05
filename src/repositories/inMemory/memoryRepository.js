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
