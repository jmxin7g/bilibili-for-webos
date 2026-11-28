// Always start at the top: a reload must not restore an old scroll position under the hero.
history.scrollRestoration = 'manual';
const home = document.querySelector('#home');
const player = document.querySelector('#player');
const video = document.querySelector('#video');
const start = document.querySelector('#start');
const toggle = document.querySelector('#toggle');
const input = document.querySelector('#bvid');
const homeStatus = document.querySelector('#home-status');
const playerStatus = document.querySelector('#player-status');
const overlay = document.querySelector('.overlay');
const quality = document.querySelector('#quality');
const qualityMenu = document.querySelector('#quality-menu');
// Default quality: auto unless chosen (older saved values 360 / 1080 stay valid).
quality.value = localStorage.getItem('quality') || 'auto';
if (!quality.value) {
  quality.value = 'auto';
  localStorage.setItem('quality', quality.value);
}
quality.addEventListener('change', () => localStorage.setItem('quality', quality.value));
// The BV field is internal now (cards, next part and search fill it); typing a BV number happens in search.
// Settings row behaviour: Up/Down move between rows; Enter or Right steps to the next quality, as tvOS rows do.
quality.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  quality.selectedIndex = (quality.selectedIndex + 1) % quality.options.length;
  quality.dispatchEvent(new Event('change'));
});
quality.addEventListener('mousedown', event => {
  event.preventDefault();
  quality.focus();
  quality.selectedIndex = (quality.selectedIndex + 1) % quality.options.length;
  quality.dispatchEvent(new Event('change'));
});
const homeRetry = document.querySelector('#home-retry');
const playerRetry = document.querySelector('#player-retry');
const replay = document.querySelector('#replay');
const playNext = document.querySelector('#play-next');
let controlsTimer;
let scrubDrag = null;
function showControls() {
  clearTimeout(controlsTimer);
  const wasHidden = overlay.hidden;
  overlay.hidden = false;
  if (wasHidden) (replay.hidden ? (playerRetry.hidden ? toggle : playerRetry) : replay).focus({ preventScroll: true });
  if (!scrubDrag && qualityMenu.hidden && !video.paused && !video.seeking && video.readyState >= 3 && playerStatus.textContent === '' && current.errors.length === 0) {
    controlsTimer = setTimeout(() => {
      overlay.hidden = true;
      player.focus({ preventScroll: true });
    }, 5000);
  }
}
let current;
// Multi-part videos: callers set `requestedPart` before submitting the play form; the form copies it into
// `selectedPart`, which retries and "next part" reuse. Part 1 keeps the original progress key.
let requestedPart = 1;
let selectedPart = 1;
let playbackQuality = null;
let playbackCodec = null;
function progressKey(bvid, page = 1) { return `progress:${accountIdentity ?? 'guest'}:${bvid}${page > 1 ? `:p${page}` : ''}`; }
function historyKey() { return `history:${accountIdentity ?? 'guest'}`; }
let playbackGeneration = 0;
let resolveController;
let returnTarget = start;
let returnScroll = 0;
let returnContainer = null;
let startingAt = 0;
let seekTarget = 0;
let waitingAt = null;
let lastSavedPosition = 0;
let progressReady = false;
shaka.polyfill.installAll();
const dashPlayer = new shaka.Player();
// Keep headroom for slow high-bitrate segments and CDN recovery.
dashPlayer.configure({
  streaming: { bufferingGoal: 60 },
  abr: {
    useNetworkInformation: false,
    // Use measured media throughput. Leave room for short drops on the VPN or CDN route.
    defaultBandwidthEstimate: 700_000,
    bandwidthUpgradeTarget: 0.65,
    bandwidthDowngradeTarget: 0.75,
    clearBufferSwitch: true,
    safeMarginSwitch: 5,
  },
});
const playerAttached = dashPlayer.attach(video);
dashPlayer.getNetworkingEngine().registerRequestFilter((type, request) => {
  if (type !== shaka.net.NetworkingEngine.RequestType.SEGMENT || !request.uris[0].includes('/media/')) return;
  let ahead = 0;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) ahead = video.buffered.end(i) - video.currentTime;
  }
  request.headers['X-Playback-Buffer'] = String(ahead);
});
dashPlayer.addEventListener('error', event => showError(event.detail));
dashPlayer.addEventListener('adaptation', updatePlaybackQuality);
window.playbackSessions = [];

// Sidebar: focusing an entry shows its page; Right enters the page, Left or Back from the page returns here.
const navItems = Array.from(document.querySelectorAll('.nav-item'));
const pages = Array.from(document.querySelectorAll('.page'));
let activePage = 'browse';
const pagePositions = new Map();
const pageSelections = new Map();
// 关注, 观看历史 and 收藏 are top-level sidebar entries; they share one page element (the account
// library), which shows only the chosen shelf.
const libraryPages = { following: 'following-shelf', later: 'later-shelf', 'cloud-history': 'cloud-history-shelf', favorites: 'favorites-shelf' };
function pageSection(name) { return document.getElementById(libraryPages[name] ? 'page-library' : `page-${name}`); }
function showPage(name) {
  const changed = activePage !== name;
  if (changed) pagePositions.set(activePage, window.scrollY);
  activePage = name;
  document.querySelector('#home').dataset.page = name;
  for (const page of pages) page.hidden = page !== pageSection(name);
  for (const item of navItems) {
    if (item.dataset.page === name) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  if (changed) window.scrollTo(0, pagePositions.get(name) || 0);
  updateNavPill();
  // Reentering an account page refreshes its contents.
  if (libraryPages[name]) { showLibraryShelf(); loadLibrary(); }
  if (changed) setAmbient(name === 'browse' ? '' : (libraryPages[name] ? document.getElementById(libraryPages[name]) : pageSection(name)).querySelector('.video-card img[src]')?.src || '');
  if (name === 'regions' && !regionState.loaded) selectRegion(regions[0].rid, false);
}
window.showPage = showPage;
function activeNav() { return navItems.find(item => item.dataset.page === activePage); }
function pageFocusables() {
  return Array.from(pageSection(activePage).querySelectorAll('button, input, select, [tabindex="0"]')).filter(element => !element.disabled && element.tabIndex >= 0 && element.offsetParent !== null);
}
// Where Back lands on a scrolled page: its first control, or the selected tab on the regions page.
function pageTopTarget() {
  if (activePage === 'regions') return regionTabs.querySelector('[aria-pressed="true"]') || pageFocusables()[0];
  return pageFocusables()[0];
}
// Scrolled away from the top: the window moved, or the top control has left the screen (settings scroll their
// own list).
function awayFromPageTop() {
  if (window.scrollY > 1) return true;
  const rect = pageTopTarget()?.getBoundingClientRect();
  return !!rect && (rect.top < 0 || rect.bottom > innerHeight);
}
function returnToPageTop() {
  const top = pageTopTarget();
  if (!top) return;
  top.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  for (let element = top.parentElement; element; element = element.parentElement) if (element.scrollTop > 0) element.scrollTop = 0;
}
function enterPage() {
  // Search starts on its keyboard, as on Apple TV.
  if (activePage === 'search' && !pageSelections.get('search')?.isConnected) { keyboardTarget().focus({ preventScroll: true }); return; }
  const targets = pageFocusables();
  const previous = pageSelections.get(activePage);
  (targets.includes(previous) ? previous : (targets[0] || activeNav())).focus({ preventScroll: true });
  window.scrollTo(0, pagePositions.get(activePage) || 0);
  if (!targets.includes(previous) && targets.length) targets[0].scrollIntoView({ block: 'nearest' });
}
// Left at the left edge of any sidebar page opens the sidebar, as on Apple TV. Each area keeps its own Left
// handling; when the press leaves focus where it was (nothing further left) and did not page the hero, the
// sidebar opens. Checked after the press is handled, so it works whatever handler took the key.
window.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' || !player.hidden || overlayOpen()) return;
  if (document.querySelector('dialog[open]')) return;
  const from = document.activeElement;
  if (!from?.closest?.('.page') || from.matches('input, textarea')) return;
  const hero = heroIndex;
  setTimeout(() => {
    if (document.activeElement !== from || heroIndex !== hero || !player.hidden || overlayOpen() || document.querySelector('dialog[open]')) return;
    pagePositions.set(activePage, window.scrollY);
    activeNav().focus({ preventScroll: true });
  }, 0);
}, true);
home.addEventListener('focusin', event => {
  if (event.target.closest('.page')) pageSelections.set(activePage, event.target);
});
// As in the Apple TV app, moving through the sidebar only moves the highlight (the current page keeps a soft
// one); OK switches to the highlighted page and enters it, Right returns to the current page.
for (const item of navItems) {
  item.addEventListener('click', () => {
    if (!item.dataset.page) return;
    showPage(item.dataset.page);
    if (item.dataset.page === 'browse') {
      pageSelections.delete('browse');
      pagePositions.set('browse', 0);
      window.scrollTo(0, 0);
      renderHistory();
      loadRecommend(false);
    }
    item.focus({ preventScroll: true });
    enterPage();
  });
}
showPage('browse');

