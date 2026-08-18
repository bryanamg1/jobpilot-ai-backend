import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { env } from '../../config/env.js';
import { userFacingText } from '../../constants/userFacingText.js';
import { retryOperation } from '../../lib/retry.js';
import { aiDraftPreviewSchema } from '../../schemas/aiDraftSchemas.js';
import { buildDraftContext } from './draftContextBuilder.js';
import { buildDraftPrompt } from './draftPromptBuilder.js';

const SYSTEM_PROMPT = `
Generas un borrador de postulacion laboral en espanol.

Rules:
- El correo debe sonar humano, breve, directo y veraz.
- Usa solo informacion del contexto provisto.
- Nunca inventes experiencia, anos, seniority, nivel de ingles, salario, autorizacion laboral, reubicacion ni respuestas legales.
- No menciones razonamiento interno, hechos del sistema, certezas, inferencias ni etiquetas tecnicas.
- Mantene el cuerpo entre 150 y 250 palabras.
- Devuelve solo la salida estructurada solicitada.
`.trim();

export function createOpenAiDraftService(options = {}) {
  const config = options.config ?? env;
  const client = options.client ?? createClient(config);
  const breaker = options.breaker ?? null;

  return {
    async generateDraft(jobAnalysis, generationOptions = {}) {
      const context = buildDraftContext(jobAnalysis, generationOptions);
      const fallback = buildFallbackDraft(jobAnalysis, generationOptions, context);

      if (config.isTest || config.OPENAI_FEATURE_MODE !== 'assist' || !config.OPENAI_API_KEY || !client) {
        return {
          ...fallback,
          generation: {
            mode: 'deterministic',
            provider: 'openai',
            model: null,
            warnings: [...fallback.generation.warnings],
          },
        };
      }

      try {
        const response = await executeProviderCall(
          breaker,
          () =>
            retryOperation(
              () =>
                client.responses.parse({
                  model: config.OPENAI_MODEL,
                  reasoning: {
                    effort: config.OPENAI_REASONING_EFFORT,
                  },
                  text: {
                    verbosity: config.OPENAI_TEXT_VERBOSITY,
                    format: zodTextFormat(aiDraftPreviewSchema, 'job_application_draft_preview'),
                  },
                  input: [
                    {
                      role: 'system',
                      content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
                    },
                    {
                      role: 'user',
                      content: [
                        {
                          type: 'input_text',
                          text: buildDraftPrompt(context),
                        },
                      ],
                    },
                  ],
                }),
              {
                attempts: config.EXTERNAL_RETRY_ATTEMPTS,
                baseDelayMs: config.isTest ? 0 : config.EXTERNAL_RETRY_BASE_DELAY_MS,
              },
            ),
        );

        const parsed = response.output_parsed;
        if (!parsed) {
          return fallback;
        }

        return {
          ...fallback,
          subject: sanitizeGeneratedText(parsed.subject) || fallback.subject,
          body: sanitizeGeneratedText(parsed.body) || fallback.body,
          highlights: dedupeStrings([...fallback.highlights, ...(parsed.highlights ?? [])]).slice(0, 6),
          factsUsed: mergeFacts(fallback.factsUsed, parsed.factsUsed ?? []),
          generation: {
            mode: 'hybrid',
            provider: 'openai',
            model: config.OPENAI_MODEL,
            warnings: dedupeStrings([...fallback.generation.warnings, ...(parsed.warnings ?? [])]),
          },
        };
      } catch {
        return {
          ...fallback,
          generation: {
            mode: 'deterministic',
            provider: 'openai',
            model: config.OPENAI_MODEL,
            warnings: [
              ...fallback.generation.warnings,
              'No se pudo personalizar el borrador con IA en este intento. Se muestra una version segura para revisar manualmente.',
            ],
          },
        };
      }
    },
  };
}

async function executeProviderCall(breaker, operation) {
  if (!breaker) {
    return operation();
  }

  return breaker.execute(operation);
}

