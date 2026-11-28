const Service = require('webos-service');
const fs = require('node:fs/promises');
const https = require('node:https');
const { rootCertificates } = require('node:tls');
const path = require('node:path');
const caFile = path.join(__dirname, 'network-ca.pem');
const caReady = fs.readFile(caFile, 'utf8').then(pem => {
  process.env.BILI_EXTRA_CA_FILE = caFile;
  return [...rootCertificates, pem];
}, error => { if (error.code !== 'ENOENT') throw error; return undefined; });
const service = new Service('com.jinmx.independent.playback.service');
const directory = process.env.SERVICE_DATA_DIR || '/media/internal/com.jinmx.independent.playback';
service.register('probe', async message => {
  if (message.sender !== 'com.jinmx.independent.playback') { message.respond({ returnValue: false, errorText: 'caller is not this app', errorCode: 1 }); return; }
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = `${directory}/probe.json`;
    let previous = null;
    try { previous = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const current = { runs: (previous?.runs || 0) + 1, time: Date.now() };
    await fs.writeFile(file, JSON.stringify(current), { mode: 0o600 });
    const ca = await caReady;
    const network = await new Promise((resolve, reject) => {
      const request = https.get('https://api.bilibili.com/x/web-interface/nav', { ca, headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' } }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => text += chunk);
        response.on('error', reject);
        response.on('end', () => { try { resolve({ status: response.statusCode, code: JSON.parse(text).code }); } catch (error) { reject(error); } });
      });
      request.setTimeout(20000, () => request.destroy(new Error('HTTPS timeout')));
      request.on('error', reject);
    });
    message.respond({ returnValue: true, node: process.version, previous, saved: JSON.parse(await fs.readFile(file, 'utf8')), network });
  } catch (error) { message.respond({ returnValue: false, errorText: error.message, errorCode: error.code || 1 }); }
});

process.env.TV_SERVICE = '1';
process.env.SERVICE_DATA_DIR = directory;
// Direct DASH returned 403 on this TV; the app-scoped service streams local Range responses.
process.env.TV_MEDIA_MODE = 'proxy';
const backend = caReady.then(() => import('./server.mjs')).then(async module => { await module.ready; return module; });
const sessions = new Map();
service.register('session', async message => {
  if (!message.isSubscription) { message.respond({ returnValue: false, errorText: 'session requires subscribe', errorCode: 1 }); return; }
  if (message.sender !== 'com.jinmx.independent.playback') { message.respond({ returnValue: false, errorText: 'caller is not this app', errorCode: 1 }); return; }
  let activity;
  service.activityManager.create('app-session', value => { activity = value; });
  sessions.set(message.uniqueToken, activity);
  try {
    const module = await backend;
    message.respond({ returnValue: true, subscribed: true, base: `http://127.0.0.1:${module.port}`, token: module.serviceToken, node: process.version, mediaMode: process.env.TV_MEDIA_MODE });
  } catch (error) {
    sessions.delete(message.uniqueToken);
    service.activityManager.complete(activity);
    message.respond({ returnValue: false, errorText: error.message, errorCode: 1 });
  }
}, message => {
  const activity = sessions.get(message.uniqueToken);
  if (activity) { sessions.delete(message.uniqueToken); service.activityManager.complete(activity); }
});
