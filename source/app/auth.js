const accountStatus = document.querySelector('#account-status');
const loginButton = document.querySelector('#login');
const logoutButton = document.querySelector('#logout');
const loginDialog = document.querySelector('#login-dialog');
const qrStatus = document.querySelector('#qr-status');
const qrImage = document.querySelector('#qr-image');
const addAccountButton = document.querySelector('#add-account');
const accountList = document.querySelector('#account-list');
let loginTimer;
let loginGeneration = 0;
let loginController;
// Where focus goes back to when the login page closes without signing in (the row or avatar that opened it).
let loginReturn = null;
let loginSucceeded = false;
let accountIdentity;

let tvConnection;
let localCredentialsReload;

function resetTvConnection() {
  tvConnection = undefined;
  window.tvServiceSession?.cancel();
  window.tvServiceSession = undefined;
}

function connectTvService() {
  if (tvConnection) return tvConnection;
  let timer;
  tvConnection = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('电视内置服务启动超时，请重试')), 8000);
    window.tvServiceSession = webOS.service.request('luna://com.jinmx.independent.playback.service', {
      method: 'session', parameters: { subscribe: true }, subscribe: true,
      onSuccess(reply) {
        if (!reply.base || !reply.token) { reject(new Error('电视内置服务未返回连接信息')); return; }
        resolve(reply);
      },
      onFailure(reply) { reject(new Error(`电视内置服务启动失败：${reply.errorText}`)); },
    });
  }).then(reply => {
    window.serviceBase = reply.base;
    window.serviceToken = reply.token;
  }).catch(error => {
    resetTvConnection();
    throw error;
  }).finally(() => clearTimeout(timer));
  return tvConnection;
}

function reloadLocalCredentials() {
  localCredentialsReload ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `service-token.js?reload=${Date.now()}`;
    script.onload = () => { script.remove(); resolve(); };
    script.onerror = () => { script.remove(); reject(new Error('无法读取本机测试服务的连接信息')); };
    document.head.append(script);
  }).finally(() => { localCredentialsReload = undefined; });
  return localCredentialsReload;
}

window.addEventListener('pagehide', () => window.tvServiceSession?.cancel());

window.serviceRequest = async function(path, method = 'GET', signal) {
  if (window.tvService) await connectTvService();
  async function request() {
    const connection = tvConnection;
    const timeout = AbortSignal.timeout(45000);
    try {
      return await fetch(`${window.serviceBase || 'http://127.0.0.1:8769'}${path}`, {
        method, cache: 'no-store', headers: { 'X-Prototype-Token': window.serviceToken }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (error.name !== 'TypeError') throw error;
      if (connection && connection === tvConnection) resetTvConnection();
      throw new Error(window.tvService ? '无法连接电视内置服务，请重试' : '无法连接本机测试服务，请确认已运行 npm start');
    }
  }
  const initialConnection = tvConnection;
  const initialToken = window.serviceToken;
  let response = await request();
  // The service rejects stale credentials before running the handler, so a single replay is safe.
  if (response.status === 403) {
    if (window.tvService) {
      if (tvConnection === initialConnection) resetTvConnection();
      await connectTvService();
    } else if (window.serviceToken === initialToken) await reloadLocalCredentials();
    response = await request();
  }
  if (!response.ok) {
    if (response.status === 403) throw new Error('服务连接信息已失效，请重试');
    const failure = await response.json();
    throw new Error(failure.error);
  }
  return response.json();
};

function displayAccount(user) {
  const identity = user.loggedIn ? user.mid : null;
  const changed = accountIdentity !== undefined && accountIdentity !== identity;
  accountIdentity = identity;
  // The status line only speaks when there is something to say; the name is kept for the sidebar profile.
  accountStatus.dataset.name = user.loggedIn ? user.name : '';
  accountStatus.dataset.face = user.loggedIn ? (user.face || '') : '';
  accountStatus.textContent = user.loggedIn ? '' : '未登录。扫码登录后可以看关注更新、稍后再看、云端历史和收藏，并使用 720P 以上画质。';
  loginButton.hidden = user.loggedIn;
  logoutButton.hidden = !user.loggedIn;
  addAccountButton.hidden = !user.loggedIn;
  window.dispatchEvent(new CustomEvent('accountchange', { detail: { loggedIn: user.loggedIn, changed } }));
  refreshAccounts();
}

// Round avatar: the account's Bilibili picture, or its initial on the tint while there is none or it fails to load.
window.fillAvatar = function(element, face, name) {
  element.textContent = Array.from(name || '')[0] || '?';
  if (!face) return;
  const image = document.createElement('img');
  image.alt = ''; image.referrerPolicy = 'no-referrer'; image.decoding = 'async';
  image.addEventListener('error', () => image.remove());
  image.src = face;
  element.append(image);
};

// Saved accounts: the active one is marked; selecting another switches the whole app to it.
async function refreshAccounts() {
  try {
    const data = await serviceRequest('/auth/accounts');
    const focusedMid = document.activeElement?.closest('#account-list') ? document.activeElement.dataset.mid : null;
    accountList.replaceChildren(...data.accounts.map(item => {
      const button = document.createElement('button');
      button.className = 'row-button';
      button.dataset.mid = item.mid;
      const avatar = document.createElement('span'); avatar.className = 'account-avatar'; fillAvatar(avatar, item.face, item.name);
      button.append(avatar, item.name);
      // Membership next to the name, as Bilibili shows it; the current account carries a tick marker.
      if (item.vip) { const vip = document.createElement('span'); vip.className = 'vip'; vip.textContent = item.vip; button.append(vip); }
      if (item.active) { const marker = document.createElement('span'); marker.className = 'marker'; marker.textContent = '当前'; button.append(marker); }
      button.addEventListener('click', () => { if (!item.active) switchTo(item.mid); });
      return button;
    }));
    if (focusedMid) accountList.querySelector(`[data-mid="${focusedMid}"]`)?.focus();
  } catch (error) { accountStatus.textContent = error.message; }
}
async function switchTo(mid) {
  accountStatus.textContent = '正在切换账号…';
  try { displayAccount(await serviceRequest(`/auth/switch?mid=${encodeURIComponent(mid)}`, 'POST')); return null; }
  catch (error) { accountStatus.textContent = `切换失败：${error.message}`; return error.message; }
}

function drawLoginQr({ size, matrix }) {
  if (!Number.isInteger(size) || size < 21 || size > 177 || (size - 21) % 4 !== 0 ||
      typeof matrix !== 'string' || matrix.length !== size * size || /[^01]/.test(matrix)) {
    throw new Error('服务返回的二维码数据无效，请重启应用后重试');
  }
  const margin = 4;
  const scale = 8;
  const width = (size + 2 * margin) * scale;
  qrImage.width = width;
  qrImage.height = width;
  const context = qrImage.getContext('2d');
  if (!context) throw new Error('无法绘制二维码，请重试');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, width);
  context.fillStyle = '#000';
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (matrix[row * size + column] === '1') {
        context.fillRect((column + margin) * scale, (row + margin) * scale, scale, scale);
      }
    }
  }
}