function createClient(config) {
  if (config.isTest || config.OPENAI_FEATURE_MODE !== 'assist' || !config.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({
    apiKey: config.OPENAI_API_KEY,
    timeout: config.OPENAI_TIMEOUT_MS,
  });
}

export function buildFallbackDraft(jobAnalysis, generationOptions = {}, existingContext = null) {
  const context = existingContext ?? buildDraftContext(jobAnalysis, generationOptions);
  const recipient = context.job.recruiterEmail;
  const approvals = (jobAnalysis.match.approvals ?? []).map((item) => `${item.field}: ${item.reason}`);
  const blocked = [...(jobAnalysis.match.excludedByRules ?? [])];

  if (blocked.length) {
    return {
      status: 'BLOCKED',
      recipient,
      subject: null,
      body: null,
      highlights: context.highlights,
      factsUsed: context.factsUsed,
      approvalsRequired: approvals,
      blockedReasons: blocked,
      generation: {
        mode: 'deterministic',
        provider: 'openai',
        model: null,
        warnings: [userFacingText.draft.blockedWarning],
      },
    };
  }

  const warnings = [...approvals];
  if (!recipient) {
    warnings.push(userFacingText.draft.recipientMissing);
  }
  if (jobAnalysis.resumeSelection?.label) {
    warnings.push(userFacingText.draft.selectedResume(jobAnalysis.resumeSelection.label));
  } else {
    warnings.push(userFacingText.draft.noResumeSelected);
  }

  return {
    status: approvals.length ? 'REVIEW_REQUIRED' : 'READY',
    recipient,
    subject: buildSubject(context),
    body: buildBody(context),
    highlights: context.highlights,
    factsUsed: context.factsUsed,
    approvalsRequired: approvals,
    blockedReasons: [],
    generation: {
      mode: 'deterministic',
      provider: 'openai',
      model: null,
      warnings,
    },
  };
}

function buildSubject(context) {
  if (context.job.title) {
    return `Postulacion para ${context.job.title} - Bryan Marquez`;
  }

  if (context.job.company) {
    return `Postulacion a ${context.job.company} - Bryan Marquez`;
  }

  return 'Postulacion laboral - Bryan Marquez';
}

function buildBody(context) {
  const paragraphs = [
    'Hola,',
    buildIntroParagraph(context),
    buildFitParagraph(context),
    buildProjectsParagraph(context),
    buildClosingParagraph(context),
    'Saludos,\\nBryan Marquez',
  ].filter(Boolean);

  return paragraphs.join('\\n\\n');
}

function buildIntroParagraph(context) {
  const roleReference = context.job.title
    ? `la posicion de ${context.job.title}`
    : 'la oportunidad que publicaron recientemente';

  if (context.job.company) {
    return `Mi nombre es Bryan Marquez y me gustaria postularme a ${roleReference} en ${context.job.company}. Me interesa especialmente sumar mi perfil a un equipo donde pueda aportar desde un stack JavaScript orientado a producto.`;
  }

  return `Mi nombre es Bryan Marquez y me gustaria postularme a ${roleReference}. Me interesa especialmente aportar en un rol donde pueda trabajar sobre productos web y resolver necesidades concretas desde el desarrollo.`;
}

function buildFitParagraph(context) {
  const technologies = joinNaturalList(context.candidate.relevantTechnologies);
  const experiences = joinNaturalList(context.candidate.relevantExperience);
  const roleSentence = technologies
    ? `Mi experiencia hoy esta mas cerca de trabajar con ${technologies}`
    : 'Mi perfil esta orientado a desarrollo web con foco full stack';
  const experienceSentence = experiences
    ? `, especialmente en ${experiences}.`
    : '.';

  return `${roleSentence}${experienceSentence} Son puntos que veo alineados con lo que pide la vacante y con el tipo de aporte que puedo hacer desde el inicio, manteniendo una base practica y un enfoque de implementacion prolijo.`;
}

function buildProjectsParagraph(context) {
  const projects = joinNaturalList(context.candidate.relevantProjects);
  const availability = context.candidate.availability?.toLowerCase() ?? 'full time';
  const modalities = joinNaturalList(context.candidate.modalities);

  if (!projects) {
    return `Actualmente estoy en ${context.candidate.location} y tengo disponibilidad ${availability}. Tambien me resulta comodo trabajar en esquemas ${modalities} cuando el rol lo requiere.`;
  }

  return `Ademas, proyectos como ${projects} me ayudaron a consolidar una forma de trabajo orientada a construir, iterar y cuidar la calidad tecnica del producto. Actualmente estoy en ${context.candidate.location} y tengo disponibilidad ${availability}, con comodidad para trabajar en esquemas ${modalities}.`;
}

function buildClosingParagraph(context) {
  const resumeReference = context.job.title
    ? `la version de CV mas alineada con ${context.job.title}`
    : 'la version de CV mas alineada con la vacante';

  return `Si les interesa, con gusto puedo ampliar cualquier punto en una conversacion y compartir ${resumeReference}. Muchas gracias por el tiempo.`;
}

function joinNaturalList(values = []) {
  const normalized = values.filter(Boolean);
  if (!normalized.length) {
    return '';
  }
  if (normalized.length === 1) {
    return normalized[0];
  }
  if (normalized.length === 2) {
    return `${normalized[0]} y ${normalized[1]}`;
  }

  return `${normalized.slice(0, -1).join(', ')} y ${normalized.at(-1)}`;
}

function sanitizeGeneratedText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function mergeFacts(baseFacts, nextFacts) {
  return [...baseFacts, ...nextFacts].filter(
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

function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))];
}
