import {
  createCandidateProfile,
  defaultCandidateProfileInput,
} from '../domain/candidateProfile.js';

export const defaultCandidateProfile = createCandidateProfile(
  defaultCandidateProfileInput,
  {
    source: 'candidate_profile_seed',
  },
);