async function generateQr() {
  const generation = ++loginGeneration;
  loginController?.abort();
  loginController = new AbortController();
  const { signal } = loginController;
  clearTimeout(loginTimer);
  qrImage.hidden = true;
  qrImage.parentElement.dataset.state = 'loading';
  qrStatus.textContent = '正在生成二维码…';
  try {
    const qr = await serviceRequest('/auth/qr', 'POST', signal);
    if (generation !== loginGeneration) return;
    drawLoginQr(qr);
    qrImage.hidden = false;
    qrImage.parentElement.dataset.state = 'ready';
    qrStatus.textContent = '请用手机 Bilibili 扫码，并确认登录';
    async function poll() {
      try {
        const state = await serviceRequest(`/auth/poll?id=${encodeURIComponent(qr.id)}`, 'POST', signal);
        if (generation !== loginGeneration) return;
        if (state.status === 'success') {
          displayAccount(state.account);
          loginSucceeded = true;
          loginDialog.close();
          return;
        }
        const labels = { waiting: '等待扫码…', scanned: '已扫码，请在手机确认登录', expired: '二维码已过期，请刷新', cancelled: '扫码已取消，请刷新' };
        qrStatus.textContent = labels[state.status];
        if (['waiting', 'scanned'].includes(state.status)) loginTimer = setTimeout(poll, 2000);
        else {
          qrImage.hidden = true;
          qrImage.parentElement.dataset.state = 'expired';
        }
      } catch (error) { if (generation === loginGeneration) qrStatus.textContent = `登录状态获取失败：${error.message}，请刷新二维码重试`; }
    }
    loginTimer = setTimeout(poll, 2000);
  } catch (error) {
    if (generation !== loginGeneration) return;
    qrImage.parentElement.dataset.state = 'error';
    qrStatus.textContent = `二维码生成失败：${error.message}`;
  }
}

