import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { evaluateGuardrails } from '../../src/services/guardrails/guardrailService.js';
import { matchJobOffer } from '../../src/services/matching/matchJobOffer.js';
import { normalizeTechnology, parseManualJob } from '../../src/services/manualIntake/manualJobParser.js';

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
    expect(match.status).toBe('AWAITING_APPROVAL');
    expect(match.explanation.risks).toContain('El salario es un dato sensible y requiere aprobacion manual.');
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

  it('normalizes equivalent technologies and does not leave unknown company placeholders', () => {
    const parsed = parseManualJob({
      rawText: `
Frontend Developer
We are hiring for a remote LATAM team.
Requirements: JS, ReactJS, NodeJS, Express.js, MySql and GitHub.
Apply here.
      `.trim(),
      sourceUrl: 'https://example.com/frontend-job',
      sourceLabel: 'Manual',
    });
    const guardrails = evaluateGuardrails(parsed, defaultCandidateProfile);
    const match = matchJobOffer(defaultCandidateProfile, parsed, guardrails);

    expect(parsed.jobOffer.company).toBeNull();
    expect(parsed.jobOffer.technologies).toEqual(
      expect.arrayContaining(['JavaScript', 'React', 'Node.js', 'Express', 'MySQL']),
    );
    expect(match.matchedTechnologies).toEqual(
      expect.arrayContaining(['JavaScript', 'React', 'Node.js', 'Express', 'MySQL']),
    );
  });

  it('normalizes canonical technology labels consistently', () => {
    expect(normalizeTechnology('JavaScript ES6+')).toBe('JavaScript');
    expect(normalizeTechnology('NodeJS')).toBe('Node.js');
    expect(normalizeTechnology('ReactJS')).toBe('React');
    expect(normalizeTechnology('Express.js')).toBe('Express');
  });
});

