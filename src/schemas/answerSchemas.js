import { z } from 'zod';
import { CERTAINTY } from '../constants/certainty.js';

const certaintyValues = Object.values(CERTAINTY);
const answerKindValues = [
  'salaryExpectation',
  'englishLevel',
  'availability',
  'workAuthorization',
  'relocation',
  'travel',
  'location',
  'legalQuestions',
  'custom',
];

const nonEmptyString = z.string().trim().min(1).max(240);

export const answerLibraryItemSchema = z.object({
  kind: z.enum(answerKindValues),
  question: nonEmptyString,
  answer: z.string().trim().min(1).max(1200),
  certainty: z.enum(certaintyValues),
  tags: z.array(nonEmptyString).max(12).default([]),
});

export const answerLibraryParamsSchema = z.object({
  answerId: z.string().trim().min(1, 'Answer id is required'),
});
