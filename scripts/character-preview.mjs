// Owns an isolated HTTP preview proxy with development-only suite fixtures.
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { readFile } from 'node:fs/promises';
const fixture = await readFile(new URL('./character-fixture.mjs', import.meta.url), 'utf8');
const server = createServer((incoming, outgoing) => {
  if (incoming.url === '/favicon.ico') { outgoing.writeHead(204); outgoing.end(); return; }
  if (incoming.url.startsWith('/__character-assets/')) { const file = new URL(incoming.url, 'http://localhost').pathname.split('/').at(-1); if (!['portrait.png', 'birthplace.png', 'map.png'].includes(file)) { outgoing.writeHead(404); outgoing.end(); return; } readFile(new URL(`../benchmarks/character-preview-assets/${file}`, import.meta.url)).then(content => { outgoing.writeHead(200, { 'content-type': 'image/png' }); outgoing.end(content); }).catch(() => { outgoing.writeHead(404); outgoing.end(); }); return; }
  if (incoming.url.startsWith('/src/mcp.ts')) { outgoing.writeHead(200, { 'content-type': 'text/javascript' }); outgoing.end(fixture + '\nexport function setupMcp(run) { mountFixture(run).catch(console.error); }'); return; }
  if (incoming.url.startsWith('/src/character-fixture.js')) { outgoing.writeHead(200, { 'content-type': 'text/javascript' }); outgoing.end(fixture); return; }
  const proxy = request({ hostname: '127.0.0.1', port: 5175, path: incoming.url, method: incoming.method, headers: { ...incoming.headers, host: '127.0.0.1:5175' } }, response => { outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing); });
  proxy.on('error', error => { outgoing.writeHead(502); outgoing.end(error.message); }); incoming.pipe(proxy);
});
server.on('upgrade', (incoming, socket, head) => {
  const upstream = connect(5175, '127.0.0.1', () => { upstream.write(`${incoming.method} ${incoming.url} HTTP/1.1\r\n${Object.entries(incoming.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
});
server.listen(5176, '127.0.0.1', () => console.log('Isolated Character preview: http://127.0.0.1:5176/?fixture=worst'));
