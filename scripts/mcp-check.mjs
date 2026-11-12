// Owns end-to-end stdio MCP checks against one disposable dev session; no OS input or focus changes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, writeFile, rm, mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, [join(root, 'scripts/mcp.mjs')], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
const lines = createInterface({ input: child.stdout });
const waiting = new Map();
let next = 0;
lines.on('line', line => {
  const message = JSON.parse(line);
  const task = waiting.get(message.id);
  if (!task) return;
  waiting.delete(message.id); clearTimeout(task.timer);
  if (message.error) task.reject(new Error(JSON.stringify(message.error)));
  else task.resolve(message.result);
});
function rpc(method, params = {}) {
  const id = ++next;
  return new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`MCP timed out: ${method}; do not blindly retry a mutation.`)); }, 20_000);
    waiting.set(id, { resolve: resolveResult, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
async function action(action, options = {}, expected = 'completed') {
  const response = await rpc('tools/call', { name: 'negareh_action', arguments: { action, ...options } });
  const result = JSON.parse(response.content[0].text);
  if (expected === 'failed') assert.equal(response.isError, true, action);
  else { assert.equal(result.ok, true, `${action}: ${JSON.stringify(result)}`); assert.equal(result.status, expected, action); }
  return result.state;
}
async function state() {
  const response = await rpc('tools/call', { name: 'negareh_state', arguments: {} });
  assert.notEqual(response.isError, true, response.content[0].text);
  return JSON.parse(response.content[0].text).state;
}
const temporary = await mkdtemp(join(tmpdir(), 'negareh-mcp-check-'));
const appData = join(process.env.LOCALAPPDATA, process.env.NEGAREH_TEST_IDENTIFIER ?? 'ir.negareh.desktop');
const backups = new Map();
const checks = [];
let started = false;
try {
  const initialize = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'negareh-check', version: '1.0.0' } });
  assert.equal(initialize.protocolVersion, '2025-11-25');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = await rpc('tools/list');
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['negareh_action', 'negareh_state']);
  const resources = await rpc('resources/list');
  assert.equal(resources.resources[0].uri, 'negareh://state');
  const resource = await rpc('resources/read', { uri: 'negareh://state' });
  assert.equal(JSON.parse(resource.contents[0].text).ok, true);
  checks.push('initialize, tool schemas, resource list/read');
  const initial = await state();
  assert.equal(initial.runtime, 'tauri', 'Run this against a native debug app.');
  assert.equal(initial.project.dirty, false, 'Use a fresh disposable session; existing edits must not be touched.');
  assert.equal(initial.project.path, null);
  for (const file of ['history.json', 'recovery.json']) {
    try { backups.set(file, await readFile(join(appData, file))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; backups.set(file, null); }
  }
  started = true;
  await action('welcome.dismiss');
  await action('project.new');
  await action('project.name', { value: 'MCP verification' });
  await action('project.notes', { value: 'Original saved notes' });
  let current = await state(); assert.equal(current.project.dirty, true);
  await action('project.new', {}, 'failed');
  current = await action('project.new', { decision: 'cancel' }, 'cancelled'); assert.equal(current.project.dirty, true);
  const original = join(temporary, 'original.negareh');
  await action('project.save', { path: join(temporary, 'missing', 'test.negareh') }, 'failed');
  assert.equal((await state()).project.dirty, true);
  current = await action('project.save', { path: original }); assert.equal(current.project.dirty, false);
  assert.equal(JSON.parse(await readFile(original, 'utf8')).notes, 'Original saved notes');
  await action('project.notes', { value: 'Recovered unsaved notes' });
  assert.equal(JSON.parse(await readFile(original, 'utf8')).notes, 'Original saved notes');
  await action('project.close', { decision: 'discard' });
  current = await action('project.recover');
  assert.equal(current.project.project.notes, 'Recovered unsaved notes');
  assert.equal(current.project.path, null); assert.equal(current.project.dirty, true);
  const recovered = join(temporary, 'recovered.negareh');
  await action('project.save', { path: recovered });
  assert.equal(JSON.parse(await readFile(original, 'utf8')).notes, 'Original saved notes');
  checks.push('save, failed save, dirty cancel/decision, separate unsaved recovery and save-copy');
  await action('project.new');
  const invalid = join(temporary, 'invalid.negareh');
  await writeFile(invalid, '{"version":2,"name":"Future","notes":""}');
  await action('project.open', { path: invalid }, 'failed');
  current = await action('project.open', { path: original }); assert.equal(current.project.project.notes, 'Original saved notes');
  await action('project.new');
  current = await action('project.recent'); assert.equal(current.project.path, original);
  await action('project.notes', { value: 'Saved before replacing' });
  await action('project.new', { decision: 'save' });
  assert.equal(JSON.parse(await readFile(original, 'utf8')).notes, 'Saved before replacing');
  await unlink(original);
  await action('project.recent', {}, 'failed');
  assert.equal((await state()).project.project.name, 'Untitled');
  checks.push('validated open, persisted recent, save-before-replace, missing recent error');
  for (const target of ['file', 'edit', 'window', 'help']) {
    current = await action('menu.open', { target }); assert.equal(current.menu, `${target}-menu`);
    current = await action('menu.close'); assert.equal(current.menu, null);
  }
  const first = (await state()).tabs[0].id;
  current = await action('tab.new'); const second = current.tabs.at(-1).id;
  current = await action('tab.select', { target: first }); assert.equal(current.tabs.find(tab => tab.id === first).selected, true);
  await action('tab.close', { target: second });
  await action('tab.close', { target: first });
  for (const tab of (await state()).tabs) await action('tab.close', { target: tab.id });
  assert.equal((await state()).tabs.length, 0);
  await action('tab.new');
  current = await action('about.show'); assert.equal(current.about, true);
  current = await action('about.close'); assert.equal(current.about, false);
  await action('links.releases', {}, 'failed'); await action('links.donation', {}, 'failed');
  current = await action('welcome.show'); assert.equal(current.project.welcome, true);
  current = await action('welcome.dismiss'); assert.equal(current.project.welcome, false);
  checks.push('all four menus, new/select/close tabs, about, welcome, unavailable links');
  await action('project.new', { decision: 'discard' });
  let workspace = (await state()).workspace;
  const left = workspace.tabs[0].activeTile;
  const originalNodes = JSON.stringify(workspace.nodes);
  current = await action('layout.preview-split', { target: left, axis: 'horizontal', ratio: .5 });
  assert.equal(current.workspace.preview.kind, 'split'); assert.equal(current.project.layoutDirty, false);
  await action('layout.cancel'); assert.equal(JSON.stringify((await state()).workspace.nodes), originalNodes);
  current = await action('layout.split', { target: left, axis: 'horizontal', ratio: .5 });
  assert.equal(current.project.layoutDirty, true); assert.equal(current.project.contentDirty, false);
  const splitLifecycle = current.workspace.lifecycle;
  assert.equal(splitLifecycle.live, splitLifecycle.mounted - splitLifecycle.disposed);
  const recoveredNodes = structuredClone(current.workspace.nodes);
  await action('project.close', { decision: 'discard' });
  current = await action('project.recover');
  assert.deepEqual(current.workspace.nodes, recoveredNodes); assert.equal(current.project.project.notes, '');
  const right = current.workspace.nodes.find(node => node.kind === 'tile' && node.id !== left && current.workspace.geometry[node.id]).id;
  const split = current.workspace.nodes.find(node => node.kind === 'split').id;
  const originalRect = current.workspace.geometry[right];
  current = await action('surface.switch', { target: right, value: 'overview' });
  assert.deepEqual(current.workspace.geometry[right], originalRect);
  assert.equal(current.workspace.surfaces.length, 6); assert.equal(current.workspace.surfaces[0].id, 'overview');
  await action('surface.mode', { target: left, value: 'read' });
  await action('surface.write', { target: left, field: 'notes', value: 'Must not write' }, 'failed');
  await action('project.notes', { value: 'Shared test value' });
  await action('layout.resize', { target: split, ratio: .6 });
  current = await action('layout.join', { target: left, other: right }); assert.equal(current.workspace.nodes.filter(node => node.kind === 'tile' && current.workspace.geometry[node.id]).length, 1); assert.equal(current.workspace.lifecycle.live, current.workspace.lifecycle.mounted - current.workspace.lifecycle.disposed);
  current = await action('layout.undo'); assert.equal(current.workspace.nodes.filter(node => node.kind === 'tile' && current.workspace.geometry[node.id]).length, 2);
  current = await action('layout.redo'); assert.equal(current.workspace.nodes.filter(node => node.kind === 'tile' && current.workspace.geometry[node.id]).length, 1);
  const oldTab = current.workspace.activeTab;
  await action('tab.new'); current = await action('tab.rename', { value: 'Independent layout' }); const newTab = current.workspace.activeTab;
  await action('tab.reorder', { target: newTab, index: 0 }); await action('tab.select', { target: oldTab });
  assert.equal((await state()).project.project.notes, 'Shared test value');
  const layoutFile = join(temporary, 'layout.negareh');
  await action('project.save', { path: layoutFile }); const savedWorkspace = JSON.parse(await readFile(layoutFile, 'utf8')).workspace;
  await action('project.new'); current = await action('project.open', { path: layoutFile });
  const overviewTab = savedWorkspace.tabs.find(tab => tab.name === 'Overview');
  const timelineTab = savedWorkspace.tabs.find(tab => tab.name === 'Timeline');
  const characterTab = savedWorkspace.tabs.find(tab => tab.name === 'Character');
  assert.deepEqual(current.workspace.tabs, [overviewTab, timelineTab, characterTab, ...savedWorkspace.tabs.filter(tab => tab !== overviewTab && tab !== timelineTab && tab !== characterTab)]); assert.deepEqual(current.workspace.nodes, savedWorkspace.nodes); assert.equal(current.workspace.activeTab, overviewTab.id);
  assert.equal(current.project.dirty, false);
  const corrupt = JSON.parse(await readFile(layoutFile, 'utf8')); corrupt.workspace.nodes[0].kind = 'bad'; const corruptPath = join(temporary, 'bad-layout.negareh'); await writeFile(corruptPath, JSON.stringify(corrupt));
  current = await action('project.open', { path: corruptPath }); assert.equal(current.project.project.notes, 'Shared test value'); assert.match(current.project.message, /invalid/);
  assert.equal(current.workspace.nodes.length, 3);
  const unknown = JSON.parse(await readFile(layoutFile, 'utf8'));
  const unknownTab = unknown.workspace.tabs.find(tab => tab.name === 'Independent layout');
  const unknownTile = unknown.workspace.nodes.find(node => node.id === unknownTab.activeTile);
  const retainedState = { type: 'missing.extension', data: { opaque: ['retained', 42] }, mode: 'future', tool: '', toggles: [], rail: { width: 40, visible: true }, view: { deck: 'opaque', zoom: 1 } };
  unknownTile.type = retainedState.type; unknownTile.states.push(retainedState);
  const unknownPath = join(temporary, 'unavailable.negareh'); await writeFile(unknownPath, JSON.stringify(unknown));
  current = await action('project.open', { path: unknownPath });
  assert.deepEqual(current.workspace.nodes.find(node => node.id === unknownTile.id).states.find(state => state.type === retainedState.type), retainedState);
  await action('tab.select', { target: unknownTab.id });
  await action('surface.view', { target: unknownTile.id, value: 'deck.partial' });
  await action('surface.switch', { target: unknownTile.id, value: 'overview' });
  const preservedPath = join(temporary, 'preserved.negareh'); await action('project.save', { path: preservedPath });
  const preserved = JSON.parse(await readFile(preservedPath, 'utf8')).workspace.nodes.find(node => node.id === unknownTile.id).states.find(state => state.type === retainedState.type);
  assert.deepEqual(preserved.data, retainedState.data); assert.equal(preserved.view.deck, 'partial');
  const emptyPath = join(temporary, 'empty-workspace.negareh'); await writeFile(emptyPath, JSON.stringify({ version: 1, name: 'Empty tabs', notes: 'Content intact', workspace: { version: 1, tabs: [], activeTab: null, nodes: [] } }));
  current = await action('project.open', { path: emptyPath }); assert.equal(current.workspace.tabs.length, 3); assert.equal(current.project.project.notes, 'Content intact');
  const legacy = join(temporary, 'legacy.negareh'); await writeFile(legacy, JSON.stringify({ version: 1, name: 'Legacy', notes: 'Old content' }));
  current = await action('project.open', { path: legacy }); assert.equal(current.workspace.tabs.length, 3); assert.equal(current.project.project.notes, 'Old content');
  checks.push('workspace preview/cancel, scoped Read writes, Overview defaults, layout history, shared project across tabs, persisted workspace and corrupted/legacy fallback');
  const unicodeName = 'نور🎨'.repeat(40), unicodeNotes = '王秀英 — نور الهدى 🎨';
  await action('project.name', { value: unicodeName }); await action('project.notes', { value: unicodeNotes });
  const unicodePath = join(temporary, 'unicode.negareh');
  await action('project.save', { path: unicodePath }); await action('project.new');
  current = await action('project.open', { path: unicodePath });
  assert.equal(current.project.project.name, unicodeName); assert.equal(current.project.project.notes, unicodeNotes);
  checks.push('200 UTF-16-unit multilingual name and notes save/open through native IO');
  const invalidCall = await rpc('tools/call', { name: 'negareh_action', arguments: { action: 'arbitrary-eval', value: 'unsafe' } });
  assert.equal(invalidCall.isError, true);
  checks.push('unknown action rejected by MCP schema');
  console.log(JSON.stringify({ passed: checks, windowControls: 'Defined but deliberately not exercised on the user desktop.' }, null, 2));
  await mkdir(join(root, 'benchmarks'), { recursive: true });
  await writeFile(join(root, 'benchmarks/mcp-verification.json'), JSON.stringify({ passed: checks, date: new Date().toISOString() }, null, 2));
} finally {
  if (started) {
    await action('project.new', { decision: 'discard' }).catch(error => console.error(error.message));
    for (const [file, data] of backups) {
      if (data === null) await unlink(join(appData, file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      else await writeFile(join(appData, file), data);
    }
  }
  child.stdin.end(); lines.close();
  for (const task of waiting.values()) { clearTimeout(task.timer); task.reject(new Error('Test closed.')); }
  if (dirname(temporary) !== resolve(tmpdir()) || !temporary.startsWith(join(resolve(tmpdir()), 'negareh-mcp-check-'))) throw new Error('Unexpected test cleanup path.');
  await rm(temporary, { recursive: true, force: true });
}





