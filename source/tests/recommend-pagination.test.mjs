import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
const start = source.indexOf('let recommendBusy =');
const end = source.indexOf("window.addEventListener('accountchange', event => {", start);

function harness(responses) {
  const requests = [];
  const classList = { add() {}, remove() {} };
  const status = { textContent: '' };
  const retry = { hidden: true, addEventListener(type, callback) { this[type] = callback; } };
  const document = { querySelector: () => ({ classList }), activeElement: null };
  const makeCard = bvid => ({ dataset: { bvid }, classList, style: { setProperty() {} } });
  const grid = {
    children: [makeCard('old')],
    append(...cards) { this.children.push(...cards); },
    closest: () => ({ classList }),
    get lastElementChild() { return this.children.at(-1); },
  };
  const observers = [];
  const context = vm.createContext({
    document, recommendGrid: grid, recommendStatus: status, recommendRetry: retry, heroItem: true,
    heroItems: [{ bvid: 'featured' }],
    setHeroItems(items) { context.heroItems = items; },
    replaceKeepingFocus(row, cards) { row.children = cards; },
    focusCard(card) { document.activeElement = card; },
    clock: String, videoCard: item => makeCard(item.bvid),
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      disconnect() { this.target = null; }
      observe(target) { this.target = target; }
    },
    serviceRequest: async path => {
      requests.push(path);
      const items = responses.shift();
      if (items instanceof Error) throw items;
      return { items: items.map(bvid => ({ bvid, duration: 10 })) };
    },
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, document, grid, retry, status, more: observers[1], requests };
}

test('recommendations skip a duplicate batch and observe the new tail', async () => {
  const h = harness([['old', 'featured'], ['new', 'new']]);
  await h.context.loadRecommend(false, true);
  assert.deepEqual(h.requests, ['/recommend?round=1', '/recommend?round=2']);
  assert.deepEqual(h.grid.children.map(card => card.dataset.bvid), ['old', 'new']);
  assert.equal(h.more.target, h.grid.lastElementChild);
  assert.equal(h.retry.hidden, true);
});

test('recommendations stop after three duplicate batches and offer a manual continuation', async () => {
  const h = harness([['old'], [], ['featured'], ['new']]);
  await h.context.loadRecommend(false, true);
  assert.equal(h.requests.length, 3);
  assert.equal(h.more.target, null);
  assert.equal(h.retry.hidden, false);
  assert.equal(h.retry.textContent, '继续加载');
  h.document.activeElement = h.retry;
  await h.retry.click();
  assert.equal(h.requests.at(-1), '/recommend?round=4');
  assert.equal(h.retry.hidden, true);
  assert.equal(h.document.activeElement, h.grid.lastElementChild);
});

test('recommendation failure preserves the list and retries the failed round', async () => {
  const h = harness([['old'], new Error('offline'), ['new']]);
  const first = h.grid.children[0];
  await h.context.loadRecommend(false, true);
  assert.equal(h.grid.children.length, 1);
  assert.equal(h.grid.children[0], first);
  assert.equal(h.status.textContent, '推荐加载失败：offline');
  assert.equal(h.retry.textContent, '重试加载');
  await h.retry.click();
  assert.deepEqual(h.requests, ['/recommend?round=1', '/recommend?round=2', '/recommend?round=2']);
  assert.equal(h.grid.children.length, 2);
});

test('startup dismisses its splash after the account picker even with recommendations pending', async () => {
  let accountReady, recommendationsReady;
  const account = new Promise(resolve => { accountReady = resolve; });
  const recommendations = new Promise(resolve => { recommendationsReady = resolve; });
  const splash = { hidden: false };
  let opened = false;
  const context = vm.createContext({
    window: { initialAccountReady: account }, localStorage: { getItem: () => null },
    loadRecommend: () => recommendations,
    document: { querySelector: () => splash },
    openProfilePicker: async () => { opened = true; },
  });
  const start = source.indexOf('loadRecommend(false);\nwindow.initialAccountReady');
  const end = source.indexOf('// Bilibili covers', start);
  const startup = vm.runInContext(source.slice(start, end), context);
  assert.equal(splash.hidden, false);
  accountReady();
  await startup;
  assert.equal(opened, true);
  assert.equal(splash.hidden, true);
  recommendationsReady();
});
