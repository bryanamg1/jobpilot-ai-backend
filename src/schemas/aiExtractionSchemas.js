import { z } from 'zod';
import { CERTAINTY } from '../constants/certainty.js';

const certaintyValues = Object.values(CERTAINTY);

const certaintyFactSchema = z
  .object({
    field: z.string().min(1),
    value: z.string().nullable(),
    certainty: z.enum(certaintyValues),
    source: z.string().min(1),
  })
  .strict();

const salarySchema = z
  .object({
    currency: z.string().default('USD'),
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
    display: z.string().min(1),
  })
  .strict();

export const aiJobExtractionSchema = z
  .object({
    title: z.string().nullable(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    recruiterEmail: z.string().nullable(),
    modality: z.array(z.enum(['remote', 'hybrid', 'onsite'])).default([]),
    seniority: z.enum(['junior', 'mid', 'senior', 'lead', 'unknown']).default('unknown'),
    englishRequirement: z.enum(['basic', 'intermediate', 'advanced', 'unknown']).default('unknown'),
    technologies: z.array(z.string()).default([]),
    requirements: z.array(z.string()).max(12).default([]),
    instructions: z.array(z.string()).max(12).default([]),
    salary: salarySchema.nullable(),
    flags: z
      .object({
        requiresVisa: z.boolean().default(false),
        asksForSalary: z.boolean().default(false),
        legalQuestions: z.boolean().default(false),
        visibleContactCallToAction: z.boolean().default(false),
        requiresRelocation: z.boolean().default(false),
        requiresTravel: z.boolean().default(false),
        requiresImmediateAvailability: z.boolean().default(false),
      })
      .strict(),
    certaintyMap: z.array(certaintyFactSchema).default([]),
    summary: z.string().max(500).nullable(),
  })
  .strict();
