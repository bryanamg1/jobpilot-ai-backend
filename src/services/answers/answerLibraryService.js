import { createAnswerLibraryEntry } from '../../domain/candidateProfile.js';
import { HttpError } from '../../lib/httpError.js';

const USAGE_STATUS = {
  REFERENCE_ONLY: 'REFERENCE_ONLY',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  DO_NOT_USE: 'DO_NOT_USE',
};

const KIND_REASON_MAP = {
  salaryExpectation: 'The offer mentions salary or asks for compensation expectations.',
  englishLevel: 'The offer includes an English requirement.',
  availability: 'The offer hints at availability or scheduling expectations.',
  workAuthorization: 'The offer references work authorization, visa or legal screening.',
  relocation: 'The offer mentions relocation.',
  travel: 'The offer mentions travel availability.',
  location: 'The offer includes location or modality context.',
  legalQuestions: 'The offer includes legal or compliance screening.',
};

export function createAnswerLibraryService(repository, auditService) {
  return {
    async listAnswers() {
      const profile = await repository.getCandidateProfile();
      return structuredClone(profile.answerLibrary ?? []);
    },

    async createAnswer(input) {
      const profile = await repository.getCandidateProfile();
      const answer = createAnswerLibraryEntry(input, {
        source: 'answer_library_create',
      });
      const nextProfile = {
        ...structuredClone(profile),
        answerLibrary: [...(profile.answerLibrary ?? []), answer],
      };

      await repository.updateCandidateProfile(nextProfile);
      await auditService.record('answer_library.created', 'candidate_profile', profile.id, {
        answerId: answer.id,
        kind: answer.kind,
        certainty: answer.certainty,
      });

      return answer;
    },

    async updateAnswer(answerId, input) {
      const profile = await repository.getCandidateProfile();
      const existing = (profile.answerLibrary ?? []).find((item) => item.id === answerId);
      if (!existing) {
        throw new HttpError(404, 'Answer library item not found');
      }

      const updated = createAnswerLibraryEntry(
        {
          ...existing,
          ...input,
        },
        {
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
          source: 'answer_library_update',
        },
      );

      const nextProfile = {
        ...structuredClone(profile),
        answerLibrary: (profile.answerLibrary ?? []).map((item) => (item.id === answerId ? updated : item)),
      };

      await repository.updateCandidateProfile(nextProfile);
      await auditService.record('answer_library.updated', 'candidate_profile', profile.id, {
        answerId: updated.id,
        kind: updated.kind,
        certainty: updated.certainty,
      });

      return updated;
    },

    async deleteAnswer(answerId) {
      const profile = await repository.getCandidateProfile();
      const existing = (profile.answerLibrary ?? []).find((item) => item.id === answerId);
      if (!existing) {
        throw new HttpError(404, 'Answer library item not found');
      }

      const nextProfile = {
        ...structuredClone(profile),
        answerLibrary: (profile.answerLibrary ?? []).filter((item) => item.id !== answerId),
      };

      await repository.updateCandidateProfile(nextProfile);
      await auditService.record('answer_library.deleted', 'candidate_profile', profile.id, {
        answerId,
        kind: existing.kind,
      });

      return {
        deleted: true,
        answerId,
      };
    },

    async getPreviewSuggestions(jobAnalysis) {
      const answers = await this.listAnswers();
      const signals = collectSignals(jobAnalysis);

      return answers
        .map((answer) => mapSuggestion(answer, signals, jobAnalysis))
        .filter(Boolean)
        .sort(sortSuggestions);
    },
  };
}

