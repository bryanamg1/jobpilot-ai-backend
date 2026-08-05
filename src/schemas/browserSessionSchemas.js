import { z } from 'zod';
import { BROWSER_SESSION_PROVIDER } from '../constants/browserSessions.js';

export const browserSessionStartSchema = z.object({
  provider: z
    .enum([
      BROWSER_SESSION_PROVIDER.LINKEDIN_JOBS,
      BROWSER_SESSION_PROVIDER.LINKEDIN_FEED,
      BROWSER_SESSION_PROVIDER.LINKEDIN_POST_SEARCH,
    ])
    .default(BROWSER_SESSION_PROVIDER.LINKEDIN_JOBS),
  startUrl: z.string().url().optional(),
});

export const browserSessionParamsSchema = z.object({
  sessionId: z.string().trim().min(1, 'Browser session id is required'),
});

export const browserSessionNavigateSchema = z.object({
  url: z.string().url('Browser navigation requires a valid URL'),
});
