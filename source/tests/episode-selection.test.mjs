import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const app = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
const requests = readFileSync(new URL('../app/search-requests.js', import.meta.url), 'utf8');
const submitSearch = app.slice(app.indexOf('function submitSearch('), app.indexOf("searchForm.addEventListener('submit'"));
const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const seasonCode = server.slice(server.indexOf('async function seasonEpisodes('), server.indexOf('function supportedMediaUrl('));

test('a repeated season lookup opens only the newest result', async () => {
  const pending = [];
  const opened = [];
  const context = vm.createContext({
    AbortController, clearTimeout, liveTimer: undefined, activePage: 'search',
    searchInput: { value: 'ss88780', blur() {} }, searchResults: {}, searchGrid: { replaceChildren() {} },
    searchMore: {}, searchError: {}, searchStatus: {}, searchField: {},
    trendingSection: {}, trendingList: { children: [] }, document: { querySelector: () => ({}) },
    typedBv: () => '', openDetail: item => opened.push(item.title),
    serviceRequest: () => new Promise(resolve => pending.push(resolve)),
  });
  vm.runInContext(requests + '\nconst searchRequests = createSearchRequests();\n' +
    'function resetSearchRequest(keyword) { searchRequests.reset(keyword); }\n' + submitSearch, context);
  const old = vm.runInContext('submitSearch()', context);
  const fresh = vm.runInContext('submitSearch()', context);
  pending[1]({ title: 'new' });
  await fresh;
  pending[0]({ title: 'stale' });
  await old;
  assert.deepEqual(opened, ['new']);
});

test('protocol-relative episode metadata resolves through the season lookup', async () => {
  const calls = [];
  const context = vm.createContext({
    URL, cookieFile: undefined,
    biliRequest: async (host, path) => {
      calls.push([host, path]);
      return { code: 0, result: { episodes: [
        { bvid: 'BV0000000001', id: 12, title: '1' }, { bvid: '', id: 13 },
      ] } };
    },
  });
  const episodes = await vm.runInContext(seasonCode +
    "\nseasonEpisodes({ redirect_url: '//www.bilibili.com/bangumi/play/ep12' })", context);
  assert.deepEqual(calls, [['api.bilibili.com', '/pgc/view/web/season?ep_id=12']]);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].episodeId, 12);
});

test('selection keeps P numbers for ordinary videos and uses the selected BV for a series', () => {
  const detailPages = { replaceChildren(...children) { this.children = children; } };
  const detailPagesShelf = {}, detailEpisodes = {}, input = {}, start = { disabled: false };
  const submissions = [];
  const context = vm.createContext({
    detailPages, detailPagesShelf, detailEpisodes, input, start,
    document: {
      createElement: () => ({ dataset: {}, addEventListener(_, fn) { this.click = fn; }, focus() {} }),
      querySelector: () => ({ requestSubmit: () => submissions.push([input.value, context.requestedPart]) }),
    },
  });
  vm.runInContext(app.slice(app.indexOf('function renderDetailEpisodes('), app.indexOf('// The part a detail page resumes')), context);
  vm.runInContext("renderDetailEpisodes({ bvid: 'BV0000000001' }, { pages: [] })", context);
  assert.equal(detailEpisodes.hidden, true);
  vm.runInContext("renderDetailEpisodes({ bvid: 'BV0000000001' }, { pages: [{page: 1}, {page: 2}] })", context);
  assert.equal(detailPagesShelf.hidden, false);
  detailPages.children[1].click();
  vm.runInContext("renderDetailEpisodes({}, { pages: [], episodes: [{bvid: 'BV0000000001'}, {bvid: 'BV0000000002'}] })", context);
  detailPages.children[1].click();
  start.disabled = true;
  detailPages.children[0].click();
  assert.deepEqual(submissions, [['BV0000000001', 2], ['BV0000000002', 1]]);
});

const endedHandler = app.slice(app.indexOf("video.addEventListener('ended'"), app.indexOf("playNext.addEventListener('click'"));
function finishPlayback(data, { switchPart = false } = {}) {
  let ended;
  let resolve;
  const playNext = { hidden: true, dataset: {} };
  const context = vm.createContext({
    current: { bvid: 'BV0000000001', page: 1 }, playbackGeneration: 1, playNext,
    video: { ended: true, addEventListener(_, listener) { ended = listener; } },
    player: { hidden: false }, playerStatus: {}, replay: { focus() {} }, toggle: {},
    saveProgress() {}, showControls() {}, startAutoplay() {},
    serviceRequest: () => new Promise(done => { resolve = done; }),
  });
  vm.runInContext(endedHandler, context);
  ended();
  if (switchPart) {
    context.current = { ...context.current, page: 2 };
    context.playbackGeneration++;
  }
  resolve(data);
  return Promise.resolve().then(() => playNext);
}

test('series completion offers the next episode before unrelated recommendations', async () => {
  const next = await finishPlayback({
    pages: [], episodes: [{ bvid: 'BV0000000001' }, { bvid: 'BV0000000002', title: '第 2 集' }],
    related: [{ bvid: 'BV0000000003', title: '推荐' }],
  });
  assert.equal(next.dataset.bvid, 'BV0000000002');
  assert.equal(next.textContent, '下一集：第 2 集');
});

test('a stale completion response cannot show a next-up offer for another part', async () => {
  const next = await finishPlayback({ pages: [{ page: 2 }, { page: 3 }], related: [] }, { switchPart: true });
  assert.equal(next.hidden, true);
});
