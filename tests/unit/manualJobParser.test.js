import { describe, expect, it } from 'vitest';
import { parseManualJob } from '../../src/services/manualIntake/manualJobParser.js';

const LINKEDIN_CAPTURE_TEXT = `
Source: LinkedIn Jobs supervised session
Captured URL: https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421&keywords=react
Description:
Seleccionado, Fullstack Developer (React/Node.js) (Remote)
Fullstack Developer (React/Node.js) (Remote)
Hired
Argentina
Figurarías entre los principales solicitantes
Publicado hace 14 horas
Node.js React MySQL Jest
`.trim();

describe('manualJobParser', () => {
  it('prefers the structured snapshot title over the LinkedIn detail panel text block', () => {
    const parsed = parseManualJob({
      rawText: LINKEDIN_CAPTURE_TEXT,
      sourceUrl: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421&keywords=react',
      sourceLabel: 'LinkedIn Jobs supervised session',
      sourceType: 'LINKEDIN_JOBS_SUPERVISED',
      structuredJob: {
        title: 'Fullstack Developer (React/Node.js)',
        company: 'Acme Labs',
        location: 'Argentina',
        modality: ['remote'],
        seniority: 'junior',
        technologies: ['React', 'Node.js', 'MySQL', 'Jest'],
        requirements: ['Node.js React MySQL Jest'],
      },
    });

    expect(parsed.jobOffer.title).toBe('Fullstack Developer (React/Node.js)');
    expect(parsed.jobOffer.company).toBe('Acme Labs');
    expect(parsed.jobOffer.location).toBe('Argentina');
    expect(parsed.jobOffer.modality).toContain('remote');
    expect(parsed.jobOffer.technologies).toEqual(
      expect.arrayContaining(['React', 'Node.js', 'MySQL', 'Jest']),
    );
    expect(parsed.jobOffer.certaintyMap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'title',
          certainty: 'CONFIRMED',
          source: 'supervised_structured_capture',
        }),
      ]),
    );
  });

  it('does not infer the title from the Description block when structured fields are absent', () => {
    const parsed = parseManualJob({
      rawText: LINKEDIN_CAPTURE_TEXT,
      sourceUrl: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4425937421&keywords=react',
      sourceLabel: 'LinkedIn Jobs supervised session',
      sourceType: 'LINKEDIN_JOBS_SUPERVISED',
    });

    expect(parsed.jobOffer.title).toBeNull();
  });

  it('keeps a confirmed remote modality without expanding it with incidental hybrid text', () => {
    const parsed = parseManualJob({
      rawText: [
        'Backend Engineer (Remote Position) | Entefy',
        'Company: Entefy',
        'Location: Estados Unidos',
        'Description:',
        'Minimum 3 years of demonstrable Node.js experience.',
        'Our distributed engineering organization collaborates across hybrid rituals, but this opening is remote.',
      ].join('\n'),
      sourceUrl: 'https://example.com/entefy',
      sourceLabel: 'LinkedIn Jobs supervised session',
      sourceType: 'LINKEDIN_JOBS_SUPERVISED',
      structuredJob: {
        title: 'Backend Engineer (Remote Position) | Entefy',
        company: 'Entefy',
        location: 'Estados Unidos',
        modality: ['remote'],
        technologies: ['JavaScript', 'Node.js', 'AWS'],
        description: [
          'Backend Engineer (Remote Position) | Entefy',
          'Minimum 3 years of demonstrable Node.js experience.',
          'Advanced English is not mentioned anywhere in this description.',
        ].join('\n'),
      },
    });

    expect(parsed.jobOffer.modality).toEqual(['remote']);
    expect(parsed.jobOffer.certaintyMap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'modality',
          certainty: 'CONFIRMED',
          source: 'supervised_structured_capture',
        }),
      ]),
    );
  });

  it('keeps fluency in English as fluent instead of advanced', () => {
    const parsed = parseManualJob({
      rawText: [
        'Back End Node Developer | Sophilabs',
        'Fluency in English',
      ].join('\n'),
      sourceUrl: 'https://example.com/sophilabs',
      sourceLabel: 'LinkedIn Jobs supervised session',
      sourceType: 'LINKEDIN_JOBS_SUPERVISED',
      structuredJob: {
        title: 'Back End Node Developer | Sophilabs',
        company: 'Sophilabs',
        location: 'Argentina',
        modality: ['remote'],
        description: [
          'Fluency in English',
          'Preferred Qualifications',
          'Familiarity with AWS and Docker',
        ].join('\n'),
      },
    });

    expect(parsed.jobOffer.englishRequirement).toBe('fluent');
  });

  it('detects advanced English explicitly and normalizes C1 as advanced', () => {
    const advanced = parseManualJob({
      rawText: 'Advanced English required',
      sourceUrl: 'https://example.com/advanced',
      sourceLabel: 'Manual',
    });
    const c1 = parseManualJob({
      rawText: 'C1 English required',
      sourceUrl: 'https://example.com/c1',
      sourceLabel: 'Manual',
    });

    expect(advanced.jobOffer.englishRequirement).toBe('advanced');
    expect(c1.jobOffer.englishRequirement).toBe('advanced');
  });

  it('classifies preferred and alternative technology requirements without copying the whole description', () => {
    const parsed = parseManualJob({
      rawText: [
        'Back End Node Developer | Sophilabs',
        'Description:',
        'Fluency in English',
        'Requirements',
        'AWS is required for this role.',
        'Preferred Qualifications',
        'Familiarity with AWS and Docker',
        'Experience in programming languages such as PHP, Python, Java, etc.',
        'Benefits',
        'Remote-first team and learning budget',
      ].join('\n'),
      sourceUrl: 'https://example.com/sophilabs',
      sourceLabel: 'LinkedIn Jobs supervised session',
      sourceType: 'LINKEDIN_JOBS_SUPERVISED',
      structuredJob: {
        title: 'Back End Node Developer | Sophilabs',
        company: 'Sophilabs',
        location: 'Argentina',
        modality: ['remote'],
        technologies: ['JavaScript', 'Node.js', 'MySQL', 'Docker', 'PHP', 'AWS', 'Git', 'GitHub'],
        description: [
          'Fluency in English',
          'Requirements',
          'AWS is required for this role.',
          'Preferred Qualifications',
          'Familiarity with AWS and Docker',
          'Experience in programming languages such as PHP, Python, Java, etc.',
          'Benefits',
          'Remote-first team and learning budget',
        ].join('\n'),
      },
    });

    expect(parsed.jobOffer.requirements).toEqual(
      expect.arrayContaining([
        'Fluency in English',
        'AWS is required for this role.',
      ]),
    );
    expect(parsed.jobOffer.preferredRequirements).toEqual(['Familiarity with AWS and Docker']);
    expect(parsed.jobOffer.benefits).toEqual([]);
    expect(parsed.jobOffer.requirements).not.toContain('Requirements');
    expect(parsed.jobOffer.requirements.join(' ')).not.toContain('Preferred Qualifications');
    expect(parsed.jobOffer.technologyClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          technology: 'AWS',
          requirementLevel: 'required',
          relationship: 'all',
        }),
        expect.objectContaining({
          technology: 'PHP',
          requirementLevel: 'optional',
          relationship: 'alternative',
        }),
        expect.objectContaining({
          technology: 'Python',
          requirementLevel: 'optional',
          relationship: 'alternative',
        }),
        expect.objectContaining({
          technology: 'Java',
          requirementLevel: 'optional',
          relationship: 'alternative',
        }),
      ]),
    );
  });
});
