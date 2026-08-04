import { env } from '../config/env.js';
import { createMemoryRepository } from './inMemory/memoryRepository.js';
import { createMysqlRepository } from './mysql/mysqlRepository.js';

let repository;

export function resolveStorageMode() {
  if (env.STORAGE_MODE === 'memory') {
    return 'memory';
  }

  if (env.STORAGE_MODE === 'mysql') {
    if (!env.mysqlConfigured) {
      throw new Error('STORAGE_MODE is set to mysql but MySQL is not fully configured.');
    }
    return 'mysql';
  }

  if (env.isTest) {
    return 'memory';
  }

  return env.mysqlConfigured ? 'mysql' : 'memory';
}

export function getRepository() {
  if (!repository) {
    const storageMode = resolveStorageMode();
    repository =
      storageMode === 'mysql'
        ? createMysqlRepository()
        : createMemoryRepository();
  }
  return repository;
}

export function resetRepositoryForTests() {
  repository = undefined;
}
