export function createProfileService(repository) {
  return {
    async getProfile() {
      return repository.getCandidateProfile();
    },
  };
}
