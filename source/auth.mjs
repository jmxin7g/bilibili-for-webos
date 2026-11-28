import { mkdir, writeFile, rename, rm, access, copyFile, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { biliData, biliRequest } from './bilibili.mjs';

const directory = process.env.SERVICE_DATA_DIR ? new URL(`file://${process.env.SERVICE_DATA_DIR}/`) : new URL('./.local/', import.meta.url);
export const cookieFile = fileURLToPath(new URL('account.cookies', directory));
await mkdir(directory, { recursive: true, mode: 0o700 });
// Multiple accounts: the active one is always `account.cookies` (used by every API call); each logged-in
// account also keeps its own copy, `accounts/<mid>.cookies`, plus `accounts/<mid>.json` with its name.
const accountsDirectory = new URL('./accounts/', directory);
await mkdir(accountsDirectory, { recursive: true, mode: 0o700 });
const storedCookies = mid => fileURLToPath(new URL(`${mid}.cookies`, accountsDirectory));
const storedProfile = mid => fileURLToPath(new URL(`${mid}.json`, accountsDirectory));
async function remember(user) {
  await copyFile(cookieFile, storedCookies(user.mid));
  await writeFile(storedProfile(user.mid), JSON.stringify({ mid: user.mid, name: user.name, vip: user.vip || '', face: user.face || '' }), { mode: 0o600 });
}
// Avatar address from the nav response, kept only when it points at Bilibili's image hosts (forced to https).
function faceUrl(value) {
  let face;
  try { face = new URL(String(value || '').startsWith('//') ? `https:${value}` : value); } catch { return ''; }
  if (!['http:', 'https:'].includes(face.protocol) || !/\.(hdslb|biliimg)\.com$/.test(face.hostname)) return '';
  face.protocol = 'https:';
  return face.href;
}
let login = null;

async function profile(file) {
  const result = await biliRequest('api.bilibili.com', '/x/web-interface/nav', { cookieFile: file });
  if (result.code === -101) return { loggedIn: false };
  if (result.code !== 0) throw new Error(`账号验证失败（${result.code}）`);
  // vip: the membership label shown in settings ("大会员" / "年度大会员"), empty without an active membership.
  const vip = result.data.vipStatus === 1 ? (result.data.vip_label?.text || '大会员') : '';
  return { loggedIn: result.data.isLogin, name: result.data.uname, mid: result.data.mid, vip, face: faceUrl(result.data.face) };
}

export async function account() {
  try { await access(cookieFile); }
  catch (error) { if (error.code === 'ENOENT') return { loggedIn: false }; throw error; }
  const user = await profile(cookieFile);
  // An account that logged in before multi-account support is saved the first time it is seen; a saved one is
  // refreshed when its name or avatar has changed, so the other accounts' rows show the latest avatar too.
  if (user.loggedIn) {
    let saved = null;
    try { saved = JSON.parse(await readFile(storedProfile(user.mid), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!saved || saved.name !== user.name || saved.face !== user.face) await remember(user);
  }
  return user;
}

export async function accounts() {
  const current = await account();
  const files = (await readdir(accountsDirectory)).filter(name => /^\d+\.json$/.test(name));
  const list = await Promise.all(files.map(async name => JSON.parse(await readFile(fileURLToPath(new URL(name, accountsDirectory)), 'utf8'))));
  // The active account's membership is current; the others show what was saved when they last signed in.
  return { current, accounts: list.map(item => {
    const active = current.loggedIn && item.mid === current.mid;
    return { mid: item.mid, name: item.name, vip: active ? current.vip : (item.vip || ''), face: active ? current.face : faceUrl(item.face), active };
  }).sort((a, b) => a.name.localeCompare(b.name, 'zh')) };
}

export async function switchAccount(mid) {
  if (!/^\d{1,12}$/.test(String(mid))) throw new Error('账号参数无效');
  try { await access(storedCookies(mid)); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('没有找到这个账号，请重新扫码添加'); throw error; }
  const candidate = fileURLToPath(new URL(`switch-${randomUUID()}.cookies`, directory));
  try {
    await copyFile(storedCookies(mid), candidate);
    const user = await profile(candidate);
    if (!user.loggedIn || String(user.mid) !== String(mid)) throw new Error('这个账号的登录已失效，请重新扫码添加');
    await rename(candidate, cookieFile);
    return user;
  } finally {
    await rm(candidate, { force: true });
  }
}

export async function createLogin() {
  const attempt = { id: randomUUID() };
  login = attempt;
  try {
    const data = await biliData('passport.bilibili.com', '/x/passport-login/web/qrcode/generate');
    if (typeof data?.qrcode_key !== 'string' || !data.qrcode_key || typeof data.url !== 'string' || !URL.canParse(data.url)) {
      throw new Error('Bilibili 返回的二维码信息不完整');
    }
    const qrUrl = new URL(data.url);
    if (qrUrl.protocol !== 'https:' || !['passport.bilibili.com', 'account.bilibili.com'].includes(qrUrl.hostname)) throw new Error('二维码地址异常');
    const expires = Date.now() + 180000;
    if (login !== attempt) throw new Error('二维码请求已取消');
    const { modules } = QRCode.create(data.url);
    const matrix = Array.from(modules.data).join('');
    attempt.key = data.qrcode_key;
    attempt.expires = expires;
    return { id: attempt.id, size: modules.size, matrix, expiresIn: 180 };
  } catch (error) {
    if (login === attempt) login = null;
    throw error;
  }
}

export async function pollLogin(id) {
  const attempt = login;
  if (!attempt?.key || attempt.id !== id) return { status: 'cancelled' };
  if (Date.now() >= attempt.expires) return { status: 'expired' };
  const candidate = fileURLToPath(new URL(`${id}.cookies`, directory));
  await writeFile(candidate, '', { mode: 0o600 });
  try {
    const data = await biliData('passport.bilibili.com', `/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(attempt.key)}`, { saveCookies: candidate });
    if (login !== attempt) return { status: 'cancelled' };
    if (data.code === 86101) return { status: 'waiting' };
    if (data.code === 86090) return { status: 'scanned' };
    if (data.code === 86038) return { status: 'expired' };
    if (data.code !== 0) throw new Error(`扫码确认失败（${data.code}）`);
    const user = await profile(candidate);
    if (!user.loggedIn) throw new Error('扫码已确认，但账号验证未通过');
    if (login !== attempt) return { status: 'cancelled' };
    await rename(candidate, cookieFile);
    await remember(user);
    if (login === attempt) login = null;
    return { status: 'success', account: user };
  } finally {
    await rm(candidate, { force: true });
  }
}

// Leaves the active account only: its saved copy goes too, other saved accounts stay available.
export async function logout() {
  login = null;
  const current = await account();
  await rm(cookieFile, { force: true });
  if (current.loggedIn) {
    await rm(storedCookies(current.mid), { force: true });
    await rm(storedProfile(current.mid), { force: true });
  }
  return { loggedIn: false };
}

export function cancelLogin() { login = null; return { status: 'cancelled' }; }
