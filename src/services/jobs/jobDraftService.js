import { HttpError } from '../../lib/httpError.js';
import { createOpenAiDraftService } from '../openai/openAiDraftService.js';

export function createJobDraftService(repository, auditService, options = {}) {
  const openAiDraftService = options.openAiDraftService ?? createOpenAiDraftService();

  return {
    async createPreview(jobId) {
      const jobAnalysis = await repository.getJobAnalysisById(jobId);
      if (!jobAnalysis) {
        throw new HttpError(404, 'Job analysis not found');
      }

      const preview = await openAiDraftService.generateDraft(jobAnalysis);

      await auditService.record('job_draft.preview_generated', 'job_offer', jobId, {
        status: preview.status,
        mode: preview.generation.mode,
        hasRecipient: Boolean(preview.recipient),
      });

      return {
        jobId,
        jobTitle: jobAnalysis.jobOffer.title,
        company: jobAnalysis.jobOffer.company,
        sourceUrl: jobAnalysis.source.originalUrl,
        matchStatus: jobAnalysis.match.status,
        score: jobAnalysis.match.score,
        ...preview,
      };
    },
  };
}
