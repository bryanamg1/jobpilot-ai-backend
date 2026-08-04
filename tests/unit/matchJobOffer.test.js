import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { evaluateGuardrails } from '../../src/services/guardrails/guardrailService.js';
import { matchJobOffer } from '../../src/services/matching/matchJobOffer.js';
import { parseManualJob } from '../../src/services/manualIntake/manualJobParser.js';

const fixture = (name) =>
  fs.readFileSync(path.join(import.meta.dirname, '../fixtures', name), 'utf8');

describe('matchJobOffer', () => {
  it('recommends a compatible junior backend opportunity', () => {
    const parsed = parseManualJob({
      rawText: fixture('manual-job-spanish.txt'),
      sourceUrl: 'https://example.com/backend-job',
      sourceLabel: 'Manual',
    });
    const guardrails = evaluateGuardrails(parsed, defaultCandidateProfile);
    const match = matchJobOffer(defaultCandidateProfile, parsed, guardrails);

    expect(match.score).toBeGreaterThanOrEqual(65);
    expect(match.status).toBe('READY_TO_PREPARE');
    expect(match.matchedTechnologies).toContain('Node.js');
  });

  it('blocks incompatible offers with prohibited requirements', () => {
    const parsed = parseManualJob({
      rawText: fixture('manual-job-incompatible.txt'),
      sourceUrl: 'https://example.com/wordpress-job',
      sourceLabel: 'Manual',
    });
    const guardrails = evaluateGuardrails(parsed, defaultCandidateProfile);
    const match = matchJobOffer(defaultCandidateProfile, parsed, guardrails);

    expect(match.status).toBe('REJECTED_BY_RULES');
    expect(match.excludedByRules.length).toBeGreaterThan(0);
  });
});
