import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
function harness() {
  const pending = [], reports = [];
  const button = { dataset: { bvid: 'video', saved: 'false' }, disabled: false, hidden: false, setAttribute() {}, focus() { reports.push('focus'); }, offsetParent: {} };
  const context = vm.createContext({ document: { querySelector: () => ({ hidden: false, textContent: '' }), querySelectorAll: () => [button] }, window: { addEventListener() {} }, detail: { hidden: true }, heroItem: null, heroLater: button, detailLater: button, detailGeneration: 1, libraryState: { loadedAt: { later: 1 } }, markLibraryStale() {}, recommendStatus: {}, serviceRequest: path => new Promise((resolve, reject) => pending.push({ path, resolve, reject })) });
  const a = source.indexOf('let laterSaved =');
  const b = source.indexOf('// Hero: large artwork', a);
  const c = source.indexOf('function showLaterState(');
  const d = source.indexOf("detailLater.addEventListener", c);
  vm.runInContext(source.slice(a, b) + source.slice(c, d), context);
  return { context, pending, button, reports };
}
test('old watch-later mutation cannot change the new account saved state or focus', async () => {
  const h = harness();
  const mutation = h.context.toggleLater(h.button, text => h.reports.push(text));
  h.context.refreshLaterSaved();
  h.pending[1].resolve({ items: [] });
  await Promise.resolve();
  h.pending[0].resolve({ saved: true });
  await mutation;
  assert.equal(h.button.dataset.saved, 'false');
  assert.equal(vm.runInContext("laterSaved.has('video')", h.context), false);
  assert.deepEqual(h.reports, []);
});
test('old detail watch-later lookup cannot change the new account marker', async () => {
  const h = harness();
  h.context.showLaterState('video', 1);
  h.context.refreshLaterSaved();
  h.pending[1].resolve({ items: [] });
  await Promise.resolve();
  h.pending[0].resolve({ saved: true });
  await Promise.resolve();
  assert.equal(h.button.dataset.saved, 'false');
});
test('old mutation errors do not report against the new account', async () => {
  const h = harness();
  const mutation = h.context.toggleLater(h.button, text => h.reports.push(text));
  h.context.refreshLaterSaved();
  h.pending[1].resolve({ items: [] });
  h.pending[0].reject(new Error('old account failure'));
  await mutation;
  assert.deepEqual(h.reports, []);
  assert.equal(h.button.disabled, false);
});
test('current account mutation updates its marker and reports success', async () => {
  const h = harness();
  const mutation = h.context.toggleLater(h.button, text => h.reports.push(text));
  h.pending[0].resolve({ saved: true });
  await mutation;
  assert.equal(h.button.dataset.saved, 'true');
  assert.equal(vm.runInContext("laterSaved.has('video')", h.context), true);
  assert.deepEqual(h.reports, ['已添加到稍后再看', 'focus']);
});
test('removing a saved video clears its marker and reports success', async () => {
  const h = harness();
  h.button.dataset.saved = 'true';
  const mutation = h.context.toggleLater(h.button, text => h.reports.push(text));
  assert.equal(h.pending[0].path, '/me/later/remove?bvid=video');
  h.pending[0].resolve({ saved: false });
  await mutation;
  assert.equal(h.button.dataset.saved, 'false');
  assert.equal(vm.runInContext("laterSaved.has('video')", h.context), false);
  assert.deepEqual(h.reports, ['已从稍后再看移除', 'focus']);
});
test('visible detail refreshes watch-later state when account changes', async () => {
  const h = harness();
  h.context.detail.hidden = false;
  h.context.refreshLaterSaved();
  assert.equal(h.pending[0].path, '/me/later/state?bvid=video');
  h.pending[0].resolve({ saved: true });
  h.pending[1].resolve({ items: [{ bvid: 'video' }] });
  await Promise.resolve();
  assert.equal(h.button.dataset.saved, 'true');
});
