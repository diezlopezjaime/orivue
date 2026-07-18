import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../fixtures/', import.meta.url));
const types = {
  '.m3u': 'audio/x-mpegurl',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.ts': 'video/mp2t',
};
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
  const relative = normalize(pathname).replace(/^([/\\])+/, '');
  const path = join(root, relative);
  if (!path.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'content-type': types[extname(path)] ?? 'application/octet-stream',
      'content-length': stat.size,
      'access-control-allow-origin': 'http://127.0.0.1:5173',
    });
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404).end('Fixture not found');
  }
});
server.listen(9867, '127.0.0.1', () =>
  process.stdout.write('Fixture server: http://127.0.0.1:9867/sample.m3u\n'),
);
