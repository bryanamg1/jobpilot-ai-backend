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

const questionSchema = z
  .string({
    required_error: 'La pregunta es obligatoria.',
    invalid_type_error: 'La pregunta es obligatoria.',
  })
  .trim()
  .min(1, 'La pregunta es obligatoria.')
  .max(240, 'La pregunta no puede superar 240 caracteres.');

const answerSchema = z
  .string({
    required_error: 'La respuesta es obligatoria.',
    invalid_type_error: 'La respuesta es obligatoria.',
  })
  .trim()
  .min(1, 'La respuesta es obligatoria.')
  .max(1200, 'La respuesta no puede superar 1200 caracteres.');

export const answerLibraryItemSchema = z.object({
  kind: z.enum(answerKindValues),
  question: questionSchema,
  answer: answerSchema,
  certainty: z.enum(certaintyValues),
  tags: z.array(nonEmptyString).max(12).default([]),
});

export const answerLibraryParamsSchema = z.object({
  answerId: z.string().trim().min(1, 'Answer id is required'),
});