function clock(seconds) {
  const two = value => Math.floor(value).toString().padStart(2, '0');
  // Hours appear only for long videos: 12:34, 1:41:35.
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${two(seconds % 3600 / 60)}:${two(seconds % 60)}` : `${two(seconds / 60)}:${two(seconds % 60)}`;
}

function showError(error) {
  player.classList.remove('busy');
  const message = error instanceof shaka.util.Error ? ({
    1001: '视频源请求失败，请重试播放',
    1002: '视频源连接失败，请重试播放',
    1003: '视频源连接超时，请重试播放',
  }[error.code] || `DASH 播放错误 ${error.code}`) : error.message;
  const text = `播放失败：${message}`;
  (player.hidden ? homeStatus : playerStatus).textContent = text;
  if (player.hidden && returnTarget === heroPlay) document.querySelector('#hero-status').textContent = text;
  if (player.hidden && !detail.hidden) document.querySelector('#detail-status').textContent = text;
  if (current) current.errors.push(text);
  (player.hidden ? homeRetry : playerRetry).hidden = false;
  if (!player.hidden) { video.pause(); playerStatus.textContent = text; replay.hidden = true; playNext.hidden = true; showControls(); playerRetry.focus(); }
  console.error(text);
}

function saveProgress() {
  if (current && progressReady && video.readyState >= 1) {
    localStorage.setItem(progressKey(current.bvid, current.page), String(video.ended ? 0 : video.currentTime));
    recordHistory();
    lastSavedPosition = video.currentTime;
  }
}

async function leavePlayer() {
  holdPausedAfterBackground = false;
  markLibraryStale('history');
  qualityMenu.hidden = true;
  qualitySwitch.setAttribute('aria-expanded', 'false');
  clearSubtitles();
  player.classList.remove('busy');
  playbackGeneration++;
  resolveController.abort();
  clearTimeout(controlsTimer);
  saveProgress();
  progressReady = false;
  video.pause();
  await dashPlayer.unload();
  video.removeAttribute('src');
  video.load();
  start.disabled = false;
  player.hidden = true;
  if (!overlayOpen()) home.hidden = false;
  start.textContent = '继续播放';
  homeStatus.textContent = '';
  homeRetry.hidden = true;
  renderHistory();
  if (heroItem) showHero(heroItem);
  if (!detail.hidden && detailStack.length) refreshDetailActions(detailStack[detailStack.length - 1]);
  // History cards are rebuilt on return; the watched video is now the first card.
  // A target that is gone or not displayed (e.g. the internal BV form's button) falls back as well.
  if (!returnTarget.isConnected || !returnTarget.getClientRects().length) returnTarget = (returnContainer?.isConnected && returnContainer.firstElementChild) || activeNav();
  returnTarget.focus({ preventScroll: true });
  window.scrollTo(0, returnScroll);
}

document.querySelector('#form').addEventListener('submit', async event => {
  event.preventDefault();
  if (start.disabled) return;
  const focused = document.activeElement;
  returnTarget = focused.closest('.video-card') || (focused.closest('.page, #detail') ? focused : start);
  document.querySelector('#detail-status').textContent = '';
  returnContainer = returnTarget.parentElement;
  playbackQuality = null;
  playbackCodec = null;
  selectedPart = requestedPart;
  requestedPart = 1;
  returnScroll = window.scrollY;
  await openVideo();
});

async function openVideo() {
  heroPreview.stop();
  progressReady = false;
  const generation = ++playbackGeneration;
  const controller = resolveController = new AbortController();
  start.disabled = true;
  homeRetry.hidden = true;
  playerRetry.hidden = true;
  replay.hidden = true;
  playNext.hidden = true;
  toggle.hidden = false;
  homeStatus.textContent = '';
  startingAt = performance.now();
  if (player.hidden) current = null;
  try {
    await playerAttached;
    let requestedQuality = playbackQuality || quality.value;
    const fallbackParam = playbackQuality ? '' : '&fallback=1';
    const codecParam = playbackCodec ? `&codec=${encodeURIComponent(playbackCodec)}` : '';
    let media = await serviceRequest(`/resolve?bvid=${encodeURIComponent(input.value.trim())}&quality=${encodeURIComponent(requestedQuality)}&page=${selectedPart}${codecParam}${fallbackParam}`, 'GET', controller.signal);
    if (generation !== playbackGeneration) return;
    if (!playbackQuality && requestedQuality !== 'auto' && media.format === 'dash' && !MediaSource.isTypeSupported(`video/mp4; codecs="${media.videoCodec}"`)) {
      const available = media.qualityOptions.filter(option => option.id <= media.quality).sort((a, b) => b.id - a.id)
        .flatMap(option => option.codecs.map(codec => ({ value: option.value, codec })))
        .find(option => MediaSource.isTypeSupported(`video/mp4; codecs="${option.codec}"`));
      if (!available) throw new Error('当前设备不支持此视频的可用编码');
      media = await serviceRequest(`/resolve?bvid=${encodeURIComponent(input.value.trim())}&quality=${encodeURIComponent(available.value)}&page=${selectedPart}&codec=${encodeURIComponent(available.codec)}`, 'GET', controller.signal);
      if (generation !== playbackGeneration) return;
    }
    if (requestedQuality !== 'auto' && media.format === 'dash' && !MediaSource.isTypeSupported(`video/mp4; codecs="${media.videoCodec}"`)) throw new Error('当前设备不支持所选画质的编码');
    if (requestedQuality !== 'auto') requestedQuality = media.qualityOptions.find(option => option.id === media.quality).value;
    current = { bvid: media.bvid, title: media.title, owner: media.owner, duration: media.duration, cover: media.cover, page: media.page, pages: media.pages, part: media.part, quality: media.quality, qualityOptions: media.qualityOptions, qualityLabel: media.qualityLabel, requestedQuality, format: media.format, sourceHost: media.sourceHost, startupMs: null, stalls: [], errors: [] };
    window.playbackSessions.push(current);
    playerOptionsFor(current);
    document.querySelector('#title').textContent = media.part ? `${media.title} · P${media.page} ${media.part}` : media.title;
    document.querySelector('#source').textContent = media.owner;
    homeStatus.textContent = '视频已打开';
    playerStatus.textContent = '正在载入视频…';
    player.classList.add('busy');
    home.hidden = true;
    player.hidden = false;
    overlay.hidden = false;
    seekTarget = Number(localStorage.getItem(progressKey(media.bvid, media.page)) || 0);
    lastSavedPosition = seekTarget;
    waitingAt = null;
    if (media.format === 'dash') {
      dashPlayer.configure({ abr: { enabled: requestedQuality === 'auto' } });
      await dashPlayer.load(media.src, seekTarget, 'application/dash+xml');
      updatePlaybackQuality();
    }
    else video.src = media.src;
    if (generation !== playbackGeneration) return;
    toggle.focus();
    await video.play();
  } catch (error) {
    if (controller.signal.aborted) return;
    if (generation !== playbackGeneration && (error.name === 'AbortError' || error.code === shaka.util.Error.Code.LOAD_INTERRUPTED)) return;
    if (error.name === 'AbortError' && current.errors.length > 0) return;
    showError(error);
  } finally {
    if (generation === playbackGeneration) {
      start.disabled = false;
      if (player.hidden) {
        if (returnTarget === heroPlay) heroPlay.focus({ preventScroll: true });
        else ((homeRetry.hidden || !detail.hidden) ? returnTarget : homeRetry).focus();
      }
    }
  }
}
async function retryPlayback() {
  if (start.disabled) return;
  start.disabled = true;
  homeRetry.disabled = true;
  playerRetry.disabled = true;
  try {
    if (!player.hidden) {
      saveProgress();
      progressReady = false;
      video.pause();
      await dashPlayer.unload();
      video.removeAttribute('src');
      video.load();
    }
    await openVideo();
  } finally {
    start.disabled = false;
    homeRetry.disabled = false;
    playerRetry.disabled = false;
  }
}
homeRetry.addEventListener('click', () => retryPlayback().catch(showError));
playerRetry.addEventListener('click', () => retryPlayback().catch(showError));
replay.addEventListener('click', () => {
  replay.hidden = true;
  playNext.hidden = true;
  toggle.hidden = false;
  video.currentTime = 0;
  saveProgress();
  toggle.focus();
  video.play().catch(showError);
});

video.addEventListener('loadedmetadata', () => {
  if (current.format === 'mp4' && seekTarget > 0 && seekTarget < video.duration - 2) video.currentTime = seekTarget;
});
video.addEventListener('playing', () => {
  if (current.errors.length > 0) return;
  progressReady = true;
  replay.hidden = true;
  playNext.hidden = true;
  toggle.hidden = false;
  if (current.startupMs === null) current.startupMs = Math.round(performance.now() - startingAt);
  if (waitingAt !== null) {
    current.stalls.push({ at: video.currentTime, durationMs: Math.round(performance.now() - waitingAt) });
    waitingAt = null;
  }
  playerStatus.textContent = '';
  player.classList.remove('busy');
  toggle.textContent = '暂停';
  toggle.dataset.state = 'playing';
  showControls();
  // A video that finishes loading after the user left the app must not start playing in the background.
  if (document.visibilityState === 'hidden') video.pause();
});
video.addEventListener('waiting', () => {
  if (current.errors.length > 0) return;
  clearTimeout(controlsTimer);
  overlay.hidden = false;
  playerStatus.textContent = '正在缓冲…';
  player.classList.add('busy');
  if (current.startupMs !== null && !video.seeking && waitingAt === null) waitingAt = performance.now();
});
video.addEventListener('seeking', () => { clearTimeout(controlsTimer); overlay.hidden = false; if (current.errors.length === 0) playerStatus.textContent = '正在跳转…'; });
video.addEventListener('pause', () => {
  toggle.textContent = '播放';
  toggle.dataset.state = 'paused';
  if (current.errors.length === 0) playerStatus.textContent = video.ended ? '播放结束' : '';
  saveProgress();
  showControls();
});
video.addEventListener('ended', () => {
  saveProgress();
  replay.hidden = false;
  toggle.hidden = true;
  showControls();
  replay.focus();
  const ended = current;
  const generation = playbackGeneration;
  const stillEnded = () => !player.hidden && video.ended &&
    current === ended && playbackGeneration === generation;
  serviceRequest(`/detail?bvid=${encodeURIComponent(ended.bvid)}`).then(data => {
    if (!stillEnded()) return;
    const nextPart = data.pages.find(item => item.page === ended.page + 1);
    const episodeIndex = data.episodes?.findIndex(item => item.bvid === ended.bvid) ?? -1;
    const nextEpisode = episodeIndex >= 0 ? data.episodes[episodeIndex + 1] : undefined;
    const related = data.related.find(item => item.bvid !== ended.bvid);
    const next = nextPart
      ? { bvid: ended.bvid, page: nextPart.page, label: `下一集：P${nextPart.page} ${nextPart.part}` }
      : nextEpisode
        ? { bvid: nextEpisode.bvid, page: 1, label: `下一集：${nextEpisode.title}` }
        : related && { bvid: related.bvid, page: 1, label: `下一个：${related.title}` };
    if (!next) return;
    playNext.dataset.bvid = next.bvid;
    playNext.dataset.part = next.page;
    playNext.textContent = next.label;
    playNext.hidden = false;
    startAutoplay();
  }).catch(error => {
    if (stillEnded()) playerStatus.textContent = `相关视频加载失败：${error.message}`;
  });
});
playNext.addEventListener('click', () => {
  if (!playNext.dataset.bvid || start.disabled) return;
  playbackQuality = null;
  playbackCodec = null;
  input.value = playNext.dataset.bvid;
  selectedPart = Number(playNext.dataset.part || 1);
  playNext.hidden = true;
  retryPlayback().catch(showError);
});
video.addEventListener('error', () => showError(new Error(`媒体错误 ${video.error.code}：${video.error.message}`)));
video.addEventListener('timeupdate', () => {
  if (Math.abs(video.currentTime - lastSavedPosition) >= 5) saveProgress();
  if (scrubDrag) return;
  // Elapsed on the left, remaining on the right, as on the Apple TV scrubber.
  const total = Number.isFinite(video.duration) ? video.duration : 0;
  document.querySelector('#time').textContent = clock(video.currentTime);
  document.querySelector('#time-left').textContent = `-${clock(Math.max(0, total - video.currentTime))}`;
  document.querySelector('#progress').max = Number.isFinite(video.duration) ? video.duration : 1;
  document.querySelector('#progress').value = video.currentTime;
  placeOnScrubber(playhead, video.currentTime);
});
window.addEventListener('pagehide', saveProgress);
// Leaving the app (Home, another input or app) pauses playback and saves the position; on return it stays
// paused with the controls shown, so the viewer resumes with Play.
// webOS itself pauses the media when the app is hidden and resumes it when the app returns (Shaka then calls
// play() as well), so a hold keeps it paused until the viewer presses a key or points and clicks.
let holdPausedAfterBackground = false;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || player.hidden) return;
  holdPausedAfterBackground = true;
  if (!video.paused) video.pause(); // the pause handler saves progress and shows the controls
  else saveProgress();
});
video.addEventListener('play', () => { if (holdPausedAfterBackground && !player.hidden) video.pause(); });
for (const type of ['keydown', 'pointerdown']) document.addEventListener(type, () => { holdPausedAfterBackground = false; }, true);

toggle.addEventListener('click', () => {
  if (video.paused) video.play().catch(showError);
  else video.pause();
});
document.querySelector('#backward').addEventListener('click', () => {
  if (video.readyState >= 1) video.currentTime = Math.max(0, video.currentTime - 10);
});
document.querySelector('#forward').addEventListener('click', () => {
  if (video.readyState >= 1) video.currentTime = Math.min(video.duration, video.currentTime + 10);
});
document.querySelector('#back').addEventListener('click', () => leavePlayer().catch(showError));
player.addEventListener('pointermove', () => { if (!player.hidden) showControls(); });
document.querySelector('#controls').addEventListener('click', showControls);

document.addEventListener('keydown', event => {
  if (!player.hidden && (event.key === 'Escape' || event.keyCode === 461)) {
    event.preventDefault();
    if (!overlay.hidden) {
      clearTimeout(controlsTimer);
      overlay.hidden = true;
      player.focus({ preventScroll: true });
    } else leavePlayer().catch(showError);
    return;
  }
  if (!player.hidden && [179, 415, 19, 412, 417].includes(event.keyCode)) {
    event.preventDefault();
    showControls();
    if (event.keyCode === 179) toggle.click();
    if (event.keyCode === 415) video.play().catch(showError);
    if (event.keyCode === 19) video.pause();
    if (event.keyCode === 412) document.querySelector('#backward').click();
    if (event.keyCode === 417) document.querySelector('#forward').click();
    return;
  }
  if (event.defaultPrevented) return;
  if (player.hidden && start.disabled && (event.key === 'Escape' || event.keyCode === 461) && !document.querySelector('#login-dialog').open) {
    event.preventDefault();
    playbackGeneration++;
    resolveController.abort();
    start.disabled = false;
    homeStatus.textContent = '';
    (detail.hidden ? activeNav() : detailPlay).focus({ preventScroll: true });
    return;
  }
  if (player.hidden && !upPage.hidden) { upKeys(event); return; }
  if (player.hidden && !detail.hidden) { detailKeys(event); return; }
  if (!player.hidden && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) {
    const wasHidden = overlay.hidden;
    showControls();
    // As on Apple TV, Left/Right with the controls hidden skip 10 seconds straight away; other keys only reveal them.
    if (wasHidden && event.key === 'ArrowLeft') document.querySelector('#backward').click();
    if (wasHidden && event.key === 'ArrowRight') document.querySelector('#forward').click();
    if (wasHidden) { event.preventDefault(); return; }
  }
  if (player.hidden && (event.key === 'Escape' || event.keyCode === 461) && !navItems.includes(document.activeElement) && !document.querySelector('#login-dialog').open) {
    event.preventDefault();
    // Back on a scrolled page first returns to its top (focus on the page's first control); only at the top
    // does Back open the sidebar.
    if (awayFromPageTop()) { returnToPageTop(); return; }
    pagePositions.set(activePage, window.scrollY);
    activeNav().focus({ preventScroll: true });
    return;
  }
  // Back on the sidebar is the top level: ask before leaving the app (appinfo sets disableBackHistoryAPI, so
  // the app receives 461 and must offer the exit itself).
  if (player.hidden && !overlayOpen() && (event.key === 'Escape' || event.keyCode === 461) && navItems.includes(document.activeElement) && !document.querySelector('#login-dialog').open) {
    event.preventDefault();
    exitDialog.showModal();
    exitCancel.focus();
    return;
  }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  if (document.querySelector('#login-dialog').open || exitDialog.open || document.querySelector('#profile-picker').open) return;
  if (player.hidden && navItems.includes(document.activeElement)) {
    event.preventDefault();
    const index = navItems.indexOf(document.activeElement);
    // Up from the first entry reaches the profile at the top of the sidebar (Apple TV's profile switcher).
    if (event.key === 'ArrowUp' && index === 0) { navProfile.focus({ preventScroll: true }); return; }
    const target = event.key === 'ArrowUp' ? navItems[Math.max(0, index - 1)] : event.key === 'ArrowDown' ? navItems[Math.min(navItems.length - 1, index + 1)] : null;
    if (target) target.focus({ preventScroll: true });
    if (event.key === 'ArrowRight') { activeNav().focus({ preventScroll: true }); enterPage(); }
    return;
  }
  // Preserve normal caret movement while editing a BV number.
  if ((document.activeElement === input || document.activeElement.id === 'search-input') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const targets = player.hidden ? [...pageFocusables(), ...(homeRetry.hidden ? [] : [homeRetry])] : Array.from(document.querySelectorAll('#controls button:not([hidden])')).filter(button => button.getClientRects().length);
  const index = targets.indexOf(document.activeElement);
  if (player.hidden && ['ArrowLeft', 'ArrowUp'].includes(event.key) && index <= 0) { return; }
  // Settings is a vertical list: Left stays in place, Up/Down move between rows.
  if (player.hidden && activePage === 'settings' && event.key === 'ArrowLeft') { return; }
  // Player: the option capsules sit on their own row at the bottom right (as on Apple TV), so Down from the
  // centre buttons enters that row and Up leaves it; Left/Right still walk every visible button.
  if (!player.hidden && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
    const options = targets.filter(button => button.closest('.player-options'));
    const inOptions = document.activeElement.closest?.('.player-options');
    if (event.key === 'ArrowDown' && !inOptions && options.length) { options[0].focus(); return; }
    if (event.key === 'ArrowUp' && inOptions) { (targets.find(button => button.id === 'toggle') || targets[0]).focus(); return; }
    return;
  }
  const step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
  targets[Math.max(0, Math.min(targets.length - 1, index + step))].focus();
});

const grid = document.querySelector('#video-grid');
const loadMore = document.querySelector('#load-more');
const browseStatus = document.querySelector('#browse-status');
let nextPage = 1;
let popularDone = false;
async function loadPopular() {
  // Remember the press before disabling: a disabled button drops focus to the page body.
  const pressed = document.activeElement === loadMore;
  loadMore.disabled = true;
  browseStatus.textContent = '';
  grid.closest('.shelf').classList.add('loading');
  try {
    const data = await serviceRequest(`/popular?page=${nextPage}`);
    const firstNewIndex = grid.children.length;
    const seen = new Set(Array.from(grid.children, card => card.dataset.bvid));
    for (const item of data.items) {
      if (seen.has(item.bvid)) continue;
      seen.add(item.bvid);
      const card = videoCard(item, `${item.owner} · ${clock(item.duration)}`);
      grid.append(card);
    }
    if (nextPage === 1) fillSearchPopular(data.items.slice(0, 12));
    nextPage++;
    popularDone = data.noMore || nextPage > 100;
    loadMore.hidden = true;
    browseStatus.textContent = grid.children.length ? '' : '暂无热门视频';
    if (pressed && grid.children.length > firstNewIndex) {
      grid.children[firstNewIndex].focus({ preventScroll: true });
      grid.children[firstNewIndex].scrollIntoView({ block: 'nearest' });
    }
  } catch (error) {
    browseStatus.textContent = `加载失败：${error.message}，请选择重试。`;
    loadMore.hidden = false;
    if (pressed) setTimeout(() => loadMore.focus({ preventScroll: true }));
    loadMore.textContent = '重试加载';
    return;
  } finally {
    loadMore.disabled = false;
    grid.closest('.shelf').classList.remove('loading');
  }
  loadMore.textContent = '加载更多';
}
loadMore.addEventListener('click', loadPopular);
// Card grid navigation for the search results and continue-watching pages.
function gridNavigation(container, above, below, columnCount = 3, leftOut = () => document.activeElement) { container.addEventListener('keydown', event => {
  // 'auto' reads the live column count (the search grid widens when the keyboard slides away).
  const columns = columnCount === 'auto' ? getComputedStyle(container).gridTemplateColumns.split(' ').length : columnCount;
  const cards = Array.from(container.children);
  const index = cards.indexOf(document.activeElement);
  let target;
  if (event.key === 'ArrowLeft') target = index % columns > 0 ? cards[index - 1] : leftOut();
  if (event.key === 'ArrowRight') target = cards[Math.min(cards.length - 1, index + (index % columns < columns - 1 ? 1 : 0))];
  if (event.key === 'ArrowUp') target = index < columns ? (above() || cards[index]) : cards[index - columns];
  if (event.key === 'ArrowDown') target = index + columns < cards.length ? cards[index + columns] : below(cards);
  if (target) {
    event.preventDefault();
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest' });
    if (event.key === 'ArrowUp' && index < columns) window.scrollTo(0, 0);
  }
}); }
gridNavigation(grid, () => document.activeElement, () => loadMore.hidden ? document.activeElement : loadMore, 'auto');
grid.addEventListener('keydown', event => {
  if (['ArrowDown', 'ArrowRight'].includes(event.key) && Array.from(grid.children).indexOf(document.activeElement) >= grid.children.length - 6 && !popularDone && !loadMore.disabled && loadMore.hidden) loadPopular();
});
loadPopular();

const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#search-input');
const searchResults = document.querySelector('#search-results');
const searchGrid = document.querySelector('#search-grid');
const searchStatus = document.querySelector('#search-status');
const searchMore = document.querySelector('#search-more');
const searchError = document.querySelector('#search-error');
const searchRequests = createSearchRequests();
function resetSearchRequest(keyword = '') {
  searchRequests.reset(keyword);
  searchMore.disabled = false;
  searchStatus.setAttribute('aria-busy', 'false');
}
function submitSearch(live = false) {
  const keyword = searchInput.value.trim();
  clearTimeout(liveTimer);
  resetSearchRequest(keyword);
  searchResults.hidden = false;
  document.querySelector('#search-empty').hidden = true;
  searchGrid.replaceChildren();
  searchMore.hidden = true;
  searchError.hidden = true;
  searchStatus.textContent = '';
  trendingSection.hidden = Boolean(keyword) || !trendingList.children.length;
  // A BV number typed in full (OK on the query line or the system keyboard) opens the video itself.
  const bvid = typedBv(keyword);
  if (bvid && !live) { openTypedBv(bvid); return; }
  const season = /^(?:https:\/\/www\.bilibili\.com\/bangumi\/play\/)?((?:ss|ep)[0-9]+)(?:[/?#].*)?$/i.exec(keyword);
  if (season && !live) {
    searchInput.blur();
    searchStatus.textContent = '正在加载剧集…';
    const request = searchRequests.start();
    const isCurrent = () => searchRequests.isCurrent(request) &&
      activePage === 'search' && searchInput.value.trim() === keyword;
    return serviceRequest(`/season?ref=${season[1].toLowerCase()}`, 'GET', request.controller.signal).then(item => {
      if (isCurrent()) {
        searchStatus.textContent = '';
        openDetail(item, searchField);
      }
    }).catch(error => {
      if (isCurrent()) searchStatus.textContent = `剧集加载失败：${error.message}`;
    }).finally(() => searchRequests.finish(request));
  }
  if (!keyword) { searchStatus.textContent = '请输入关键词'; searchInput.blur(); if (!live) searchField.focus(); return; }
  // Leave the text field so the webOS virtual keyboard closes before focus moves to the results.
  if (!live) searchInput.blur();
  return loadSearch(!live);
}
searchForm.addEventListener('submit', event => {
  event.preventDefault();
  submitSearch();
});
async function loadSearch(moveFocus = true) {
  const request = searchRequests.start();
  if (!request) return;
  // Remember the press before disabling: a disabled button drops focus to the page body.
  const pressed = document.activeElement === searchMore;
  searchMore.disabled = true;
  searchStatus.textContent = '正在搜索…';
  searchStatus.setAttribute('aria-busy', 'true');
  searchError.hidden = true;
  const firstNewIndex = searchGrid.children.length;
  const mayMoveFocus = () => moveFocus && activePage === 'search' && player.hidden && !overlayOpen() &&
    (!document.activeElement || document.activeElement === document.body || pageSection('search').contains(document.activeElement));
  let refocusMore = false;
  try {
    const data = await serviceRequest(`/search?keyword=${encodeURIComponent(request.keyword)}&page=${request.page}`, 'GET', request.controller.signal);
    if (!searchRequests.isCurrent(request) || searchInput.value.trim() !== request.keyword) return;
    const seen = new Set(Array.from(searchGrid.children, card => card.dataset.bvid));
    for (const item of data.items) {
      if (seen.has(item.bvid)) continue;
      seen.add(item.bvid);
      searchGrid.append(videoCard(item, `${item.owner} · ${item.duration}`));
    }
    searchRequests.advance(request);
    searchMore.hidden = data.noMore;
    searchMore.textContent = '加载更多结果';
    searchStatus.textContent = searchGrid.children.length ? `找到 ${searchGrid.children.length} 个视频` : '没有找到结果';
    // Live results while typing leave focus on the keyboard, as Apple TV's search does.
    const target = searchGrid.children[firstNewIndex];
    if (mayMoveFocus()) {
      if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' }); }
      else if (searchMore.hidden && firstNewIndex > 0) searchGrid.lastElementChild.focus();
      else if (!document.activeElement || document.activeElement === document.body) searchField.focus();
    }
  } catch (error) {
    if (!searchRequests.isCurrent(request) || searchInput.value.trim() !== request.keyword) return;
    refocusMore = pressed;
    if (!pressed && mayMoveFocus() && (!document.activeElement || document.activeElement === document.body)) searchField.focus();
    searchStatus.textContent = `搜索失败：${error.message}`;
    searchError.textContent = `搜索失败：${error.message}`;
    searchError.hidden = false;
    searchMore.hidden = false;
    searchMore.textContent = '重试搜索';
  } finally {
    if (searchRequests.isCurrent(request)) {
      searchRequests.finish(request);
      searchMore.disabled = false;
      searchStatus.setAttribute('aria-busy', 'false');
      if (refocusMore && mayMoveFocus()) searchMore.focus({ preventScroll: true });
    }
  }
}
searchMore.addEventListener('click', () => loadSearch());

// The search box is focused as a whole, so the webOS keyboard (which captures every remote key in the
// Simulator) only opens after Enter; Down goes straight to the hot searches or the results.
const searchField = document.querySelector('#search-field');
const trendingSection = document.querySelector('#search-trending');
const trendingList = document.querySelector('#trending-list');
searchField.addEventListener('keydown', event => {
  if (event.target !== searchField) return;
  if (event.key === 'Enter') { event.preventDefault(); searchInput.focus(); }
  if (event.key === 'ArrowDown') { event.preventDefault(); keyboardTarget().focus({ preventScroll: true }); }
});
searchField.addEventListener('click', () => searchInput.focus());
searchInput.addEventListener('keydown', event => {
  if (event.key === 'Escape' || event.keyCode === 461) { event.preventDefault(); searchField.focus(); }
  // The webOS on-screen keyboard's Enter arrives as a synthetic key event, which does not trigger implicit
  // form submission, so submit explicitly.
  if (event.key === 'Enter' || event.keyCode === 13) { event.preventDefault(); searchForm.requestSubmit(); }
});
trendingList.addEventListener('keydown', event => {
  const buttons = Array.from(trendingList.querySelectorAll('button'));
  const index = buttons.indexOf(document.activeElement);
  if (index < 0 || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  // Two columns of five, filled top to bottom: Left/Right switch columns, Left from the first column opens the sidebar.
  const column = Math.floor(index / 5);
  let target;
  if (event.key === 'ArrowUp') target = index % 5 > 0 ? buttons[index - 1] : (searchSuggest.hidden ? null : searchSuggest.firstElementChild) || searchField;
  if (event.key === 'ArrowDown') target = index % 5 < 4 && buttons[index + 1] ? buttons[index + 1] : (searchPopular.firstElementChild ? nearestCard(searchPopular, buttons[index]) : buttons[index]);
  if (event.key === 'ArrowRight') target = buttons[index + 5] || buttons[index];
  if (event.key === 'ArrowLeft') target = column > 0 ? buttons[index - 5] : keyboardTarget();
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest' });
});
// Below the hot searches, a poster shelf of popular videos fills the page the way Apple TV's search screen
// shows what people are watching before anything is typed.
const searchPopular = document.querySelector('#search-popular');
function fillSearchPopular(items) {
  searchPopular.replaceChildren(...items.map(item => videoCard(item, `${item.owner} · ${clock(item.duration)}`)));
  document.querySelector('#search-popular-title').hidden = !items.length;
}
searchPopular.addEventListener('keydown', event => {
  const cards = Array.from(searchPopular.children);
  const index = cards.indexOf(document.activeElement);
  if (index < 0 || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const buttons = Array.from(trendingList.querySelectorAll('button'));
  let target;
  if (event.key === 'ArrowLeft') target = index > 0 ? cards[index - 1] : keyboardTarget();
  if (event.key === 'ArrowRight') target = cards[Math.min(cards.length - 1, index + 1)];
  if (event.key === 'ArrowUp') target = buttons.length ? nearestCard({ children: buttons.filter((_, i) => i % 5 === 4 || i === buttons.length - 1) }, cards[index]) : searchField;
  if (event.key === 'ArrowDown') target = cards[index];
  if (target === activeNav()) { target.focus({ preventScroll: true }); return; }
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});
async function loadTrending() {
  try {
    const data = await serviceRequest('/trending');
    trendingList.replaceChildren(...data.items.map((item, index) => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = index + 1;
      button.append(rank, document.createTextNode(item.label));
      button.addEventListener('click', () => { searchInput.value = item.keyword; searchForm.requestSubmit(); });
      row.append(button);
      return row;
    }));
    if (searchResults.hidden && data.items.length) {
      trendingSection.hidden = false;
      document.querySelector('#search-empty').hidden = true;
    }
  } catch {
    // Without hot searches the empty page keeps its hint; searching still works.
  }
}
loadTrending();
gridNavigation(searchGrid, () => (searchSuggest.hidden ? null : searchSuggest.firstElementChild) || searchField, cards => searchMore.hidden ? cards[cards.length - 1] : searchMore, 'auto', () => keyboardTarget());
searchMore.addEventListener('keydown', event => {
  if (event.key === 'ArrowUp' && searchGrid.children.length) {
    event.preventDefault();
    searchGrid.lastElementChild.focus();
  }
});

// Continue watching: last 12 unfinished videos with saved progress, stored only on this device
// in the 继续观看 shelf on 推荐. The history page uses the account's platform records.
const historyRow = document.querySelector('#history-row');
function readHistory() {
  return JSON.parse(localStorage.getItem(historyKey()) || '[]');
}
function recordHistory() {
  if (!current) return;
  const position = Number(localStorage.getItem(progressKey(current.bvid, current.page)) || 0);
  const list = readHistory().filter(item => item.bvid !== current.bvid);
  if (position > 0) list.unshift({ bvid: current.bvid, title: current.title, owner: current.owner, duration: current.page > 1 || current.pages > 1 ? video.duration || current.duration : current.duration, cover: current.cover, position, page: current.page, part: current.part });
  localStorage.setItem(historyKey(), JSON.stringify(list.slice(0, 12)));
}
function historyCard(item) {
  const left = Math.max(0, (item.duration || 0) - item.position);
  const card = videoCard(item, left >= 60 ? `剩余 ${Math.round(left / 60)} 分钟` : `已看到 ${clock(item.position)}`, true);
  const bar = document.createElement('span'); bar.className = 'card-progress';
  const fill = document.createElement('i'); fill.style.width = `${Math.min(100, item.position / (item.duration || item.position) * 100)}%`;
  bar.append(fill);
  card.querySelector('.art').append(bar);
  return card;
}
function renderHistory() {
  const list = readHistory();
  historyRow.replaceChildren(...list.map(historyCard));
  document.querySelector('#history-shelf').hidden = list.length === 0;
}

renderHistory();
window.addEventListener('accountchange', () => {
  renderHistory();
  if (heroItem) showHero(heroItem);
});

// Recommendations on the 推荐 page; personalised by the server when logged in.
const recommendGrid = document.querySelector('#recommend-grid');
const recommendStatus = document.querySelector('#recommend-status');
const recommendRetry = document.querySelector('#recommend-retry');
let recommendBusy = false;
let recommendRetryAppend = false;
const recommendReveal = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('revealed');
    recommendReveal.unobserve(entry.target);
  }
}, { threshold: .15 });
let recommendRound = 1;
let recommendGeneration = 0;
const recommendMore = new IntersectionObserver(entries => {
  if (recommendRetry.hidden && entries.some(entry => entry.target === recommendGrid.lastElementChild && entry.isIntersecting)) loadRecommend(false, true);
}, { rootMargin: '0px 0px 250px 0px' });
async function loadRecommend(focusFirst, append = false) {
  if (append && recommendBusy) return;
  const generation = ++recommendGeneration;
  recommendBusy = true;
  recommendMore.disconnect();
  recommendStatus.textContent = '';
  recommendGrid.closest('.shelf').classList.add('loading');
  document.querySelector('#hero').classList.add('loading');
  try {
    // The upstream may repeat a whole batch. Try up to three batches per action.
    for (let attempt = 0; attempt < 3; attempt++) {
      const data = await serviceRequest(`/recommend?round=${recommendRound}`);
      if (generation !== recommendGeneration) return;
      recommendRound = recommendRound % 50 + 1;
      if (!data.items.length) continue;
      const replacing = !append;
      if (replacing) {
        setHeroItems(data.items.slice(0, 5));
        recommendReveal.disconnect();
        append = true;
      }
      const seen = new Set(heroItems.map(item => item.bvid));
      if (!replacing) for (const card of recommendGrid.children) seen.add(card.dataset.bvid);
      const newCards = [];
      for (const item of replacing ? data.items.slice(5) : data.items) {
        if (seen.has(item.bvid)) continue;
        seen.add(item.bvid);
        newCards.push(videoCard(item, `${item.owner} · ${clock(item.duration)}`));
      }
      if (replacing) replaceKeepingFocus(recommendGrid, newCards);
      else recommendGrid.append(...newCards);
      newCards.forEach((card, index) => {
        card.classList.add('reveal-card');
        card.style.setProperty('--reveal-delay', `${index % 5 * 70}ms`);
        recommendReveal.observe(card);
      });
      if (!newCards.length) continue;
      if (document.activeElement === recommendRetry) focusCard(newCards[0]);
      else if (focusFirst) recommendGrid.firstElementChild.focus();
      recommendRetry.hidden = true;
      recommendMore.observe(recommendGrid.lastElementChild);
      return;
    }
    recommendStatus.textContent = '暂无更多推荐';
    recommendRetryAppend = append;
    recommendRetry.textContent = '继续加载';
    recommendRetry.hidden = false;
  } catch (error) {
    if (generation !== recommendGeneration) return;
    recommendStatus.textContent = `推荐加载失败：${error.message}`;
    recommendRetryAppend = append;
    recommendRetry.textContent = '重试加载';
    recommendRetry.hidden = false;
    // Nothing to feature yet: the hero explains the failure and its button retries.
    if (!heroItem) {
      document.querySelector('#browse-heading').textContent = '暂时无法载入推荐';
      document.querySelector('#hero-meta').textContent = error.message;
      heroPlay.textContent = '重试';
    }
  } finally {
    if (generation === recommendGeneration) {
      recommendBusy = false;
      recommendGrid.closest('.shelf').classList.remove('loading');
      document.querySelector('#hero').classList.remove('loading');
    }
  }
}
recommendRetry.addEventListener('click', () => {
  if (!recommendBusy) return loadRecommend(false, recommendRetryAppend);
});
recommendRetry.addEventListener('keydown', event => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  if (event.key === 'ArrowUp') {
    const card = recommendGrid.lastElementChild || historyRow.lastElementChild;
    if (card) focusCard(card);
    else { heroPlay.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }
});
window.addEventListener('accountchange', event => {
  document.querySelector('#recommend-title').textContent = event.detail.loggedIn ? '为你推荐' : '推荐视频';
  if (event.detail.changed) {
    recommendRound = 1;
    recommendGrid.replaceChildren();
    recommendRetry.hidden = true;
    heroPreview?.stop();
    setHeroItems([]);
    loadRecommend(false);
  }
});
loadRecommend(false);
window.initialAccountReady.then(async () => {
  // Simulator regressions bypass the launch picker while exercising other pages.
  if (localStorage.getItem('test.skipProfilePrompt') !== '1') await openProfilePicker('谁在观看？');
  document.querySelector('#startup-screen').hidden = true;
});

// Bilibili covers are full-size uploads (up to 2560×1440). The image host scales them on request
// (@<w>w_<h>h_1c.webp); decoding the originals for 412-pixel cards stalled the TV for up to 0.8 s whenever a
// new row of cards came into view.
function coverAt(url, width) {
  if (!url || !/^(https?:)?\/\/[^/]*hdslb\.com\/bfs\//.test(url) || url.includes('@')) return url;
  return `${url}@${width}w_${Math.round(width * 9 / 16)}h_1c.webp`;
}
// Shared card for shelves and grids: artwork, title, one line of detail; selecting it opens the video.
function videoCard(item, detailText, direct = false) {
  const card = document.createElement('button'); card.className = 'video-card'; card.dataset.bvid = item.bvid;
  // Artwork sits in its own rounded frame so the focus sheen and progress line can overlay it.
  const art = document.createElement('span'); art.className = 'art';
  const image = document.createElement('img'); image.alt = ''; image.referrerPolicy = 'no-referrer'; image.decoding = 'async';
  // Covers load as they near the screen: the regions grid and library pages hold 70–100 cards at once.
  image.loading = 'lazy';
  if (item.cover) image.src = coverAt(item.cover, 640);
  art.append(image);
  const title = document.createElement('strong'); title.textContent = item.title;
  const detail = document.createElement('span'); detail.className = 'detail'; detail.textContent = detailText;
  card.append(art, title, detail);
  card.addEventListener('click', () => {
    if (start.disabled) return;
    if (!direct) { openDetail(item, card); return; }
    requestedPart = item.page || 1;
    input.value = item.bvid;
    document.querySelector('#form').requestSubmit();
  });
  return card;
}

// 稍后再看 toggles (hero and detail page): Apple TV's round "+" (Add to Up Next) that turns into a tick.
// laterSaved mirrors the account's watch-later list so the rotating hero needs no request per item.
let laterSaved = new Set();
let laterSavedGeneration = 0;
function setLaterSaved(button, saved) {
  button.dataset.saved = String(saved);
  button.setAttribute('aria-label', saved ? '已在稍后再看，确认键移除' : '添加到稍后再看');
}
function refreshLaterSaved() {
  const generation = ++laterSavedGeneration;
  laterSaved = new Set();
  if (heroItem) setLaterSaved(heroLater, false);
  if (!detail.hidden) showLaterState(detailLater.dataset.bvid, detailGeneration);
  if (document.querySelector('#logout').hidden) { laterSaved = new Set(); return; }
  serviceRequest('/me/later').then(data => {
    if (generation !== laterSavedGeneration) return;
    laterSaved = new Set(data.items.map(item => item.bvid));
    if (heroItem) setLaterSaved(heroLater, laterSaved.has(heroItem.bvid));
  }).catch(error => {
    if (generation === laterSavedGeneration) recommendStatus.textContent = `稍后再看状态加载失败：${error.message}`;
  });
}
async function toggleLater(button, report) {
  if (button.disabled) return;
  const generation = laterSavedGeneration;
  const bvid = button.dataset.bvid;
  const add = button.dataset.saved !== 'true';
  button.disabled = true;
  try {
    const data = await serviceRequest(`/me/later/${add ? 'add' : 'remove'}?bvid=${encodeURIComponent(bvid)}`, 'POST');
    if (generation !== laterSavedGeneration) return;
    if (data.saved) laterSaved.add(bvid); else laterSaved.delete(bvid);
    for (const other of document.querySelectorAll('#hero-later, #detail-later')) if (other.dataset.bvid === bvid) setLaterSaved(other, data.saved);
    report(data.saved ? '已添加到稍后再看' : '已从稍后再看移除');
    markLibraryStale('later');
  } catch (error) {
    if (generation !== laterSavedGeneration) return;
    report(`${add ? '添加' : '移除'}失败：${error.message}`);
  } finally {
    button.disabled = false;
    if (generation === laterSavedGeneration && button.offsetParent) button.focus({ preventScroll: true });
  }
}
window.addEventListener('accountchange', refreshLaterSaved);

// Hero: large artwork of the recommendation with Play and 稍后再看.
const heroPlay = document.querySelector('#hero-play');
const heroLater = document.querySelector('#hero-later');
let heroItem = null;
let heroPreview = null;
function showHero(item) {
  heroItem = item || null;
  document.querySelector('#hero-status').textContent = '';
  const image = document.querySelector('#hero-image');
  if (item?.cover) { image.referrerPolicy = 'no-referrer'; image.src = coverAt(item.cover, 1920); } else image.removeAttribute('src');
  document.querySelector('#browse-heading').textContent = item ? item.title : '今天，看点什么。';
  // A saved position turns 播放 into 继续播放 and shows the time left, as the Apple TV hero does.
  const position = item ? Number(localStorage.getItem(progressKey(item.bvid)) || 0) : 0;
  const left = item ? Math.max(0, item.duration - position) : 0;
  const resume = position > 0 && left > 0;
  document.querySelector('#hero-meta').textContent = item ? `${item.owner} · ${resume ? `剩余 ${Math.max(1, Math.round(left / 60))} 分钟` : clock(item.duration)}` : '';
  heroPlay.textContent = resume ? '继续播放' : '播放';
  heroLater.hidden = !item || document.querySelector('#logout').hidden;
  if (item) { heroLater.dataset.bvid = item.bvid; setLaterSaved(heroLater, laterSaved.has(item.bvid)); }
  // Re-showing the same item (e.g. after returning from the player) keeps a preview that is already loaded.
  if (heroPreview && !heroPreview.playingFor(item)) heroPreview.schedule(item);
}
heroLater.addEventListener('click', () => toggleLater(heroLater, text => {
  const meta = document.querySelector('#hero-meta');
  if (text) meta.dataset.note = text; else delete meta.dataset.note;
  clearTimeout(heroLater.noteTimer);
  heroLater.noteTimer = setTimeout(() => { delete meta.dataset.note; }, 3000);
}));
// Rotating hero: the first few recommendations take turns every 8 seconds with a fade, like the Apple TV
// top shelf. Any key press restarts the countdown so the item never changes under the user's hand.
const hero = document.querySelector('#hero');
const heroDots = document.querySelector('#hero-dots');
let heroItems = [];
let heroIndex = 0;
let heroTimer;
function setHeroItems(items) {
  heroItems = items;
  heroIndex = 0;
  heroDots.replaceChildren(...items.map(() => document.createElement('i')));
  heroDots.hidden = items.length < 2;
  showHero(items[0]);
  markHeroDot();
  restartHeroTimer();
}
function markHeroDot() {
  Array.from(heroDots.children).forEach((dot, index) => dot.classList.toggle('current', index === heroIndex));
}
function restartHeroTimer() {
  clearTimeout(heroTimer);
  heroTimer = setTimeout(advanceHero, 8000);
}
function advanceHero() {
  // A preview that is loading or playing keeps its slot (up to a minute); it advances the hero itself when it ends.
  if (heroPreview.activeFor(heroItem) && heroPreview.elapsed() < 60) { restartHeroTimer(); return; }
  if (heroItems.length > 1 && player.hidden && !overlayOpen() && activePage === 'browse' && document.visibilityState === 'visible') {
    hero.classList.add('fading');
    setTimeout(() => {
      heroIndex = (heroIndex + 1) % heroItems.length;
      showHero(heroItems[heroIndex]);
      markHeroDot();
      hero.classList.remove('fading');
    }, 450);
  }
  restartHeroTimer();
}
// Manual paging from the remote: forward wraps to the first item like the rotation; back stops at the first
// item (returns false there so the caller can open the sidebar instead).
function stepHero(delta) {
  if (heroItems.length < 2 || (delta < 0 && heroIndex === 0)) return false;
  heroIndex = (heroIndex + delta + heroItems.length) % heroItems.length;
  showHero(heroItems[heroIndex]);
  markHeroDot();
  restartHeroTimer();
  if (document.activeElement.hidden) heroPlay.focus({ preventScroll: true });
  return true;
}
document.addEventListener('keydown', restartHeroTimer, true);
// Hero preview: after the featured item has been on screen for a moment, its video plays muted behind the
// title (720P DASH through the local service), fading in over the artwork the way Apple TV plays a trailer.
// It pauses while the player, the detail page, another page or the shelves below are in front, and is
// unloaded as soon as real playback starts so the TV never decodes two videos.
heroPreview = (() => {
  const element = document.querySelector('#hero-video');
  element.muted = true;
  const preview = new shaka.Player();
  const attached = preview.attach(element);
  preview.configure({ streaming: { bufferingGoal: 20, rebufferingGoal: 2, retryParameters: { maxAttempts: 2 } } });
  preview.addEventListener('error', () => stop());
  let bvid = null;
  let generation = 0;
  let startTimer;
  let startedAt = 0;
  function wanted() {
    return player.hidden && !home.hidden && !overlayOpen() && !document.querySelector('#sidebar').matches(':focus-within') && activePage === 'browse' && document.visibilityState === 'visible' && window.scrollY < innerHeight * .4 && !hero.classList.contains('fading');
  }
  async function load(item) {
    const current = ++generation;
    bvid = item.bvid;
    try {
      await attached;
      // 720P needs a login; signed out the service offers up to 480P.
      let media;
      try { media = await serviceRequest(`/resolve?bvid=${encodeURIComponent(item.bvid)}&quality=720`); } catch { if (current === generation) media = await serviceRequest(`/resolve?bvid=${encodeURIComponent(item.bvid)}&quality=480`); }
      if (current !== generation) return;
      if (media.format !== 'dash' || !MediaSource.isTypeSupported(`video/mp4; codecs="${media.videoCodec}"`)) { bvid = null; return; }
      await preview.load(media.src, 0, 'application/dash+xml');
      if (current !== generation) return;
      if (wanted()) await element.play();
    } catch {
      if (current === generation) stop();
    }
  }
  function stop() {
    generation++;
    clearTimeout(startTimer);
    bvid = null;
    startedAt = 0;
    element.classList.remove('playing');
    element.pause();
    preview.unload().catch(() => {});
  }
  // Called whenever the hero shows an item: the old preview goes away and the new one starts after 3 seconds.
  function schedule(item) {
    stop();
    if (!item) return;
    startTimer = setTimeout(() => { if (heroItem === item && wanted()) load(item); else schedule(item); }, 3000);
  }
  element.addEventListener('playing', () => {
    if (!startedAt) startedAt = performance.now();
    element.classList.add('playing');
  });
  element.addEventListener('ended', () => { stop(); advanceHero(); });
  // Pause and resume as the hero goes out of and back into view; checked every second rather than wiring every
  // page, overlay and scroll change.
  setInterval(() => {
    if (!bvid) return;
    if (!wanted()) { if (!element.paused) element.pause(); }
    else if (element.paused && element.readyState >= 2) element.play().catch(() => {});
  }, 1000);
  return {
    schedule, stop,
    activeFor: item => Boolean(item && bvid === item.bvid),
    playingFor: item => Boolean(item && bvid === item.bvid && element.classList.contains('playing') && !element.ended),
    elapsed: () => startedAt ? (performance.now() - startedAt) / 1000 : 0,
  };
})();
heroPlay.addEventListener('click', () => {
  if (!heroItem) {
    if (!recommendBusy) loadRecommend(false, !recommendRetry.hidden && recommendRetryAppend);
    if (!grid.children.length && !loadMore.disabled) loadPopular();
    return;
  }
  if (start.disabled) return;
  input.value = heroItem.bvid;
  document.querySelector('#form').requestSubmit();
});

// Shelf navigation on the 推荐 page: Left/Right along a row, Up/Down to the nearest card in the
// neighbouring row, the hero above the first row, and the sidebar from the first card.
const shelfRows = [historyRow, recommendGrid];
function focusCard(card) {
  card.focus({ preventScroll: true });
  card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const shelf = card.closest('.shelf');
  // 推荐 shelves, as on Apple TV: the focused row settles just below the top-left page pill (the hero scrolls
  // away instead of half its buttons staying under the pill); other pages keep the nearest scroll.
  if (shelfRows.includes(card.parentElement)) window.scrollTo(0, Math.max(0, (card.parentElement === recommendGrid ? card : shelf).getBoundingClientRect().top + window.scrollY - innerHeight * (card.parentElement === recommendGrid ? .2 : .12)));
  else shelf.scrollIntoView({ block: 'nearest' });
}
function nearestCard(row, from) {
  const x = from.getBoundingClientRect().left;
  return Array.from(row.children).reduce((best, card) => Math.abs(card.getBoundingClientRect().left - x) < Math.abs(best.getBoundingClientRect().left - x) ? card : best);
}
function visibleRows() { return shelfRows.filter(row => row.children.length && !row.closest('.shelf').hidden); }
for (const row of shelfRows) row.addEventListener('keydown', event => {
  const cards = Array.from(row.children);
  const index = cards.indexOf(document.activeElement);
  if (index < 0) return;
  const rows = visibleRows();
  const rowIndex = rows.indexOf(row);
  let target;
  if (event.key === 'ArrowLeft') target = index > 0 ? cards[index - 1] : document.activeElement;
  if (event.key === 'ArrowRight') {
    target = cards[Math.min(cards.length - 1, index + 1)];
    if (row === grid && index >= cards.length - 4 && !popularDone && !loadMore.disabled) loadPopular();
  }
  if (event.key === 'ArrowUp') target = rowIndex > 0 ? nearestCard(rows[rowIndex - 1], cards[index]) : heroPlay;
  if (event.key === 'ArrowDown') target = rowIndex < rows.length - 1 ? nearestCard(rows[rowIndex + 1], cards[index]) : cards[index];
  if (row === recommendGrid) {
    const columns = getComputedStyle(recommendGrid).gridTemplateColumns.split(' ').length;
    if (event.key === 'ArrowDown' && index >= cards.length - columns * 2 && recommendRetry.hidden) loadRecommend(false, true);
    if (event.key === 'ArrowLeft') target = index % columns > 0 ? cards[index - 1] : document.activeElement;
    if (event.key === 'ArrowRight') target = index % columns < columns - 1 ? cards[Math.min(index + 1, cards.length - 1)] : cards[index];
    if (event.key === 'ArrowUp' && index >= columns) target = cards[index - columns];
    if (event.key === 'ArrowDown') target = index < Math.floor((cards.length - 1) / columns) * columns ? cards[Math.min(index + columns, cards.length - 1)] : recommendRetry.hidden ? cards[index] : recommendRetry;
  } else if (event.key === 'ArrowDown' && rowIndex === rows.length - 1 && !recommendRetry.hidden) {
    target = recommendRetry;
  }
  if (!target) return;
  event.preventDefault();
  if (target === heroPlay) { heroPlay.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  else if (target.classList.contains('video-card')) focusCard(target);
  else target.focus({ preventScroll: target !== recommendRetry });
});
document.querySelector('.hero-actions').addEventListener('keydown', event => {
  const actions = Array.from(document.querySelectorAll('.hero-actions button')).filter(button => !button.hidden);
  const index = actions.indexOf(document.activeElement);
  let target;
  // Past the last button Right pages to the next featured item; past the first button Left pages back, and on
  // the first item it opens the sidebar.
  if (event.key === 'ArrowLeft') {
    if (index > 0) target = actions[index - 1];
    else { event.preventDefault(); if (!stepHero(-1)) activeNav().focus({ preventScroll: true }); return; }
  }
  if (event.key === 'ArrowRight') {
    if (index < actions.length - 1) target = actions[index + 1];
    else { event.preventDefault(); stepHero(1); return; }
  }
  if (event.key === 'ArrowUp') target = document.activeElement;
  if (event.key === 'ArrowDown') target = visibleRows()[0]?.firstElementChild || (recommendRetry.hidden ? null : recommendRetry);
  if (!target) return;
  event.preventDefault();
  if (target.classList.contains('video-card')) focusCard(target); else target.focus({ preventScroll: target !== recommendRetry });
});
loadMore.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'ArrowUp' && grid.children.length) {
    grid.lastElementChild.focus({ preventScroll: true });
    grid.lastElementChild.scrollIntoView({ block: 'nearest' });
  }
});
heroPlay.focus();

// Sidebar profile: account name and avatar (initial until the picture loads) from the login state, plus the time.
function updateProfile() {
  const name = document.querySelector('#account-status').dataset.name || '';
  const loggedIn = !document.querySelector('#logout').hidden;
  document.querySelector('#nav-name').textContent = loggedIn ? name : '未登录';
  const avatar = document.querySelector('#nav-avatar');
  const face = document.querySelector('#account-status').dataset.face || '';
  // Rebuilt only when the account changes: updateProfile also runs whenever the sidebar takes focus (clock).
  const key = loggedIn ? `${name}\n${face}` : '';
  if (avatar.dataset.key !== key) {
    avatar.dataset.key = key;
    if (loggedIn) fillAvatar(avatar, face, name);
    else avatar.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.2-4 4.1-6 7.5-6s6.3 2 7.5 6"/></svg>';
  }
  const now = new Date();
  document.querySelector('#nav-clock').textContent = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
}
window.addEventListener('accountchange', updateProfile);
const navProfile = document.querySelector('#nav-profile');
navProfile.addEventListener('click', () => openProfilePicker());
navProfile.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'Escape' || event.keyCode === 461) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.key === 'ArrowDown' ? navItems[0] : activeNav();
    target.focus({ preventScroll: true });
    if (event.key === 'ArrowRight') enterPage();
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') event.preventDefault();
});
document.querySelector('#sidebar').addEventListener('focusin', () => {
  document.querySelector('#hero-video').pause();
  updateProfile();
});
updateProfile();

// Detail page, as in the Apple TV app: artwork, title, facts, description, 播放 / 继续播放 and a
// related shelf. Related videos open their own detail page; Back steps back through them to the original card.
const detail = document.querySelector('#detail');
const detailPlay = document.querySelector('#detail-play');
const detailRelated = document.querySelector('#detail-related');
const detailPages = document.querySelector('#detail-pages');
const detailEpisodes = document.querySelector('#detail-episodes');
const detailPagesShelf = document.querySelector('#detail-pages-shelf');
detailEpisodes.addEventListener('click', () => {
  const target = detailPages.querySelector('[aria-pressed="true"]') || detailPages.firstElementChild;
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});
const detailAbout = document.querySelector('#detail-about');
const detailInfoGrid = document.querySelector('#detail-info-grid');
const detailStack = [];
let detailOrigin = null;
let detailOriginScroll = 0;
let detailGeneration = 0;
let detailAboutFocus = null;
function countLabel(value) {
  if (!Number.isFinite(value)) return '';
  return value >= 10000 ? `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)} 万次播放` : `${value} 次播放`;
}
function showDetail(item) {
  const generation = ++detailGeneration;
  const image = document.querySelector('#detail-image');
  const blur = document.querySelector('#detail-blur');
  for (const [layer, width] of [[image, 1920], [blur, 640]]) { layer.referrerPolicy = 'no-referrer'; if (item.cover) layer.src = coverAt(item.cover, width); else layer.removeAttribute('src'); }
  document.querySelector('#detail-title').textContent = item.title;
  document.querySelector('#detail-mini-title').textContent = item.title;
  document.querySelector('#detail-meta').textContent = [item.owner, item.duration ? clock(item.duration) : ''].filter(Boolean).join(' · ');
  document.querySelector('#detail-desc').textContent = '';
  document.querySelector('#detail-facts').replaceChildren();
  document.querySelector('#detail-credits').replaceChildren();
  document.querySelector('#detail-people-shelf').hidden = true;
  detailAbout.hidden = true;
  detailInfoGrid.hidden = true;
  detailAboutFocus = null;
  detail.scrollTop = 0;
  detail.classList.remove('scrolled');
  document.querySelector('#detail-status').textContent = '';
  document.querySelector('#detail-related-shelf').hidden = true;
  detailPagesShelf.hidden = detailEpisodes.hidden = true;
  detailPages.replaceChildren();
  detailRelated.replaceChildren();
  if (item.episodes) renderDetailEpisodes(item, { pages: [] });
  refreshDetailActions(item);
  showLaterState(item.bvid, generation);
  detailPlay.focus({ preventScroll: true });
  serviceRequest(`/detail?bvid=${encodeURIComponent(item.bvid)}`).then(data => {
    if (generation !== detailGeneration) return;
    if (data.title) { document.querySelector('#detail-title').textContent = data.title; document.querySelector('#detail-mini-title').textContent = data.title; }
    document.querySelector('#detail-desc').textContent = data.desc && data.desc !== '-' ? data.desc : '';
    fillDetailSections(data);
    if (data.cover && !item.cover) { image.src = coverAt(data.cover, 1920); document.querySelector('#detail-blur').src = coverAt(data.cover, 640); }
    detailRelated.replaceChildren(...data.related.map(related => videoCard(related, `${related.owner} · ${clock(related.duration)}`)));
    if ((item.episodes?.length || 0) < 2) renderDetailEpisodes(item, data);
    refreshDetailActions(item);
    document.querySelector('#detail-related-shelf').hidden = data.related.length === 0;
  }).catch(error => {
    if (generation === detailGeneration) document.querySelector('#detail-status').textContent = `详情加载失败：${error.message}，仍可播放`;
  });
}
function renderDetailEpisodes(item, data) {
  const season = item.episodes?.length > 1 ? item.episodes : data.episodes;
  const episodes = season?.length > 1 ? season : data.pages.map(part => ({
    bvid: item.bvid, page: part.page, title: `P${part.page} ${part.part}`,
  }));
  detailPages.replaceChildren(...episodes.map(episode => {
    const button = document.createElement('button');
    button.dataset.bvid = episode.bvid;
    button.dataset.page = episode.page || 1;
    button.textContent = episode.title;
    button.addEventListener('click', () => {
      if (start.disabled) return;
      requestedPart = Number(button.dataset.page);
      input.value = episode.bvid;
      button.focus({ preventScroll: true });
      document.querySelector('#form').requestSubmit();
    });
    return button;
  }));
  detailPagesShelf.hidden = detailEpisodes.hidden = episodes.length < 2;
  if (data.episodesUnavailable) document.querySelector('#detail-status').textContent = '选集加载失败，重新打开详情可重试';
}
// The part a detail page resumes: the one last watched on this device, otherwise P1.
function detailPart(item) { return readHistory().find(entry => entry.bvid === item.bvid)?.page || 1; }
function refreshDetailActions(item) {
  const page = detailPart(item);
  const position = Number(localStorage.getItem(progressKey(item.bvid, page)) || 0);
  detailPlay.textContent = position > 0 ? (page > 1 ? `继续播放 P${page}` : '继续播放') : (page > 1 ? `播放 P${page}` : '播放');
  for (const button of detailPages.children) button.setAttribute('aria-pressed', String(button.dataset.bvid === item.bvid && Number(button.dataset.page) === page));
}
// The stack holds detail entries (videos) and UP 主 entries ({ up: mid }); the top one is shown.
function overlayOpen() { return !detail.hidden || !upPage.hidden; }
function showOverlay(entry) {
  detail.hidden = Boolean(entry.up);
  upPage.hidden = !entry.up;
  if (entry.up) showUp(entry);
  else { upEntry = null; showDetail(entry); }
}
function openDetail(item, card) {
  if (!overlayOpen()) {
    detailOrigin = card;
    detailOriginScroll = window.scrollY;
    detailStack.length = 0;
    home.hidden = true;
  }
  const top = detailStack[detailStack.length - 1];
  if (top?.up) {
    top.focusBvid = card?.dataset.bvid;
    top.scrollTop = upPage.scrollTop;
  }
  detailStack.push(item);
  showOverlay(item);
}
function openUp(mid) {
  detailStack.push({ up: mid, page: 0, more: true, items: [], profile: null, error: '', loading: false });
  showOverlay(detailStack[detailStack.length - 1]);
}
function backDetail() {
  detailStack.pop();
  if (detailStack.length) { showOverlay(detailStack[detailStack.length - 1]); return; }
  detailGeneration++;
  upEntry = null;
  detail.hidden = true;
  upPage.hidden = true;
  home.hidden = false;
  window.scrollTo(0, detailOriginScroll);
  const target = detailOrigin?.isConnected ? detailOrigin : activeNav();
  target.focus({ preventScroll: true });
  if (target.classList.contains('video-card')) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function playFromDetail() {
  const item = detailStack[detailStack.length - 1];
  if (!item || start.disabled) return;
  const page = detailPart(item);
  requestedPart = page;
  input.value = item.bvid;
  detailPlay.focus({ preventScroll: true });
  document.querySelector('#form').requestSubmit();
}
detailPlay.addEventListener('click', playFromDetail);
function detailKeys(event) {
  if (event.key === 'Escape' || event.keyCode === 461) { event.preventDefault(); backDetail(); return; }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  // Left/Right move within a row; Up/Down move through the shelves and the final information section.
  const actions = [detailPlay, detailEpisodes, detailLater].filter(button => !button.hidden);
  const shown = id => !document.querySelector(id).hidden;
  const sections = [
    actions,
    shown('#detail-pages-shelf') ? Array.from(detailPages.children) : [],
    shown('#detail-related-shelf') ? Array.from(detailRelated.children) : [],
    shown('#detail-people-shelf') ? Array.from(document.querySelector('#detail-people').children) : [],
    detailAbout.hidden ? [] : Array.from(document.querySelector('#detail-about-cards').children),
    detailInfoGrid.hidden ? [] : [detailInfoGrid],
  ].filter(row => row.length);
  const active = document.activeElement;
  const rowIndex = sections.findIndex(row => row.includes(active));
  if (rowIndex < 0) { detailPlay.focus({ preventScroll: true }); return; }
  const row = sections[rowIndex];
  const index = row.indexOf(active);
  let target;
  if (event.key === 'ArrowLeft') target = row[index - 1];
  if (event.key === 'ArrowRight') target = row[index + 1];
  if (event.key === 'ArrowUp' && rowIndex > 0) {
    const above = sections[rowIndex - 1];
    if (active === detailInfoGrid && above.includes(detailAboutFocus)) target = detailAboutFocus;
    else target = above === actions ? detailPlay : (above.find(button => button.getAttribute('aria-pressed') === 'true') || nearestCard({ children: above }, active));
  }
  if (event.key === 'ArrowDown' && rowIndex < sections.length - 1) {
    const below = sections[rowIndex + 1];
    target = below.find(button => button.getAttribute('aria-pressed') === 'true') || (row === actions ? below[0] : nearestCard({ children: below }, active));
  }
  if (!target) return;
  target.focus({ preventScroll: true });
  if (actions.includes(target)) detail.scrollTop = 0;
  else if (target === detailInfoGrid) {
    detailAboutFocus = active;
    detailInfoGrid.scrollIntoView({ block: 'end', inline: 'nearest' });
  } else {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const shelf = target.closest('.shelf');
    // Keep the metadata in view with 关于 when both fit below the sticky title.
    if (shelf === detailAbout && !detailInfoGrid.hidden &&
        detailInfoGrid.getBoundingClientRect().bottom - shelf.getBoundingClientRect().top <= detail.clientHeight * .87) {
      detailInfoGrid.scrollIntoView({ block: 'end', inline: 'nearest' });
    } else shelf?.scrollIntoView({ block: 'center' });
  }
}
// Scrolled past the artwork: the art gives way to a blurred backdrop and a small title, as on Apple TV.
detail.addEventListener('scroll', () => detail.classList.toggle('scrolled', detail.scrollTop > innerHeight * .3));
// The sections below the fold, filled from /detail.
function fillDetailSections(data) {
  const date = data.pubdate ? new Date(data.pubdate * 1000) : null;
  const day = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
  const count = value => !Number.isFinite(value) ? '—' : value >= 100000000 ? `${(value / 100000000).toFixed(1)}亿` : value >= 10000 ? `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万` : String(value);
  document.querySelector('#detail-meta').textContent = [data.category, data.owner].filter(Boolean).join(' · ');
  // Facts line with outlined badges, like "2026年 · 1 小时 38 分钟 · [4K] [CC]".
  const facts = document.querySelector('#detail-facts');
  const height = data.height || 0;
  const resolution = height >= 2160 ? '4K' : height >= 1440 ? '2K' : height >= 1080 ? '1080P' : height >= 720 ? '720P' : '';
  const badges = [resolution, data.original ? '自制' : '', data.subtitles?.length ? '字幕' : '', data.pages.length ? `${data.pages.length}P` : ''].filter(Boolean);
  facts.replaceChildren(document.createTextNode([day, clock(data.duration), Number.isFinite(data.views) ? `${count(data.views)}播放` : ''].filter(Boolean).join(' · ')),
    ...badges.map(text => Object.assign(document.createElement('span'), { className: 'badge', textContent: text })));
  // Credits at the lower right: collaborators for joint uploads.
  const people = data.staff?.length ? data.staff : (data.owner ? [{ mid: data.ownerMid, name: data.owner, role: 'UP 主', face: data.ownerFace }] : []);
  const credits = document.querySelector('#detail-credits');
  const others = people.filter(person => person.name !== data.owner).map(person => person.name);
  credits.replaceChildren(...[['合作', others.slice(0, 4).join('、')]].filter(([, value]) => value)
    .flatMap(([label, value]) => [Object.assign(document.createElement('dt'), { textContent: label }), Object.assign(document.createElement('dd'), { textContent: value })]));
  // UP 主与合作: round portraits (initials without a photo) that open the person's page.
  const peopleRow = document.querySelector('#detail-people');
  peopleRow.replaceChildren(...people.filter(person => person.mid).map(person => {
    const button = document.createElement('button');
    button.className = 'person';
    const face = document.createElement('span'); face.className = 'face';
    if (person.face) { const img = document.createElement('img'); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = person.face; face.append(img); }
    else face.textContent = Array.from(person.name)[0] || '?';
    button.append(face, Object.assign(document.createElement('strong'), { textContent: person.name }), Object.assign(document.createElement('span'), { className: 'role', textContent: person.role || '' }));
    button.addEventListener('click', () => openUp(person.mid));
    return button;
  }));
  document.querySelector('#detail-people-shelf').hidden = !peopleRow.children.length;
  // 关于: the full description card and big-number cards for the counts.
  const about = document.querySelector('#detail-about-cards');
  const descCard = document.createElement('button'); descCard.className = 'about-card about-desc';
  descCard.append(Object.assign(document.createElement('strong'), { textContent: data.title }), Object.assign(document.createElement('span'), { className: 'about-sub', textContent: [data.category, day].filter(Boolean).join('、') }), Object.assign(document.createElement('p'), { textContent: data.desc && data.desc !== '-' ? data.desc : '这个视频没有简介。' }));
  const stat = (value, label) => { const card = document.createElement('button'); card.className = 'about-card about-stat'; card.append(Object.assign(document.createElement('b'), { textContent: count(value) }), Object.assign(document.createElement('span'), { textContent: label })); return card; };
  about.replaceChildren(descCard, stat(data.stats?.view, '播放'), stat(data.stats?.like, '点赞'), stat(data.stats?.coin, '投币'), stat(data.stats?.favorite, '收藏'));
  detailAbout.hidden = false;
  // Information columns, as Apple TV's 信息 / 语言 / 辅助功能.
  const column = (title, rows) => {
    const section = document.createElement('div');
    section.append(Object.assign(document.createElement('h3'), { textContent: title }));
    for (const [label, value] of rows.filter(([, value]) => value)) section.append(Object.assign(document.createElement('dt'), { textContent: label }), Object.assign(document.createElement('dd'), { textContent: value }));
    return section;
  };
  detailInfoGrid.replaceChildren(
    column('信息', [['UP 主', data.owner], ['发布日期', day], ['时长', clock(data.duration)], ['分区', data.category], ['视频编号', data.bvid]]),
    column('数据', [['弹幕', count(data.stats?.danmaku)], ['评论', count(data.stats?.reply)], ['分享', count(data.stats?.share)]]),
    column('视频', [['类型', data.original ? '自制' : '转载'], ['分辨率', data.width && data.height ? `${data.width}×${data.height}` : ''], ['字幕', data.subtitles?.length ? data.subtitles.join('、') : '无'], ['分集', data.pages.length ? `${data.pages.length} 集` : '单集']]),
  );
  detailInfoGrid.hidden = false;
}

// Settings: clearing the watch history needs a second press within 3 seconds, like a tvOS confirmation.
const clearHistory = document.querySelector('#clear-history');
let clearArmed = null;
clearHistory.addEventListener('click', () => {
  if (!clearArmed) {
    clearHistory.textContent = '再按一次确认清除';
    clearHistory.classList.add('armed');
    clearArmed = setTimeout(() => { clearArmed = null; clearHistory.textContent = '清除观看记录'; clearHistory.classList.remove('armed'); }, 3000);
    return;
  }
  clearTimeout(clearArmed);
  clearArmed = null;
  for (const key of Object.keys(localStorage)) if (key.startsWith(`progress:${accountIdentity ?? 'guest'}:`)) localStorage.removeItem(key);
  localStorage.removeItem(historyKey());
  renderHistory();
  if (heroItem) showHero(heroItem);
  clearHistory.classList.remove('armed');
  clearHistory.textContent = '已清除';
  setTimeout(() => { clearHistory.textContent = '清除观看记录'; }, 2000);
});

// Exit confirmation: 取消 is focused first; Left/Right switch buttons, Back cancels, 退出 closes the app.
const exitDialog = document.querySelector('#exit-dialog');
const exitConfirm = document.querySelector('#exit-confirm');
const exitCancel = document.querySelector('#exit-cancel');
function closeExitDialog() { exitDialog.close(); activeNav().focus({ preventScroll: true }); }
exitDialog.addEventListener('keydown', event => {
  if (event.key === 'Escape' || event.keyCode === 461) { event.preventDefault(); event.stopPropagation(); closeExitDialog(); return; }
  // A tvOS alert stacks its buttons; any arrow moves between the two.
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    (document.activeElement === exitConfirm ? exitCancel : exitConfirm).focus();
  }
});
exitCancel.addEventListener('click', closeExitDialog);
exitConfirm.addEventListener('click', () => { saveProgress(); window.close(); });

// Selecting the UP 主 closes the detail pages and searches that name.
// 稍后再看 on the detail page: Apple TV's round "+" (Add to Up Next) beside Play; a tick once saved.
const detailLater = document.querySelector('#detail-later');
function showLaterState(bvid, generation) {
  const accountGeneration = laterSavedGeneration;
  const loggedIn = !document.querySelector('#logout').hidden;
  detailLater.hidden = !loggedIn;
  detailLater.dataset.bvid = bvid;
  setLaterSaved(detailLater, laterSaved.has(bvid));
  if (!loggedIn) return;
  serviceRequest(`/me/later/state?bvid=${encodeURIComponent(bvid)}`).then(data => {
    if (generation === detailGeneration && accountGeneration === laterSavedGeneration) setLaterSaved(detailLater, data.saved);
  }).catch(error => {
    if (generation === detailGeneration && accountGeneration === laterSavedGeneration) document.querySelector('#detail-status').textContent = `稍后再看状态加载失败：${error.message}`;
  });
}
detailLater.addEventListener('click', () => toggleLater(detailLater, text => { document.querySelector('#detail-status').textContent = text; }));
// Account library: the logged-in account's following feed, watch later, cloud history and favourites as shelves.
const libraryRows = ['following-row', 'later-row', 'cloud-history-row', 'folder-row', 'favorite-row'].map(id => document.getElementById(id));
const libraryStatus = document.querySelector('#library-status');
const libraryLogin = document.querySelector('#library-login');
let libraryGeneration = 0;
const libraryState = { following: '', followingMore: false, history: null, historyMore: false, folder: null, favoritePage: 1, favoriteMore: false, busy: new Map(), keyGen: {}, loadedAt: {}, seen: new Set(), errors: {} };
// Each library page loads only its own list. A list loaded in the last minute is shown as it is; an older one
// (or one marked stale: watch later changed, a video was watched, the account switched) reloads on entry,
// replacing its cards in place and keeping the focused card.
const libraryKeys = { following: 'following', later: 'later', 'cloud-history': 'history', favorites: 'favorites' };
const libraryPaths = { following: '/me/following', later: '/me/later', history: '/me/history', favorites: '/me/favorites' };
const libraryFreshMs = 60000;
function markLibraryStale(...keys) { for (const key of keys.length ? keys : Object.values(libraryKeys)) delete libraryState.loadedAt[key]; }
// Replace a row's children; if focus was inside, put it back on the same video (or folder), else the card now
// at the same position, so a refresh never drops focus to the page body.
function replaceKeepingFocus(row, nodes) {
  const active = document.activeElement;
  const had = active && row.contains?.(active) ? { bvid: active.dataset.bvid, folder: active.dataset.folder, index: Array.from(row.children).indexOf(active) } : null;
  row.replaceChildren(...nodes);
  if (!had) return;
  const same = nodes.find(node => (had.bvid && node.dataset.bvid === had.bvid) || (had.folder && node.dataset.folder === had.folder));
  const target = same || nodes[Math.min(had.index, nodes.length - 1)];
  if (target) { target.focus({ preventScroll: true }); if (!same) target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  else (pageFocusables()[0] || activeNav()).focus({ preventScroll: true });
}
function libraryCard(item, detailText) { return videoCard(item, detailText ?? `${item.owner} · ${clock(item.duration)}`); }
function historyText(item) { return item.progress === -1 ? `${item.owner} · 已看完` : item.progress > 0 ? `${item.owner} · 看到 ${clock(item.progress)}` : `${item.owner} · ${clock(item.duration)}`; }
function showShelf(row, items, append, text) {
  const cards = items.map(item => libraryCard(item, text?.(item)));
  if (append) row.append(...cards.filter(card => !row.querySelector(`[data-bvid="${card.dataset.bvid}"]`))); else replaceKeepingFocus(row, cards);
  row.closest('.shelf').hidden = row.closest('.shelf').id !== 'favorites-shelf' && row.children.length === 0;
  showLibraryShelf();
}
// Each library entry shows its own shelf as a grid; an empty one says so once the library has loaded.
const libraryGridColumns = 4;
const libraryEmpty = document.querySelector('#library-empty');
function showLibraryShelf() {
  const id = libraryPages[activePage];
  if (!id) return;
  const shelf = document.getElementById(id);
  for (const item of document.querySelectorAll('.library-content > .shelf')) item.classList.toggle('current', item === shelf);
  const name = shelf.querySelector('h2').textContent;
  document.querySelector('#library-heading').textContent = name;
  const key = libraryKeys[activePage];
  const loading = libraryState.busy.has(key) || (key === 'favorites' && libraryState.busy.has('favorite'));
  if (libraryLogin.hidden) libraryStatus.textContent = loading && !libraryState.seen.has(key) ? '正在加载…' : (libraryState.errors[key] || '');
  libraryStatus.setAttribute('aria-busy', String(loading));
  const done = libraryState.seen.has(key) && !loading && libraryLogin.hidden;
  libraryEmpty.hidden = !(done && shelf.hidden);
  libraryEmpty.textContent = `${name}里还没有视频。`;
}
function libraryGridOf(shelf) { return shelf?.id === 'favorites-shelf' ? libraryRows[4] : shelf?.querySelector('.row'); }
// A request is dropped when the account switched or a forced refresh of the same list started after it.
async function libraryRequest(key, path, force = false) {
  if (libraryState.busy.has(key) && !force) return null;
  const generation = libraryGeneration;
  const keyGeneration = force ? (libraryState.keyGen[key] = (libraryState.keyGen[key] || 0) + 1) : (libraryState.keyGen[key] || 0);
  const current = () => generation === libraryGeneration && keyGeneration === (libraryState.keyGen[key] || 0);
  const busy = libraryState.busy;
  const token = {};
  busy.set(key, token);
  try {
    const data = await serviceRequest(path);
    return current() ? data : null;
  } catch (error) {
    if (!current()) return null;
    throw error;
  } finally { if (busy.get(key) === token) busy.delete(key); }
}
async function loadLibrary(force = false) {
  const key = libraryKeys[activePage];
  if (!key || (libraryState.busy.has(key) && !force)) return;
  const at = libraryState.loadedAt[key];
  if (!force && at && Date.now() - at < libraryFreshMs) return;
  const generation = libraryGeneration;
  libraryLogin.hidden = true;
  // A forced refresh of 收藏 also drops a pending folder page.
  if (force && key === 'favorites') libraryState.keyGen.favorite = (libraryState.keyGen.favorite || 0) + 1;
  const request = libraryRequest(key, libraryPaths[key], force);
  showLibraryShelf();
  let data, error;
  try { data = await request; } catch (caught) { error = caught; }
  if (generation !== libraryGeneration || (!data && !error)) { showLibraryShelf(); return; }
  if (error && /登录/.test(error.message)) {
    for (const row of libraryRows) { row.replaceChildren(); row.closest('.shelf').hidden = true; }
    libraryState.loadedAt = {}; libraryState.seen.clear(); libraryState.errors = {};
    libraryLogin.hidden = false;
    libraryStatus.textContent = '登录后可以查看关注、观看历史和收藏。';
    libraryStatus.setAttribute('aria-busy', 'false');
    libraryEmpty.hidden = true;
    return;
  }
  libraryState.seen.add(key);
  if (error) libraryState.errors[key] = `加载失败：${error.message}`;
  else {
    delete libraryState.errors[key];
    libraryState.loadedAt[key] = Date.now();
    if (key === 'following') { showShelf(libraryRows[0], data.items); libraryState.following = data.offset; libraryState.followingMore = data.more; }
    if (key === 'later') showShelf(libraryRows[1], data.items);
    if (key === 'history') { showShelf(libraryRows[2], data.items, false, historyText); libraryState.history = data.cursor; libraryState.historyMore = data.more; }
    if (key === 'favorites') {
      const folderRow = libraryRows[3];
      replaceKeepingFocus(folderRow, data.folders.map(folder => {
        const button = document.createElement('button');
        button.dataset.folder = folder.id;
        button.append(folder.title);
        const count = document.createElement('span'); count.textContent = folder.count;
        button.append(count);
        button.addEventListener('click', () => openFolder(folder.id));
        return button;
      }));
      document.querySelector('#favorites-shelf').hidden = data.folders.length === 0;
      // Keep the open folder if it still exists; otherwise open the first one.
      const keep = data.folders.find(folder => String(folder.id) === String(libraryState.folder)) || data.folders[0];
      if (!keep || String(keep.id) !== String(libraryState.folder)) { libraryState.favoriteMore = false; libraryRows[4].replaceChildren(); }
      if (!keep) libraryState.folder = null;
      if (keep) openFolder(keep.id, false);
    }
  }
  showLibraryShelf();
}
async function openFolder(id, focusFirst = true) {
  libraryState.folder = id;
  libraryState.favoritePage = 1;
  for (const button of libraryRows[3].children) button.setAttribute('aria-pressed', String(button.dataset.folder === String(id)));
  const data = await libraryRequest('favorite', `/me/favorites/items?id=${id}&page=1`).catch(error => { libraryStatus.textContent = `收藏夹加载失败：${error.message}`; return null; });
  showLibraryShelf();
  if (!data || libraryState.folder !== id) return;
  showShelf(libraryRows[4], data.items);
  libraryState.favoriteMore = data.more;
  if (focusFirst && libraryRows[4].firstElementChild) focusCard(libraryRows[4].firstElementChild);
}
// Load the next page when focus gets near the end of a paged row.
async function libraryMore(row) {
  if (row === libraryRows[0] && libraryState.followingMore) {
    const data = await libraryRequest('following', `/me/following?offset=${libraryState.following}`).catch(() => null);
    if (data) { showShelf(row, data.items, true); libraryState.following = data.offset; libraryState.followingMore = data.more; }
  } else if (row === libraryRows[2] && libraryState.historyMore) {
    const data = await libraryRequest('history', `/me/history?max=${libraryState.history.max}&view_at=${libraryState.history.viewAt}`).catch(() => null);
    if (data) { showShelf(row, data.items, true, historyText); libraryState.history = data.cursor; libraryState.historyMore = data.more; }
  } else if (row === libraryRows[4] && libraryState.favoriteMore) {
    const page = libraryState.favoritePage + 1;
    const data = await libraryRequest('favorite', `/me/favorites/items?id=${libraryState.folder}&page=${page}`).catch(() => null);
    if (data) { showShelf(row, data.items, true); libraryState.favoritePage = page; libraryState.favoriteMore = data.more; }
  }
}
document.querySelector('#page-library').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const active = document.activeElement;
  const shelf = document.querySelector('.library-content > .shelf.current');
  const grid = libraryGridOf(shelf);
  const folders = shelf?.id === 'favorites-shelf' ? libraryRows[3] : null;
  let target;
  // Left from the first column and Up from the top row go back to the sidebar.
  if (folders?.contains(active)) {
    const items = Array.from(folders.children);
    const index = items.indexOf(active);
    if (event.key === 'ArrowLeft') target = index > 0 ? items[index - 1] : document.activeElement;
    if (event.key === 'ArrowRight') target = items[Math.min(items.length - 1, index + 1)];
    if (event.key === 'ArrowDown') target = grid.firstElementChild ? nearestCard(grid, active) : active;
    if (event.key === 'ArrowUp') target = document.activeElement;
  } else if (grid?.contains(active)) {
    const cards = Array.from(grid.children);
    const index = cards.indexOf(active);
    const columns = libraryGridColumns;
    if (event.key === 'ArrowLeft') target = index % columns > 0 ? cards[index - 1] : document.activeElement;
    if (event.key === 'ArrowRight') target = cards[Math.min(cards.length - 1, index + (index % columns < columns - 1 ? 1 : 0))];
    if (event.key === 'ArrowUp') target = index >= columns ? cards[index - columns] : (folders?.children.length ? nearestCard(folders, active) : document.activeElement);
    if (event.key === 'ArrowDown') target = cards[Math.min(cards.length - 1, index + columns)];
    if (index >= cards.length - columns * 2) libraryMore(grid);
  } else return;
  if (!target) return;
  event.preventDefault();
  target.focus({ preventScroll: true });
  if (target !== activeNav()) target.scrollIntoView({ block: 'nearest' });
  if (event.key === 'ArrowUp' && (folders?.contains(active) || Array.from(grid.children).indexOf(active) < libraryGridColumns)) window.scrollTo(0, 0);
});
libraryLogin.addEventListener('click', () => {
  const settings = navItems.find(item => item.dataset.page === 'settings');
  settings.focus({ preventScroll: true });
  showPage('settings');
  enterPage();
});
libraryLogin.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); document.activeElement.focus({ preventScroll: true }); }
});
window.addEventListener('accountchange', event => {
  if (!event.detail.changed) return;
  libraryGeneration++;
  Object.assign(libraryState, { following: '', followingMore: false, history: null, historyMore: false, folder: null, favoritePage: 1, favoriteMore: false, busy: new Map(), keyGen: {}, loadedAt: {}, seen: new Set(), errors: {} });
  for (const row of libraryRows) { row.replaceChildren(); row.closest('.shelf').hidden = true; }
  libraryStatus.textContent = '';
  libraryStatus.setAttribute('aria-busy', 'false');
  if (libraryPages[activePage]) loadLibrary();
});

// Player options: speed (this session), quality switch (reopens at the current position), subtitles.
const speedButton = document.querySelector('#speed');
const qualitySwitch = document.querySelector('#quality-switch');
const subtitleToggle = document.querySelector('#subtitle-toggle');
const subtitleText = document.querySelector('#subtitle-text');
const speeds = [1, 1.25, 1.5, 2, 0.75];
let speed = 1;
let subtitleTracks = [];
let subtitleIndex = -1;
let subtitleCues = [];
let subtitleGeneration = 0;
function applySpeed() { video.defaultPlaybackRate = speed; video.playbackRate = speed; speedButton.textContent = `倍速 ${speed}×`; }
speedButton.addEventListener('click', () => { speed = speeds[(speeds.indexOf(speed) + 1) % speeds.length]; applySpeed(); });
video.addEventListener('loadedmetadata', applySpeed);
video.addEventListener('playing', () => { if (video.playbackRate !== speed) applySpeed(); });
qualitySwitch.addEventListener('click', () => {
  if (start.disabled || !current) return;
  if (!qualityMenu.hidden) { closeQualityMenu(); return; }
  const choices = document.querySelector('#quality-choices');
  const options = [{ value: 'auto', label: '自动', id: 0 }, ...current.qualityOptions];
  choices.replaceChildren(...options.map(option => {
    const button = document.createElement('button');
    button.textContent = option.label;
    button.dataset.quality = option.value;
    button.setAttribute('aria-pressed', String(option.value === current.requestedQuality));
    const codec = option.id === 0 ? null : (option.codecs.find(value => value.startsWith('avc1') && MediaSource.isTypeSupported(`video/mp4; codecs="${value}"`)) || option.codecs.find(value => MediaSource.isTypeSupported(`video/mp4; codecs="${value}"`)));
    if (option.id !== 0 && !codec) {
      button.disabled = true;
      button.append(Object.assign(document.createElement('small'), { textContent: option.codecs.length ? '设备不支持' : '账号不可用' }));
    }
    if (option.id === 126) button.prepend(document.querySelector('#dolby-vision-icon').content.cloneNode(true));
    button.addEventListener('click', () => {
      const changed = current.requestedQuality !== option.value;
      closeQualityMenu();
      if (!changed) return;
      playbackQuality = option.value;
      playbackCodec = codec;
      retryPlayback().catch(showError);
    });
    return button;
  }));
  qualityMenu.hidden = false;
  qualitySwitch.setAttribute('aria-expanded', 'true');
  clearTimeout(controlsTimer);
  const selected = choices.querySelector('[aria-pressed="true"]:not([disabled])') || choices.querySelector('button:not([disabled])');
  selected.focus();
});
qualityMenu.addEventListener('keydown', event => {
  event.stopPropagation();
  if (event.key === 'Escape' || event.keyCode === 461) {
    event.preventDefault();
    closeQualityMenu();
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const buttons = Array.from(document.querySelectorAll('#quality-choices button:not([disabled])'));
    const index = buttons.indexOf(document.activeElement);
    const step = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
    const target = buttons[Math.max(0, Math.min(buttons.length - 1, index + step))];
    target.focus();
    target.scrollIntoView({ block: 'nearest' });
  }
});
function closeQualityMenu() {
  qualityMenu.hidden = true;
  qualitySwitch.setAttribute('aria-expanded', 'false');
  showControls();
  qualitySwitch.focus();
}
function clearSubtitles() {
  clearDanmaku();
  subtitleGeneration++;
  subtitleTracks = []; subtitleCues = []; subtitleIndex = -1;
  subtitleText.hidden = true; subtitleText.textContent = '';
  subtitleToggle.hidden = true;
}
function updatePlaybackQuality() {
  if (!current || current.requestedQuality !== 'auto') return;
  const track = dashPlayer.getVariantTracks().find(track => track.active);
  if (!track) return;
  const option = current.qualityOptions.find(option => option.id === Number(track.originalVideoId.split('-')[0]));
  current.quality = option.id;
  current.qualityLabel = option.label;
  qualitySwitch.textContent = `自动 · ${option.label}`;
}
function playerOptionsFor(session) {
  qualitySwitch.textContent = `画质 ${session.qualityLabel}`;
  if (session.quality === 126) qualitySwitch.prepend(document.querySelector('#dolby-vision-icon').content.cloneNode(true));
  clearSubtitles();
  loadDanmaku(session);
  loadVideoshot(session);
  const generation = subtitleGeneration;
  serviceRequest(`/subtitles?bvid=${encodeURIComponent(session.bvid)}&page=${session.page || 1}`).then(data => {
    if (generation !== subtitleGeneration) return;
    subtitleTracks = data.tracks;
    subtitleToggle.hidden = subtitleTracks.length === 0;
    // 字幕 setting: off never turns them on; auto picks the remembered language, else Chinese, else the first;
    // remember (default) only restores a language chosen before.
    const mode = localStorage.getItem('subtitles') || 'remember';
    let preferred = subtitleTracks.findIndex(track => track.language === localStorage.getItem('subtitle-language'));
    if (mode === 'auto' && preferred < 0) preferred = Math.max(0, subtitleTracks.findIndex(track => /^(ai-)?zh/.test(track.language)));
    if (mode === 'off') preferred = -1;
    selectSubtitle(preferred);
  }).catch(() => { /* no subtitles: the option stays hidden */ });
}
async function selectSubtitle(index) {
  const generation = ++subtitleGeneration;
  subtitleIndex = index;
  subtitleCues = [];
  subtitleText.hidden = true;
  subtitleToggle.textContent = index < 0 ? '字幕 关' : `字幕 ${subtitleTracks[index].label}`;
  if (index < 0) return;
  try {
    const data = await serviceRequest(`/subtitle?url=${encodeURIComponent(subtitleTracks[index].url)}`);
    if (generation === subtitleGeneration) subtitleCues = data.cues;
  } catch (error) {
    if (generation === subtitleGeneration) subtitleToggle.textContent = `字幕加载失败`;
  }
}
subtitleToggle.addEventListener('click', () => {
  const next = subtitleIndex + 1 < subtitleTracks.length ? subtitleIndex + 1 : -1;
  if (next < 0) localStorage.removeItem('subtitle-language'); else localStorage.setItem('subtitle-language', subtitleTracks[next].language);
  selectSubtitle(next);
});
video.addEventListener('timeupdate', () => {
  if (!subtitleCues.length) return;
  const time = video.currentTime;
  const cue = subtitleCues.find(item => item.from <= time && time < item.to);
  subtitleText.textContent = cue ? cue.text : '';
  subtitleText.hidden = !cue;
});

// UP 主 page: profile and uploads (newest first), loading the next page near the end of the grid.
const upPage = document.querySelector('#up-page');
const upGrid = document.querySelector('#up-grid');
const upStatus = document.querySelector('#up-status');
const upRetry = document.querySelector('#up-retry');
let upEntry = null;
function renderUpProfile(profile) {
  const face = document.querySelector('#up-face');
  if (profile?.face) { face.referrerPolicy = 'no-referrer'; face.src = profile.face; } else face.removeAttribute('src');
  document.querySelector('#up-name').textContent = profile?.name || '';
  const fans = profile?.fans;
  const fansLabel = Number.isFinite(fans) ? (fans >= 10000 ? `${(fans / 10000).toFixed(1)} 万粉丝` : `${fans} 粉丝`) : '';
  document.querySelector('#up-meta').textContent = [fansLabel, Number.isFinite(profile?.videos) ? `${profile.videos} 个视频` : ''].filter(Boolean).join(' · ');
  document.querySelector('#up-sign').textContent = profile?.sign || '';
}
function upVideoCard(item) { return videoCard(item, clock(item.duration)); }
function renderUpStatus(entry) {
  upStatus.textContent = entry.error || (entry.page && !entry.items.length ? '这位 UP 主还没有公开视频' : '');
  upRetry.hidden = !entry.error;
}
async function loadUpPage(entry) {
  if (entry.loading || !entry.more) return;
  entry.loading = true;
  try {
    const data = await serviceRequest(`/up?mid=${encodeURIComponent(entry.up)}&page=${entry.page + 1}`);
    entry.page += 1;
    entry.more = data.more;
    if (data.profile) entry.profile = data.profile;
    entry.error = '';
    entry.items.push(...data.items);
    if (entry !== upEntry) return;
    if (data.profile) renderUpProfile(entry.profile);
    const cards = data.items.map(upVideoCard);
    upGrid.append(...cards);
    if (document.activeElement === upPage || document.activeElement === upRetry) {
      const target = cards[0] || upGrid.lastElementChild || upPage;
      target.focus({ preventScroll: true });
      if (target !== upPage) target.scrollIntoView({ block: 'nearest' });
    }
    renderUpStatus(entry);
  } catch (error) {
    entry.error = `UP 主页面加载失败：${error.message}`;
    if (entry === upEntry) {
      renderUpStatus(entry);
      if (document.activeElement === upPage) upRetry.focus();
    }
  } finally {
    entry.loading = false;
  }
}
function showUp(entry) {
  upEntry = entry;
  renderUpProfile(entry.profile);
  upGrid.replaceChildren(...entry.items.map(upVideoCard));
  renderUpStatus(entry);
  upPage.scrollTop = entry.scrollTop || 0;
  const card = Array.from(upGrid.children).find(node => node.dataset.bvid === entry.focusBvid) || upGrid.firstElementChild;
  (card || (entry.error ? upRetry : upPage)).focus({ preventScroll: true });
  if (!entry.page && !entry.error) return loadUpPage(entry);
}
upRetry.addEventListener('click', () => { if (upEntry) return loadUpPage(upEntry); });
function upKeys(event) {
  if (event.key === 'Escape' || event.keyCode === 461) { event.preventDefault(); backDetail(); return; }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const cards = Array.from(upGrid.children);
  if (document.activeElement === upRetry) {
    if (event.key === 'ArrowUp') cards.at(-1)?.focus();
    return;
  }
  const index = cards.indexOf(document.activeElement);
  if (index < 0) { cards[0]?.focus({ preventScroll: true }); return; }
  const columns = 4;
  let target;
  if (event.key === 'ArrowLeft' && index % columns > 0) target = cards[index - 1];
  if (event.key === 'ArrowRight') target = cards[Math.min(cards.length - 1, index + 1)];
  if (event.key === 'ArrowUp') target = index >= columns ? cards[index - columns] : null;
  if (event.key === 'ArrowDown') {
    const onLastRow = index >= Math.floor((cards.length - 1) / columns) * columns;
    target = onLastRow && !upRetry.hidden ? upRetry : cards[Math.min(cards.length - 1, index + columns)];
  }
  if (index >= cards.length - columns && upEntry && !upEntry.error) loadUpPage(upEntry);
  if (event.key === 'ArrowUp' && !target) { upPage.scrollTop = 0; return; }
  if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' }); }
}

// 分区: category pills; Enter loads that category's popular videos into the grid.
const regions = [
  { rid: 1, name: '动画' }, { rid: 4, name: '游戏' }, { rid: 36, name: '知识' }, { rid: 188, name: '科技' }, { rid: 160, name: '生活' },
  { rid: 211, name: '美食' }, { rid: 3, name: '音乐' }, { rid: 129, name: '舞蹈' }, { rid: 234, name: '运动' }, { rid: 223, name: '汽车' },
  { rid: 217, name: '动物圈' }, { rid: 181, name: '影视' }, { rid: 5, name: '娱乐' }, { rid: 119, name: '鬼畜' }, { rid: 155, name: '时尚' },
];
const regionTabs = document.querySelector('#region-tabs');
const regionGrid = document.querySelector('#region-grid');
const regionStatus = document.querySelector('#region-status');
const regionLoading = document.querySelector('#region-loading');
const regionRetry = document.querySelector('#region-retry');
const regionState = { loaded: false, rid: null, request: 0, cache: new Map() };
regionTabs.replaceChildren(...regions.map(region => {
  const button = document.createElement('button');
  button.dataset.rid = region.rid;
  button.textContent = region.name;
  button.addEventListener('click', () => selectRegion(region.rid, true, true));
  return button;
}));
async function selectRegion(rid, focusFirst, force = false) {
  if (force) regionState.cache.delete(rid);
  const request = ++regionState.request;
  regionState.loaded = true;
  regionState.rid = rid;
  const tab = regionTabs.querySelector(`[data-rid="${rid}"]`);
  for (const button of regionTabs.children) button.setAttribute('aria-pressed', String(Number(button.dataset.rid) === rid));
  if (regionGrid.contains(document.activeElement) || document.activeElement === regionRetry) tab.focus({ preventScroll: true });
  regionStatus.textContent = '';
  regionRetry.hidden = true;
  regionGrid.inert = true;
  for (const card of regionGrid.querySelectorAll('button')) card.disabled = true;
  regionGrid.setAttribute('aria-busy', 'true');
  regionLoading.hidden = regionState.cache.has(rid);
  if (!regionGrid.children.length) {
    regionGrid.replaceChildren(...Array.from({ length: 8 }, () => {
      const card = document.createElement('div');
      card.className = 'region-skeleton';
      card.setAttribute('aria-hidden', 'true');
      card.innerHTML = '<span class="art"></span><span class="title"></span><span class="meta"></span>';
      return card;
    }));
  }
  const slowTimer = setTimeout(() => {
    if (regionState.request === request) regionStatus.textContent = '加载时间较长…';
  }, 3000);
  try {
    const items = regionState.cache.get(rid) || (await serviceRequest(`/region?rid=${rid}`)).items;
    if (regionState.request !== request) return;
    regionState.cache.set(rid, items);
    regionGrid.replaceChildren(...items.map(item => videoCard(item, `${item.owner} · ${clock(item.duration)}`)));
    regionGrid.inert = false;
    regionStatus.textContent = items.length ? '' : '这个分区暂时没有视频';
    if (focusFirst && document.activeElement === tab && activePage === 'regions' && regionGrid.firstElementChild) { regionGrid.firstElementChild.focus({ preventScroll: true }); regionGrid.firstElementChild.scrollIntoView({ block: 'nearest' }); }
  } catch (error) {
    if (regionState.request !== request) return;
    regionGrid.replaceChildren();
    regionStatus.textContent = `分区加载失败：${error.message}`;
    regionRetry.hidden = false;
  } finally {
    clearTimeout(slowTimer);
    if (regionState.request === request) {
      regionLoading.hidden = true;
      regionGrid.setAttribute('aria-busy', 'false');
    }
  }
}
regionRetry.addEventListener('click', () => selectRegion(regionState.rid, true, true));
regionRetry.addEventListener('keydown', event => {
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    regionTabs.querySelector('[aria-pressed="true"]').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
});
regionTabs.addEventListener('keydown', event => {
  const tabs = Array.from(regionTabs.children);
  const index = tabs.indexOf(document.activeElement);
  let target;
  if (event.key === 'ArrowLeft') target = index > 0 ? tabs[index - 1] : document.activeElement;
  if (event.key === 'ArrowRight') target = tabs[Math.min(tabs.length - 1, index + 1)];
  if (event.key === 'ArrowUp') {
    target = document.activeElement;
    window.scrollTo(0, 0);
  }
  if (event.key === 'ArrowDown') target = !regionRetry.hidden ? regionRetry : regionGrid.inert ? document.activeElement : regionGrid.firstElementChild;
  if (!target) return;
  event.preventDefault();
  target.focus({ preventScroll: true });
  if (target.closest('.row')) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});
gridNavigation(regionGrid, () => {
  window.scrollTo(0, 0);
  return regionTabs.querySelector('[aria-pressed="true"]') || regionTabs.firstElementChild;
}, cards => cards[cards.length - 1], 4);

// Danmaku: fetched per part, released as playback passes their time. Scrolling comments take the first free
// lane; when every lane is busy the comment is skipped rather than overlapped. Seeking restarts from the new time.
const danmakuLayer = document.querySelector('#danmaku-layer');
const danmakuToggle = document.querySelector('#danmaku-toggle');
let danmakuLanes = 10;
let danmakuItems = [];
let danmakuNext = 0;
let danmakuGeneration = 0;
let laneFreeAt = [];
let fixedFreeAt = [];
function danmakuOn() { return localStorage.getItem('danmaku') !== 'off'; }
function clearDanmaku() {
  danmakuGeneration++;
  danmakuItems = [];
  danmakuNext = 0;
  danmakuLayer.replaceChildren();
}
function resetDanmakuTime() {
  danmakuLayer.replaceChildren();
  laneFreeAt = []; fixedFreeAt = [];
  const time = video.currentTime;
  let low = 0, high = danmakuItems.length;
  while (low < high) { const mid = (low + high) >> 1; if (danmakuItems[mid].t < time) low = mid + 1; else high = mid; }
  danmakuNext = low;
}
function loadDanmaku(session) {
  clearDanmaku();
  danmakuToggle.textContent = danmakuOn() ? '弹幕 开' : '弹幕 关';
  const generation = danmakuGeneration;
  serviceRequest(`/danmaku?bvid=${encodeURIComponent(session.bvid)}&page=${session.page || 1}`).then(data => {
    if (generation !== danmakuGeneration) return;
    danmakuItems = data.items;
    resetDanmakuTime();
  }).catch(() => { /* playback works without danmaku */ });
}
function spawnDanmaku(item, now) {
  if (danmakuLayer.childElementCount >= 60) return;
  const element = document.createElement('span');
  element.className = 'dm';
  element.textContent = item.text;
  const color = item.color & 0xffffff;
  if (color !== 0xffffff) element.style.color = `#${color.toString(16).padStart(6, '0')}`;
  // Lanes follow the chosen size and area: one lane per line of danmaku text.
  const fontPx = parseFloat(getComputedStyle(danmakuLayer).getPropertyValue('--dm-size')) * innerWidth / 100 || 36;
  danmakuLanes = Math.max(3, Math.floor(danmakuLayer.clientHeight / (fontPx * 1.35)));
  const laneHeight = danmakuLayer.clientHeight / danmakuLanes;
  const pace = (parseFloat(getComputedStyle(danmakuLayer).getPropertyValue('--dm-duration')) || 9) / 9;
  if (item.mode === 1) {
    const lane = Array.from({ length: danmakuLanes }, (_, index) => index).find(index => !(laneFreeAt[index] > now));
    if (lane === undefined) return;
    laneFreeAt[lane] = now + (1.6 + item.text.length * 0.12) * pace;
    element.style.top = `${lane * laneHeight}px`;
  } else {
    const slots = 3;
    const slot = Array.from({ length: slots }, (_, index) => index).find(index => !(fixedFreeAt[index + (item.mode === 4 ? slots : 0)] > now));
    if (slot === undefined) return;
    fixedFreeAt[slot + (item.mode === 4 ? slots : 0)] = now + 4;
    element.classList.add('fixed');
    element.style.top = item.mode === 5 ? `${slot * laneHeight}px` : `${(danmakuLanes - 1 - slot) * laneHeight}px`;
  }
  element.addEventListener('animationend', () => element.remove());
  danmakuLayer.append(element);
}
video.addEventListener('timeupdate', () => {
  if (!danmakuOn() || !danmakuItems.length || video.paused) return;
  const time = video.currentTime;
  const now = performance.now() / 1000;
  // A jump of more than 2 s (seek, resume) restarts from the new position instead of flooding the screen.
  if (danmakuItems[danmakuNext] && danmakuItems[danmakuNext].t < time - 2) resetDanmakuTime();
  while (danmakuNext < danmakuItems.length && danmakuItems[danmakuNext].t <= time) spawnDanmaku(danmakuItems[danmakuNext++], now);
});
video.addEventListener('seeking', resetDanmakuTime);
video.addEventListener('pause', () => danmakuLayer.classList.add('paused'));
video.addEventListener('playing', () => danmakuLayer.classList.remove('paused'));
danmakuToggle.addEventListener('click', () => {
  if (danmakuOn()) { localStorage.setItem('danmaku', 'off'); danmakuLayer.replaceChildren(); danmakuToggle.textContent = '弹幕 关'; }
  else { localStorage.removeItem('danmaku'); resetDanmakuTime(); danmakuToggle.textContent = '弹幕 开'; }
  showSettingRows();
});

