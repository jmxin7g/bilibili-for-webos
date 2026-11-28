import https from 'node:https';
import { rootCertificates } from 'node:tls';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, inflateSync, inflateRawSync, brotliDecompressSync } from 'node:zlib';

const ca = process.env.BILI_EXTRA_CA_FILE ? [...rootCertificates, await readFile(process.env.BILI_EXTRA_CA_FILE, 'utf8')] : undefined;

export async function readCookieJar(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return ''; }
}

// Keep the existing Netscape cookie files, including the per-account copies. Only Bilibili API
// hosts receive credentials; CDN requests use the separate media transport in server.mjs.
export async function biliRequest(host, path, { cookieFile, cookieJar, saveCookies, cookie, form } = {}) {
  const headers = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/', 'Accept-Encoding': 'gzip, deflate, br' };
  const values = [];
  const jar = cookieJar ?? (cookieFile ? await readCookieJar(cookieFile) : '');
  if (jar) {
    for (const line of jar.split('\n')) {
      if (line.startsWith('#') && !line.startsWith('#HttpOnly_')) continue;
      const [rawDomain, , cookiePath, , expires, name, value] = line.replace(/^#HttpOnly_/, '').split('\t');
      if (!name) continue;
      const domain = rawDomain.replace(/^\./, '');
      if ((host === domain || host.endsWith(`.${domain}`)) && path.startsWith(cookiePath) && (!Number(expires) || Number(expires) > Date.now() / 1000)) values.push(`${name}=${value}`);
    }
  }
  if (cookie) values.push(cookie);
  if (values.length) headers.Cookie = values.join('; ');
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  const { text, cookies } = await requestText(host, path, headers, form);
  if (saveCookies && cookies.length) {
    const rows = cookies.map(value => {
      const [pair, ...attributes] = value.split(';').map(value => value.trim());
      const equal = pair.indexOf('=');
      const attrs = new Map(attributes.map(item => { const i = item.indexOf('='); return [item.slice(0, i < 0 ? undefined : i).toLowerCase(), i < 0 ? true : item.slice(i + 1)]; }));
      const domain = attrs.get('domain') || host;
      const seconds = attrs.has('max-age') ? Math.floor(Date.now() / 1000) + Number(attrs.get('max-age')) : attrs.has('expires') ? Math.floor(Date.parse(attrs.get('expires')) / 1000) : 0;
      return [domain, domain.startsWith('.') ? 'TRUE' : 'FALSE', attrs.get('path') || '/', attrs.has('secure') ? 'TRUE' : 'FALSE', seconds, pair.slice(0, equal), pair.slice(equal + 1)].join('\t');
    });
    await writeFile(saveCookies, `# Netscape HTTP Cookie File\n${rows.join('\n')}\n`, { mode: 0o600 });
  }
  return JSON.parse(text);
}

function requestText(host, path, headers, form) {
  if (!(host === 'api.bilibili.com' || host === 'passport.bilibili.com' || host === 's.search.bilibili.com')) throw new Error('Bilibili API 主机不受支持');
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: host, path, method: form ? 'POST' : 'GET', headers, ca, signal: AbortSignal.timeout(20000) }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); reject(new Error(`Bilibili HTTP ${response.statusCode}`)); return; }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) response.destroy(new Error('Bilibili 响应过大')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => {
        try {
          let body = Buffer.concat(chunks);
          const encoding = response.headers['content-encoding'];
          if (encoding === 'gzip') body = gunzipSync(body);
          else if (encoding === 'deflate') {
            // The real danmaku endpoint sends raw DEFLATE (a4 bd...), while some HTTP servers
            // wrap it in zlib. Select from the actual header bytes, without swallowing decode errors.
            const zlibHeader = (body[0] & 15) === 8 && ((body[0] << 8) + body[1]) % 31 === 0;
            body = zlibHeader ? inflateSync(body) : inflateRawSync(body);
          }
          else if (encoding === 'br') body = brotliDecompressSync(body);
          resolve({ text: body.toString('utf8'), cookies: response.headers['set-cookie'] || [] });
        } catch (error) { reject(error); }
      });
    });
    request.on('error', error => reject(new Error(`Bilibili HTTPS 失败（${error.code || error.name}）`)));
    request.end(form);
  });
}

export async function biliText(host, path) {
  return (await requestText(host, path, { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/', 'Accept-Encoding': 'gzip, deflate, br' })).text;
}

export async function biliData(host, path, options) {
  const body = await biliRequest(host, path, options);
  if (body.code !== 0) throw new Error(`Bilibili 接口错误 ${body.code}`);
  if (body.data?.v_voucher) throw new Error('Bilibili 要求额外验证，请稍后重试或检查登录状态');
  return body.data;
}
