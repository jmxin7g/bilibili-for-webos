import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
test('continue watching and resume positions stay with their account', () => {
  const storage = new Map([['history', '[{"bvid":"unowned"}]']]);
  const context = vm.createContext({ accountIdentity: 'A', localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, current: { bvid: 'video', page: 1, duration: 100 }, video: {} });
  const start = source.indexOf('function progressKey(');
  vm.runInContext(source.slice(start, source.indexOf('\nlet playbackGeneration', start)), context);
  const historyStart = source.indexOf('function readHistory()');
  vm.runInContext(source.slice(historyStart, source.indexOf('function historyCard(', historyStart)), context);
  storage.set(context.progressKey('video'), '30'); context.recordHistory();
  context.accountIdentity = 'B';
  assert.equal(context.readHistory().length, 0);
  assert.equal(storage.get(context.progressKey('video')), undefined);
  storage.set(context.progressKey('video'), '70'); context.recordHistory();
  context.accountIdentity = 'A';
  assert.equal(context.readHistory()[0].position, 30);
  assert.equal(storage.get(context.progressKey('video')), '30');
  context.accountIdentity = null;
  assert.equal(context.readHistory().length, 0);
  assert.ok(storage.has('history'), 'unowned legacy records remain untouched');
});

test('account changes immediately refresh continue watching and the hero resume label', () => {
  let handler, renders = 0, heroUpdates = 0;
  const context = vm.createContext({ window: { addEventListener(name, callback) { assert.equal(name, 'accountchange'); handler = callback; } }, renderHistory() { renders++; }, heroItem: { bvid: 'video' }, showHero() { heroUpdates++; } });
  const start = source.indexOf("window.addEventListener('accountchange', () => {");
  vm.runInContext(source.slice(start, source.indexOf('\n});', start) + 4), context);
  handler();
  assert.equal(renders, 1);
  assert.equal(heroUpdates, 1);
});
