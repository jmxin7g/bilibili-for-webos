import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../app/search-requests.js', import.meta.url), 'utf8');
const { createSearchRequests } = vm.runInNewContext(source + '\n({ createSearchRequests });', { AbortController });

test('a superseded request cannot advance or finish the latest search', () => {
  const search = createSearchRequests();
  search.reset('old query');
  const previous = search.start();
  search.reset('new query');
  const current = search.start();
  assert.equal(previous.controller.signal.aborted, true);
  assert.equal(search.isCurrent(previous), false);
  assert.equal(current.keyword, 'new query');
  assert.equal(current.page, 1);
  search.advance(previous);
  search.finish(previous);
  assert.equal(search.isCurrent(current), true);
  search.finish(current);
  assert.equal(search.start().page, 1);
});

test('pagination advances on success and retries the same page after failure', () => {
  const search = createSearchRequests();
  search.reset('query');
  const first = search.start();
  assert.equal(search.start(), undefined);
  search.advance(first);
  search.finish(first);
  const next = search.start();
  assert.equal(next.page, 2);
  search.finish(next);
  assert.equal(search.start().page, 2);
  search.reset('');
  assert.equal(search.start(), undefined);
});
