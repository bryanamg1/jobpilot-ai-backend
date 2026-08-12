import { defaultCandidateProfile } from '../../config/candidateProfileSeed.js';

const runtime = {
  profile: structuredClone(defaultCandidateProfile),
  resumes: [],
  offers: [],
  browserSessions: [],
  approvalRequests: [],
  emailDrafts: [],
  automationSettings: null,
  applications: [],
  agentRuns: [],
  desktopAgents: [],
  browserJobs: [],
  audits: [],
};

export function getInMemoryRuntime() {
  return runtime;
}
