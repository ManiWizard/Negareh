// Owns opt-in dev MCP transport; authenticated loopback bridge, no arbitrary code or shell dispatch.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const connection = process.env.NEGAREH_MCP_CONNECTION ?? resolve(process.env.LOCALAPPDATA ?? tmpdir(), 'ir.negareh.desktop', 'mcp-' + createHash('sha256').update(root).digest('hex').slice(0, 12) + '.json');
const credentialRelative = relative(root, resolve(connection));
if (!credentialRelative.startsWith('..') && !isAbsolute(credentialRelative)) throw new Error('MCP credentials must stay outside the served workspace.');
const actions = z.enum(['state', 'project.new', 'project.open', 'project.save', 'project.close', 'project.recent', 'project.recover', 'project.name', 'project.notes', 'welcome.show', 'welcome.dismiss', 'links.releases', 'links.donation', 'tab.new', 'tab.select', 'tab.close', 'tab.rename', 'tab.reorder', 'tile.focus', 'layout.split', 'layout.preview-split', 'layout.join', 'layout.preview-join', 'layout.resize', 'layout.commit', 'layout.cancel', 'layout.undo', 'layout.redo', 'surface.switch', 'surface.mode', 'surface.tool', 'surface.toggle', 'surface.modifier', 'surface.action', 'surface.view', 'surface.write', 'rail.resize', 'rail.visible', 'menu.open', 'menu.close', 'about.show', 'about.close', 'window.minimize', 'window.maximize', 'window.close', 'window.move', 'window.resize', 'dialog.respond']);
const input = z.strictObject({
  action: actions,
  value: z.string().max(1_000_000).optional(),
  target: z.string().max(80).optional(),
  other: z.string().max(80).optional(),
  axis: z.enum(['horizontal', 'vertical']).optional(),
  ratio: z.number().gt(0).lt(1).optional(),
  index: z.int().min(0).max(999).optional(),
  enabled: z.boolean().optional(),
  field: z.enum(['name', 'notes']).optional(),
  path: z.string().max(32767).optional(),
  savePath: z.string().max(32767).optional(),
  decision: z.enum(['save', 'discard', 'cancel']).optional(),
  overwrite: z.boolean().optional(),
  x: z.int().min(-32768).max(32768).optional(), y: z.int().min(-32768).max(32768).optional(),
  width: z.int().min(20).max(8192).optional(), height: z.int().min(480).max(8192).optional(),
});

export function mcpPlugin() {
  return {
    name: 'negareh-dev-mcp', apply: 'serve',
    config() { return { server: { fs: { strict: true, allow: [root], deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/mcp-*.json', connection.replaceAll('\\', '/')] } } }; },
    async configureServer(server) {
      if (process.env.NEGAREH_MCP !== '1') return;
      const token = randomBytes(32).toString('hex');
      const clients = new Set();
      const pending = new Map();
      let occupied = false;
      server.ws.on('negareh:hello', (_, client) => { if (clients.has(client)) return; clients.add(client); client.socket.once('close', () => { clients.delete(client); }); });
      server.ws.on('negareh:result', (data, client) => {
        const task = pending.get(data?.id);
        if (!task || task.client !== client) return;
        pending.delete(data.id); clearTimeout(task.timeout); task.resolve(data.result);
      });
      server.middlewares.use('/__negareh_mcp', async (request, response) => {
        const fail = (status, text) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ error: text })); };
        const supplied = request.headers.authorization;
        if (request.method !== 'POST' || request.headers.origin || !/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? '')) { fail(403, 'Local non-browser POST only.'); return; }
        const expected = `Bearer ${token}`;
        if (typeof supplied !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(supplied) || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) { fail(401, 'Unauthorized.'); return; }
        if (occupied) { fail(409, 'Another MCP action is in progress. Do not retry mutations automatically.'); return; }
        if (clients.size !== 1) { fail(409, `Expected one connected dev app; found ${clients.size}.`); return; }
        occupied = true;
        try {
          let bytes = 0; const chunks = [];
          for await (const chunk of request) { bytes += chunk.length; if (bytes > 12_100_000) throw new Error('Request is too large.'); chunks.push(chunk); }
          const args = input.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          const client = [...clients][0];
          const id = randomUUID();
          const result = await new Promise((resolveResult, reject) => {
            const timeout = setTimeout(() => { pending.delete(id); reject(new Error('App response timed out; outcome is unknown. Inspect state before retrying.')); }, 15_000);
            pending.set(id, { resolve: resolveResult, reject, timeout, client });
            client.send('negareh:request', { id, args });
          });
          response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(result));
        } catch (error) { fail(400, error.message); }
        finally { occupied = false; }
      });
      server.httpServer.once('listening', () => {
        const address = server.httpServer.address();
        if (!address || typeof address === 'string') return;
        mkdir(dirname(connection), { recursive: true }).then(() => writeFile(connection, JSON.stringify({ url: `http://127.0.0.1:${address.port}/__negareh_mcp`, token }), { mode: 0o600 })).catch(error => server.config.logger.error(error.message));
      });
      server.httpServer.once('close', () => {
        for (const task of pending.values()) { clearTimeout(task.timeout); task.reject(new Error('Dev server closed; action outcome may be unknown.')); }
        pending.clear(); clients.clear();
        unlink(connection).catch(() => undefined);
      });
    },
  };
}

async function request(args) {
  const config = JSON.parse(await readFile(connection, 'utf8'));
  const url = new URL(config.url);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/__negareh_mcp' || url.protocol !== 'http:' || !/^\d+$/.test(url.port)) throw new Error('Invalid local MCP connection file.');
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(18_000), redirect: 'error' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Bridge failed: ${response.status}`);
  return data;
}

function makeServer() {
  const server = new McpServer({ name: 'negareh-dev', version: '0.1.0' });
  server.registerTool('negareh_action', { description: 'Operate the single connected Negareh dev app through the same validated handlers as UI. Inspect state first. Dirty replacements require explicit decision; path/savePath avoid native dialogs. Release/donation/edit remain honestly unavailable. Window actions affect only this app and are never required for tests.', inputSchema: input }, async args => {
    try {
      const result = await request(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: result.ok === false };
    } catch (error) { return { content: [{ type: 'text', text: error.message }], isError: true }; }
  });
  server.registerTool('negareh_state', { description: 'Inspect connected app state, enabled controls, menus, tabs, project, dirty state and runtime availability without OS input or foregrounding.', inputSchema: z.strictObject({}), annotations: { readOnlyHint: true } }, async () => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await request({ action: 'state' })) }] }; }
    catch (error) { return { content: [{ type: 'text', text: error.message }], isError: true }; }
  });
  server.registerResource('app-state', 'negareh://state', { description: 'Live serializable Negareh dev app state.', mimeType: 'application/json' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await request({ action: 'state' })) }] }));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) serveStdio(makeServer, { onerror: error => console.error(error.message) });







