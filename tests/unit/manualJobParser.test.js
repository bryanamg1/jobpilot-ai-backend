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

function itemTexts(items) {
  return items.map((item) => item.text);
}

function findTechnologyClaim(parsed, technology, evidencePart) {
  return parsed.jobOffer.technologyClaims.find(
    (claim) => claim.technology === technology && (!evidencePart || claim.evidence.includes(evidencePart)),
  );
}

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
      'Beneficios: Esquema por honorarios 100% remoto (Latinoamérica) Participación en proyectos con tecnologías modernas Trabajo con herramientas de IA aplicadas al desarrollo Equipo y herramientas proporcionadas por cliente',
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
    expect(parsed.jobOffer.benefits).toEqual([
      'Esquema por honorarios 100% remoto (Latinoamérica)',
      'Participación en proyectos con tecnologías modernas',
      'Trabajo con herramientas de IA aplicadas al desarrollo',
      'Equipo y herramientas proporcionadas por cliente',
    ]);
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

    expect(findTechnologyClaim(parsed, 'Docker')).toEqual(expect.objectContaining({ relationship: 'all' }));
    expect(findTechnologyClaim(parsed, 'GitFlow')).toEqual(expect.objectContaining({ relationship: 'all' }));
    expect(findTechnologyClaim(parsed, 'Jest')).toEqual(expect.objectContaining({ relationship: 'all' }));
    expect(findTechnologyClaim(parsed, 'React Testing Library')).toEqual(expect.objectContaining({ relationship: 'all' }));
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

  it('infers middle seniority from the title without treating responsibility verbs as lead seniority', () => {
    const middle = parseManualJob({
      rawText: [
        'Middle Node.js Engineer',
        'Responsibilities: Lead the migration from a legacy service to Node.js.',
        'Requirements: Node.js is required.',
      ].join('\n'),
      sourceUrl: 'https://example.com/avenga-middle',
      sourceLabel: 'LinkedIn Jobs supervised session',
      sourceType: 'LINKEDIN_JOBS_SUPERVISED',
      structuredJob: {
        title: 'Middle Node.js Engineer',
        company: 'Avenga',
        description: [
          'Responsibilities: Lead the migration from a legacy service to Node.js.',
          'Requirements: Node.js is required.',
        ].join('\n'),
      },
    });
    const middleStrong = parseManualJob({
      rawText: [
        'Middle-Strong Node.js Engineer',
        'Responsibilities: Lead the migration from a legacy service to Node.js.',
      ].join('\n'),
      sourceUrl: 'https://example.com/avenga-middle-strong',
      sourceLabel: 'Manual',
    });

    expect(middle.jobOffer.seniority).toBe('mid');
    expect(middleStrong.jobOffer.seniority).toBe('mid');
  });

  it('canonicalizes duplicated Avenga-style sections into one effective requirement per evidence', () => {
    const description = [
      'Responsibilities: Lead the migration from legacy services.',
      'Requirements: 5+ years of experience with Node.js.',
      'Requirements: AWS is required for cloud services.',
      'Benefits: Remote work and learning budget.',
    ].join(' ');
    const duplicatedText = [
      'Middle Node.js Engineer',
      `Responsibilities: ${description}`,
      `Requirements: ${description}`,
      `Benefits: ${description}`,
      `Description: ${description}`,
    ].join('\n');

    const parsed = parseManualJob({
      rawText: duplicatedText,
      sourceUrl: 'https://example.com/avenga-duplicated',
      sourceLabel: 'LinkedIn Jobs supervised session',
    });

    const requirementKeys = parsed.jobOffer.requirementItems.map((item) => `${item.requirementLevel}:${item.text}`);
    const claimKeys = parsed.jobOffer.technologyClaims.map(
      (claim) => `${claim.technology}:${claim.requirementLevel}:${claim.evidence}`,
    );

    expect(requirementKeys).toHaveLength(new Set(requirementKeys).size);
    expect(claimKeys).toHaveLength(new Set(claimKeys).size);
    expect(parsed.jobOffer.requirements.filter((item) => item === '5+ years of experience with Node.js.')).toHaveLength(1);
    expect(parsed.jobOffer.requirements.filter((item) => item === 'AWS is required for cloud services.')).toHaveLength(1);
    expect(parsed.jobOffer.optionalRequirements).not.toContain('5+ years of experience with Node.js.');
    expect(parsed.jobOffer.optionalRequirements).not.toContain('AWS is required for cloud services.');
  });

  it('enforces segmentation invariants for fragments, partial duplicates and relationships', () => {
    const parsed = parseManualJob({
      rawText: [
        'Backend Engineer',
        'Requirements:',
        'Solid technical scoping, requirements translation, and full SDLC ownership.',
        'Solid technical scoping,',
        'translation, and full SDLC ownership.',
        'Experiencia con Docker, GitFlow y testing con Jest/RTL.',
        'Preferred:',
        'Next.js o React Native.',
        'Responsibilities:',
        'Translate requirements into prototypes and production-ready technical solutions;',
      ].join('\n'),
      sourceUrl: 'https://example.com/invariants',
      sourceLabel: 'Manual',
    });

    const requirementTexts = itemTexts(parsed.jobOffer.requirementItems);
    expect(requirementTexts).toContain('Solid technical scoping, requirements translation, and full SDLC ownership.');
    expect(requirementTexts).not.toContain('Solid technical scoping,');
    expect(requirementTexts).not.toContain('translation, and full SDLC ownership.');
    expect(requirementTexts).not.toContain('Requirements');
    expect(requirementTexts).not.toContain('Preferred');
    expect(requirementTexts).not.toContain('Responsibilities');
    expect(requirementTexts.some((text) => text.endsWith(','))).toBe(false);
    expect(parsed.jobOffer.requirements).not.toContain('Translate requirements into prototypes and production-ready technical solutions;');
    expect(parsed.jobOffer.responsibilities).toContain('Translate requirements into prototypes and production-ready technical solutions;');

    expect(parsed.jobOffer.requirementItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'Solid technical scoping, requirements translation, and full SDLC ownership.',
          category: 'general',
        }),
      ]),
    );
    expect(findTechnologyClaim(parsed, 'Docker')).toEqual(expect.objectContaining({ relationship: 'all' }));
    expect(findTechnologyClaim(parsed, 'GitFlow')).toEqual(expect.objectContaining({ relationship: 'all' }));
    expect(findTechnologyClaim(parsed, 'Jest')).toEqual(expect.objectContaining({ relationship: 'all' }));
    expect(findTechnologyClaim(parsed, 'React Testing Library')).toEqual(expect.objectContaining({ relationship: 'all' }));
    expect(findTechnologyClaim(parsed, 'Next.js')).toEqual(expect.objectContaining({ relationship: 'alternative' }));
    expect(findTechnologyClaim(parsed, 'React Native')).toEqual(
      expect.objectContaining({
        relationship: 'alternative',
        alternativeGroup: findTechnologyClaim(parsed, 'Next.js').alternativeGroup,
      }),
    );
  });

  it('resolves requirement level conflicts by keeping the strongest level for equivalent evidence', () => {
    const parsed = parseManualJob({
      rawText: [
        'Backend Developer',
        'Optional: AWS is required for cloud services.',
        'Preferred: AWS is required for cloud services.',
        'Requirements: AWS is required for cloud services.',
      ].join('\n'),
      sourceUrl: 'https://example.com/conflicting-levels',
      sourceLabel: 'Manual',
    });

    expect(parsed.jobOffer.requirements).toEqual(['AWS is required for cloud services.']);
    expect(parsed.jobOffer.preferredRequirements).toEqual([]);
    expect(parsed.jobOffer.optionalRequirements).toEqual([]);
    expect(parsed.jobOffer.technologyClaims.filter((claim) => claim.technology === 'AWS')).toEqual([
      expect.objectContaining({
        requirementLevel: 'required',
        evidence: 'AWS is required for cloud services.',
      }),
    ]);
  });

  it('does not create an explicit JavaScript claim when only Node.js is present', () => {
    const parsed = parseManualJob({
      rawText: [
        'Middle Node.js Engineer',
        'Requirements: Node.js is required for backend services.',
      ].join('\n'),
      sourceUrl: 'https://example.com/node-only',
      sourceLabel: 'Manual',
    });

    expect(parsed.jobOffer.technologies).toContain('Node.js');
    expect(parsed.jobOffer.technologyClaims).toEqual([
      expect.objectContaining({
        technology: 'Node.js',
        requirementLevel: 'required',
      }),
    ]);
    expect(parsed.jobOffer.technologyClaims.some((claim) => claim.technology === 'JavaScript')).toBe(false);
  });

  it('segments Avenga-style natural headings without fragments or section leakage', () => {
    const description = [
      'This is you',
      '5+ years with Node.js.',
      'NestJS or Express.',
      'RESTful APIs.',
      'Microservices.',
      'Cloud deployment.',
      'GitLab workflows.',
      'Monitoring/alerting.',
      'Solid technical scoping, requirements translation, and full SDLC ownership.',
      'English intermediate.',
      'Nice-to-have skills',
      'AWS serverless.',
      'TypeScript.',
      'React.',
      'Agile SDLC.',
      'This is your role',
      'Design and maintain BFF/backend services.',
      'Build/document REST APIs.',
      'Translate requirements into prototypes and production-ready technical solutions;',
      'Ensure code quality with automated tests;',
      'Deploy and manage cloud applications;',
      'Improve performance and scalability;',
      'Maintain documentation;',
      'Collaborate with frontend teams and mentor peers.',
    ].join(' ');

    const parsed = parseManualJob({
      rawText: ['Middle Node.js Engineer | Avenga', 'Company: Avenga', 'Description:', description].join('\n'),
      sourceUrl: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4465551234',
      sourceLabel: 'LinkedIn Jobs supervised session',
      sourceType: 'LINKEDIN_JOBS_SUPERVISED',
      structuredJob: {
        title: 'Middle Node.js Engineer',
        company: 'Avenga',
        location: 'Argentina',
        seniority: 'mid',
        description,
      },
    });

    expect(parsed.jobOffer.requirements).toEqual(
      expect.arrayContaining([
        '5+ years with Node.js.',
        'NestJS or Express.',
        'RESTful APIs.',
        'Microservices.',
        'Cloud deployment.',
        'GitLab workflows.',
        'Monitoring/alerting.',
        'Solid technical scoping, requirements translation, and full SDLC ownership.',
        'English intermediate',
      ]),
    );
    expect(parsed.jobOffer.preferredRequirements).toEqual(
      expect.arrayContaining(['AWS serverless.', 'TypeScript.', 'React.', 'Agile SDLC']),
    );
    expect(parsed.jobOffer.responsibilities).toEqual(
      expect.arrayContaining([
        'Design and maintain BFF/backend services.',
        'Build/document REST APIs.',
        'Translate requirements into prototypes and production-ready technical solutions;',
        'Ensure code quality with automated tests;',
        'Deploy and manage cloud applications;',
        'Improve performance and scalability;',
        'Maintain documentation;',
        'Collaborate with frontend teams and mentor peers.',
      ]),
    );

    const requirementTexts = itemTexts(parsed.jobOffer.requirementItems);
    expect(requirementTexts).not.toContain('This is you');
    expect(requirementTexts).not.toContain('This is your role');
    expect(requirementTexts).not.toContain('Translate');
    expect(requirementTexts).not.toContain('into prototypes and production-ready technical solutions;');
    expect(requirementTexts).not.toContain('Solid technical scoping,');
    expect(parsed.jobOffer.requirements).not.toContain('Translate requirements into prototypes and production-ready technical solutions;');
    expect(parsed.jobOffer.preferredRequirements).not.toContain('This is your role');
    expect(parsed.jobOffer.preferredRequirements).not.toContain('Design and maintain BFF/backend services.');

    expect(parsed.jobOffer.requirementItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: '5+ years with Node.js.',
          category: 'experience',
          minYears: 5,
        }),
        expect.objectContaining({
          text: 'English intermediate',
          category: 'language',
        }),
        expect.objectContaining({
          text: 'Solid technical scoping, requirements translation, and full SDLC ownership.',
          category: 'general',
        }),
      ]),
    );
    expect(findTechnologyClaim(parsed, 'NestJS')).toEqual(expect.objectContaining({ relationship: 'alternative' }));
    expect(findTechnologyClaim(parsed, 'Express')).toEqual(
      expect.objectContaining({
        relationship: 'alternative',
        alternativeGroup: findTechnologyClaim(parsed, 'NestJS').alternativeGroup,
      }),
    );
    expect(findTechnologyClaim(parsed, 'Node.js')).toEqual(expect.objectContaining({ relationship: 'all' }));
    expect(findTechnologyClaim(parsed, 'GitLab')).toEqual(expect.objectContaining({ relationship: 'all' }));
  });

  it('parses the Wispok supervised description into required, preferred and responsibility segments', () => {
    const description = [
      'Rol: Desarrollador Backend Mid-Level',
      'Modalidad: Híbrida',
      'Experiencia requerida: 3 a 5 años en desarrollo backend profesional',
      'Buscamos a alguien con experiencia real en: Dominio de JavaScript y TypeScript Desarrollo de APIs RESTful usando Express.js y NestJS Conocimiento de bases de datos relaciones y no relacionales. Conocimiento en uso de queues y procesamiento de tareas asíncronas. Comprensión profunda de principios SOLID, patrones de diseño, DDD, clean architecture, patrón hexagonal. Fluidez con Git, integración continua y metodologías ágiles como Scrum o Kanban.',
      'Deseable: Conocimientos prácticos de servicios en AWS.',
      'En este rol también estarás a cargo de: Diseñar e implementar arquitecturas desacopladas y escalables Mantener un alto estándar de calidad de código con pruebas automatizadas Colaborar con frontend, QA y producto en soluciones integrales Documentar tus desarrollos y participar activamente en la evolución del stack',
      'Lo que ofrecemos: Esquema de trabajo híbrido.',
    ].join(' ');

    const parsed = parseManualJob({
      rawText: ['Backend (Mid) | Wispok', 'Company: Wispok', 'Description:', description].join('\n'),
      sourceUrl: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4462986553',
      sourceLabel: 'LinkedIn Jobs supervised session',
      sourceType: 'LINKEDIN_JOBS_SUPERVISED',
      structuredJob: {
        title: 'Backend (Mid) | Wispok',
        company: 'Wispok',
        location: 'usa',
        technologies: ['JavaScript', 'TypeScript', 'Node.js', 'React', 'AWS', 'Git', 'REST API', 'Express', 'Next.js'],
        description,
      },
    });

    expect(parsed.jobOffer.seniority).toBe('mid');
    expect(parsed.jobOffer.modality).toEqual(['hybrid']);
    expect(parsed.jobOffer.requirements).toEqual(
      expect.arrayContaining([
        '3 a 5 años en desarrollo backend profesional',
        'Dominio de JavaScript y TypeScript',
        'Desarrollo de APIs RESTful usando Express.js y NestJS',
        'Conocimiento de bases de datos relaciones y no relacionales.',
        'Conocimiento en uso de queues y procesamiento de tareas asíncronas.',
        'Comprensión profunda de principios SOLID, patrones de diseño, DDD, clean architecture, patrón hexagonal.',
        'Fluidez con Git, integración continua y metodologías ágiles como Scrum o Kanban.',
      ]),
    );
    expect(parsed.jobOffer.preferredRequirements).toEqual(['Conocimientos prácticos de servicios en AWS.']);
    expect(parsed.jobOffer.responsibilities).toEqual(
      expect.arrayContaining([
        'Diseñar e implementar arquitecturas desacopladas y escalables',
        'Mantener un alto estándar de calidad de código con pruebas automatizadas',
        'Colaborar con frontend, QA y producto en soluciones integrales',
        'Documentar tus desarrollos y participar activamente en la evolución del stack',
      ]),
    );
    expect(parsed.jobOffer.requirementItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: '3 a 5 años en desarrollo backend profesional',
          requirementLevel: 'required',
          minYears: 3,
        }),
      ]),
    );
    expect(parsed.jobOffer.technologyClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ technology: 'JavaScript', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'TypeScript', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'REST API', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'Express', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'NestJS', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'Git', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'AWS', requirementLevel: 'preferred' }),
      ]),
    );
    expect(findTechnologyClaim(parsed, 'Git')).toEqual(expect.objectContaining({ relationship: 'all' }));
    expect(findTechnologyClaim(parsed, 'Scrum')).toEqual(expect.objectContaining({ relationship: 'all' }));
    expect(findTechnologyClaim(parsed, 'Kanban')).toEqual(expect.objectContaining({ relationship: 'all' }));
    expect(parsed.jobOffer.technologyClaims.some((claim) => claim.technology === 'AWS' && claim.requirementLevel === 'required')).toBe(false);
  });

  it('parses the Artax supervised description and filters LinkedIn UI noise', () => {
    const description = [
      'Modalidad: Híbrido',
      'Responsabilidades Desarrollar y mantener servicios fullstack utilizando Node.js y Next.js Diseñar APIs REST eficientes y seguras y participar en integraciones SOAP Aplicar buenas prácticas de programación, diseño limpio y uso de patrones Ejecutar consultas SQL avanzadas y participar en diseño de bases de datos Colaborar con el equipo en entornos ágiles Scrum e iteraciones planificadas',
      'Requisitos excluyentes +5 años de experiencia en desarrollo fullstack Conocimientos avanzados en Node.js, TypeScript, Express y Next.js Dominio de SQL Experiencia en diseño de APIs REST y SOAP Experiencia trabajando con metodologías ágiles Scrum Formación en Ingeniería, Lic. en Sistemas o carreras afines',
      'Requisitos deseables Experiencia en Python para automatizaciones o scripting Conocimientos básicos/intermedios en Docker, Kubernetes y Elastic Stack Manejo de herramientas como Postman, Git y UML',
      'A tu perfil y tu currículum les faltan algunos requisitos, aunque podrían tenerte en cuenta por tu trayectoria.',
      'Mira una comparación con otros solicitantes',
    ].join(' ');

    const parsed = parseManualJob({
      rawText: ['Fullstack Developer (Node - Next.js) | Artax Advisors', 'Description:', description].join('\n'),
      sourceUrl: 'https://www.linkedin.com/jobs/search-results/?currentJobId=4460621968',
      sourceLabel: 'LinkedIn Jobs supervised session',
      sourceType: 'LINKEDIN_JOBS_SUPERVISED',
      structuredJob: {
        title: 'Fullstack Developer (Node - Next.js) | Artax Advisors',
        company: 'Artax Advisors',
        location: 'Buenos Aires',
        seniority: 'senior',
        technologies: ['TypeScript', 'Node.js', 'Express', 'React', 'Docker', 'AWS', 'Git', 'Next.js', 'REST API', 'Python'],
        description,
        requirements: [
          'A tu perfil y tu currículum les faltan algunos requisitos, aunque podrían tenerte en cuenta por tu trayectoria.',
          '💡 Requisitos excluyentes',
          '✨ Requisitos deseables',
        ],
      },
    });

    expect(parsed.jobOffer.seniority).toBe('senior');
    expect(parsed.jobOffer.modality).toEqual(['hybrid']);
    expect(parsed.jobOffer.requirements).toEqual(
      expect.arrayContaining([
        '+5 años de experiencia en desarrollo fullstack',
        'Conocimientos avanzados en Node.js, TypeScript, Express y Next.js',
        'Dominio de SQL',
        'Experiencia en diseño de APIs REST y SOAP',
        'Experiencia trabajando con metodologías ágiles Scrum',
        'Formación en Ingeniería, Lic. en Sistemas o carreras afines',
      ]),
    );
    expect(parsed.jobOffer.preferredRequirements).toEqual(
      expect.arrayContaining([
        'Experiencia en Python para automatizaciones o scripting',
        'Conocimientos básicos/intermedios en Docker, Kubernetes y Elastic Stack',
        'Manejo de herramientas como Postman, Git y UML',
      ]),
    );
    expect(parsed.jobOffer.responsibilities).toEqual(
      expect.arrayContaining([
        'Desarrollar y mantener servicios fullstack utilizando Node.js y Next.js',
        'Diseñar APIs REST eficientes y seguras y participar en integraciones SOAP',
        'Ejecutar consultas SQL avanzadas y participar en diseño de bases de datos',
      ]),
    );
    expect(parsed.jobOffer.requirements.join(' ')).not.toContain('A tu perfil');
    expect(parsed.jobOffer.requirements).not.toContain('Requisitos excluyentes');
    expect(parsed.jobOffer.requirements).not.toContain('Requisitos deseables');
    expect(parsed.jobOffer.requirementItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: '+5 años de experiencia en desarrollo fullstack',
          requirementLevel: 'required',
          minYears: 5,
        }),
      ]),
    );
    expect(parsed.jobOffer.technologyClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ technology: 'Node.js', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'TypeScript', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'Express', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'Next.js', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'SQL', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'REST API', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'SOAP API', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'Scrum', requirementLevel: 'required' }),
        expect.objectContaining({ technology: 'Python', requirementLevel: 'preferred' }),
        expect.objectContaining({ technology: 'Docker', requirementLevel: 'preferred' }),
        expect.objectContaining({ technology: 'Kubernetes', requirementLevel: 'preferred' }),
        expect.objectContaining({ technology: 'Elastic Stack', requirementLevel: 'preferred' }),
        expect.objectContaining({ technology: 'Postman', requirementLevel: 'preferred' }),
        expect.objectContaining({ technology: 'Git', requirementLevel: 'preferred' }),
        expect.objectContaining({ technology: 'UML', requirementLevel: 'preferred' }),
      ]),
    );
    expect(findTechnologyClaim(parsed, 'REST API', 'REST y SOAP')).toEqual(expect.objectContaining({ relationship: 'all' }));
    expect(findTechnologyClaim(parsed, 'SOAP API', 'REST y SOAP')).toEqual(expect.objectContaining({ relationship: 'all' }));
  });
});