function collectSignals(jobAnalysis) {
  const reasons = new Map();
  const rawText = String(jobAnalysis.source?.originalText ?? '').toLowerCase();
  const title = String(jobAnalysis.jobOffer?.title ?? '').toLowerCase();
  const requirements = (jobAnalysis.jobOffer?.requirements ?? []).join(' ').toLowerCase();
  const approvals = new Set((jobAnalysis.match?.approvals ?? []).map((entry) => entry.field));
  const blocked = new Set((jobAnalysis.match?.blocked ?? []).map((entry) => entry.field));
  const flags = jobAnalysis.jobOffer?.flags ?? {};
  const englishRequirement = jobAnalysis.jobOffer?.englishRequirement ?? 'unknown';

  addReason(reasons, 'location', KIND_REASON_MAP.location, Boolean(jobAnalysis.jobOffer?.location || jobAnalysis.jobOffer?.modality?.length));
  addReason(
    reasons,
    'salaryExpectation',
    KIND_REASON_MAP.salaryExpectation,
    Boolean(jobAnalysis.jobOffer?.salary || flags.asksForSalary || approvals.has('salary')),
  );
  addReason(
    reasons,
    'englishLevel',
    KIND_REASON_MAP.englishLevel,
    englishRequirement !== 'unknown' || approvals.has('englishLevel') || blocked.has('englishRequirement'),
  );
  addReason(
    reasons,
    'availability',
    KIND_REASON_MAP.availability,
    flags.requiresImmediateAvailability || approvals.has('availabilityImmediate'),
  );
  addReason(
    reasons,
    'workAuthorization',
    KIND_REASON_MAP.workAuthorization,
    flags.requiresVisa || approvals.has('workAuthorization'),
  );
  addReason(
    reasons,
    'relocation',
    KIND_REASON_MAP.relocation,
    flags.requiresRelocation || approvals.has('relocation'),
  );
  addReason(
    reasons,
    'travel',
    KIND_REASON_MAP.travel,
    flags.requiresTravel || approvals.has('travel'),
  );
  addReason(
    reasons,
    'legalQuestions',
    KIND_REASON_MAP.legalQuestions,
    flags.legalQuestions || blocked.has('legalQuestions'),
  );

  return {
    reasons,
    searchableText: `${rawText} ${title} ${requirements}`.trim(),
  };
}

function addReason(map, kind, reason, shouldAdd) {
  if (!shouldAdd) {
    return;
  }

  const current = map.get(kind) ?? [];
  map.set(kind, [...current, reason]);
}

function mapSuggestion(answer, signals) {
  const reasons = signals.reasons.get(answer.kind) ?? matchCustomAnswer(answer, signals.searchableText);
  if (!reasons?.length) {
    return null;
  }

  return {
    id: answer.id,
    kind: answer.kind,
    question: answer.question,
    answer: answer.answer,
    certainty: answer.certainty,
    source: answer.source,
    tags: answer.tags,
    usageStatus: mapUsageStatus(answer.certainty),
    matchReason: reasons[0],
  };
}

function matchCustomAnswer(answer, searchableText) {
  if (answer.kind !== 'custom') {
    return [];
  }

  const keywords = [...answer.tags, answer.question]
    .map((entry) => String(entry).trim().toLowerCase())
    .filter((entry) => entry.length >= 3);

  const hit = keywords.find((keyword) => searchableText.includes(keyword));
  return hit ? [`Matched custom keyword: ${hit}`] : [];
}

function mapUsageStatus(certainty) {
  if (certainty === 'CONFIRMED' || certainty === 'INFERRED') {
    return USAGE_STATUS.REFERENCE_ONLY;
  }

  if (certainty === 'REQUIRES_APPROVAL') {
    return USAGE_STATUS.REVIEW_REQUIRED;
  }

  return USAGE_STATUS.DO_NOT_USE;
}

function sortSuggestions(left, right) {
  const scoreLeft = usagePriority(left.usageStatus);
  const scoreRight = usagePriority(right.usageStatus);
  if (scoreLeft !== scoreRight) {
    return scoreLeft - scoreRight;
  }

  return left.kind.localeCompare(right.kind);
}

function usagePriority(value) {
  if (value === USAGE_STATUS.REVIEW_REQUIRED) {
    return 0;
  }
  if (value === USAGE_STATUS.DO_NOT_USE) {
    return 1;
  }
  return 2;
}
