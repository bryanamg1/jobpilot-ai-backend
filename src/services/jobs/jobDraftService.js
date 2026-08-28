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
      const startedAt = Date.now();
      const jobAnalysis = await repository.getJobAnalysisById(jobId);
      if (!jobAnalysis) {
        throw new HttpError(404, 'Job analysis not found');
      }

      const candidateProfile =
        typeof repository.getCandidateProfile === 'function'
          ? await repository.getCandidateProfile()
          : null;

      logJobDraftEvent('draft.generation.started', {
        jobId,
      });
      const preview = await openAiDraftService.generateDraft(jobAnalysis, { candidateProfile });
      if (preview.generation?.fallbackReason === 'timeout') {
        logJobDraftEvent('draft.generation.timeout', {
          jobId,
          mode: preview.generation.mode,
          attemptCount: preview.generation.attemptCount ?? 0,
          durationMs: Date.now() - startedAt,
          fallbackReason: preview.generation.fallbackReason,
        });
      } else if (
        preview.generation?.fallbackReason === 'blocked' ||
        preview.generation?.fallbackReason === 'not_recommended'
      ) {
        logJobDraftEvent('draft.generation.skipped', {
          jobId,
          mode: preview.generation.mode,
          attemptCount: preview.generation.attemptCount ?? 0,
          durationMs: Date.now() - startedAt,
          fallbackReason: preview.generation.fallbackReason,
        });
      } else if (preview.generation?.fallbackReason) {
        logJobDraftEvent('draft.generation.failed', {
          jobId,
          mode: preview.generation.mode,
          attemptCount: preview.generation.attemptCount ?? 0,
          durationMs: Date.now() - startedAt,
          fallbackReason: preview.generation.fallbackReason,
          errorName: preview.generation.error?.name ?? null,
          errorCode: preview.generation.error?.code ?? null,
          providerStatus: preview.generation.error?.providerStatus ?? null,
          failureType: preview.generation.error?.failureType ?? preview.generation.fallbackReason,
        });
      }
      logJobDraftEvent('draft.generation.completed', {
        jobId,
        mode: preview.generation?.mode ?? 'unknown',
        attemptCount: preview.generation?.attemptCount ?? 0,
        durationMs: Date.now() - startedAt,
        fallbackReason: preview.generation?.fallbackReason ?? null,
      });
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

function logJobDraftEvent(stage, payload) {
  console.info(
    `[job-draft-service] ${JSON.stringify({
      stage,
      timestamp: new Date().toISOString(),
      ...payload,
    })}`,
  );
}