// One page for signing in and for adding an account: the explanation on the left, the QR card on the right.
function openLogin(returnTo = document.activeElement, adding = !logoutButton.hidden) {
  loginReturn = returnTo;
  loginSucceeded = false;
  document.querySelector('#login-title').textContent = adding ? '添加 Bilibili 账号' : '登录 Bilibili';
  loginDialog.showModal();
  generateQr();
}
window.openAddAccount = returnTo => openLogin(returnTo);
loginButton.addEventListener('click', () => openLogin(loginButton, false));
addAccountButton.addEventListener('click', () => openLogin(addAccountButton, true));
document.querySelector('#qr-refresh').addEventListener('click', generateQr);
document.querySelector('#qr-close').addEventListener('click', () => loginDialog.close());
loginDialog.addEventListener('close', () => {
  if (loginDialog.open) return;
  loginGeneration++;
  loginController?.abort();
  clearTimeout(loginTimer);
  serviceRequest('/auth/cancel', 'POST').catch(error => { accountStatus.textContent = error.message; });
  const returnTo = loginReturn;
  loginReturn = null;
  // After signing in from settings, focus lands on 退出登录 (the 登录 row is gone); otherwise back where it came from.
  if (loginSucceeded && returnTo === loginButton) logoutButton.focus();
  else if (returnTo?.isConnected && !returnTo.hidden) returnTo.focus({ preventScroll: true });
  else if (!loginButton.hidden) loginButton.focus();
  else addAccountButton.focus();
});
loginDialog.addEventListener('keydown', event => {
  if (event.keyCode === 461) { event.preventDefault(); loginDialog.close(); }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    document.querySelector(['ArrowLeft', 'ArrowUp'].includes(event.key) ? '#qr-refresh' : '#qr-close').focus();
  }
  event.stopPropagation();
});
logoutButton.addEventListener('click', async () => {
  try { displayAccount(await serviceRequest('/auth/logout', 'POST')); loginButton.focus(); }
  catch (error) { accountStatus.textContent = error.message; }
});
// Profile picker, as Apple TV shows its household profiles: a row of round avatars with the current one
// ticked, plus 添加用户. Opened from the sidebar and after the startup screen ("谁在观看？").
const profilePicker = document.querySelector('#profile-picker');
const profileChoices = document.querySelector('#profile-choices');
let pickerReturn = null;
function profileChoice(label, initial, onPick, current, mid, face) {
  const button = document.createElement('button');
  button.className = 'profile-choice';
  // Each account keeps its avatar colour wherever it appears in the row.
  if (mid !== undefined) button.dataset.tint = String(Number(mid) % 4);
  const avatar = document.createElement('span'); avatar.className = 'avatar';
  if (mid !== undefined) fillAvatar(avatar, face, label); else avatar.textContent = initial;
  const name = document.createElement('span'); name.className = 'name'; name.textContent = label;
  button.append(avatar, name);
  if (current) { button.dataset.current = 'true'; button.setAttribute('aria-label', `${label}，当前用户`); }
  button.addEventListener('click', onPick);
  return button;
}
// From the sidebar it is Apple TV's 切换个人资料 panel at the top left; on launch it fills the screen.
window.openProfilePicker = async function(title) {
  let data = { accounts: [] };
  try { data = await serviceRequest('/auth/accounts'); } catch (error) { accountStatus.textContent = error.message; }
  profilePicker.classList.toggle('panel', !title);
  document.querySelector('#profile-picker-title').textContent = title || '切换账号';
  const loggedIn = !logoutButton.hidden;
  profileChoices.replaceChildren(
    ...data.accounts.map(item => profileChoice(item.name, Array.from(item.name)[0] || '?', async () => {
      if (item.active) { profilePicker.close(); return; }
      profilePicker.close();
      const failure = await switchTo(item.mid);
      if (failure) openProfilePicker(`切换失败：${failure}`);
    }, item.active, item.mid, item.face)),
    profileChoice(loggedIn ? '添加账号' : '登录账号', '+', () => {
      const returnTo = pickerReturn;
      profilePicker.close();
      openAddAccount(returnTo);
    }, false),
  );
  profileChoices.lastElementChild.classList.add('add');
  pickerReturn = document.activeElement;
  if (!profilePicker.open) profilePicker.showModal();
  (profileChoices.querySelector('[data-current]') || profileChoices.firstElementChild).focus();
};
profilePicker.addEventListener('keydown', event => {
  if (event.keyCode === 461) { event.preventDefault(); profilePicker.close(); }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const choices = Array.from(profileChoices.children);
    const index = choices.indexOf(document.activeElement);
    if (event.key === 'ArrowLeft' && index > 0) choices[index - 1].focus();
    if (event.key === 'ArrowRight' && index < choices.length - 1) choices[index + 1].focus();
  }
  event.stopPropagation();
});
profilePicker.addEventListener('close', () => {
  if (loginDialog.open) return;
  if (pickerReturn?.isConnected) pickerReturn.focus({ preventScroll: true });
});

window.initialAccountReady = serviceRequest('/auth/status').then(user => {
  displayAccount(user);
}).catch(error => { accountStatus.textContent = error.message; });
