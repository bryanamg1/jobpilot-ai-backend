import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4300),
  LOG_LEVEL: z.string().default('info'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
  MYSQL_HOST: z.string().optional(),
  MYSQL_PORT: z.coerce.number().default(3306),
  MYSQL_DATABASE: z.string().optional(),
  MYSQL_USER: z.string().optional(),
  MYSQL_PASSWORD: z.string().optional(),
  MYSQL_SSL: z.string().default('false'),
  REDIS_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  GOOGLE_GMAIL_LABEL: z.string().default('Postulaciones/Por revisar'),
  ENCRYPTION_KEY: z.string().optional(),
});

const parsed = envSchema.parse(process.env);

export const env = {
  ...parsed,
  isTest: parsed.NODE_ENV === 'test',
  isProduction: parsed.NODE_ENV === 'production',
  mysqlConfigured: Boolean(
    parsed.MYSQL_HOST &&
      parsed.MYSQL_DATABASE &&
      parsed.MYSQL_USER &&
      typeof parsed.MYSQL_PASSWORD === 'string',
  ),
};
