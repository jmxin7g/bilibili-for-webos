import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
function harness(activePage) {
  const calls = [];
  const handlers = {};
  const navItems = ['browse', 'popular'].map(name => ({
    dataset: { page: name },
    addEventListener: (type, fn) => handlers[name] = fn,
    focus() {},
  }));
  const context = vm.createContext({
    navItems, activePage,
    pageSelections: new Map([['browse', 'old-card']]),
    pagePositions: new Map([['browse', 500]]),
    window: { scrollTo: (...args) => calls.push(['scroll', ...args]) },
    showPage: name => { context.activePage = name; },
    renderHistory: () => calls.push('history'),
    loadRecommend: () => calls.push('recommend'),
    enterPage: () => calls.push('enter'),
  });
  const start = source.indexOf('for (const item of navItems) {\n  item.addEventListener');
  vm.runInContext(source.slice(start, source.indexOf("showPage('browse');", start)), context);
  return { context, calls, handlers };
}
test('activating recommendation refreshes both on reentry and on the current page', () => {
  for (const page of ['popular', 'browse']) {
    const h = harness(page);
    h.handlers.browse();
    assert.equal(h.context.activePage, 'browse');
    assert.equal(h.context.pageSelections.has('browse'), false);
    assert.equal(h.context.pagePositions.get('browse'), 0);
    assert.deepEqual(h.calls, [['scroll', 0, 0], 'history', 'recommend', 'enter']);
    h.handlers.browse();
    assert.equal(h.calls.filter(call => call === 'recommend').length, 2);
  }
});
test('other sidebar entries retain their navigation behavior', () => {
  const h = harness('browse'); h.handlers.popular();
  assert.equal(h.context.activePage, 'popular');
  assert.deepEqual(h.calls, ['enter']);
});

test('popular pagination keeps the first card for each BV within and across batches', async () => {
  const focused = [];
  const loadMore = {};
  const children = [{ dataset: { bvid: 'old' } }];
  const grid = {
    children, closest: () => ({ classList: { add() {}, remove() {} } }),
    append: card => children.push(card),
  };
  const context = vm.createContext({
    grid, loadMore, browseStatus: {}, nextPage: 2, popularDone: false,
    document: { activeElement: loadMore }, clock: String,
    serviceRequest: async path => {
      assert.equal(path, '/popular?page=2');
      return { items: ['old', 'new', 'new', 'another'].map(bvid => ({ bvid })), noMore: true };
    },
    videoCard: item => ({
      dataset: { bvid: item.bvid },
      focus() { focused.push(item.bvid); },
      scrollIntoView() {},
    }),
  });
  const start = source.indexOf('async function loadPopular()');
  const end = source.indexOf("loadMore.addEventListener('click'", start);
  vm.runInContext(source.slice(start, end), context);
  await context.loadPopular();
  assert.deepEqual(children.map(card => card.dataset.bvid), ['old', 'new', 'another']);
  assert.deepEqual(focused, ['new']);
  assert.equal(context.nextPage, 3);
  assert.equal(context.popularDone, true);
});
