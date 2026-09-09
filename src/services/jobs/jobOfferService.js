import { randomUUID } from 'node:crypto';
import { buildOfferFingerprint } from '../../lib/fingerprint.js';
import { HttpError } from '../../lib/httpError.js';
import { createApprovalRequestService } from '../approvals/approvalRequestService.js';
import { evaluateGuardrails } from '../guardrails/guardrailService.js';
import { matchJobOffer } from '../matching/matchJobOffer.js';
import { normalizeTechnology, parseManualJob } from '../manualIntake/manualJobParser.js';
import { createOpenAiEnrichmentService } from '../openai/openAiEnrichmentService.js';
import { recommendJobOffer } from '../recommendations/recommendationEngine.js';

export function createJobOfferService(repository, auditService, options = {}) {
  const openAiEnrichmentService =
    options.openAiEnrichmentService ?? createOpenAiEnrichmentService();
  const approvalRequestService =
    options.approvalRequestService ?? createApprovalRequestService(repository, auditService);

  return {
    async createFromManualInput(input) {
      const startedAt = Date.now();
      const summary = createCaptureSummary(input);
      try {
        const parseStartedAt = Date.now();
        const deterministicParse = parseManualJob(input);
        summary.title = deterministicParse.jobOffer.title ?? null;
        summary.parseMs = Date.now() - parseStartedAt;
        logJobOfferPipelineEvent('capture.intake.parse.completed', {
          sourceType: input.sourceType ?? 'MANUAL',
          sourceUrl: input.sourceUrl ?? null,
          parsedTitle: deterministicParse.jobOffer.title ?? null,
          parsedCompany: deterministicParse.jobOffer.company ?? null,
          parsedTechnologies: deterministicParse.jobOffer.technologies.length,
          durationMs: summary.parseMs,
        });

        validateParsedManualIntake(input, deterministicParse);

        const earlyFingerprint = buildFingerprintFromParsedOffer(deterministicParse);
        const duplicate = await findDuplicateByFingerprint(repository, earlyFingerprint, input, 'capture.intake.deduplication');
        if (duplicate) {
          summary.deduplicationStatus = 'duplicate';
          summary.finalStatus = 'DUPLICATE';
          summary.totalMs = Date.now() - startedAt;
          logCaptureSummary(summary);
          throw new HttpError(409, 'Ya existe una vacante equivalente registrada.', {
            duplicateId: duplicate.id,
          });
        }
        summary.deduplicationStatus = 'passed';

        const enrichmentStartedAt = Date.now();
        let enrichmentResult;
        if (shouldSkipSynchronousEnrichment(input)) {
          enrichmentResult = buildSkippedEnrichmentResult();
          logJobOfferPipelineEvent('capture.intake.enrichment.skipped', {
            sourceType: input.sourceType ?? 'MANUAL',
            sourceUrl: input.sourceUrl ?? null,
            mode: enrichmentResult.mode,
            applied: enrichmentResult.applied,
            fallbackReason: enrichmentResult.fallbackReason,
            durationMs: 0,
          });
        } else {
          logJobOfferPipelineEvent('capture.intake.enrichment.started', {
            sourceType: input.sourceType ?? 'MANUAL',
            sourceUrl: input.sourceUrl ?? null,
          });
          enrichmentResult = await openAiEnrichmentService.enrichManualJob(input, deterministicParse);
          if (enrichmentResult.fallbackReason === 'timeout') {
            logJobOfferPipelineEvent('capture.intake.enrichment.timeout', {
              sourceType: input.sourceType ?? 'MANUAL',
              sourceUrl: input.sourceUrl ?? null,
              mode: enrichmentResult.mode,
              applied: enrichmentResult.applied,
              attemptCount: enrichmentResult.attemptCount ?? 0,
              fallbackReason: enrichmentResult.fallbackReason,
              durationMs: Date.now() - enrichmentStartedAt,
            });
          } else if (
            enrichmentResult.fallbackReason &&
            enrichmentResult.fallbackReason !== 'disabled' &&
            enrichmentResult.fallbackReason !== 'missing_api_key' &&
            enrichmentResult.fallbackReason !== 'client_unavailable' &&
            enrichmentResult.fallbackReason !== 'test_mode'
          ) {
            logJobOfferPipelineEvent('capture.intake.enrichment.failed', {
              sourceType: input.sourceType ?? 'MANUAL',
              sourceUrl: input.sourceUrl ?? null,
              mode: enrichmentResult.mode,
              applied: enrichmentResult.applied,
              attemptCount: enrichmentResult.attemptCount ?? 0,
              fallbackReason: enrichmentResult.fallbackReason,
              durationMs: Date.now() - enrichmentStartedAt,
            });
          }
        }
        summary.enrichmentMode = enrichmentResult.mode ?? 'deterministic';
        summary.enrichmentMs = shouldSkipSynchronousEnrichment(input) ? 0 : Date.now() - enrichmentStartedAt;
        logJobOfferPipelineEvent('capture.intake.enrichment.completed', {
          sourceType: input.sourceType ?? 'MANUAL',
          sourceUrl: input.sourceUrl ?? null,
          mode: enrichmentResult.mode,
          applied: enrichmentResult.applied,
          attemptCount: enrichmentResult.attemptCount ?? 0,
          fallbackReason: enrichmentResult.fallbackReason ?? null,
          warningCount: enrichmentResult.warnings?.length ?? 0,
          durationMs: summary.enrichmentMs,
        });

        const parsed = mergeParsedOffer(deterministicParse, enrichmentResult);
        validateJobOfferForPersistence(input, parsed.jobOffer);
        const fingerprint = buildFingerprintFromParsedOffer(parsed);
        if (fingerprint !== earlyFingerprint) {
          const duplicateAfterEnrichment = await findDuplicateByFingerprint(
            repository,
            fingerprint,
            input,
            'capture.intake.deduplication.post_enrichment',
          );
          if (duplicateAfterEnrichment) {
            summary.deduplicationStatus = 'duplicate_post_enrichment';
            summary.finalStatus = 'DUPLICATE';
            summary.totalMs = Date.now() - startedAt;
            logCaptureSummary(summary);
            throw new HttpError(409, 'Ya existe una vacante equivalente registrada.', {
              duplicateId: duplicateAfterEnrichment.id,
            });
          }
        }

        const profileStartedAt = Date.now();
        logJobOfferPipelineEvent('capture.intake.profile.started', {
          sourceType: input.sourceType ?? 'MANUAL',
          sourceUrl: input.sourceUrl ?? null,
        });
        const profile = await repository.getCandidateProfile();
        logJobOfferPipelineEvent('capture.intake.profile.completed', {
          profileId: profile.id,
          durationMs: Date.now() - profileStartedAt,
        });

        const matchingStartedAt = Date.now();
        const guardrails = evaluateGuardrails(parsed, profile);
        const baseMatch = matchJobOffer(profile, parsed, guardrails);
        const recommendationDecision = recommendJobOffer({
          candidateProfile: profile,
          structuredJob: parsed,
          guardrailResult: guardrails,
          matchingResult: baseMatch,
        });
        const match = {
          ...baseMatch,
          recommendation: recommendationDecision.recommendation,
          status: recommendationDecision.status,
          suggestedActions: recommendationDecision.suggestedActions,
          recommendationBreakdown: recommendationDecision.recommendationBreakdown,
        };
        summary.matchScore = match.score;
        summary.recommendation = match.recommendation ?? null;
        summary.blockedRules = guardrails.blocked.length;
        summary.finalStatus = match.status;
        logJobOfferPipelineEvent('capture.matching.completed', {
          sourceType: input.sourceType ?? 'MANUAL',
          sourceUrl: input.sourceUrl ?? null,
          score: match.score,
          status: match.status,
          decision: match.recommendationBreakdown?.decision ?? null,
          confidence: match.recommendationBreakdown?.confidence ?? null,
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

        summary.totalMs = Date.now() - startedAt;
        logCaptureSummary(summary);
        return saved;
      } catch (error) {
        if (summary.totalMs === null) {
          summary.finalStatus = summary.finalStatus ?? 'ERROR';
          summary.totalMs = Date.now() - startedAt;
          logCaptureSummary(summary, error);
        }
        throw error;
      }
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
  const baseFacts = merged.jobOffer.certaintyMap ?? [];
  const nextFacts = extracted.certaintyMap ?? [];

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
  merged.jobOffer.modality = mergeFieldArray(
    'modality',
    merged.jobOffer.modality,
    extracted.modality,
    baseFacts,
    nextFacts,
  );
  merged.jobOffer.seniority = chooseKnownValue(merged.jobOffer.seniority, extracted.seniority);
  merged.jobOffer.englishRequirement = chooseKnownValue(
    merged.jobOffer.englishRequirement,
    extracted.englishRequirement,
  );
  merged.jobOffer.technologies = mergeFieldArray(
    'technology',
    merged.jobOffer.technologies,
    extracted.technologies.map(normalizeTechnology),
    baseFacts,
    nextFacts,
  );
  merged.jobOffer.requirements = sanitizeTextList(
    mergeStringArrays(merged.jobOffer.requirements, extracted.requirements),
  ).slice(0, 12);
  merged.jobOffer.preferredRequirements = sanitizeTextList(merged.jobOffer.preferredRequirements).slice(0, 12);
  merged.jobOffer.optionalRequirements = sanitizeTextList(merged.jobOffer.optionalRequirements).slice(0, 12);
  merged.jobOffer.responsibilities = sanitizeTextList(merged.jobOffer.responsibilities).slice(0, 12);
  merged.jobOffer.benefits = sanitizeTextList(merged.jobOffer.benefits).slice(0, 12);
  merged.jobOffer.instructions = mergeStringArrays(merged.jobOffer.instructions, extracted.instructions).slice(0, 12);
  merged.jobOffer.salary = merged.jobOffer.salary ?? extracted.salary ?? null;
  merged.jobOffer.flags = mergeFlags(merged.jobOffer.flags, extracted.flags);
  merged.jobOffer.certaintyMap = mergeCertaintyMap(merged.jobOffer.certaintyMap, extracted.certaintyMap);
  merged.jobOffer.analysisSummary = extracted.summary ?? null;

  return merged;
}

function buildFingerprintFromParsedOffer(parsed) {
  const title = parsed?.jobOffer?.title;
  const company = parsed?.jobOffer?.company;
  const contactEmail = parsed?.jobOffer?.recruiterEmail;
  const sourceUrl = parsed?.source?.originalUrl;
  if (![title, company, contactEmail, sourceUrl].some((value) => String(value ?? '').trim())) {
    return null;
  }

  return buildOfferFingerprint({
    title,
    company,
    contactEmail,
    sourceUrl,
  });
}

async function findDuplicateByFingerprint(repository, fingerprint, input, stage) {
  if (!fingerprint) {
    logJobOfferPipelineEvent(`${stage}.skipped`, {
      sourceType: input.sourceType ?? 'MANUAL',
      sourceUrl: input.sourceUrl ?? null,
      reason: 'missing_fingerprint_inputs',
    });
    return null;
  }

  const dedupeStartedAt = Date.now();
  const duplicate = await repository.findByFingerprint(fingerprint);
  if (duplicate) {
    logJobOfferPipelineEvent(`${stage}.duplicate`, {
      sourceType: input.sourceType ?? 'MANUAL',
      sourceUrl: input.sourceUrl ?? null,
      fingerprint,
      duplicateId: duplicate.id,
      durationMs: Date.now() - dedupeStartedAt,
    });
    return duplicate;
  }

  logJobOfferPipelineEvent(`${stage}.completed`, {
    sourceType: input.sourceType ?? 'MANUAL',
    sourceUrl: input.sourceUrl ?? null,
    fingerprint,
    durationMs: Date.now() - dedupeStartedAt,
  });
  return null;
}

function shouldSkipSynchronousEnrichment(input) {
  return input?.sourceType === 'LINKEDIN_JOBS_SUPERVISED' && Boolean(input?.structuredJob?.description);
}

function buildSkippedEnrichmentResult() {
  return {
    applied: false,
    mode: 'deterministic',
    provider: 'openai',
    model: null,
    attemptCount: 0,
    fallbackReason: 'skipped_supervised_capture',
    warnings: ['skipped_supervised_capture: La captura supervisada ya contiene datos estructurados suficientes.'],
    extracted: null,
  };
}

function createCaptureSummary(input) {
  return {
    currentJobId: input?.captureMetadata?.currentJobId ?? extractCurrentJobId(input?.sourceUrl),
    title: null,
    snapshotMs: input?.captureMetadata?.snapshotMs ?? null,
    parseMs: null,
    deduplicationStatus: 'pending',
    enrichmentMode: 'pending',
    enrichmentMs: null,
    matchScore: null,
    recommendation: null,
    blockedRules: 0,
    finalStatus: null,
    draftStatus: 'not_requested',
    totalMs: null,
  };
}

function logCaptureSummary(summary, error = null) {
  logJobOfferPipelineEvent('capture.summary', {
    ...summary,
    errorName: error?.name ?? null,
    errorCode: error?.code ?? error?.details?.code ?? null,
  });
}

function extractCurrentJobId(sourceUrl) {
  if (!sourceUrl) {
    return null;
  }

  try {
    const url = new URL(sourceUrl);
    const currentJobId = String(url.searchParams.get('currentJobId') ?? '').trim();
    if (/^\d+$/.test(currentJobId)) {
      return currentJobId;
    }

    const viewMatch = url.pathname.match(/\/jobs\/view\/(\d+)/i);
    return viewMatch?.[1] ?? null;
  } catch {
    return null;
  }
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

function mergeFieldArray(field, baseValues = [], nextValues = [], baseFacts = [], nextFacts = []) {
  if (hasStructuredConfirmedFact(baseFacts, field)) {
    return mergeStringArrays(baseValues, []);
  }

  const filteredNextValues = nextValues.filter((value) => !isOverriddenByStructuredFact(baseFacts, field, value));
  const nextFieldFacts = nextFacts.filter((fact) => fact.field === field);
  if (hasStructuredConfirmedFact(nextFieldFacts, field)) {
    return mergeStringArrays(filteredNextValues, []);
  }

  return mergeStringArrays(baseValues, filteredNextValues);
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
  const merged = [...baseFacts];
  for (const fact of nextFacts) {
    if (isOverriddenByStructuredFact(baseFacts, fact.field, fact.value)) {
      continue;
    }
    merged.push(fact);
  }

  return merged.filter(
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

function hasStructuredConfirmedFact(facts = [], field) {
  return facts.some(
    (fact) =>
      fact.field === field &&
      fact.certainty === 'CONFIRMED' &&
      fact.source === 'supervised_structured_capture',
  );
}

function isOverriddenByStructuredFact(facts = [], field, value) {
  if (!hasStructuredConfirmedFact(facts, field)) {
    return false;
  }

  const normalizedValue = normalizeComparableValue(value);
  return !facts.some(
    (fact) =>
      fact.field === field &&
      fact.certainty === 'CONFIRMED' &&
      fact.source === 'supervised_structured_capture' &&
      normalizeComparableValue(fact.value) === normalizedValue,
  );
}

function normalizeComparableValue(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function sanitizeTextList(values = []) {
  return mergeStringArrays(values, []).filter((value) => {
    const cleaned = String(value ?? '').trim();
    if (!cleaned) {
      return false;
    }
    if (/^(requirements?|responsibilities|benefits?)\s*:?\s*$/i.test(cleaned)) {
      return false;
    }
    if (cleaned.length > 280) {
      return false;
    }
    return true;
  });
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

  if (
    !description ||
    descriptionLength < 80 ||
    looksLikeLinkedInCardNoise(description) ||
    looksLikeLinkedInPromotionNoise(description)
  ) {
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

function looksLikeLinkedInPromotionNoise(value) {
  return /estar[ií]as entre los candidatos destacados|podemos ayudarte a captar el inter[eé]s|figurar[ií]as entre los principales solicitantes|adel[aá]ntate a solicitar|meet the hiring team|conoce al equipo de contrataci[oó]n|applicant insights|candidate insights|try premium|promocionado por|promoted by|a[uú]n no hay informaci[oó]n disponible|there is no information available|no information available/i.test(
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