// Liquid Glass (tvOS 26), modelled optically instead of as blurred translucency. Each glass element is a
// clear slab (refractive index 1.5) whose rim is a convex squircle bevel, height(x) = (1 - (1 - x)^4)^(1/4)
// across the bevel width. A ray coming straight down through the bevel bends by Snell's law and lands
// inwards by height · tan(θ1 - θ2), so the backdrop is pulled towards the centre and magnified along the rim,
// while the flat middle shows it undistorted and unblurred. The filter, used as a backdrop-filter, displaces
// the backdrop with that field, three times at slightly different strengths for the red, green and blue
// channels (the colour fringing of real glass), saturates it a little, and screens a specular highlight on
// top: light from the upper left catching the slope of the bevel (the far side catches a weaker reflection).
const glassFilters = document.querySelector('#glass-filters');
const svgNS = 'http://www.w3.org/2000/svg';
let glassCount = 0;
function svgElement(name, attributes) {
  const element = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}
// Bevel optics along the distance from the border, in CSS pixels: inward landing offset and slope factor.
function bevelProfile(bevel, thickness, samples = 128) {
  const height = x => Math.pow(1 - Math.pow(1 - x, 4), 1 / 4);
  const shifts = [], slopes = [];
  for (let i = 0; i < samples; i++) {
    const x = Math.min(.999, Math.max(.001, (i + .5) / samples));
    const derivative = (height(Math.min(1, x + .001)) - height(x - .001)) / .002;
    const theta1 = Math.atan(derivative * thickness / bevel);
    const theta2 = Math.asin(Math.sin(theta1) / 1.5);
    shifts.push(height(x) * thickness * Math.tan(theta1 - theta2));
    slopes.push(Math.sin(theta1));
  }
  return { shifts, slopes, max: Math.max(...shifts) || 1 };
}
function liquidGlass(element, { bevel = .3, thickness = .9, chroma = .07, saturation = 1.35, specular = .55, id, refract = true } = {}) {
  // A named filter (the sidebar) is styled by its own CSS rule; anonymous ones mark the element .liquid.
  // Without refract the element keeps the rim highlight and tint but no backdrop-filter (.liquid.lite): on the
  // LG TV every live backdrop-filter is re-run whenever anything behind it moves, and the small buttons and
  // pills sit over scrolling pages, the drifting hero and video (which the TV composites on its own plane).
  const named = Boolean(id);
  id ||= `glass-${++glassCount}`;
  const filter = svgElement('filter', { id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
  const map = svgElement('feImage', { result: 'map', preserveAspectRatio: 'none' });
  const light = svgElement('feImage', { result: 'light', preserveAspectRatio: 'none' });
  const channel = rows => svgElement('feColorMatrix', { type: 'matrix', values: rows });
  const displacements = [1 + chroma, 1, 1 - chroma].map((factor, index) => svgElement('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', xChannelSelector: 'R', yChannelSelector: 'G', result: `d${index}`, 'data-factor': factor }));
  const red = channel('1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'), green = channel('0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'), blue = channel('0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0');
  red.setAttribute('in', 'd0'); red.setAttribute('result', 'r');
  green.setAttribute('in', 'd1'); green.setAttribute('result', 'g');
  blue.setAttribute('in', 'd2'); blue.setAttribute('result', 'b');
  filter.append(map, ...displacements, red, green, blue,
    svgElement('feBlend', { in: 'r', in2: 'g', mode: 'screen', result: 'rg' }),
    svgElement('feBlend', { in: 'rg', in2: 'b', mode: 'screen', result: 'glass' }),
    svgElement('feColorMatrix', { in: 'glass', type: 'saturate', values: saturation, result: 'vivid' }),
    light,
    svgElement('feBlend', { in: 'light', in2: 'vivid', mode: 'screen' }));
  glassFilters.append(filter);
  if (!named) element.classList.add('liquid');
  if (!named && refract) element.style.setProperty('--glass-filter', `url(#${id})`);
  if (!refract) element.classList.add('lite');
  let drawn = '';
  const draw = () => {
    const width = Math.round(element.offsetWidth);
    const height = Math.round(element.offsetHeight);
    const radius = Math.min(parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0, width / 2, height / 2);
    // Hidden elements have no size; they are drawn when they first appear.
    if (!width || !height || drawn === `${width}x${height}x${radius}`) return;
    drawn = `${width}x${height}x${radius}`;
    const bevelPx = Math.max(4, Math.min(width, height) * bevel);
    const optics = bevelProfile(bevelPx, bevelPx * thickness);
    // Maps are drawn at the device pixel ratio (capped at 2): at CSS-pixel or half resolution feImage stretches
    // them up and the rounded rim of the highlight and refraction shows as steps and bumps.
    const k = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const w = Math.ceil(width * k), h = Math.ceil(height * k), r = radius * k, b = bevelPx * k;
    const sdf = (x, y) => {
      const qx = Math.abs(x - w / 2) - (w / 2 - r), qy = Math.abs(y - h / 2) - (h / 2 - r);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    };
    const mapCanvas = document.createElement('canvas'), lightCanvas = document.createElement('canvas');
    mapCanvas.width = lightCanvas.width = w; mapCanvas.height = lightCanvas.height = h;
    const field = mapCanvas.getContext('2d').createImageData(w, h);
    const glow = lightCanvas.getContext('2d').createImageData(w, h);
    const lx = -Math.SQRT1_2, ly = -Math.SQRT1_2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const depth = -sdf(x + .5, y + .5);
      let dx = 0, dy = 0, shine = 0;
      // Refraction and highlight fade out over the outermost couple of device pixels. The backdrop-filter is
      // clipped to the rounded outline without anti-aliasing; with the backdrop undistorted and unlit right at
      // the outline, both sides of that clip match and its steps do not show.
      if (depth > -.5 && depth < b) {
        const coverage = Math.min(1, (depth + .5) / 2.5);
        const nx = sdf(x + 1.5, y + .5) - sdf(x - .5, y + .5), ny = sdf(x + .5, y + 1.5) - sdf(x + .5, y - .5);
        const length = Math.hypot(nx, ny) || 1;
        // The bevel profile is interpolated between samples, so neighbouring rings do not jump in steps.
        const position = Math.max(0, depth) / b * (optics.shifts.length - 1);
        const low = Math.floor(position), high = Math.min(optics.shifts.length - 1, low + 1), t = position - low;
        const amount = (optics.shifts[low] * (1 - t) + optics.shifts[high] * t) / optics.max;
        const slope = optics.slopes[low] * (1 - t) + optics.slopes[high] * t;
        dx = -nx / length * amount * coverage; dy = -ny / length * amount * coverage;
        const facing = (nx * lx + ny * ly) / length;
        shine = coverage * slope ** 3 * (Math.max(0, facing) ** 2 + .45 * Math.max(0, -facing) ** 2);
      }
      field.data[i] = 128 + dx * 127; field.data[i + 1] = 128 + dy * 127; field.data[i + 2] = 128; field.data[i + 3] = 255;
      glow.data[i] = glow.data[i + 1] = glow.data[i + 2] = 255; glow.data[i + 3] = Math.min(255, shine * specular * 255);
    }
    lightCanvas.getContext('2d').putImageData(glow, 0, 0);
    if (!refract) { element.style.setProperty('--glass-light', `url(${lightCanvas.toDataURL()})`); return; }
    mapCanvas.getContext('2d').putImageData(field, 0, 0);
    const box = { x: 0, y: 0, width, height };
    for (const target of [filter, map, light]) for (const [key, value] of Object.entries(box)) target.setAttribute(key, value);
    map.setAttribute('href', mapCanvas.toDataURL());
    light.setAttribute('href', lightCanvas.toDataURL());
    for (const displacement of displacements) displacement.setAttribute('scale', optics.max * 2 * displacement.dataset.factor);
    // Chromium keeps the backdrop it filtered at first paint and ignores later changes to the referenced SVG
    // filter (an element that starts hidden would stay unrefracted), so re-apply the property.
    element.style.backdropFilter = 'none';
    void element.offsetWidth;
    element.style.backdropFilter = '';
  };
  draw();
  new ResizeObserver(draw).observe(element);
}
// Buttons are small lenses whose bevel reaches most of the way in.
for (const button of document.querySelectorAll('#controls button, .round-action')) liquidGlass(button, { bevel: .42, thickness: 1.2, specular: .9, refract: false });
// The search field and its button are glass over the ambient background as well.
for (const element of document.querySelectorAll('#search-form button')) liquidGlass(element, { bevel: .4, thickness: 1.1, specular: .8, refract: false });
// Tab bars are glass capsules over the ambient background.
for (const bar of document.querySelectorAll('#folder-row')) liquidGlass(bar, { bevel: .32, thickness: 1, specular: .8, refract: false });
// The exit alert is a glass panel over the blurred page.
liquidGlass(document.querySelector('#exit-dialog'), { bevel: .12, thickness: 1.3, specular: .9 });

