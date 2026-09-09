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
    expect(match.matchBreakdown.scoreComponents.technologyScore).toBeGreaterThan(0);
    expect(match.matchBreakdown.strengths).toEqual(
      expect.arrayContaining([
        'Node.js esta confirmado en el perfil del candidato.',
      ]),
    );
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

  it('usa REJECTED cuando el score es bajo pero no existen reglas bloqueantes', () => {
    const parsed = {
      source: {
        originalText: 'Senior Golang Platform Engineer. Remote LATAM.',
      },
      jobOffer: {
        title: 'Senior Golang Platform Engineer',
        company: 'Platform Co',
        location: 'Remote LATAM',
        modality: ['remote'],
        seniority: 'senior',
        englishRequirement: 'basic',
        technologies: ['Go', 'Kubernetes', 'Terraform'],
        salary: null,
        flags: {
          asksForSalary: false,
        },
      },
    };
    const guardrails = { approvals: [], blocked: [] };

    const match = matchJobOffer(defaultCandidateProfile, parsed, guardrails);

    expect(match.excludedByRules).toHaveLength(0);
    expect(match.score).toBeLessThan(50);
    expect(match.status).toBe('REJECTED');
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

  it('penaliza AWS preferred sin bloquear la vacante', () => {
    const parsed = parseManualJob({
      rawText: [
        'Backend Developer',
        'Requirements',
        'Node.js is required for this role.',
        'Preferred Qualifications',
        'Familiarity with AWS',
      ].join('\n'),
      sourceUrl: 'https://example.com/aws-preferred',
      sourceLabel: 'Manual',
    });
    const guardrails = evaluateGuardrails(parsed, defaultCandidateProfile);
    const match = matchJobOffer(defaultCandidateProfile, parsed, guardrails);

    expect(guardrails.blocked.some((entry) => entry.field === 'technologyClaims')).toBe(false);
    expect(match.matchBreakdown.preferredMissing).toEqual(
      expect.arrayContaining([
        'AWS aparece como requisito deseable y no esta confirmado en el perfil.',
      ]),
    );
    expect(match.excludedByRules).toHaveLength(0);
  });

  it('bloquea AWS required cuando no esta confirmado', () => {
    const parsed = parseManualJob({
      rawText: ['Backend Developer', 'Requirements', 'AWS is required for this role.'].join('\n'),
      sourceUrl: 'https://example.com/aws-required',
      sourceLabel: 'Manual',
    });
    const guardrails = evaluateGuardrails(parsed, defaultCandidateProfile);
    const match = matchJobOffer(defaultCandidateProfile, parsed, guardrails);

    expect(match.status).toBe('REJECTED_BY_RULES');
    expect(match.matchBreakdown.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('aws experience'),
      ]),
    );
  });

  it('treats satisfied technology alternatives as a single matched unit', () => {
    const parsed = parseManualJob({
      rawText: [
        'Backend Developer',
        'Requirements',
        'Experience with Node.js/Python/Java is required.',
      ].join('\n'),
      sourceUrl: 'https://example.com/alternatives',
      sourceLabel: 'Manual',
    });
    const guardrails = evaluateGuardrails(parsed, defaultCandidateProfile);
    const match = matchJobOffer(defaultCandidateProfile, parsed, guardrails);

    expect(match.matchBreakdown.technologyUnits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationship: 'alternative',
          requirementLevel: 'required',
          technologies: expect.arrayContaining(['Node.js', 'Python', 'Java']),
        }),
      ]),
    );
    expect(match.matchedTechnologies).toContain('Node.js');
    expect(match.missingTechnologies).not.toEqual(expect.arrayContaining(['Python', 'Java']));
  });

  it('uses CONDITIONAL with traceable reasons for junior-compatible low confidence roles', () => {
    const parsed = {
      source: {
        originalText: 'Junior Backend Developer. Remote. Go services.',
      },
      jobOffer: {
        title: 'Backend Developer',
        company: 'Unknown Co',
        location: 'Remote',
        modality: ['remote'],
        seniority: 'junior',
        englishRequirement: 'intermediate',
        technologies: ['Go'],
        technologyClaims: [],
        salary: null,
        flags: {
          asksForSalary: false,
        },
      },
    };
    const guardrails = { approvals: [], blocked: [] };
    const match = matchJobOffer(defaultCandidateProfile, parsed, guardrails);

    expect(match.recommendation).toBe('CONDITIONAL');
    expect(match.status).toBe('AWAITING_APPROVAL');
    expect(match.matchBreakdown.optionalMissing).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Go'),
      ]),
    );
  });
});

