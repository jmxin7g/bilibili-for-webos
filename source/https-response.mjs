import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { rootCertificates } from 'node:tls';
import { Readable } from 'node:stream';
const ca = process.env.BILI_EXTRA_CA_FILE ? [...rootCertificates, await readFile(process.env.BILI_EXTRA_CA_FILE, 'utf8')] : undefined;

// The caller validates the API-returned HTTPS CDN/subtitle host before using this transport.
// Stream Range bytes without collecting a video segment in service memory.
export function httpsResponse(address, { headers, signal }) {
  return new Promise((resolve, reject) => {
    const request = https.get(address, { headers, signal, ca }, response => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach(item => responseHeaders.append(name, item));
        else if (value !== undefined) responseHeaders.set(name, value);
      }
      resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers: responseHeaders }));
    });
    request.on('error', reject);
  });
}
