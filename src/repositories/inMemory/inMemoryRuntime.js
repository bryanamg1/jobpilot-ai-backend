import { defaultCandidateProfile } from '../../config/candidateProfileSeed.js';

const runtime = {
  profile: structuredClone(defaultCandidateProfile),
  offers: [],
  audits: [],
};

export function getInMemoryRuntime() {
  return runtime;
}
