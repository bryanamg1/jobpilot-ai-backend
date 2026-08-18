import { HttpError } from '../../lib/httpError.js';
import { createAnswerLibraryService } from '../answers/answerLibraryService.js';
import { createApprovalRequestService } from '../approvals/approvalRequestService.js';
import { createOpenAiDraftService } from '../openai/openAiDraftService.js';

export function createJobDraftService(repository, auditService, options = {}) {
  const openAiDraftService = options.openAiDraftService ?? createOpenAiDraftService();
  const answerLibraryService =
    options.answerLibraryService ?? createAnswerLibraryService(repository, auditService);
  const approvalRequestService =
    options.approvalRequestService ?? createApprovalRequestService(repository, auditService);

  return {
    async createPreview(jobId) {
      const jobAnalysis = await repository.getJobAnalysisById(jobId);
      if (!jobAnalysis) {
        throw new HttpError(404, 'Job analysis not found');
      }

      const candidateProfile =
        typeof repository.getCandidateProfile === 'function'
          ? await repository.getCandidateProfile()
          : null;

      const preview = await openAiDraftService.generateDraft(jobAnalysis, { candidateProfile });
      const approvalRequests = await approvalRequestService.listRequestsForJob(jobId);
      const suggestedAnswers = approvalRequestService.decorateSuggestions(
        await answerLibraryService.getPreviewSuggestions(jobAnalysis),
        approvalRequests,
      );
      const approvalSummary = approvalRequestService.summarizeRequests(approvalRequests);

      await auditService.record('job_draft.preview_generated', 'job_offer', jobId, {
        status: preview.status,
        mode: preview.generation.mode,
        hasRecipient: Boolean(preview.recipient),
        suggestedAnswers: suggestedAnswers.length,
        pendingApprovals: approvalSummary.pending.length,
      });

      return {
        jobId,
        jobTitle: jobAnalysis.jobOffer.title,
        company: jobAnalysis.jobOffer.company,
        sourceUrl: jobAnalysis.source.originalUrl,
        matchStatus: jobAnalysis.match.status,
        score: jobAnalysis.match.score,
        selectedResume: jobAnalysis.resumeSelection ?? null,
        suggestedAnswers,
        approvalRequests,
        pendingApprovalRequests: approvalSummary.pending,
        rejectedApprovalRequests: approvalSummary.rejected,
        ...preview,
      };
    },
  };
}
