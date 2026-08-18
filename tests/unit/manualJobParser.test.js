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
});
