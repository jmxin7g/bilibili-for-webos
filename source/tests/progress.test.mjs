import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the shipped handlers together without copying the persistence logic.
const source = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
const code = [
  ['function saveProgress()', "document.querySelector('#form')"],
  ["video.addEventListener('playing'", "video.addEventListener('waiting'"],
  ["video.addEventListener('pause'", "video.addEventListener('ended'"],
  ['function readHistory()', 'function historyCard('],
].map(([start, end]) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))).join('\n');

function playerHarness() {
  const storage = new Map([['progress:course', '17'], ['progress:course:p2', '60']]);
  const handlers = new Map();
  const context = vm.createContext({
    current: { bvid: 'course', page: 2, pages: 101, title: 'Course', owner: 'Teacher', duration: 3600, errors: [], startupMs: null },
    progressReady: false, lastSavedPosition: 60, waitingAt: null, startingAt: 0,
    historyKey: () => 'history', markLibraryStale() {},
    progressKey: (bvid, page) => `progress:${bvid}${page > 1 ? `:p${page}` : ''}`,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
    qualityMenu: {}, qualitySwitch: { setAttribute() {} }, clearSubtitles() {},
    player: { hidden: false, classList: { remove() {} } }, playbackGeneration: 0,
    resolveController: new AbortController(), controlsTimer: undefined, clearTimeout,
    start: {}, home: {}, homeStatus: {}, homeRetry: {}, renderHistory() {}, heroItem: null,
    detail: { hidden: true }, detailStack: [], overlayOpen: () => false,
    returnTarget: { isConnected: true, getClientRects: () => [1], focus() {} },
    returnScroll: 0, window: { scrollTo() {} },
    replay: {}, playNext: {}, toggle: { dataset: {} }, playerStatus: {},
    showControls() {}, performance: { now: () => 100 },
    document: { visibilityState: 'visible' },
  });
  context.video = {
    readyState: 1, currentTime: 0, ended: false, duration: 3600,
    addEventListener: (name, handler) => handlers.set(name, handler),
    pause() { handlers.get('pause')(); }, removeAttribute() {}, load() {},
  };
  context.dashPlayer = { async unload() {
    context.video.currentTime = 0;
    context.video.readyState = 1;
    context.saveProgress();
  } };
  vm.runInContext(code, context);
  return { context, storage, handlers };
}

test('P2 metadata at zero cannot replace the saved resume position', () => {
  const { context, storage } = playerHarness();
  context.saveProgress();
  assert.equal(storage.get('progress:course:p2'), '60');
  assert.equal(storage.get('progress:course'), '17');
  assert.equal(storage.has('history'), false);
});

test('actual playback and pause save the P2 position and history', () => {
  const { context, storage, handlers } = playerHarness();
  context.video.currentTime = 90; context.video.readyState = 4;
  handlers.get('playing')(); context.video.pause();
  assert.equal(storage.get('progress:course:p2'), '90');
  assert.equal(JSON.parse(storage.get('history'))[0].page, 2);
  assert.equal(JSON.parse(storage.get('history'))[0].position, 90);
});

test('return saves once and ignores the media reset during unload', async () => {
  const { context, storage, handlers } = playerHarness();
  context.video.currentTime = 90; context.video.readyState = 4;
  handlers.get('playing')();
  await context.leavePlayer();
  context.saveProgress(); // pagehide after returning
  assert.equal(storage.get('progress:course:p2'), '90');
  assert.equal(storage.get('progress:course'), '17');
  assert.equal(JSON.parse(storage.get('history'))[0].position, 90);
});

test('a genuinely completed part still clears its resume position', () => {
  const { context, storage, handlers } = playerHarness();
  context.video.currentTime = 3600; context.video.readyState = 4;
  handlers.get('playing')(); context.video.ended = true;
  context.saveProgress();
  assert.equal(storage.get('progress:course:p2'), '0');
  assert.deepEqual(JSON.parse(storage.get('history')), []);
});
