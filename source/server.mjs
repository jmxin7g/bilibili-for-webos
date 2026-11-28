import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { biliData, biliRequest, biliText, readCookieJar } from './bilibili.mjs';
import { httpsResponse } from './https-response.mjs';
import { proxyMediaRange } from './media-proxy.mjs';
import { createMediaRoute } from './media-routing.mjs';
import { signWbi } from './wbi.mjs';
import { createPlaybackMappings } from './playback-mappings.mjs';
import { createVideoInfoReader } from './video-info.mjs';
import { account, accounts, switchAccount, createLogin, pollLogin, logout, cancelLogin, cookieFile } from './auth.mjs';

export const port = Number(process.env.SERVICE_PORT || 8769);
const streams = createPlaybackMappings({ renewOnAccess: true });
const manifests = createPlaybackMappings();
// LAN_HOST (this Mac's LAN address) lets an app installed on a real TV reach the service; unset, it stays loopback-only.
// The TV package embeds the token, so in LAN mode it is kept in .local/ and survives restarts.
const television = process.env.TV_SERVICE === '1';
const networkFetch = television ? httpsResponse : fetch;
const lanHost = television ? undefined : process.env.LAN_HOST;
const hosts = [`127.0.0.1:${port}`, ...(lanHost ? [`${lanHost}:${port}`] : [])];
const lanTokenFile = new URL('./.local/lan-token', import.meta.url);
const serviceToken = lanHost ? (await readFile(lanTokenFile, 'utf8').catch(() => '')).trim() || randomUUID() : randomUUID();
if (!television) {
await mkdir(new URL('./app/vendor/', import.meta.url), { recursive: true });
for (const name of ['shaka-player.compiled.js']) {
  await copyFile(new URL(`./node_modules/shaka-player/dist/${name}`, import.meta.url), new URL(`./app/vendor/${name}`, import.meta.url));
}
await copyFile(new URL('./node_modules/shaka-player/LICENSE', import.meta.url), new URL('./app/vendor/SHAKA-LICENSE', import.meta.url));
}
const headers = {
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://www.bilibili.com/',
};
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/auth.js', ['auth.js', 'text/javascript; charset=utf-8']],
  ['/search-requests.js', ['search-requests.js', 'text/javascript; charset=utf-8']],
  ['/service-token.js', ['service-token.js', 'text/javascript; charset=utf-8']],
  ['/vendor/shaka-player.compiled.js', ['vendor/shaka-player.compiled.js', 'text/javascript; charset=utf-8']],
]);

