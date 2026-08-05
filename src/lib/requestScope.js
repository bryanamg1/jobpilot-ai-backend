import { AsyncLocalStorage } from 'node:async_hooks';

const requestScopeStorage = new AsyncLocalStorage();

export function runWithRequestScope(scope, callback) {
  return requestScopeStorage.run(scope, callback);
}

export function getRequestScope() {
  return requestScopeStorage.getStore() ?? null;
}
