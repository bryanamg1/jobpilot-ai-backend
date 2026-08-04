import { randomUUID } from 'node:crypto';
import { buildOfferFingerprint } from '../../lib/fingerprint.js';
import { HttpError } from '../../lib/httpError.js';
import { evaluateGuardrails } from '../guardrails/guardrailService.js';
import { matchJobOffer } from '../matching/matchJobOffer.js';
import { parseManualJob } from '../manualIntake/manualJobParser.js';

export function createJobOfferService(repository, auditService) {
  return {
    async createFromManualInput(input) {
      const profile = await repository.getCandidateProfile();
      const parsed = parseManualJob(input);
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
      });

      return saved;
    },
    async list() {
      return repository.listJobAnalyses();
    },
  };
}
