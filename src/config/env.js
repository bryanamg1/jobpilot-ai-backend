import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4300),
  LOG_LEVEL: z.string().default('info'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(60),
  AUTOMATION_KILL_SWITCH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  STORAGE_MODE: z.enum(['auto', 'memory', 'mysql']).default('auto'),
  MYSQL_HOST: z.string().optional(),
  MYSQL_PORT: z.coerce.number().default(3306),
  MYSQL_DATABASE: z.string().optional(),
  MYSQL_USER: z.string().optional(),
  MYSQL_PASSWORD: z.string().optional(),
  MYSQL_SSL: z.string().default('false'),
  REDIS_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.6-terra'),
  OPENAI_FEATURE_MODE: z.enum(['disabled', 'assist']).default('disabled'),
  OPENAI_REASONING_EFFORT: z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max']).default('low'),
  OPENAI_TEXT_VERBOSITY: z.enum(['low', 'medium', 'high']).default('medium'),
  OPENAI_TIMEOUT_MS: z.coerce.number().default(20_000),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  GOOGLE_GMAIL_LABEL: z.string().default('Postulaciones/Por revisar'),
  GOOGLE_TOKEN_PATH: z.string().default('storage/tokens/gmail-oauth.json.enc'),
  GOOGLE_GMAIL_ALERT_QUERY: z
    .string()
    .default('("linkedin" OR "job alert" OR "hiring" OR "vacante" OR "oportunidad laboral") newer_than:30d'),
  GOOGLE_GMAIL_MAX_RESULTS: z.coerce.number().default(10),
  RESUME_STORAGE_DIR: z.string().default('storage/resumes'),
  RESUME_MAX_BYTES: z.coerce.number().default(5 * 1024 * 1024),
  EXTERNAL_RETRY_ATTEMPTS: z.coerce.number().default(2),
  EXTERNAL_RETRY_BASE_DELAY_MS: z.coerce.number().default(150),
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().default(3),
  CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce.number().default(30_000),
  OPERATIONS_QUEUE_NAME: z.string().default('jobpilot-operations'),
  OPERATIONS_QUEUE_RETRY_ATTEMPTS: z.coerce.number().default(3),
  OPERATIONS_QUEUE_RETRY_DELAY_MS: z.coerce.number().default(250),
  ENCRYPTION_KEY: z.string().optional(),
});

const parsed = envSchema.parse(process.env);

export const env = {
  ...parsed,
  isTest: parsed.NODE_ENV === 'test',
  isProduction: parsed.NODE_ENV === 'production',
  openAiConfigured: parsed.OPENAI_FEATURE_MODE === 'assist' && Boolean(parsed.OPENAI_API_KEY),
  mysqlConfigured: Boolean(
    parsed.MYSQL_HOST &&
      parsed.MYSQL_DATABASE &&
      parsed.MYSQL_USER &&
      typeof parsed.MYSQL_PASSWORD === 'string',
  ),
};
