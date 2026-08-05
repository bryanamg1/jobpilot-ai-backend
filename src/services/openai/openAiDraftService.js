import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { env } from '../../config/env.js';
import { CERTAINTY } from '../../constants/certainty.js';
import { aiDraftPreviewSchema } from '../../schemas/aiDraftSchemas.js';

const SYSTEM_PROMPT = `
You generate a cautious job-application email draft preview.

Rules:
- Never invent experience, years, English level, salary expectations, work authorization, relocation, or legal answers.
- Exclude facts with certainty UNKNOWN or PROHIBITED.
- Exclude sensitive facts that require approval unless the user already approved them.
- Keep the tone professional, concise, and truthful.
- Use only the provided candidate profile and analyzed job data.
- Mention fit through confirmed technologies, projects, and role alignment only.
- Return structured output only.
`.trim();

export function createOpenAiDraftService(options = {}) {
  const config = options.config ?? env;
  const client = options.client ?? createClient(config);

  return {
    async generateDraft(jobAnalysis) {
      const fallback = buildFallbackDraft(jobAnalysis);

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
        const response = await client.responses.parse({
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
                  text: buildPrompt(jobAnalysis, fallback),
                },
              ],
            },
          ],
        });

        const parsed = response.output_parsed;
        if (!parsed) {
          return fallback;
        }

        return {
          ...fallback,
          subject: parsed.subject,
          body: parsed.body,
          highlights: parsed.highlights,
          factsUsed: mergeFacts(fallback.factsUsed, parsed.factsUsed),
          generation: {
            mode: 'hybrid',
            provider: 'openai',
            model: config.OPENAI_MODEL,
            warnings: dedupeStrings([...fallback.generation.warnings, ...parsed.warnings]),
          },
        };
      } catch (error) {
        return {
          ...fallback,
          generation: {
            mode: 'deterministic',
            provider: 'openai',
            model: config.OPENAI_MODEL,
            warnings: [
              ...fallback.generation.warnings,
              `openai_error:${error?.name ?? 'Error'}:${error?.message ?? 'Unknown error'}`,
            ],
          },
        };
      }
    },
  };
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

export function buildFallbackDraft(jobAnalysis) {
  const recipient = jobAnalysis.jobOffer.recruiterEmail || null;
  const approvals = jobAnalysis.match.approvals.map((item) => `${item.field}: ${item.reason}`);
  const blocked = [...jobAnalysis.match.excludedByRules];
  const factsUsed = collectFacts(jobAnalysis);
  const highlights = factsUsed
    .filter((fact) => fact.field === 'technology' || fact.field === 'project' || fact.field === 'targetRole')
    .slice(0, 5)
    .map((fact) => fact.value);

  if (blocked.length) {
    return {
      status: 'BLOCKED',
      recipient,
      subject: null,
      body: null,
      highlights,
      factsUsed,
      approvalsRequired: approvals,
      blockedReasons: blocked,
      generation: {
        mode: 'deterministic',
        provider: 'openai',
        model: null,
        warnings: ['draft_blocked: offer contains prohibited or unverified requirements'],
      },
    };
  }

  const subject = `Application for ${jobAnalysis.jobOffer.title} - Bryan Marquez`;
  const body = [
    recipient ? `Hello,` : `Hello hiring team,`,
    '',
    `My name is Bryan Marquez and I am interested in the ${jobAnalysis.jobOffer.title} opportunity at ${jobAnalysis.jobOffer.company}.`,
    buildFitParagraph(jobAnalysis),
    buildProjectParagraph(jobAnalysis),
    'I would appreciate the opportunity to continue the conversation and share the most relevant resume version for this role.',
    '',
    'Best regards,',
    'Bryan Marquez',
    'Buenos Aires, Argentina',
    'GitHub: https://github.com/bryanamg1',
    'LinkedIn: https://www.linkedin.com/in/bryan-marquez-dev/',
  ]
    .filter(Boolean)
    .join('\n');

  const warnings = [...approvals];
  if (!recipient) {
    warnings.push('Recipient email is not visible in the source. Do not create a Gmail draft yet.');
  }

  return {
    status: approvals.length ? 'REVIEW_REQUIRED' : 'READY',
    recipient,
    subject,
    body,
    highlights,
    factsUsed,
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

function buildPrompt(jobAnalysis, fallbackDraft) {
  return `
Candidate profile:
${JSON.stringify(jobAnalysis.profile, null, 2)}

Job offer:
${JSON.stringify(jobAnalysis.jobOffer, null, 2)}

Match summary:
${JSON.stringify(jobAnalysis.match, null, 2)}

Fallback deterministic draft:
${JSON.stringify(
    {
      subject: fallbackDraft.subject,
      body: fallbackDraft.body,
      factsUsed: fallbackDraft.factsUsed,
      approvalsRequired: fallbackDraft.approvalsRequired,
      blockedReasons: fallbackDraft.blockedReasons,
    },
    null,
    2,
  )}
`.trim();
}

function collectFacts(jobAnalysis) {
  const facts = [];
  const certaintyByField = new Map(
    jobAnalysis.jobOffer.certaintyMap.map((entry) => [entry.field, entry]),
  );

  for (const technology of jobAnalysis.match.matchedTechnologies) {
    facts.push({
      field: 'technology',
      value: technology,
      certainty: CERTAINTY.CONFIRMED,
      source: 'candidate_profile',
    });
  }

  for (const project of jobAnalysis.jobOffer.title.toLowerCase().includes('backend')
    ? ['Social App', 'PronostIA']
    : ['TechStore']) {
    facts.push({
      field: 'project',
      value: project,
      certainty: CERTAINTY.CONFIRMED,
      source: 'candidate_profile',
    });
  }

  if (jobAnalysis.jobOffer.title) {
    facts.push({
      field: 'targetRole',
      value: jobAnalysis.jobOffer.title,
      certainty: certaintyByField.get('title')?.certainty ?? CERTAINTY.INFERRED,
      source: certaintyByField.get('title')?.source ?? 'job_offer',
    });
  }

  if (jobAnalysis.jobOffer.company && !/^unknown\b/i.test(jobAnalysis.jobOffer.company)) {
    facts.push({
      field: 'company',
      value: jobAnalysis.jobOffer.company,
      certainty: certaintyByField.get('company')?.certainty ?? CERTAINTY.INFERRED,
      source: certaintyByField.get('company')?.source ?? 'job_offer',
    });
  }

  return mergeFacts([], facts).filter(
    (fact) => fact.certainty !== CERTAINTY.UNKNOWN && fact.certainty !== CERTAINTY.PROHIBITED,
  );
}

function buildFitParagraph(jobAnalysis) {
  const technologies = jobAnalysis.match.matchedTechnologies.slice(0, 4);
  const roleFocus = jobAnalysis.profile.modalities.includes('remote')
    ? 'I am comfortable working in remote and hybrid environments.'
    : '';

  const techSentence = technologies.length
    ? `My confirmed stack includes ${technologies.join(', ')}, which aligns with the core requirements visible in the posting.`
    : 'My confirmed background aligns with the role focus described in the posting.';

  return [techSentence, roleFocus].filter(Boolean).join(' ');
}

function buildProjectParagraph(jobAnalysis) {
  const projects = collectFacts(jobAnalysis)
    .filter((fact) => fact.field === 'project')
    .map((fact) => fact.value)
    .slice(0, 2);

  if (!projects.length) {
    return null;
  }

  return `Relevant work includes ${projects.join(' and ')}, where I applied backend and frontend development practices with JavaScript-based stacks.`;
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
