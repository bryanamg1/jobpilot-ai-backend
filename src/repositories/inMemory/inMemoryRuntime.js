import { defaultCandidateProfile } from '../../config/candidateProfileSeed.js';

const runtime = {
  profile: structuredClone(defaultCandidateProfile),
  resumes: [],
  offers: [],
  browserSessions: [],
  approvalRequests: [],
  emailDrafts: [],
  audits: [],
};

export function getInMemoryRuntime() {
  return runtime;
}
