import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app/auth.js', import.meta.url), 'utf8');
test('account requests bypass a cached response after switching users', async () => {
  let account = 'first';
  const cache = new Map();
  const context = vm.createContext({
    window: { addEventListener() {} }, AbortSignal,
    // A fresh HTTP cache entry is legal for GET unless the caller bypasses it.
    fetch: async (url, options) => {
      if (options.method === 'POST') account = 'second';
      const data = options.cache !== 'no-store' && cache.has(url) ? cache.get(url) : { account };
      if (options.method === 'GET' && options.cache !== 'no-store') cache.set(url, data);
      return { ok: true, json: async () => data };
    },
  });
  vm.runInContext(source.slice(source.indexOf('let tvConnection;'), source.indexOf('function displayAccount(')), context);
  for (const path of ['/auth/status', '/auth/accounts', '/me/later', '/me/history', '/me/favorites']) {
    assert.equal((await context.window.serviceRequest(path)).account, 'first');
  }
  await context.window.serviceRequest('/auth/switch?mid=2', 'POST');
  for (const path of ['/auth/status', '/auth/accounts', '/me/later', '/me/history', '/me/favorites']) {
    assert.equal((await context.window.serviceRequest(path)).account, 'second', `${path} must use the current account`);
  }
});
