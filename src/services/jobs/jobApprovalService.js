import { JOB_STATUS } from '../../constants/jobStatus.js';
import { HttpError } from '../../lib/httpError.js';

export function createJobApprovalService(repository, auditService) {
  return {
    async approve(jobId, input) {
      const record = await repository.getJobAnalysisById(jobId);
      if (!record) {
        throw new HttpError(404, 'Job analysis not found');
      }

      if (record.match.status !== JOB_STATUS.AWAITING_APPROVAL) {
        throw new HttpError(409, 'Solo puedes aprobar vacantes que esten esperando revision humana.', {
          currentStatus: record.match.status,
        });
      }

      const updated = buildReviewedRecord(record, JOB_STATUS.APPROVED, input.reason, 'approved');
      const saved = await repository.updateJobAnalysis(updated);

      await auditService.record('job_offer.approved', 'job_offer', jobId, {
        previousStatus: record.match.status,
        nextStatus: saved.match.status,
        reason: input.reason || null,
      });

      return saved;
    },

    async reject(jobId, input) {
      const record = await repository.getJobAnalysisById(jobId);
      if (!record) {
        throw new HttpError(404, 'Job analysis not found');
      }

      if (record.match.status !== JOB_STATUS.AWAITING_APPROVAL) {
        throw new HttpError(409, 'Solo puedes rechazar vacantes que esten esperando revision humana.', {
          currentStatus: record.match.status,
        });
      }

      const updated = buildReviewedRecord(record, JOB_STATUS.REJECTED, input.reason, 'rejected');
      const saved = await repository.updateJobAnalysis(updated);

      await auditService.record('job_offer.rejected_manual', 'job_offer', jobId, {
        previousStatus: record.match.status,
        nextStatus: saved.match.status,
        reason: input.reason || null,
      });

      return saved;
    },
  };
}

function buildReviewedRecord(record, status, reason, decision) {
  const next = structuredClone(record);

  next.match.status = status;
  next.analysis.guardrails.requiresHumanReview = false;
  next.analysis.review = {
    decision,
    decidedAt: new Date().toISOString(),
    reason: reason || null,
  };

  return next;
}
