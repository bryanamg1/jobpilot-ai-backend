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

  it('maps CEFR English levels consistently without treating B1 as basic', () => {
    const b1 = parseManualJob({
      rawText: 'B1 English required',
      sourceUrl: 'https://example.com/b1',
      sourceLabel: 'Manual',
    });
    const conversational = parseManualJob({
      rawText: 'Conversational English required',
      sourceUrl: 'https://example.com/conversational',
      sourceLabel: 'Manual',
    });
    const b2 = parseManualJob({
      rawText: 'B2 English required',
      sourceUrl: 'https://example.com/b2',
      sourceLabel: 'Manual',
    });
    const basic = parseManualJob({
      rawText: 'Basic English required',
      sourceUrl: 'https://example.com/basic',
      sourceLabel: 'Manual',
    });

    expect(b1.jobOffer.englishRequirement).toBe('intermediate');
    expect(conversational.jobOffer.englishRequirement).toBe('intermediate');
    expect(b2.jobOffer.englishRequirement).toBe('fluent');
    expect(basic.jobOffer.englishRequirement).toBe('basic');
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
    expect(parsed.jobOffer.preferredRequirements).toEqual([
      'Familiarity with AWS and Docker',
      'Experience in programming languages such as PHP, Python, Java, etc.',
    ]);
    expect(parsed.jobOffer.benefits).toEqual(['Remote-first team and learning budget']);
    expect(parsed.jobOffer.requirements).not.toContain('Requirements');
    expect(parsed.jobOffer.requirements.join(' ')).not.toContain('Preferred Qualifications');
    expect(parsed.jobOffer.technologyClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          technology: 'AWS',
          requirementLevel: 'required',
          certainty: 'CONFIRMED',
          relationship: 'all',
        }),
        expect.objectContaining({
          technology: 'PHP',
          requirementLevel: 'preferred',
          relationship: 'alternative',
        }),
        expect.objectContaining({
          technology: 'Python',
          requirementLevel: 'preferred',
          relationship: 'alternative',
        }),
        expect.objectContaining({
          technology: 'Java',
          requirementLevel: 'preferred',
          relationship: 'alternative',
        }),
      ]),
    );
  });

  it('classifies optional technologies without converting them into required claims', () => {
    const parsed = parseManualJob({
      rawText: [
        'Backend Developer',
        'Requirements',
        'Node.js is required for this role.',
        'Optional',
        'Docker nice to have',
      ].join('\n'),
      sourceUrl: 'https://example.com/optional-tech',
      sourceLabel: 'Manual',
    });

    expect(parsed.jobOffer.requirements).toContain('Node.js is required for this role.');
    expect(parsed.jobOffer.optionalRequirements).toContain('Docker nice to have');
    expect(parsed.jobOffer.technologyClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          technology: 'Docker',
          requirementLevel: 'optional',
        }),
      ]),
    );
  });

  it('classifies the Azkait-style LinkedIn description into semantic requirements', () => {
    const description = [
      'Requisitos: Inglés técnico: Básico - Intermedio.',
      'A partir de 3 años de experiencia con Node.js y TypeScript.',
      'Experiencia desarrollando arquitecturas serverless con AWS Lambda.',
      'Experiencia en proyectos productivos con Next.js o React Native.',
      'Desarrollo y consumo de APIs REST o GraphQL.',
      'Manejo de MongoDB o DynamoDB.',
      'Experiencia con Docker.',
      'GitFlow.',
      'Testing con Jest/RTL.',
      'Responsabilidades: Construir funcionalidades full stack y colaborar con producto.',
      'Beneficios: Esquema por honorarios 100% remoto.',
    ].join(' ');

    const parsed = parseManualJob({
      rawText: [
        'Full Stack Developer | Azkait',
        'Company: Azkait',
        'Description:',
        description,
      ].join('\n'),
      sourceUrl: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4444596852',
      sourceLabel: 'LinkedIn Jobs supervised session',
      sourceType: 'LINKEDIN_JOBS_SUPERVISED',
      structuredJob: {
        title: 'Full Stack Developer',
        company: 'Azkait',
        location: 'Argentina',
        modality: ['remote'],
        description,
      },
    });

    expect(parsed.jobOffer.englishRequirement).toBe('intermediate');
    expect(parsed.jobOffer.requirementItems.length).toBeGreaterThan(0);
    expect(parsed.jobOffer.technologyClaims.length).toBeGreaterThan(0);
    expect(parsed.jobOffer.requirements).toEqual(
      expect.arrayContaining([
        'A partir de 3 años de experiencia con Node.js y TypeScript.',
        'Experiencia desarrollando arquitecturas serverless con AWS Lambda.',
        'Experiencia en proyectos productivos con Next.js o React Native.',
        'Desarrollo y consumo de APIs REST o GraphQL.',
        'Manejo de MongoDB o DynamoDB.',
        'Experiencia con Docker.',
        'Testing con Jest/RTL.',
      ]),
    );
    expect(parsed.jobOffer.benefits).toEqual(['Esquema por honorarios 100% remoto.']);
    expect(parsed.jobOffer.responsibilities).toEqual([
      'Construir funcionalidades full stack y colaborar con producto.',
    ]);
    expect(parsed.jobOffer.requirements.join(' ')).not.toContain('Esquema por honorarios');
    expect(parsed.jobOffer.requirementItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'A partir de 3 años de experiencia con Node.js y TypeScript.',
          level: 'required',
          requirementLevel: 'required',
          certainty: 'CONFIRMED',
          evidence: 'A partir de 3 años de experiencia con Node.js y TypeScript.',
          category: 'experience',
          minYears: 3,
        }),
      ]),
    );
    expect(parsed.jobOffer.technologyClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          technology: 'Node.js',
          requirementLevel: 'required',
          certainty: 'CONFIRMED',
          relationship: 'all',
          evidence: 'A partir de 3 años de experiencia con Node.js y TypeScript.',
        }),
        expect.objectContaining({
          technology: 'TypeScript',
          requirementLevel: 'required',
          relationship: 'all',
        }),
        expect.objectContaining({
          technology: 'AWS Lambda',
          requirementLevel: 'required',
        }),
        expect.objectContaining({
          technology: 'Docker',
          requirementLevel: 'required',
        }),
      ]),
    );

    const nextClaim = parsed.jobOffer.technologyClaims.find((claim) => claim.technology === 'Next.js');
    const reactNativeClaim = parsed.jobOffer.technologyClaims.find((claim) => claim.technology === 'React Native');
    const restClaim = parsed.jobOffer.technologyClaims.find((claim) => claim.technology === 'REST API');
    const graphqlClaim = parsed.jobOffer.technologyClaims.find((claim) => claim.technology === 'GraphQL');
    const mongoClaim = parsed.jobOffer.technologyClaims.find((claim) => claim.technology === 'MongoDB');
    const dynamoClaim = parsed.jobOffer.technologyClaims.find((claim) => claim.technology === 'DynamoDB');

    expect(nextClaim).toEqual(expect.objectContaining({ relationship: 'alternative' }));
    expect(reactNativeClaim).toEqual(
      expect.objectContaining({
        relationship: 'alternative',
        alternativeGroup: nextClaim.alternativeGroup,
      }),
    );
    expect(restClaim).toEqual(expect.objectContaining({ relationship: 'alternative' }));
    expect(graphqlClaim).toEqual(
      expect.objectContaining({
        relationship: 'alternative',
        alternativeGroup: restClaim.alternativeGroup,
      }),
    );
    expect(mongoClaim).toEqual(expect.objectContaining({ relationship: 'alternative' }));
    expect(dynamoClaim).toEqual(
      expect.objectContaining({
        relationship: 'alternative',
        alternativeGroup: mongoClaim.alternativeGroup,
      }),
    );
  });

  it('detects headings with content in the same line in Spanish and English', () => {
    const parsed = parseManualJob({
      rawText: [
        'Frontend Developer',
        'Requisitos: Node.js y TypeScript.',
        'Preferred: 2-3 years preferred with AWS.',
        'Nice to have: Familiarity with Docker.',
        'Benefits: Remote work.',
      ].join('\n'),
      sourceUrl: 'https://example.com/inline-headings',
      sourceLabel: 'Manual',
    });

    expect(parsed.jobOffer.requirements).toContain('Node.js y TypeScript.');
    expect(parsed.jobOffer.preferredRequirements).toContain('2-3 years preferred with AWS.');
    expect(parsed.jobOffer.preferredRequirements).toContain('Familiarity with Docker.');
    expect(parsed.jobOffer.benefits).toEqual(['Remote work.']);
    expect(parsed.jobOffer.requirementItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: '2-3 years preferred with AWS.',
          requirementLevel: 'preferred',
          minYears: 2,
        }),
      ]),
    );
    expect(parsed.jobOffer.technologyClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          technology: 'AWS',
          requirementLevel: 'preferred',
        }),
        expect.objectContaining({
          technology: 'Docker',
          requirementLevel: 'preferred',
        }),
      ]),
    );
  });

  it('keeps unsectioned descriptions as mentioned technologies without inventing required claims', () => {
    const parsed = parseManualJob({
      rawText: 'We build products with Node.js, TypeScript and MongoDB for global users.',
      sourceUrl: 'https://example.com/unsectioned',
      sourceLabel: 'Manual',
    });

    expect(parsed.jobOffer.technologies).toEqual(
      expect.arrayContaining(['Node.js', 'TypeScript', 'MongoDB']),
    );
    expect(parsed.jobOffer.requirements).toEqual([]);
    expect(parsed.jobOffer.requirementItems).toEqual([]);
    expect(parsed.jobOffer.technologyClaims).toEqual([]);
  });

  it('keeps CEFR English normalization stable for B1, B2 and C1', () => {
    const b1 = parseManualJob({ rawText: 'English B1 required', sourceUrl: 'https://example.com/b1b', sourceLabel: 'Manual' });
    const b2 = parseManualJob({ rawText: 'English B2 required', sourceUrl: 'https://example.com/b2b', sourceLabel: 'Manual' });
    const c1 = parseManualJob({ rawText: 'English C1 required', sourceUrl: 'https://example.com/c1b', sourceLabel: 'Manual' });

    expect(b1.jobOffer.englishRequirement).toBe('intermediate');
    expect(b2.jobOffer.englishRequirement).toBe('fluent');
    expect(c1.jobOffer.englishRequirement).toBe('advanced');
  });
});
