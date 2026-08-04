import { env } from '../config/env.js';
import { createMemoryRepository } from './inMemory/memoryRepository.js';
import { createMysqlRepository } from './mysql/mysqlRepository.js';

let repository;

export function getRepository() {
  if (!repository) {
    repository = env.mysqlConfigured ? createMysqlRepository() : createMemoryRepository();
  }
  return repository;
}
