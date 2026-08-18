import { describe, expect, it } from 'vitest';
import { buildDraftPrompt } from '../../src/services/openai/draftPromptBuilder.js';

const sampleContext = {
  candidate: {
    name: 'Bryan Marquez',
    location: 'Buenos Aires, Argentina',
    availability: 'Full time',
    modalities: ['remote', 'hybrid'],
    headlineTargets: ['Backend Developer'],
    publicLinks: {
      github: 'https://github.com/bryanamg1',
      linkedin: 'https://www.linkedin.com/in/bryan-marquez-dev/',
    },
    relevantTechnologies: ['Node.js', 'Express', 'MySQL'],
    relevantProjects: ['Social App', 'PronostIA'],
    relevantExperience: [
      'desarrollo de APIs y servicios con Node.js y Express',
      'pruebas de endpoints y validacion tecnica con Jest y Supertest',
    ],
  },
  job: {
    title: 'Backend Developer',
    company: 'Acme Labs',
    modality: ['remote'],
    location: 'Remote LATAM',
    technologies: ['Node.js', 'Express', 'MySQL'],
    sourceUrl: 'https://example.com/jobs/backend',
  },
  match: {
    score: 87,
    recommendation: 'RECOMMENDED',
    matchedTechnologies: ['Node.js', 'Express', 'MySQL'],
  },
  templateVariant: 'KNOWN_COMPANY_KNOWN_TITLE',
  constraints: {
    bannedPhrases: ['Mi stack confirmado', 'Empresa desconocida'],
  },
};

describe('draftPromptBuilder', () => {
  it('construye un prompt desacoplado y centrado en contexto relevante', () => {
    const prompt = buildDraftPrompt(sampleContext);

    expect(prompt).toContain('Tecnologias a priorizar: Node.js, Express, MySQL');
    expect(prompt).toContain('Proyectos que se pueden mencionar: Social App, PronostIA');
    expect(prompt).toContain('Plantilla sugerida: KNOWN_COMPANY_KNOWN_TITLE');
  });

  it('incluye las frases prohibidas para evitar razonamiento interno en la salida', () => {
    const prompt = buildDraftPrompt(sampleContext);

    expect(prompt).toContain('Mi stack confirmado');
    expect(prompt).toContain('Empresa desconocida');
  });
});