// Ambient background, as on Apple TV's inner pages: instead of flat black, the page glows with a heavily
// blurred, darkened copy of the focused video's cover, cross-fading as focus moves (推荐 has its own hero).
// (State lives on the function: showPage can run before this part of the script has been evaluated.)
// The glow is blurred once into a tiny canvas that the page stretches: a live 70px CSS blur over the whole
// screen cost the TV about a third of its frame rate and stalled each cross-fade.
function setAmbient(cover) {
  const state = setAmbient.state ||= { cover: '', timer: 0, layers: Array.from(document.querySelectorAll('#ambient canvas')) };
  clearTimeout(state.timer);
  // A short delay keeps fast scrolling through a row from flashing every cover.
  state.timer = setTimeout(() => {
    if (cover === state.cover) return;
    state.cover = cover;
    const current = state.layers.find(layer => layer.classList.contains('current'));
    const next = state.layers.find(layer => layer !== current);
    if (!cover) { current?.classList.remove('current'); return; }
    const image = new Image();
    image.onload = () => {
      if (state.cover !== cover) return;
      const context = next.getContext('2d');
      // Drawn a few pixels past the edges, so the blur does not fade the rim towards transparent.
      const scale = Math.max((next.width + 8) / image.naturalWidth, (next.height + 8) / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      context.clearRect(0, 0, next.width, next.height);
      context.filter = 'blur(2px) saturate(1.6) brightness(.5)';
      context.drawImage(image, (next.width - width) / 2, (next.height - height) / 2, width, height);
      next.classList.add('current');
      current?.classList.remove('current');
    };
    image.referrerPolicy = 'no-referrer';
    image.src = cover;
  }, 220);
}
document.querySelector('#pages').addEventListener('focusin', event => {
  if (activePage === 'browse') return;
  const cover = event.target.closest?.('.video-card')?.querySelector('img[src]')?.src;
  if (cover) setAmbient(cover);
});

// Scrubber, as on Apple TV: a playhead on the bar and, whenever playback jumps (±10 s, resume, part change),
// a thumbnail of the target frame with its time above the playhead. Frames come from Bilibili's seek preview
// sprite sheets (columns × rows tiles per sheet, one time per tile).
const playhead = document.querySelector('#playhead');
const scrubPreview = document.querySelector('#scrub-preview');
const scrubThumb = document.querySelector('#scrub-thumb');
const scrubImage = scrubThumb.querySelector('img');
scrubImage.referrerPolicy = 'no-referrer';
let videoshot = { images: [] };
let videoshotGeneration = 0;
let scrubTimer;
function loadVideoshot(session) {
  const generation = ++videoshotGeneration;
  videoshot = { images: [] };
  scrubPreview.hidden = true;
  serviceRequest(`/videoshot?bvid=${encodeURIComponent(session.bvid)}&page=${session.page || 1}`).then(data => {
    if (generation === videoshotGeneration) videoshot = data;
  }).catch(() => { /* the preview then shows the time only */ });
}
function placeOnScrubber(element, time) {
  const total = video.duration;
  const fraction = Number.isFinite(total) && total > 0 ? Math.min(1, Math.max(0, time / total)) : 0;
  element.style.left = `${fraction * 100}%`;
  return fraction;
}
function showScrubPreview(time) {
  placeOnScrubber(playhead, time);
  const fraction = placeOnScrubber(scrubPreview, time);
  document.querySelector('#scrub-time').textContent = clock(time);
  const { images, columns, rows, times } = videoshot;
  scrubThumb.hidden = !images.length;
  if (images.length) {
    // Last tile at or before the target time.
    let low = 0, high = times.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (times[mid] <= time) low = mid; else high = mid - 1; }
    const perSheet = columns * rows;
    const sheet = Math.min(images.length - 1, Math.floor(low / perSheet));
    const cell = low % perSheet;
    if (scrubImage.getAttribute('src') !== images[sheet]) scrubImage.src = images[sheet];
    scrubImage.style.width = `${columns * 100}%`;
    scrubImage.style.height = `${rows * 100}%`;
    scrubImage.style.left = `${-(cell % columns) * 100}%`;
    scrubImage.style.top = `${-Math.floor(cell / columns) * 100}%`;
  }
  scrubPreview.hidden = false;
  // Keep the bubble over the bar at both ends.
  const bar = scrubPreview.parentElement.clientWidth;
  const half = scrubPreview.offsetWidth / 2;
  scrubPreview.style.left = `${Math.min(bar - half, Math.max(half, fraction * bar))}px`;
  clearTimeout(scrubTimer);
  if (!scrubDrag) scrubTimer = setTimeout(() => { scrubPreview.hidden = true; }, 1800);
}
const scrubber = document.querySelector('.scrubber');
const scrubProgress = document.querySelector('#progress');
function previewScrub(event) {
  const bounds = scrubProgress.getBoundingClientRect();
  scrubDrag.time = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) * video.duration;
  scrubProgress.max = video.duration;
  scrubProgress.value = scrubDrag.time;
  showScrubPreview(scrubDrag.time);
}
scrubber.addEventListener('pointerdown', event => {
  if (event.button !== 0 || scrubDrag || video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) return;
  event.preventDefault();
  scrubDrag = { pointerId: event.pointerId, time: video.currentTime };
  scrubber.setPointerCapture(event.pointerId);
  showControls();
  previewScrub(event);
});
scrubber.addEventListener('pointermove', event => {
  if (scrubDrag?.pointerId === event.pointerId) previewScrub(event);
});
scrubber.addEventListener('pointerup', event => {
  if (scrubDrag?.pointerId !== event.pointerId) return;
  previewScrub(event);
  const time = scrubDrag.time;
  scrubDrag = null;
  scrubber.releasePointerCapture(event.pointerId);
  video.currentTime = time;
  showScrubPreview(time);
  showControls();
});
scrubber.addEventListener('lostpointercapture', () => {
  if (!scrubDrag) return;
  scrubDrag = null;
  scrubProgress.value = video.currentTime;
  placeOnScrubber(playhead, video.currentTime);
  scrubPreview.hidden = true;
  showControls();
});
video.addEventListener('seeking', () => { if (!player.hidden) showScrubPreview(video.currentTime); });

