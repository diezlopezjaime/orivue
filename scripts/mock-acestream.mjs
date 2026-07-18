import { createServer } from 'node:http';

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:9868');
  if (url.pathname === '/status') {
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    return;
  }
  if (
    url.pathname === '/ace/getstream' &&
    /^[a-f0-9]{40}$/i.test(url.searchParams.get('id') ?? '')
  ) {
    response.writeHead(302, { location: 'http://127.0.0.1:9867/media/test-pattern.m3u8' }).end();
    return;
  }
  if (url.pathname === '/ace/stop' && request.method === 'POST') {
    response.writeHead(204).end();
    return;
  }
  response.writeHead(404).end('Not found');
});
server.listen(9868, '127.0.0.1', () =>
  process.stdout.write('Mock Ace Stream engine: http://127.0.0.1:9868\n'),
);
