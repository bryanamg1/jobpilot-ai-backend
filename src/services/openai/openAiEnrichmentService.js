import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { env } from '../../config/env.js';
import { retryOperation } from '../../lib/retry.js';
import { aiJobExtractionSchema } from '../../schemas/aiExtractionSchemas.js';

const SYSTEM_PROMPT = `
Extraes hechos estructurados de una vacante a partir de una unica fuente de texto.

Rules:
- Responde siempre en espanol.
- Usa solo hechos presentes en el texto provisto.
- Nunca inventes empresa, salario, anos de experiencia, nivel de ingles, correo del recruiter ni tecnologias.
- Usa certeza CONFIRMED solo para hechos explicitos en el texto.
- Usa certeza INFERRED solo para normalizaciones seguras y de bajo riesgo derivadas del texto explicito.
- Usa certeza REQUIRES_APPROVAL para salario u otros datos sensibles.
- Usa certeza UNKNOWN cuando el texto no respalde el dato.
- Usa certeza PROHIBITED solo para hechos que nunca deban usarse automaticamente.
- Mantiene las fuentes cortas y referidas al origen, por ejemplo "raw_text" o "deterministic_snapshot".
- Mantiene listas sin duplicados y concisas.
`.trim();

export function createOpenAiEnrichmentService(options = {}) {
  const config = options.config ?? env;
  const client = options.client ?? createClient(config);
  const breaker = options.breaker ?? null;

  return {
    async enrichManualJob(input, deterministicParse) {
      if (config.isTest) {
        return disabledResult('test_mode', 'La extraccion con OpenAI se desactiva durante pruebas automatizadas.');
      }

      if (config.OPENAI_FEATURE_MODE === 'disabled') {
        return disabledResult('disabled', 'La extraccion con OpenAI esta deshabilitada.');
      }

      if (!config.OPENAI_API_KEY) {
        return disabledResult('missing_api_key', 'Todavia no hay una clave de OpenAI configurada.');
      }

      if (!client) {
        return disabledResult('client_unavailable', 'El cliente de OpenAI no esta disponible.');
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
                    format: zodTextFormat(aiJobExtractionSchema, 'job_offer_extraction'),
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
                          text: buildUserPrompt(input, deterministicParse),
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

        if (!response.output_parsed) {
          return disabledResult('empty_output', 'OpenAI no devolvio una extraccion estructurada.');
        }

        return {
          applied: true,
          mode: 'hybrid',
          provider: 'openai',
          model: config.OPENAI_MODEL,
          warnings: [],
          extracted: response.output_parsed,
        };
      } catch (error) {
        return {
          applied: false,
          mode: 'deterministic',
          provider: 'openai',
          model: config.OPENAI_MODEL,
          warnings: [formatError(error)],
          extracted: null,
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
  if (config.isTest || config.OPENAI_FEATURE_MODE === 'disabled' || !config.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({
    apiKey: config.OPENAI_API_KEY,
    timeout: config.OPENAI_TIMEOUT_MS,
  });
}

function disabledResult(code, message) {
  return {
    applied: false,
    mode: 'deterministic',
    provider: 'openai',
    model: null,
    warnings: [`${code}: ${message}`],
    extracted: null,
  };
}

function formatError(error) {
  const name = error?.name ?? 'Error';
  const message = error?.message ?? 'Error desconocido de OpenAI';
  return `openai_error:${name}:${message}`;
}

function buildUserPrompt(input, deterministicParse) {
  return `
Responde siempre en espanol.

Etiqueta de la fuente: ${input.sourceLabel || 'Entrada manual'}
Source URL: ${input.sourceUrl || 'N/A'}

Texto bruto de la vacante:
${input.rawText}

Snapshot determinista:
${JSON.stringify(deterministicParse.jobOffer, null, 2)}
`.trim();
}
