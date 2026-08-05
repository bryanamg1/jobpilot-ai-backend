import { createCandidateProfile } from '../../domain/candidateProfile.js';

export function createProfileService(repository, auditService) {
  return {
    async getProfile() {
      return repository.getCandidateProfile();
    },
    async updateProfile(input) {
      const currentProfile = await repository.getCandidateProfile();
      const profile = createCandidateProfile(input, {
        id: currentProfile.id,
        source: 'candidate_profile_update',
      });
      const updatedProfile = await repository.updateCandidateProfile(profile);

      await auditService.record(
        'candidate_profile.updated',
        'candidate_profile',
        updatedProfile.id,
        {
          headlineTargets: updatedProfile.headlineTargets,
          modalities: updatedProfile.modalities,
          technologiesCount: updatedProfile.technologies.length,
        },
      );

      return updatedProfile;
    },
  };
}
