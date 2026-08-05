import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1).max(160);
const stringList = z.array(nonEmptyString).min(1).max(64);

export const profileUpdateSchema = z.object({
  name: nonEmptyString.max(120),
  headlineTargets: stringList.max(12),
  location: nonEmptyString.max(120),
  availability: nonEmptyString.max(80),
  modalities: z.array(z.enum(['remote', 'hybrid', 'onsite'])).min(1).max(3),
  englishLevel: nonEmptyString.max(32),
  salaryExpectation: z.object({
    amount: z.coerce.number().positive().max(1_000_000),
    currency: z.string().trim().min(3).max(5),
    period: z.enum(['hourly', 'monthly', 'yearly']),
  }),
  publicLinks: z.object({
    github: z.url(),
    linkedin: z.url(),
  }),
  contact: z.object({
    email: z.email(),
  }),
  projects: z.array(nonEmptyString).min(1).max(24),
  technologies: z.array(nonEmptyString).min(1).max(128),
  knowledgeAreas: z.array(nonEmptyString).max(64).default([]),
  prohibitedClaims: z.array(nonEmptyString).max(64).default([]),
});