// Collapsed-sidebar pill: the current page's icon and name (queried here, as showPage can run early).
function updateNavPill() {
  const item = document.querySelector(`.nav-item[data-page="${activePage}"]`);
  const pill = document.querySelector('#nav-pill');
  if (!item || !pill) return;
  pill.querySelector('.pill-icon').replaceChildren(...[item.querySelector('svg')].filter(Boolean).map(icon => icon.cloneNode(true)));
  pill.querySelector('.pill-name').textContent = item.textContent.trim();
}
updateNavPill();
liquidGlass(document.querySelector('#nav-pill'), { bevel: .45, thickness: 1, specular: .8, refract: false });

// Apple TV search: an on-screen keyboard on the left (pinyin/letters and digits, space, delete, clear) and,
// on the right, suggestions and results that follow every key press. Pinyin typed here ("sheying") comes back
// from Bilibili's suggestions as Chinese terms ("摄影"), so Chinese search needs no system input method; the
// query line above still opens the system keyboard on OK.
const searchKeys = document.querySelector('#search-keys');
const keyGrid = searchKeys.querySelector('.key-grid');
const searchSuggest = document.querySelector('#search-suggest');
const keySets = { letters: 'abcdefghijklmnopqrstuvwxyz'.split(''), digits: '1234567890'.split('') };
let lastKey = null;
let suggestTimer, liveTimer, suggestGeneration = 0;
let upperCase = false;
let keyMode = 'letters';
function showKeys(mode) {
  keyMode = mode;
  keyGrid.replaceChildren(...keySets[mode].map(base => {
    // Aa switches letters to capitals (BV numbers are case-sensitive).
    const character = upperCase ? base.toUpperCase() : base;
    const key = document.createElement('button');
    key.type = 'button'; key.className = 'key'; key.dataset.char = character; key.textContent = character;
    return key;
  }));
  for (const button of searchKeys.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
}
showKeys('letters');
function keyboardTarget() { return lastKey?.isConnected ? lastKey : keyGrid.firstElementChild; }
function typeInto(change) {
  searchInput.value = change(searchInput.value).slice(0, 40);
  searchInputChanged();
}
function searchInputChanged(live = true) {
  clearTimeout(suggestTimer); clearTimeout(liveTimer);
  suggestGeneration++;
  resetSearchRequest();
  searchMore.hidden = true;
  searchError.hidden = true;
  searchStatus.textContent = '';
  const query = searchInput.value.trim();
  if (!query) {
    searchSuggest.hidden = true; searchSuggest.replaceChildren();
    searchResults.hidden = true;
    trendingSection.hidden = !trendingList.children.length;
    return;
  }
  if (!live) return;
  suggestTimer = setTimeout(() => loadSuggestions(query), 250);
  // Results follow the typing after a pause, without taking focus from the keyboard.
  liveTimer = setTimeout(() => submitSearch(true), 900);
}
searchInput.addEventListener('input', () => searchInputChanged(false));
// A typed BV number opens that video directly (the settings page no longer has a BV field).
const bvPattern = /^BV[0-9A-Za-z]{10}$/;
function typedBv(query) { const text = query.trim(); return /^bv[0-9a-z]{10}$/i.test(text) ? `BV${text.slice(2)}` : ''; }
function openTypedBv(bvid) { openDetail({ bvid, title: bvid, owner: '', duration: 0, cover: '' }, document.activeElement); }
async function loadSuggestions(query) {
  const generation = ++suggestGeneration;
  const data = await serviceRequest(`/suggest?term=${encodeURIComponent(query)}`).catch(() => ({ terms: [] }));
  if (generation !== suggestGeneration || searchInput.value.trim() !== query) return;
  const focused = searchSuggest.contains(document.activeElement);
  const bvid = typedBv(query);
  const bvPill = [];
  if (bvid && bvPattern.test(bvid)) {
    const pill = document.createElement('button');
    pill.type = 'button'; pill.className = 'suggestion bv'; pill.textContent = `打开视频 ${bvid}`;
    pill.addEventListener('click', () => { searchInput.value = bvid; submitSearch(); });
    bvPill.push(pill);
  }
  searchSuggest.replaceChildren(...bvPill, ...data.terms.map(term => {
    const pill = document.createElement('button');
    pill.type = 'button'; pill.className = 'suggestion'; pill.textContent = term;
    pill.addEventListener('click', () => {
      clearTimeout(liveTimer);
      searchInput.value = term;
      searchForm.requestSubmit();
    });
    return pill;
  }));
  searchSuggest.hidden = !searchSuggest.children.length;
  if (focused) (searchSuggest.firstElementChild || keyboardTarget()).focus({ preventScroll: true });
}
searchKeys.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.mode) { showKeys(button.dataset.mode); return; }
  if (button.dataset.action === 'case') {
    const index = Array.from(keyGrid.children).indexOf(lastKey);
    upperCase = !upperCase;
    button.setAttribute('aria-pressed', String(upperCase));
    showKeys(keyMode);
    if (index >= 0) lastKey = keyGrid.children[index];
    return;
  }
  if (button.dataset.char) typeInto(value => value + button.dataset.char);
  if (button.dataset.action === 'space') typeInto(value => value + ' ');
  if (button.dataset.action === 'delete') typeInto(value => value.slice(0, -1));
  if (button.dataset.action === 'clear') typeInto(() => '');
});
searchKeys.addEventListener('focusin', event => { if (event.target.closest('.key-grid')) lastKey = event.target; });
// Arrow keys move by position: rows are the mode switch, the key rows and the action row.
function nearestIn(buttons, from) {
  const x = from.getBoundingClientRect().left + from.offsetWidth / 2;
  return buttons.reduce((best, button) => {
    const distance = Math.abs(button.getBoundingClientRect().left + button.offsetWidth / 2 - x);
    return distance < best.distance ? { button, distance } : best;
  }, { button: buttons[0], distance: Infinity }).button;
}
// Rows come from the keyboard's structure, not from screen positions (the focused key is scaled up).
function keyRows() {
  const keys = Array.from(keyGrid.children);
  const rows = [Array.from(searchKeys.querySelectorAll('.key-modes button'))];
  for (let index = 0; index < keys.length; index += 6) rows.push(keys.slice(index, index + 6));
  rows.push(Array.from(searchKeys.querySelectorAll('.key-actions button')));
  return rows;
}
function rightOfKeyboard() {
  if (!searchSuggest.hidden && searchSuggest.firstElementChild) return searchSuggest.firstElementChild;
  if (!searchResults.hidden && searchGrid.firstElementChild) return searchGrid.firstElementChild;
  if (!trendingSection.hidden) return trendingList.querySelector('button') || searchPopular.firstElementChild;
  return null;
}
searchKeys.addEventListener('keydown', event => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const rows = keyRows();
  const rowIndex = rows.findIndex(row => row.includes(document.activeElement));
  if (rowIndex < 0) return;
  const row = rows[rowIndex];
  const index = row.indexOf(document.activeElement);
  let target;
  if (event.key === 'ArrowLeft') target = index > 0 ? row[index - 1] : document.activeElement;
  if (event.key === 'ArrowRight') target = index < row.length - 1 ? row[index + 1] : rightOfKeyboard();
  if (event.key === 'ArrowUp') target = rowIndex > 0 ? nearestIn(rows[rowIndex - 1], document.activeElement) : searchField;
  if (event.key === 'ArrowDown') target = rowIndex < rows.length - 1 ? nearestIn(rows[rowIndex + 1], document.activeElement) : document.activeElement;
  event.preventDefault();
  event.stopPropagation();
  if (target) target.focus({ preventScroll: true });
});
searchSuggest.addEventListener('keydown', event => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const pills = Array.from(searchSuggest.children);
  const index = pills.indexOf(document.activeElement);
  let target;
  if (event.key === 'ArrowLeft') target = index > 0 ? pills[index - 1] : keyboardTarget();
  if (event.key === 'ArrowRight') target = pills[Math.min(pills.length - 1, index + 1)];
  if (event.key === 'ArrowUp') target = searchField;
  if (event.key === 'ArrowDown') target = (!searchResults.hidden && searchGrid.firstElementChild) || (!trendingSection.hidden && trendingList.querySelector('button')) || document.activeElement;
  event.preventDefault();
  event.stopPropagation();
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});

