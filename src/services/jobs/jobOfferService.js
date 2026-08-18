import { randomUUID } from 'node:crypto';
import { buildOfferFingerprint } from '../../lib/fingerprint.js';
import { HttpError } from '../../lib/httpError.js';
import { createApprovalRequestService } from '../approvals/approvalRequestService.js';
import { evaluateGuardrails } from '../guardrails/guardrailService.js';
import { matchJobOffer } from '../matching/matchJobOffer.js';
import { normalizeTechnology, parseManualJob } from '../manualIntake/manualJobParser.js';
import { createOpenAiEnrichmentService } from '../openai/openAiEnrichmentService.js';

export function createJobOfferService(repository, auditService, options = {}) {
  const openAiEnrichmentService =
    options.openAiEnrichmentService ?? createOpenAiEnrichmentService();
  const approvalRequestService =
    options.approvalRequestService ?? createApprovalRequestService(repository, auditService);

  return {
    async createFromManualInput(input) {
      const startedAt = Date.now();
      logJobOfferPipelineEvent('capture.intake.profile.started', {
        sourceType: input.sourceType ?? 'MANUAL',
        sourceUrl: input.sourceUrl ?? null,
      });
      const profile = await repository.getCandidateProfile();
      logJobOfferPipelineEvent('capture.intake.profile.completed', {
        profileId: profile.id,
        durationMs: Date.now() - startedAt,
      });

      const parseStartedAt = Date.now();
      const deterministicParse = parseManualJob(input);
      logJobOfferPipelineEvent('capture.intake.parse.completed', {
        sourceType: input.sourceType ?? 'MANUAL',
        sourceUrl: input.sourceUrl ?? null,
        parsedTitle: deterministicParse.jobOffer.title ?? null,
        parsedCompany: deterministicParse.jobOffer.company ?? null,
        parsedTechnologies: deterministicParse.jobOffer.technologies.length,
        durationMs: Date.now() - parseStartedAt,
      });

      validateParsedManualIntake(input, deterministicParse);

      const enrichmentStartedAt = Date.now();
      const enrichmentResult = await openAiEnrichmentService.enrichManualJob(input, deterministicParse);
      logJobOfferPipelineEvent('capture.intake.enrichment.completed', {
        sourceType: input.sourceType ?? 'MANUAL',
        sourceUrl: input.sourceUrl ?? null,
        mode: enrichmentResult.mode,
        applied: enrichmentResult.applied,
        warningCount: enrichmentResult.warnings?.length ?? 0,
        durationMs: Date.now() - enrichmentStartedAt,
      });

      const parsed = mergeParsedOffer(deterministicParse, enrichmentResult);
      validateJobOfferForPersistence(input, parsed.jobOffer);
      const fingerprint = buildOfferFingerprint({
        title: parsed.jobOffer.title,
        company: parsed.jobOffer.company,
        contactEmail: parsed.jobOffer.recruiterEmail,
        sourceUrl: parsed.source.originalUrl,
      });

      const dedupeStartedAt = Date.now();
      const duplicate = await repository.findByFingerprint(fingerprint);
      if (duplicate) {
        logJobOfferPipelineEvent('capture.intake.deduplication.duplicate', {
          sourceType: input.sourceType ?? 'MANUAL',
          sourceUrl: input.sourceUrl ?? null,
          fingerprint,
          duplicateId: duplicate.id,
          durationMs: Date.now() - dedupeStartedAt,
        });
        throw new HttpError(409, 'Ya existe una vacante equivalente registrada.', {
          duplicateId: duplicate.id,
        });
      }
      logJobOfferPipelineEvent('capture.intake.deduplication.completed', {
        sourceType: input.sourceType ?? 'MANUAL',
        sourceUrl: input.sourceUrl ?? null,
        fingerprint,
        durationMs: Date.now() - dedupeStartedAt,
      });

      const matchingStartedAt = Date.now();
      const guardrails = evaluateGuardrails(parsed, profile);
      const match = matchJobOffer(profile, parsed, guardrails);
      logJobOfferPipelineEvent('capture.matching.completed', {
        sourceType: input.sourceType ?? 'MANUAL',
        sourceUrl: input.sourceUrl ?? null,
        score: match.score,
        status: match.status,
        approvalsRequired: guardrails.approvals.length,
        blockedRules: guardrails.blocked.length,
        durationMs: Date.now() - matchingStartedAt,
      });

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

      const persistenceStartedAt = Date.now();
      logJobOfferPipelineEvent('capture.persistence.started', {
        jobId: record.id,
        fingerprint,
        title: record.jobOffer.title ?? null,
        company: record.jobOffer.company ?? null,
      });
      const saved = await repository.saveJobAnalysis(record);
      logJobOfferPipelineEvent('capture.persistence.completed', {
        jobId: saved.id,
        status: saved.match.status,
        durationMs: Date.now() - persistenceStartedAt,
      });

      const approvalsStartedAt = Date.now();
      logJobOfferPipelineEvent('capture.approvals.started', {
        jobId: saved.id,
      });
      await approvalRequestService.syncForJob(saved);
      logJobOfferPipelineEvent('capture.approvals.completed', {
        jobId: saved.id,
        durationMs: Date.now() - approvalsStartedAt,
      });

      const auditStartedAt = Date.now();
      logJobOfferPipelineEvent('capture.audit.started', {
        jobId: saved.id,
      });
      await auditService.record('job_offer.created_manual', 'job_offer', saved.id, {
        source: saved.source.type,
        status: saved.match.status,
        score: saved.match.score,
        extractionMode: saved.analysis.extraction.mode,
      });
      logJobOfferPipelineEvent('capture.audit.completed', {
        jobId: saved.id,
        durationMs: Date.now() - auditStartedAt,
        totalDurationMs: Date.now() - startedAt,
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

function validateParsedManualIntake(input, parsed) {
  if (input?.sourceType !== 'LINKEDIN_JOBS_SUPERVISED') {
    return;
  }

  const title = cleanScalar(parsed?.jobOffer?.title);
  const description = cleanScalar(input?.structuredJob?.description);
  const titleLength = String(title ?? '').length;
  const descriptionLength = String(description ?? '').length;

  if (!title || titleLength > 180 || looksLikeLinkedInCardNoise(title) || hasRepeatedLeadingSegment(title)) {
    throw buildLinkedInCaptureValidationError('LINKEDIN_CAPTURE_INVALID_TITLE', input, {
      title,
      titleLength,
    });
  }

  if (!description || descriptionLength < 80 || looksLikeLinkedInCardNoise(description)) {
    throw buildLinkedInCaptureValidationError('LINKEDIN_CAPTURE_INVALID_DESCRIPTION', input, {
      title,
      titleLength,
      descriptionLength,
    });
  }
}

function validateJobOfferForPersistence(input, jobOffer) {
  const title = cleanScalar(jobOffer?.title);
  const titleLength = String(title ?? '').length;

  if (!title || titleLength > 180 || looksLikeLinkedInCardNoise(title) || hasRepeatedLeadingSegment(title)) {
    const statusCode = input?.sourceType === 'LINKEDIN_JOBS_SUPERVISED' ? 409 : 400;
    throw new HttpError(statusCode, 'El titulo extraido no cumple el contrato esperado y no se puede persistir.', {
      code: 'JOB_TITLE_CONTRACT_INVALID',
      title: title ?? null,
      titleLength,
      sourceType: input?.sourceType ?? 'MANUAL',
    });
  }
}

function buildLinkedInCaptureValidationError(code, input, details) {
  return new HttpError(
    409,
    'No se pudo identificar con suficiente confianza el detalle de la vacante seleccionada. Verifica que el panel de la oferta esté abierto e inténtalo nuevamente.',
    {
      code,
      currentUrl: input?.sourceUrl ?? null,
      ...details,
    },
  );
}

function cleanScalar(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function looksLikeLinkedInCardNoise(value) {
  return /seleccionado|visto|adel[a-záéíóú]+\s+a\s+solicitar\s+el\s+empleo|figurar[ií]as\s+entre|publicado\s+hace|posted\s+\d+\s+\w+\s+ago/i.test(
    String(value ?? ''),
  );
}

function hasRepeatedLeadingSegment(value) {
  const normalized = cleanScalar(value)?.toLowerCase() ?? '';
  if (!normalized) {
    return false;
  }

  const words = normalized.split(/\s+/);
  if (words.length < 6) {
    return false;
  }

  const prefix = words.slice(0, Math.min(6, Math.floor(words.length / 2))).join(' ');
  return prefix.length >= 12 && normalized.includes(`${prefix} ${prefix}`);
}

function logJobOfferPipelineEvent(stage, payload) {
  console.info(
    `[job-offer-service] ${JSON.stringify({
      stage,
      timestamp: new Date().toISOString(),
      ...payload,
    })}`,
  );
}
