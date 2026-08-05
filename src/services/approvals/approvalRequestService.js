import { randomUUID } from 'node:crypto';
import {
  APPROVAL_REQUEST_KIND,
  APPROVAL_REQUEST_STATUS,
  GUARDRail_FIELD_TO_APPROVAL_KIND,
  SUPPORTED_APPROVAL_KINDS,
} from '../../constants/approvalRequests.js';
import { HttpError } from '../../lib/httpError.js';

const USAGE_STATUS = {
  REFERENCE_ONLY: 'REFERENCE_ONLY',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  DO_NOT_USE: 'DO_NOT_USE',
};

export function createApprovalRequestService(repository, auditService) {
  return {
    async syncForJob(jobAnalysis) {
      const relevantApprovals = (jobAnalysis.match?.approvals ?? [])
        .map((entry) => ({
          ...entry,
          approvalKind: GUARDRail_FIELD_TO_APPROVAL_KIND[entry.field],
        }))
        .filter((entry) => entry.approvalKind && SUPPORTED_APPROVAL_KINDS.has(entry.approvalKind));

      const created = [];

      for (const approval of relevantApprovals) {
        const existing = await repository.findApprovalRequest('job_offer', jobAnalysis.id, approval.approvalKind);
        if (existing) {
          continue;
        }

        const timestamp = new Date().toISOString();
        const record = {
          id: randomUUID(),
          entityType: 'job_offer',
          entityId: jobAnalysis.id,
          approvalKind: approval.approvalKind,
          status: APPROVAL_REQUEST_STATUS.PENDING,
          payload: {
            field: approval.field,
            certainty: approval.certainty,
            reason: approval.reason,
            note: null,
            decision: null,
            decidedAt: null,
            jobId: jobAnalysis.id,
            jobTitle: jobAnalysis.jobOffer.title,
            company: jobAnalysis.jobOffer.company,
            sourceUrl: jobAnalysis.source.originalUrl,
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        const saved = await repository.saveApprovalRequest(record);
        created.push(saved);

        await auditService.record('approval_request.created', 'job_offer', jobAnalysis.id, {
          requestId: saved.id,
          approvalKind: saved.approvalKind,
          reason: approval.reason,
        });
      }

      return created;
    },

    async listRequests(filters = {}) {
      const approvals = await repository.listApprovalRequests(filters);
      return approvals.filter((entry) => matchesApprovalFilters(entry, filters));
    },

    async listRequestsForJob(jobId) {
      return repository.listApprovalRequestsByEntity('job_offer', jobId);
    },

    async approve(requestId, input) {
      return updateRequestDecision(repository, auditService, requestId, input.note, APPROVAL_REQUEST_STATUS.APPROVED);
    },

    async reject(requestId, input) {
      return updateRequestDecision(repository, auditService, requestId, input.note, APPROVAL_REQUEST_STATUS.REJECTED);
    },

    decorateSuggestions(suggestedAnswers, approvalRequests) {
      const approvalByKind = new Map(approvalRequests.map((entry) => [entry.approvalKind, entry]));

      return suggestedAnswers.map((item) => {
        const approvalRequest = approvalByKind.get(item.kind) ?? null;
        const approvalStatus = approvalRequest?.status ?? null;

        return {
          ...item,
          approvalRequestId: approvalRequest?.id ?? null,
          approvalStatus,
          usageStatus: resolveUsageStatus(item.certainty, approvalStatus),
        };
      });
    },

    summarizeRequests(approvalRequests) {
      return {
        all: approvalRequests,
        pending: approvalRequests.filter((entry) => entry.status === APPROVAL_REQUEST_STATUS.PENDING),
        rejected: approvalRequests.filter((entry) => entry.status === APPROVAL_REQUEST_STATUS.REJECTED),
        approved: approvalRequests.filter((entry) => entry.status === APPROVAL_REQUEST_STATUS.APPROVED),
      };
    },
  };
}

function matchesApprovalFilters(entry, filters) {
  if (filters.entityId && entry.entityId !== filters.entityId) {
    return false;
  }

  if (filters.entityType && entry.entityType !== filters.entityType) {
    return false;
  }

  if (filters.approvalKind && entry.approvalKind !== filters.approvalKind) {
    return false;
  }

  if (filters.status && entry.status !== filters.status) {
    return false;
  }

  if (filters.search) {
    const searchableText = [
      entry.approvalKind,
      entry.payload?.jobTitle,
      entry.payload?.company,
      entry.payload?.reason,
      entry.payload?.sourceUrl,
      entry.payload?.note,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (!searchableText.includes(String(filters.search).trim().toLowerCase())) {
      return false;
    }
  }

  return true;
}

async function updateRequestDecision(repository, auditService, requestId, note, nextStatus) {
  const record = await repository.getApprovalRequestById(requestId);
  if (!record) {
    throw new HttpError(404, 'Approval request not found');
  }

  if (record.status === nextStatus) {
    return record;
  }

  const updated = {
    ...structuredClone(record),
    status: nextStatus,
    payload: {
      ...structuredClone(record.payload ?? {}),
      note: note || null,
      decision: nextStatus === APPROVAL_REQUEST_STATUS.APPROVED ? 'approved' : 'rejected',
      decidedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  const saved = await repository.updateApprovalRequest(updated);
  await auditService.record(
    nextStatus === APPROVAL_REQUEST_STATUS.APPROVED
      ? 'approval_request.approved'
      : 'approval_request.rejected',
    record.entityType,
    record.entityId,
    {
      requestId: saved.id,
      approvalKind: saved.approvalKind,
      note: note || null,
    },
  );

  return saved;
}

function resolveUsageStatus(certainty, approvalStatus) {
  if (certainty === 'CONFIRMED' || certainty === 'INFERRED') {
    return USAGE_STATUS.REFERENCE_ONLY;
  }

  if (certainty === 'REQUIRES_APPROVAL') {
    if (approvalStatus === APPROVAL_REQUEST_STATUS.APPROVED) {
      return USAGE_STATUS.REFERENCE_ONLY;
    }
    if (approvalStatus === APPROVAL_REQUEST_STATUS.REJECTED) {
      return USAGE_STATUS.DO_NOT_USE;
    }
    return USAGE_STATUS.REVIEW_REQUIRED;
  }

  return USAGE_STATUS.DO_NOT_USE;
}

export function mapGuardrailFieldToApprovalKind(field) {
  return GUARDRail_FIELD_TO_APPROVAL_KIND[field] ?? null;
}

export function isSensitiveApprovalKind(kind) {
  return SUPPORTED_APPROVAL_KINDS.has(kind);
}

export { APPROVAL_REQUEST_KIND, APPROVAL_REQUEST_STATUS };