document.querySelector('#page-search').addEventListener('focusin', event => {
  if (searchForm.contains(event.target) || searchKeys.contains(event.target) || searchSuggest.contains(event.target)) window.scrollTo(0, 0);
});

// Settings: the large icon on the left follows the focused group (the heading above the row) — a person for
// the account rows, the gear otherwise, as the Apple TV app shows it.
const settingsLayout = document.querySelector('.settings-layout');
function settingsGroup(element) {
  let item = element.closest('.settings-list > *');
  while (item && !item.matches('h2.group-title')) item = item.previousElementSibling;
  return item ? item.textContent.trim() : '';
}
document.querySelector('#page-settings').addEventListener('focusin', event => { settingsLayout.dataset.group = settingsGroup(event.target); });

// Settings rows that step through their values with OK or Right (as tvOS option rows), saved per device.
const settingOptions = {
  autoplay: { values: ['on', 'off'], labels: ['开', '关'] },
  subtitles: { values: ['remember', 'auto', 'off'], labels: ['记住上次选择', '自动开启', '关闭'] },
  danmaku: { values: ['on', 'off'], labels: ['开', '关'] },
  'dm-opacity': { values: ['100', '75', '50', '25'], labels: ['100%', '75%', '50%', '25%'] },
  'dm-size': { values: ['medium', 'large', 'small'], labels: ['标准', '大', '小'] },
  'dm-speed': { values: ['normal', 'fast', 'slow'], labels: ['标准', '快', '慢'] },
  'dm-area': { values: ['two-thirds', 'full', 'half', 'quarter'], labels: ['2/3 屏', '全屏', '半屏', '1/4 屏'] },
};
function settingValue(name) {
  // 显示弹幕 shares the player's toggle, which stores 'off' only.
  if (name === 'danmaku') return localStorage.getItem('danmaku') === 'off' ? 'off' : 'on';
  const stored = localStorage.getItem(name);
  return settingOptions[name].values.includes(stored) ? stored : settingOptions[name].values[0];
}
function showSettingRows() {
  for (const row of document.querySelectorAll('.option-row')) {
    const { values, labels } = settingOptions[row.dataset.setting];
    row.querySelector('.value').textContent = labels[values.indexOf(settingValue(row.dataset.setting))];
  }
}
for (const row of document.querySelectorAll('.option-row')) {
  const step = () => {
    const name = row.dataset.setting;
    const { values } = settingOptions[name];
    const next = values[(values.indexOf(settingValue(name)) + 1) % values.length];
    if (name === 'danmaku') { if (next === 'off') localStorage.setItem('danmaku', 'off'); else localStorage.removeItem('danmaku'); }
    else localStorage.setItem(name, next);
    showSettingRows();
    applyDanmakuSettings();
  };
  row.addEventListener('click', step);
  row.addEventListener('keydown', event => { if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); step(); } });
}
showSettingRows();
// Danmaku look and placement from the settings: opacity, size, scroll time and the share of the screen used.
function applyDanmakuSettings() {
  const layer = document.querySelector('#danmaku-layer');
  layer.style.setProperty('--dm-opacity', Number(settingValue('dm-opacity')) / 100);
  layer.style.setProperty('--dm-size', { small: '1.5vw', medium: '1.9vw', large: '2.4vw' }[settingValue('dm-size')]);
  layer.style.setProperty('--dm-duration', `${{ slow: 12, normal: 9, fast: 6.5 }[settingValue('dm-speed')]}s`);
  layer.style.height = `calc(${{ quarter: '25vh', half: '50vh', 'two-thirds': '66vh', full: '100vh' }[settingValue('dm-area')]} - var(--dm-top))`;
  danmakuToggle.textContent = danmakuOn() ? '弹幕 开' : '弹幕 关';
}
applyDanmakuSettings();
// 自动连播: when the next part or video is offered at the end, it starts after a short countdown unless the
// viewer moves first (any key cancels; OK on the button still plays at once).
let autoplayTimer;
function startAutoplay() {
  clearInterval(autoplayTimer);
  if (settingValue('autoplay') !== 'on') return;
  const label = playNext.textContent;
  let seconds = 5;
  playNext.textContent = `${seconds} 秒后 · ${label}`;
  playNext.focus({ preventScroll: true });
  autoplayTimer = setInterval(() => {
    if (playNext.hidden || player.hidden) { clearInterval(autoplayTimer); playNext.textContent = label; return; }
    seconds -= 1;
    if (seconds > 0) { playNext.textContent = `${seconds} 秒后 · ${label}`; return; }
    clearInterval(autoplayTimer);
    playNext.textContent = label;
    playNext.click();
  }, 1000);
  const cancel = event => {
    if (event.key === 'Enter' && document.activeElement === playNext) return;
    clearInterval(autoplayTimer);
    playNext.textContent = label;
    document.removeEventListener('keydown', cancel, true);
  };
  document.addEventListener('keydown', cancel, true);
}

// Once a page has scrolled, a short dark fade sits under the top-left page pill so rows passing beneath it
// do not run into its label.
window.addEventListener('scroll', () => document.querySelector('#home').classList.toggle('scrolled', window.scrollY > 8), { passive: true });

// LG Magic Remote: the wheel arrives as wheel events, not keys, and every page here moves by focus. Turn each
// notch into Up/Down on the focused element so it steps through rows, lists and menus like the arrow keys;
// throttled so one flick doesn't skip several rows.
let wheelAt = 0;
document.addEventListener('wheel', event => {
  event.preventDefault();
  if (!event.deltaY || event.timeStamp - wheelAt < 180) return;
  wheelAt = event.timeStamp;
  const down = event.deltaY > 0;
  (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', {
    key: down ? 'ArrowDown' : 'ArrowUp', code: down ? 'ArrowDown' : 'ArrowUp', keyCode: down ? 40 : 38, bubbles: true, cancelable: true,
  }));
}, { passive: false });