// bili_jct from the saved Netscape cookie file: the CSRF value Bilibili requires on account writes.
async function csrfToken() {
  let text;
  try { text = await readFile(cookieFile, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; text = ''; }
  const value = text.split('\n').map(line => line.split('\t')).find(fields => fields[5] === 'bili_jct')?.[6]?.trim();
  if (!value || !/^[0-9a-f]{32}$/.test(value)) throw new Error('Bilibili 接口错误 -101');
  return value;
}
async function api(path, cookie, credentials = { cookieFile }) {
  if (path.includes('/wbi/')) {
    const nav = await biliRequest('api.bilibili.com', '/x/web-interface/nav', credentials);
    if (![0, -101].includes(nav.code)) throw new Error(`签名信息请求失败（${nav.code}）`);
    const keys = [nav.data.wbi_img.img_url, nav.data.wbi_img.sub_url].map(value => {
      const key = new URL(value).pathname.split('/').at(-1).split('.')[0];
      if (!/^[0-9a-f]{32}$/.test(key)) throw new Error('签名信息格式异常');
      return key;
    });
    const url = new URL(path, 'https://api.bilibili.com');
    path = `${url.pathname}?${signWbi(url.searchParams, ...keys)}`;
  }
  return biliData('api.bilibili.com', path, { ...credentials, cookie });
}
const videoInfo = createVideoInfoReader(
  () => readCookieJar(cookieFile),
  (bvid, cookieJar) => api(`/x/web-interface/wbi/view?bvid=${bvid}`, undefined, { cookieJar }),
);

// Search answers HTTP 412 without an anonymous device cookie; fetch one from the public endpoint and reuse it.
let deviceCookie;
async function searchCookie() {
  deviceCookie ||= biliData('api.bilibili.com', '/x/frontend/finger/spi').then(data => `buvid3=${data.b_3}`, error => { deviceCookie = undefined; throw error; });
  return deviceCookie;
}

// Only HTTPS images from Bilibili's image hosts (hdslb.com, biliimg.com) reach the app; the API often returns
// http:// or protocol-relative URLs.
const imageHost = hostname => hostname.endsWith('.hdslb.com') || hostname.endsWith('.biliimg.com');
function coverUrl(value) {
  if (!value) return '';
  let cover;
  try { cover = new URL(String(value).startsWith('//') ? `https:${value}` : value); } catch { return ''; }
  if (!['http:', 'https:'].includes(cover.protocol) || !imageHost(cover.hostname)) return '';
  cover.protocol = 'https:';
  return cover.href;
}

// "1:02:03" / "12:34" -> seconds (the dynamic feed only gives text durations).
function durationSeconds(text) {
  return String(text || '').split(':').reduce((total, part) => total * 60 + Number(part || 0), 0);
}

async function seasonEpisodes(info) {
  let link;
  try { link = new URL(info.redirect_url, 'https://www.bilibili.com'); } catch { return []; }
  const match = /^\/bangumi\/play\/(ep|ss)([0-9]+)\/?$/.exec(link.pathname);
  if (link.hostname !== 'www.bilibili.com' || !match) return [];
  const id = match[1] === 'ep' ? 'ep_id' : 'season_id';
  return readSeason(id, match[2]);
}

async function readSeason(id, value) {
  const body = await biliRequest('api.bilibili.com', `/pgc/view/web/season?${id}=${value}`, { cookieFile });
  if (body.code !== 0) throw new Error(`Bilibili 接口错误 ${body.code}`);
  return (body.result?.episodes || []).map((episode, index) => ({
    bvid: episode.bvid, episodeId: episode.id, title: [episode.title, episode.long_title].filter(Boolean).join(' · ') || `第 ${index + 1} 集`,
  })).filter(episode => /^BV[0-9A-Za-z]{10}$/.test(episode.bvid || ''));
}

function supportedMediaUrl(value) {
  if (typeof value !== 'string') return null;
  let url;
  try { url = new URL(value.startsWith('//') ? `https:${value}` : value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (url.hostname.endsWith('.bilivideo.com') || url.hostname.endsWith('.bilivideo.cn') ||
    ['upos-hz-mirrorakam.akamaized.net', 'upos-sz-mirrorakam.akamaized.net'].includes(url.hostname)) return url.href;
  return null;
}

function playableDashTrack(stream) {
  const candidates = [stream.baseUrl || stream.base_url, ...(stream.backupUrl || stream.backup_url || [])];
  const [baseUrl, ...backupUrl] = [...new Set(candidates.map(supportedMediaUrl).filter(Boolean))];
  return baseUrl ? { ...stream, baseUrl, backupUrl } : null;
}

function registerStream(url, backups = [], videoEntry) {
  const id = randomUUID();
  streams.set(id, { url, backups, route: videoEntry ? createMediaRoute(videoEntry) : null });
  return `/media/${id}`;
}

function representation(stream, video = false) {
  const segment = stream.SegmentBase || stream.segment_base;
  return `<Representation id="${stream.id}-${stream.codecs}" bandwidth="${stream.bandwidth}" codecs="${stream.codecs}" mimeType="${stream.mimeType || stream.mime_type}"><BaseURL>${registerStream(stream.baseUrl || stream.base_url, stream.backupUrl || stream.backup_url || [], video ? stream : null).replaceAll('&', '&amp;')}</BaseURL><SegmentBase indexRange="${segment.indexRange || segment.index_range}"><Initialization range="${segment.Initialization || segment.initialization}"/></SegmentBase></Representation>`;
}

export const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const origin = request.headers.origin;
  if (origin && !['null', ...hosts.map(host => `http://${host}`)].includes(origin)) { response.writeHead(403).end(); return; }
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Headers', 'X-Prototype-Token, X-Playback-Buffer');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, X-Media-Source');
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (!hosts.includes(request.headers.host)) { response.writeHead(403).end(); return; }
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  const privateRoute = url.pathname === '/popular' || url.pathname === '/recommend' || url.pathname === '/search' || url.pathname === '/trending' || url.pathname === '/detail' || url.pathname === '/resolve' || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/me/') || url.pathname === '/subtitles' || url.pathname === '/subtitle' || url.pathname === '/region' || url.pathname === '/up' || url.pathname === '/danmaku' || url.pathname === '/videoshot' || url.pathname === '/suggest';
  if (privateRoute && request.headers['x-prototype-token'] !== serviceToken) { response.writeHead(403).end(); return; }
  const postRoute = ['/auth/qr', '/auth/poll', '/auth/cancel', '/auth/logout', '/auth/switch', '/me/later/add', '/me/later/remove'].includes(url.pathname);
  if (request.method !== (postRoute ? 'POST' : 'GET')) { response.writeHead(405).end(); return; }
  if (url.pathname === '/service-token.js' && request.headers['sec-fetch-site'] !== 'same-origin') { response.writeHead(403).end(); return; }
  try {
    if (url.pathname.startsWith('/auth/')) {
      let result;
      if (url.pathname === '/auth/status') result = await account();
      else if (url.pathname === '/auth/qr') result = await createLogin();
      else if (url.pathname === '/auth/poll') result = await pollLogin(url.searchParams.get('id'));
      else if (url.pathname === '/auth/logout') { result = await logout(); streams.clear(); manifests.clear(); }
      else if (url.pathname === '/auth/cancel') result = cancelLogin();
      else if (url.pathname === '/auth/accounts') result = await accounts();
      else if (url.pathname === '/auth/switch') { result = await switchAccount(url.searchParams.get('mid')); streams.clear(); manifests.clear(); }
      else { response.writeHead(404).end(); return; }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(result));
      return;
    }
    if (url.pathname === '/recommend') {
      // Home feed: personalised when the saved login cookie is present, general otherwise. Only regular videos are kept.
      const round = Number(url.searchParams.get('round') || 1);
      if (!Number.isInteger(round) || round < 1 || round > 50) { response.writeHead(400).end(JSON.stringify({ error: '批次必须为 1 至 50' })); return; }
      const data = await api(`/x/web-interface/wbi/index/top/feed/rcmd?ps=12&fresh_idx=${round}`);
      const items = (data.item || []).filter(item => item.goto === 'av' && item.bvid).flatMap(item => {
        const cover = new URL(item.pic.startsWith('//') ? `https:${item.pic}` : item.pic);
        if (!['http:', 'https:'].includes(cover.protocol) || !imageHost(cover.hostname)) return [];
        cover.protocol = 'https:';
        return [{ bvid: item.bvid, title: item.title, owner: item.owner?.name || '', duration: item.duration, cover: cover.href }];
      });
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ items }));
      return;
    }
    if (url.pathname === '/popular') {
      const page = Number(url.searchParams.get('page') || 1);
      if (!Number.isInteger(page) || page < 1 || page > 100) {
        response.writeHead(400).end(JSON.stringify({ error: '页码必须为 1 至 100' }));
        return;
      }
      // Like search, the popular list now answers -352 without a buvid3 device cookie.
      const data = await api(`/x/web-interface/popular?pn=${page}&ps=12`, await searchCookie());
      const items = data.list.map(item => ({ bvid: item.bvid, title: item.title, owner: item.owner.name, duration: item.duration, cover: coverUrl(item.pic) }));
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ items, noMore: data.no_more }));
      return;
    }
    if (url.pathname.startsWith('/me/')) {
      // Library content of the logged-in account: following feed, watch later, cloud history, favourites.
      // Bilibili answers -101 when the saved login is missing or expired.
      let result;
      try {
        if (url.pathname === '/me/following') {
          const offset = url.searchParams.get('offset') || '';
          if (!/^\d*$/.test(offset)) { response.writeHead(400).end(JSON.stringify({ error: '分页参数无效' })); return; }
          const data = await api(`/x/polymer/web-dynamic/v1/feed/all?type=video&offset=${offset}`);
          result = {
            items: (data.items || []).map(item => ({ archive: item.modules?.module_dynamic?.major?.archive, author: item.modules?.module_author })).filter(({ archive }) => archive?.bvid)
              .map(({ archive, author }) => ({ bvid: archive.bvid, title: archive.title, owner: author?.name || '', duration: durationSeconds(archive.duration_text), cover: coverUrl(archive.cover) })),
            offset: data.offset || '', more: Boolean(data.has_more),
          };
        } else if (url.pathname === '/me/later') {
          const data = await api('/x/v2/history/toview');
          result = { items: (data.list || []).filter(item => item.bvid).map(item => ({ bvid: item.bvid, title: item.title, owner: item.owner?.name || '', duration: item.duration, cover: coverUrl(item.pic) })) };
        } else if (['/me/later/add', '/me/later/remove', '/me/later/state'].includes(url.pathname)) {
          // Watch later from the detail page (Apple TV's "Add to Up Next"). Writes need the account's CSRF
          // cookie; removal takes the numeric aid, looked up from the video.
          const bvid = url.searchParams.get('bvid') || '';
          if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) { response.writeHead(400).end(JSON.stringify({ error: '视频编号无效' })); return; }
          if (url.pathname === '/me/later/state') {
            const data = await api('/x/v2/history/toview');
            result = { saved: (data.list || []).some(item => item.bvid === bvid) };
          } else {
            const csrf = await csrfToken();
            if (url.pathname === '/me/later/add') await biliData('api.bilibili.com', '/x/v2/history/toview/add', { cookieFile, form: `bvid=${bvid}&csrf=${csrf}` });
            else {
              const info = await videoInfo(bvid);
              await biliData('api.bilibili.com', '/x/v2/history/toview/del', { cookieFile, form: `aid=${Number(info.aid)}&csrf=${csrf}` });
            }
            result = { saved: url.pathname === '/me/later/add' };
          }
        } else if (url.pathname === '/me/history') {
          const max = url.searchParams.get('max') || '0';
          const viewAt = url.searchParams.get('view_at') || '0';
          if (!/^\d+$/.test(max) || !/^\d+$/.test(viewAt)) { response.writeHead(400).end(JSON.stringify({ error: '分页参数无效' })); return; }
          const data = await api(`/x/web-interface/history/cursor?ps=20&type=archive&max=${max}&view_at=${viewAt}`);
          result = {
            items: (data.list || []).filter(item => item.history?.bvid).map(item => ({ bvid: item.history.bvid, title: item.title, owner: item.author_name || '', duration: item.duration, cover: coverUrl(item.cover || item.covers?.[0]), progress: item.progress })),
            cursor: { max: data.cursor?.max || 0, viewAt: data.cursor?.view_at || 0 }, more: (data.list || []).length > 0,
          };
        } else if (url.pathname === '/me/favorites') {
          const nav = await api('/x/web-interface/nav');
          const data = await api(`/x/v3/fav/folder/created/list-all?up_mid=${nav.mid}`);
          result = { folders: (data?.list || []).map(folder => ({ id: folder.id, title: folder.title, count: folder.media_count })) };
        } else if (url.pathname === '/me/favorites/items') {
          const id = url.searchParams.get('id');
          const page = Number(url.searchParams.get('page') || 1);
          if (!/^\d+$/.test(id || '') || !Number.isInteger(page) || page < 1 || page > 100) { response.writeHead(400).end(JSON.stringify({ error: '收藏夹参数无效' })); return; }
          const data = await api(`/x/v3/fav/resource/list?media_id=${id}&ps=20&pn=${page}&platform=web`);
          result = { items: (data.medias || []).filter(item => item.bvid || item.bv_id).map(item => ({ bvid: item.bvid || item.bv_id, title: item.title, owner: item.upper?.name || '', duration: item.duration, cover: coverUrl(item.cover) })), more: Boolean(data.has_more) };
        } else { response.writeHead(404).end(JSON.stringify({ error: '未找到' })); return; }
      } catch (error) {
        if (/-101/.test(error.message)) { response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: '请先在设置中扫码登录' })); return; }
        throw error;
      }
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(result));
      return;
    }
    if (url.pathname === '/suggest') {
      // Search suggestions for what has been typed so far; pinyin ("sheying") comes back as Chinese terms
      // ("摄影"), which is how the on-screen keyboard reaches Chinese without an input method.
      const term = (url.searchParams.get('term') || '').trim();
      if (!term || term.length > 40) { response.writeHead(400).end(JSON.stringify({ error: '联想参数无效' })); return; }
      const body = await biliRequest('s.search.bilibili.com', `/main/suggest?term=${encodeURIComponent(term)}&main_ver=v1`);
      const terms = [...new Set((body.result?.tag || []).map(tag => String(tag.value || '').replace(/<[^>]+>/g, '').trim()).filter(Boolean))].slice(0, 8);
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ terms }));
      return;
    }
    if (url.pathname === '/videoshot') {
      // Seek preview frames of one part: sprite sheets (columns × rows tiles) and the time of each tile, used for
      // the thumbnail above the scrubber. Only Bilibili image hosts are passed on.
      const bvid = url.searchParams.get('bvid');
      const pageNumber = Number(url.searchParams.get('page') || 1);
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || '') || !Number.isInteger(pageNumber) || pageNumber < 1) { response.writeHead(400).end(JSON.stringify({ error: '预览参数无效' })); return; }
      const info = await videoInfo(bvid);
      const part = (info.pages || []).find(item => item.page === pageNumber) || (pageNumber === 1 ? { cid: info.cid } : null);
      if (!part) { response.writeHead(400).end(JSON.stringify({ error: `该视频没有第 ${pageNumber} 集` })); return; }
      // The aid form returns the per-tile time index; the bvid form leaves it empty.
      const shot = await api(`/x/player/videoshot?aid=${Number(info.aid)}&cid=${Number(part.cid)}&index=1`);
      const images = (shot.image || []).map(coverUrl);
      const result = images.length && images.every(Boolean) && shot.index?.length
        ? { images, columns: shot.img_x_len, rows: shot.img_y_len, times: shot.index.slice(1) }
        : { images: [] };
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(result));
      return;
    }
    if (url.pathname === '/danmaku') {
      // Danmaku of one part: time, mode (1 scrolling, 4 bottom, 5 top), colour and text, in time order.
      const bvid = url.searchParams.get('bvid');
      const pageNumber = Number(url.searchParams.get('page') || 1);
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || '') || !Number.isInteger(pageNumber) || pageNumber < 1) { response.writeHead(400).end(JSON.stringify({ error: '弹幕参数无效' })); return; }
      const info = await videoInfo(bvid);
      const part = (info.pages || []).find(item => item.page === pageNumber) || (pageNumber === 1 ? { cid: info.cid } : null);
      if (!part) { response.writeHead(400).end(JSON.stringify({ error: `该视频没有第 ${pageNumber} 集` })); return; }
      const xml = await biliText('api.bilibili.com', `/x/v1/dm/list.so?oid=${part.cid}`);
      const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      const decode = text => text.replace(/&(amp|lt|gt|quot|apos|#(\d+));/g, (_, name, code) => code ? String.fromCodePoint(Number(code)) : entities[name]);
      const items = [...xml.matchAll(/<d p="([^"]+)">([^<]*)<\/d>/g)].map(([, attributes, text]) => {
        const [time, mode, , color] = attributes.split(',');
        return { t: Number(time), mode: Number(mode), color: Number(color), text: decode(text).trim() };
      }).filter(item => Number.isFinite(item.t) && [1, 4, 5].includes(item.mode) && item.text).sort((a, b) => a.t - b.t).slice(0, 6000);
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ items }));
      return;
    }
    if (url.pathname === '/region') {
      // Popular videos of one category (the main video categories only).
      const rid = Number(url.searchParams.get('rid'));
      if (![1, 3, 4, 5, 36, 119, 129, 155, 160, 181, 188, 211, 217, 223, 234].includes(rid)) { response.writeHead(400).end(JSON.stringify({ error: '不支持的分区' })); return; }
      const data = await api(`/x/web-interface/ranking/v2?rid=${rid}&type=all`);
      const items = (data.list || []).filter(item => item.bvid).map(item => ({ bvid: item.bvid, title: item.title, owner: item.owner?.name || '', duration: item.duration, cover: coverUrl(item.pic) }));
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ items }));
      return;
    }
    if (url.pathname === '/up') {
      // A UP 主's profile (first page only) and videos, newest first, 30 per page.
      const mid = url.searchParams.get('mid');
      const page = Number(url.searchParams.get('page') || 1);
      if (!/^\d{1,12}$/.test(mid || '') || !Number.isInteger(page) || page < 1 || page > 200) { response.writeHead(400).end(JSON.stringify({ error: 'UP 主参数无效' })); return; }
      const [card, videos] = await Promise.all([
        page === 1 ? api(`/x/web-interface/card?mid=${mid}`) : null,
        api(`/x/space/wbi/arc/search?mid=${mid}&ps=30&pn=${page}&order=pubdate`),
      ]);
      const list = videos.list?.vlist || [];
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        profile: card ? { name: card.card?.name || '', face: coverUrl(card.card?.face), sign: card.card?.sign || '', fans: card.card?.fans ?? null, videos: card.archive_count ?? null } : null,
        items: list.filter(item => item.bvid).map(item => ({ bvid: item.bvid, title: item.title, owner: item.author || '', duration: durationSeconds(item.length), cover: coverUrl(item.pic) })),
        more: page * 30 < (videos.page?.count || 0),
      }));
      return;
    }
    if (url.pathname === '/subtitles') {
      // Subtitle tracks of one part (AI subtitles usually need the saved login).
      const bvid = url.searchParams.get('bvid');
      const pageNumber = Number(url.searchParams.get('page') || 1);
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || '') || !Number.isInteger(pageNumber) || pageNumber < 1) { response.writeHead(400).end(JSON.stringify({ error: '字幕参数无效' })); return; }
      const info = await videoInfo(bvid);
      const part = (info.pages || []).find(item => item.page === pageNumber) || (pageNumber === 1 ? { cid: info.cid } : null);
      if (!part) { response.writeHead(400).end(JSON.stringify({ error: `该视频没有第 ${pageNumber} 集` })); return; }
      const player = await api(`/x/player/wbi/v2?bvid=${bvid}&cid=${part.cid}`);
      const tracks = (player.subtitle?.subtitles || []).map(track => {
        const address = new URL(String(track.subtitle_url).startsWith('//') ? `https:${track.subtitle_url}` : track.subtitle_url);
        address.protocol = 'https:';
        return { language: track.lan, label: track.lan_doc, url: address.hostname.endsWith('.hdslb.com') ? address.href : '' };
      }).filter(track => track.url);
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ tracks }));
      return;
    }
    if (url.pathname === '/subtitle') {
      // Subtitle body: only Bilibili's hdslb.com subtitle files, reduced to cue timing and text.
      const address = new URL(url.searchParams.get('url') || 'about:blank');
      if (address.protocol !== 'https:' || !address.hostname.endsWith('.hdslb.com')) { response.writeHead(400).end(JSON.stringify({ error: '字幕地址不受支持' })); return; }
      const upstream = await networkFetch(address, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!upstream.ok) throw new Error(`字幕下载失败 HTTP ${upstream.status}`);
      const body = await upstream.json();
      const cues = (body.body || []).map(cue => ({ from: Number(cue.from), to: Number(cue.to), text: String(cue.content) })).filter(cue => Number.isFinite(cue.from) && Number.isFinite(cue.to));
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ cues }));
      return;
    }
    if (url.pathname === '/season') {
      const ref = /^(ss|ep)([0-9]+)$/.exec(url.searchParams.get('ref') || '');
      if (!ref) { response.writeHead(400).end(JSON.stringify({ error: '剧集编号无效' })); return; }
      const episodes = await readSeason(ref[1] === 'ep' ? 'ep_id' : 'season_id', ref[2]);
      const item = ref[1] === 'ep' ? episodes.find(episode => String(episode.episodeId) === ref[2]) : episodes[0];
      if (!item) { response.writeHead(404).end(JSON.stringify({ error: '找不到这集' })); return; }
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ...item, episodes }));
      return;
    }
    if (url.pathname === '/detail') {
      // Video detail page: description and counts from the signed view endpoint, plus related videos.
      const bvid = url.searchParams.get('bvid');
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || '')) { response.writeHead(400).end(JSON.stringify({ error: '请输入有效的 BV 号' })); return; }
      const toCover = coverUrl;
      const [info, related] = await Promise.all([
        videoInfo(bvid),
        api(`/x/web-interface/archive/related?bvid=${bvid}`).catch(() => []),
      ]);
      const episodeList = await seasonEpisodes(info).then(episodes => ({ episodes }), error => {
        console.warn(`detail episodes: ${error.message}`);
        return { episodes: [], episodesUnavailable: true };
      });
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        bvid, title: info.title, owner: info.owner?.name || '', duration: info.duration, cover: toCover(info.pic),
        ...episodeList,
        pages: (info.pages || []).length > 1 ? info.pages.map(item => ({ page: item.page, part: item.part, duration: item.duration })) : [],
        category: typeof info.tname === 'string' ? info.tname : '', ownerMid: info.owner?.mid ?? null, ownerFace: info.owner?.face ? toCover(info.owner.face) : '',
        desc: typeof info.desc === 'string' ? info.desc.trim() : '', pubdate: info.pubdate, views: info.stat?.view ?? null, likes: info.stat?.like ?? null,
        // For the Apple TV-style sections below the fold: counts, original/repost, source resolution, subtitles
        // and the credited collaborators (联合投稿).
        stats: { view: info.stat?.view ?? null, danmaku: info.stat?.danmaku ?? null, reply: info.stat?.reply ?? null, favorite: info.stat?.favorite ?? null, coin: info.stat?.coin ?? null, share: info.stat?.share ?? null, like: info.stat?.like ?? null },
        original: info.copyright === 1, height: Number(info.dimension?.height) || 0, width: Number(info.dimension?.width) || 0,
        subtitles: (info.subtitle?.list || []).map(item => item.lan_doc).filter(Boolean),
        staff: (info.staff || []).slice(0, 12).map(person => ({ mid: person.mid, name: person.name, role: person.title, face: person.face ? toCover(person.face) : '' })),
        related: (Array.isArray(related) ? related : []).filter(item => item.bvid).slice(0, 12)
          .map(item => ({ bvid: item.bvid, title: item.title, owner: item.owner?.name || '', duration: item.duration, cover: toCover(item.pic) })),
      }));
      return;
    }
    if (url.pathname === '/trending') {
      // Hot search terms for the empty search page; plain text only.
      const data = await api('/x/web-interface/search/square?limit=10');
      const items = (data.trending?.list || []).filter(item => typeof item.keyword === 'string' && item.keyword.trim()).slice(0, 10)
        .map(item => ({ keyword: item.keyword.trim(), label: (typeof item.show_name === 'string' && item.show_name.trim()) || item.keyword.trim() }));
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ items }));
      return;
    }
    if (url.pathname === '/search') {
      const keyword = url.searchParams.get('keyword')?.trim();
      if (!keyword) { response.writeHead(400).end(JSON.stringify({ error: '请输入搜索关键词' })); return; }
      const page = Number(url.searchParams.get('page') || 1);
      if (!Number.isInteger(page) || page < 1 || page > 100) { response.writeHead(400).end(JSON.stringify({ error: '搜索页码必须为 1 至 100' })); return; }
      const data = await api(`/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&page=${page}&page_size=12`, await searchCookie());
      // An unusable cover (http, or another host) shows the placeholder instead of failing the whole page.
      const entities = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" };
      const plain = text => text.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, name) => entities[name]);
      const items = (data.result || []).map(item => ({ bvid: item.bvid, title: plain(item.title), owner: item.author, duration: item.duration, cover: coverUrl(item.pic) }));
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ items, noMore: page >= data.numPages || items.length === 0 || page === 100 }));
      return;
    }
    if (url.pathname === '/resolve') {
      const bvid = url.searchParams.get('bvid');
      if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) {
        response.writeHead(400).end(JSON.stringify({ error: '请输入有效的 BV 号' }));
        return;
      }
      // Video details use the WBI endpoint with the current signature keys.
      const info = await videoInfo(bvid);
      // Cover for the continue-watching list; only HTTPS hdslb.com images are passed to the app.
      // The API returns http:// cover URLs; hdslb.com also serves them over HTTPS.
      const pic = info.pic ? new URL(info.pic.startsWith('//') ? `https:${info.pic}` : info.pic) : null;
      if (pic?.protocol === 'http:') pic.protocol = 'https:';
      const cover = pic && imageHost(pic.hostname) ? pic.href : '';
      // Multi-part videos: `page` picks the part (P1 when absent).
      const pageNumber = Number(url.searchParams.get('page') || 1);
      if (!Number.isInteger(pageNumber) || pageNumber < 1) { response.writeHead(400).end(JSON.stringify({ error: '分集参数无效' })); return; }
      const part = (info.pages || []).find(item => item.page === pageNumber) || (pageNumber === 1 ? { cid: info.cid, page: 1, part: '', duration: info.duration } : null);
      if (!part) { response.writeHead(400).end(JSON.stringify({ error: `该视频没有第 ${pageNumber} 集` })); return; }
      const partInfo = { page: part.page, part: (info.pages?.length || 1) > 1 ? part.part : '', pages: info.pages?.length || 1, partDuration: part.duration };
      const requestedQuality = url.searchParams.get('quality');
      const standardCaps = { auto: Infinity, 1080: 80, 720: 64, 480: 32, 360: 16 };
      if (!Object.hasOwn(standardCaps, requestedQuality) && !/^qn:[0-9]+$/.test(requestedQuality || '')) {
        response.writeHead(400).end(JSON.stringify({ error: '画质参数无效' })); return;
      }
      const cap = standardCaps[requestedQuality] ?? Number(requestedQuality.slice(3));
      const allowLowerQuality = url.searchParams.get('fallback') === '1';
      // Request the complete per-video catalog, including HDR, Dolby Vision, 4K and 8K.
      let media = await api(`/x/player/playurl?bvid=${bvid}&cid=${part.cid}&qn=127&fnval=4048&fourk=1&platform=pc`);
      media.support_formats = media.support_formats.filter(format => ![6, 100].includes(format.quality));
      if (media.dash) {
        const video = (media.dash.video || []).filter(stream => ![6, 100].includes(stream.id));
        media.dash.video = video.map(playableDashTrack).filter(Boolean);
        media.dash.audio = (media.dash.audio || []).map(playableDashTrack).filter(Boolean);
        if (requestedQuality !== '360' && video.length && (!media.dash.video.length || !media.dash.audio.length)) {
          throw new Error('Bilibili 未返回可用的 HTTPS 音视频地址');
        }
      }
      const qualityOptions = media.support_formats.map(format => ({
        id: format.quality, label: format.new_description,
        value: ({ 16: '360', 32: '480', 64: '720', 80: '1080' })[format.quality] || `qn:${format.quality}`,
        codecs: [...new Set((media.dash?.video || []).filter(stream => stream.id === format.quality).map(stream => stream.codecs))],
      }));
      if (requestedQuality !== 'auto' && (!allowLowerQuality || [6, 100].includes(cap)) && !qualityOptions.some(option => option.id === cap)) {
        response.writeHead(400).end(JSON.stringify({ error: '该视频不提供所选画质' })); return;
      }
      if (requestedQuality !== '360') {
        const codec = url.searchParams.get('codec');
        const exact = !allowLowerQuality && requestedQuality.startsWith('qn:');
        const picture = media.dash?.video.filter(v => (exact ? v.id === cap : v.id <= cap) && (codec ? v.codecs === codec : requestedQuality === 'auto' || allowLowerQuality || exact || v.codecs.startsWith('avc1'))).sort((a, b) => b.id - a.id || Number(b.codecs.startsWith('avc1')) - Number(a.codecs.startsWith('avc1')))[0];
        const audio = media.dash?.audio.filter(a => a.codecs.startsWith('mp4a')).sort((a, b) => b.bandwidth - a.bandwidth)[0];
        if (!picture || !audio) throw new Error('当前账号或设备无法播放所选画质');
        const videoSets = new Map();
        for (const stream of requestedQuality === 'auto' ? media.dash.video : [picture]) {
          const family = stream.codecs.split('.')[0];
          if (!videoSets.has(family)) videoSets.set(family, []);
          videoSets.get(family).push(stream);
        }
        const videoManifest = [...videoSets.values()].map(streams => `<AdaptationSet contentType="video" segmentAlignment="true">${streams.map(stream => representation(stream, true)).join('')}</AdaptationSet>`).join('');
        const id = randomUUID();
        const manifest = `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" minBufferTime="PT1.5S" mediaPresentationDuration="PT${media.dash.duration}S"><Period>${videoManifest}<AdaptationSet contentType="audio" segmentAlignment="true">${representation(audio)}</AdaptationSet></Period></MPD>`;
        manifests.set(id, manifest);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ bvid, title: info.title, owner: info.owner.name, duration: info.duration, cover, ...partInfo, quality: picture.id, videoCodec: picture.codecs, format: 'dash', sourceHost: new URL(picture.baseUrl || picture.base_url).hostname, src: `http://${request.headers.host}/manifest/${id}`, qualityOptions, qualityLabel: qualityOptions.find(option => option.id === picture.id).label }));
        return;
      }
      media = await api(`/x/player/playurl?bvid=${bvid}&cid=${part.cid}&qn=16&fnval=1&platform=html5`);
      if (media.format !== 'mp4' || media.durl?.length !== 1) {
        throw new Error('此原型仅支持接口返回的单段 MP4；此视频的格式尚未支持');
      }
      const address = supportedMediaUrl(media.durl[0].url);
      if (!address) throw new Error('Bilibili 未返回可用的 HTTPS MP4 地址');
      const upstream = new URL(address);
      const token = randomUUID();
      streams.set(token, { url: upstream.href });
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        bvid, title: info.title, owner: info.owner.name, duration: info.duration, cover, ...partInfo,
        quality: media.quality, qualityOptions, qualityLabel: qualityOptions.find(option => option.id === media.quality).label, format: media.format,
        sourceHost: upstream.hostname, src: `http://${request.headers.host}/media/${token}`,
      }));
      return;
    }
    if (url.pathname.startsWith('/manifest/')) {
      const manifest = manifests.get(url.pathname.slice('/manifest/'.length));
      if (!manifest) { response.writeHead(410).end(); return; }
      response.setHeader('Content-Type', 'application/dash+xml');
      response.end(manifest);
      return;
    }
    if (url.pathname.startsWith('/media/')) {
      const stream = streams.get(url.pathname.slice('/media/'.length));
      if (!stream) {
        response.writeHead(410).end('播放地址已过期，请重新打开视频');
        return;
      }
      await proxyMediaRange(request, response, stream, headers, networkFetch);
      return;
    }
    if (files.has(url.pathname)) {
      const [file, type] = files.get(url.pathname);
      response.setHeader('Content-Type', type);
      response.end(await readFile(new URL(`./app/${file}`, import.meta.url)));
      return;
    }
    response.writeHead(404).end('未找到');
  } catch (error) {
    console.error(`${url.pathname.split('/')[1]}: ${error.message}`);
    if (response.headersSent) response.destroy(error);
    else {
      response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: error.message }));
    }
  }
});
const mappingSweep = setInterval(() => {
  streams.sweep();
  manifests.sweep();
}, 60_000).unref();
server.once('close', () => clearInterval(mappingSweep));
export const ready = new Promise((resolve, reject) => {
server.once('error', reject);
server.listen(port, lanHost ? '0.0.0.0' : '127.0.0.1', async () => {
  try {
    // Publish credentials only after binding succeeds. A failed second start must
    // not replace the credentials used by an already-running local service.
    if (lanHost) await writeFile(lanTokenFile, serviceToken, { mode: 0o600 });
    if (!television) await writeFile(new URL('./app/service-token.js', import.meta.url), `window.serviceToken=${JSON.stringify(serviceToken)};`, { mode: 0o600 });
    console.log(`播放服务：${hosts.join('、')}`);
    resolve();
  } catch (error) {
    server.close();
    reject(error);
  }
});
});
export { serviceToken };
