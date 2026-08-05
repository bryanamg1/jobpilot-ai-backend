import { randomUUID } from 'node:crypto';
import { buildOfferFingerprint } from '../../lib/fingerprint.js';
import { HttpError } from '../../lib/httpError.js';
import { evaluateGuardrails } from '../guardrails/guardrailService.js';
import { matchJobOffer } from '../matching/matchJobOffer.js';
import { normalizeTechnology, parseManualJob } from '../manualIntake/manualJobParser.js';
import { createOpenAiEnrichmentService } from '../openai/openAiEnrichmentService.js';

export function createJobOfferService(repository, auditService, options = {}) {
  const openAiEnrichmentService =
    options.openAiEnrichmentService ?? createOpenAiEnrichmentService();

  return {
    async createFromManualInput(input) {
      const profile = await repository.getCandidateProfile();
      const deterministicParse = parseManualJob(input);
      const enrichmentResult = await openAiEnrichmentService.enrichManualJob(input, deterministicParse);
      const parsed = mergeParsedOffer(deterministicParse, enrichmentResult);
      const fingerprint = buildOfferFingerprint({
        title: parsed.jobOffer.title,
        company: parsed.jobOffer.company,
        contactEmail: parsed.jobOffer.recruiterEmail,
        sourceUrl: parsed.source.originalUrl,
      });

      const duplicate = await repository.findByFingerprint(fingerprint);
      if (duplicate) {
        throw new HttpError(409, 'A matching offer already exists', {
          duplicateId: duplicate.id,
        });
      }

      const guardrails = evaluateGuardrails(parsed, profile);
      const match = matchJobOffer(profile, parsed, guardrails);

      const record = {
        id: randomUUID(),
        matchId: randomUUID(),
        fingerprint,
        createdAt: new Date().toISOString(),
        source: {
          id: randomUUID(),
          ...parsed.source,
        },
        profile: {
          id: profile.id,
          name: profile.name,
          englishLevel: profile.englishLevel,
          modalities: profile.modalities,
        },
        analysis: {
          extraction: {
            mode: enrichmentResult.mode,
            provider: enrichmentResult.provider,
            model: enrichmentResult.model,
            warnings: enrichmentResult.warnings,
          },
          guardrails: {
            approvalsRequired: guardrails.approvals.length,
            blockedRules: guardrails.blocked.length,
            requiresHumanReview: Boolean(guardrails.approvals.length || guardrails.blocked.length),
          },
        },
        jobOffer: parsed.jobOffer,
        match: {
          ...match,
          approvals: guardrails.approvals,
          blocked: guardrails.blocked,
        },
      };

      const saved = await repository.saveJobAnalysis(record);
      await auditService.record('job_offer.created_manual', 'job_offer', saved.id, {
        source: saved.source.type,
        status: saved.match.status,
        score: saved.match.score,
        extractionMode: saved.analysis.extraction.mode,
      });

      return saved;
    },
    async list() {
      return repository.listJobAnalyses();
    },
    async getById(jobId) {
      return repository.getJobAnalysisById(jobId);
    },
    async listAwaitingApproval() {
      const jobs = await repository.listJobAnalyses();
      return jobs.filter((job) => job.match.status === 'AWAITING_APPROVAL');
    },
  };
}

function mergeParsedOffer(parsedOffer, enrichmentResult) {
  if (!enrichmentResult?.applied || !enrichmentResult.extracted) {
    return parsedOffer;
  }

  const extracted = enrichmentResult.extracted;
  const merged = structuredClone(parsedOffer);

  merged.jobOffer.title = chooseScalar(merged.jobOffer.title, extracted.title, isPlaceholder(merged.jobOffer.title));
  merged.jobOffer.company = chooseScalar(
    merged.jobOffer.company,
    extracted.company,
    isPlaceholder(merged.jobOffer.company),
  );
  merged.jobOffer.location = chooseScalar(merged.jobOffer.location, extracted.location, !merged.jobOffer.location);
  merged.jobOffer.recruiterEmail = chooseScalar(
    merged.jobOffer.recruiterEmail,
    extracted.recruiterEmail,
    !merged.jobOffer.recruiterEmail,
  );
  merged.jobOffer.modality = mergeStringArrays(merged.jobOffer.modality, extracted.modality);
  merged.jobOffer.seniority = chooseKnownValue(merged.jobOffer.seniority, extracted.seniority);
  merged.jobOffer.englishRequirement = chooseKnownValue(
    merged.jobOffer.englishRequirement,
    extracted.englishRequirement,
  );
  merged.jobOffer.technologies = mergeStringArrays(
    merged.jobOffer.technologies,
    extracted.technologies.map(normalizeTechnology),
  );
  merged.jobOffer.requirements = mergeStringArrays(merged.jobOffer.requirements, extracted.requirements).slice(0, 12);
  merged.jobOffer.instructions = mergeStringArrays(merged.jobOffer.instructions, extracted.instructions).slice(0, 12);
  merged.jobOffer.salary = merged.jobOffer.salary ?? extracted.salary ?? null;
  merged.jobOffer.flags = mergeFlags(merged.jobOffer.flags, extracted.flags);
  merged.jobOffer.certaintyMap = mergeCertaintyMap(merged.jobOffer.certaintyMap, extracted.certaintyMap);
  merged.jobOffer.analysisSummary = extracted.summary ?? null;

  return merged;
}

function chooseScalar(currentValue, nextValue, shouldReplace) {
  if (!shouldReplace) {
    return currentValue;
  }

  return hasValue(nextValue) ? nextValue.trim() : currentValue;
}

function chooseKnownValue(currentValue, nextValue) {
  if (currentValue && currentValue !== 'unknown') {
    return currentValue;
  }

  return nextValue && nextValue !== 'unknown' ? nextValue : currentValue;
}

function mergeStringArrays(baseValues = [], nextValues = []) {
  return [
    ...new Set(
      [...baseValues, ...nextValues]
        .map((entry) => String(entry).trim())
        .filter(Boolean),
    ),
  ];
}

function mergeFlags(baseFlags, nextFlags) {
  return Object.fromEntries(
    [...new Set([...Object.keys(baseFlags), ...Object.keys(nextFlags)])].map((key) => [
      key,
      Boolean(baseFlags[key] || nextFlags[key]),
    ]),
  );
}

function mergeCertaintyMap(baseFacts = [], nextFacts = []) {
  return [...baseFacts, ...nextFacts].filter(
    (entry, index, list) =>
      index ===
      list.findIndex(
        (candidate) =>
          candidate.field === entry.field &&
          candidate.value === entry.value &&
          candidate.certainty === entry.certainty &&
          candidate.source === entry.source,
      ),
  );
}

function isPlaceholder(value) {
  return !value || /^unknown\b/i.test(String(value).trim());
}

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
