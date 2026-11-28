import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
function harness() {
  const calls = [], pending = [];
  const tab = { dataset: { rid: '4' }, setAttribute() {}, focus() {} };
  const grid = { children: ['old'], contains: () => false, querySelectorAll: () => [], setAttribute() {}, replaceChildren(...items) { this.children = items; } };
  const context = vm.createContext({
    regionState: { request: 0, cache: new Map([[4, ['cached']]]) },
    regionTabs: { children: [tab], querySelector: () => tab }, regionGrid: grid,
    regionStatus: {}, regionLoading: {}, regionRetry: {}, document: {}, activePage: 'regions',
    setTimeout: () => 1, clearTimeout() {}, clock: String, videoCard: item => item,
    serviceRequest: path => { calls.push(path); return new Promise(resolve => pending.push(resolve)); },
  });
  const start = source.indexOf('async function selectRegion(');
  vm.runInContext(source.slice(start, source.indexOf("regionRetry.addEventListener('click'", start)), context);
  return { context, calls, pending, grid };
}
test('confirm refresh bypasses cached region and replaces content', async () => {
  const h = harness(); const request = h.context.selectRegion(4, false, true);
  assert.deepEqual(h.calls, ['/region?rid=4']);
  h.pending[0]({ items: ['fresh'] }); await request;
  assert.deepEqual(h.grid.children, ['fresh']);
});
test('older region response cannot overwrite a newer refresh', async () => {
  const h = harness(); const old = h.context.selectRegion(4, false, true);
  const fresh = h.context.selectRegion(4, false, true);
  h.pending[1]({ items: ['new'] }); await fresh;
  h.pending[0]({ items: ['old'] }); await old;
  assert.deepEqual(h.grid.children, ['new']);
});
test('normal navigation may reuse cache; confirm and retry explicitly refresh', async () => {
  const h = harness(); await h.context.selectRegion(4, false);
  assert.equal(h.calls.length, 0);
  assert.match(source, /selectRegion\(region\.rid, true, true\)/);
  assert.match(source, /selectRegion\(regionState\.rid, true, true\)/);
});
