import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { env } from '../../config/env.js';
import { retryOperation } from '../../lib/retry.js';
import { aiJobExtractionSchema } from '../../schemas/aiExtractionSchemas.js';

const SYSTEM_PROMPT = `
You extract structured job-offer facts from a single source text.

Rules:
- Only use facts present in the provided source text.
- Never invent employer, salary, years of experience, English level, recruiter email, or technologies.
- Use certainty CONFIRMED only for explicit facts in the text.
- Use certainty INFERRED only for safe, low-risk normalization from explicit text.
- Use certainty REQUIRES_APPROVAL for salary or other sensitive facts.
- Use certainty UNKNOWN when the text does not support the fact.
- Use certainty PROHIBITED only for facts that must never be auto-used.
- Keep sources short and reference the text origin, such as "raw_text" or "deterministic_snapshot".
- Keep lists deduplicated and concise.
`.trim();

export function createOpenAiEnrichmentService(options = {}) {
  const config = options.config ?? env;
  const client = options.client ?? createClient(config);
  const breaker = options.breaker ?? null;

  return {
    async enrichManualJob(input, deterministicParse) {
      if (config.isTest) {
        return disabledResult('test_mode', 'OpenAI enrichment is disabled during automated tests');
      }

      if (config.OPENAI_FEATURE_MODE === 'disabled') {
        return disabledResult('disabled', 'OpenAI enrichment is disabled');
      }

      if (!config.OPENAI_API_KEY) {
        return disabledResult('missing_api_key', 'OpenAI API key is not configured');
      }

      if (!client) {
        return disabledResult('client_unavailable', 'OpenAI client is not available');
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
          return disabledResult('empty_output', 'OpenAI did not return a parsed extraction');
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
  const message = error?.message ?? 'Unknown OpenAI error';
  return `openai_error:${name}:${message}`;
}

function buildUserPrompt(input, deterministicParse) {
  return `
Source label: ${input.sourceLabel || 'Manual input'}
Source URL: ${input.sourceUrl || 'N/A'}

Raw job text:
${input.rawText}

Deterministic snapshot:
${JSON.stringify(deterministicParse.jobOffer, null, 2)}
`.trim();
}
