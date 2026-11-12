// Owns focused graph/persistence/geometry checks and representative CPU timings; no desktop launch.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { WorkspaceModel, defaults, decodeWorkspace, geometry } from '../src/workspace-model.ts';
const fresh = () => new WorkspaceModel(defaults, 'test.one');
const minimum = () => ({ width: 40, height: 30 });
const inspect = model => geometry(model, 1000, 800, minimum);
function partition(model, geo) {
  const tiles = model.branch(model.tab().root).filter(node => node.kind === 'tile').map(tile => geo.rects.get(tile.id));
  let area = 0;
  for (let i = 0; i < tiles.length; i++) {
    const a = tiles[i]; assert.ok(a.width >= 40 - .001 && a.height >= 30 - .001); area += a.width * a.height;
    for (let j = i + 1; j < tiles.length; j++) { const b = tiles[j]; assert.ok(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) < .001 || Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) < .001); }
  }
  assert.ok(Math.abs(area - geo.width * geo.height) < .001);
}
const model = fresh(), tab = model.tab().id, a = model.tab().activeTile;
model.local(a, state => { state.data.selection = 'retained'; });
const original = model.tile(a);
const b = model.split(a, 'horizontal', .33); const bNode = model.tile(b);
model.split(a, 'vertical', .6); assert.equal(model.tile(b), bNode); assert.equal(model.tile(a), original); partition(model, inspect(model));
const beforeSwitch = inspect(model).rects.get(a);
model.switchSurface(a, 'test.two'); model.local(a, state => { state.data.selection = 'different'; });
model.switchSurface(a, 'test.one'); assert.equal(model.tile(a).states.find(state => state.type === 'test.one').data.selection, 'retained');
assert.deepEqual(inspect(model).rects.get(a), beforeSwitch);
model.history('undo'); assert.equal(model.tile(a).type, 'test.two'); model.history('redo'); assert.equal(model.tile(a).type, 'test.one');
model.newTab(); const other = model.tab().activeTile; model.local(other, state => { state.data.selection = 'independent'; }); model.selectTab(tab);
assert.equal(model.tile(a).states.find(state => state.type === 'test.one').data.selection, 'retained');
const roundtrip = fresh(); assert.equal(roundtrip.restore(JSON.parse(JSON.stringify(model.serialize()))), null); assert.deepEqual(roundtrip.serialize(), model.serialize());
const ratios = model.branch(model.tab().root).filter(node => node.kind === 'split').map(node => node.ratio);
const small = geometry(model, 20, 10, minimum); partition(model, small); assert.deepEqual(model.branch(model.tab().root).filter(node => node.kind === 'split').map(node => node.ratio), ratios);
const grid = fresh(), topLeft = grid.tab().activeTile, topRight = grid.split(topLeft, 'horizontal');
const bottomLeft = grid.split(topLeft, 'vertical'), bottomRight = grid.split(topRight, 'vertical');
const retained = grid.tile(bottomRight); grid.local(topLeft, state => { state.data.selection = 'survivor'; });
const beforeSwap = inspect(grid), originalTopLeft = grid.tile(topLeft);
grid.swap(topLeft, bottomRight);
assert.deepEqual(inspect(grid).rects.get(topLeft), beforeSwap.rects.get(bottomRight)); assert.deepEqual(inspect(grid).rects.get(bottomRight), beforeSwap.rects.get(topLeft));
assert.equal(grid.tile(topLeft), originalTopLeft); assert.equal(grid.tile(bottomRight), retained); partition(grid, inspect(grid));
grid.history('undo'); assert.deepEqual(inspect(grid).rects.get(topLeft), beforeSwap.rects.get(topLeft));
grid.history('redo'); assert.deepEqual(inspect(grid).rects.get(topLeft), beforeSwap.rects.get(bottomRight)); grid.history('undo');
grid.join(topLeft, topRight, inspect(grid)); assert.equal(grid.branch(grid.tab().root).filter(node => node.kind === 'tile').length, 3); assert.equal(grid.tile(bottomRight), retained); assert.equal(grid.tile(topLeft).states[0].data.selection, 'survivor'); partition(grid, inspect(grid));
const unchanged = JSON.stringify(grid.serialize()); assert.throws(() => grid.join(topLeft, bottomLeft, inspect(grid))); assert.equal(JSON.stringify(grid.serialize()), unchanged);
grid.history('undo'); assert.equal(grid.branch(grid.tab().root).filter(node => node.kind === 'tile').length, 4); grid.history('redo'); partition(grid, inspect(grid));
const invalid = structuredClone(grid.serialize()); invalid.nodes.find(node => node.kind === 'split').first = invalid.tabs[0].root;
assert.throws(() => decodeWorkspace(invalid)); const fallback = fresh(); assert.match(fallback.restore(invalid), /invalid/); assert.equal(fallback.tabs.length, 1);
const unavailable = grid.serialize(); unavailable.nodes.find(node => node.kind === 'tile').states.push({ ...defaults('missing.extension'), data: { retained: 'opaque saved data' } }); unavailable.nodes.find(node => node.kind === 'tile').type = 'missing.extension';
assert.deepEqual(decodeWorkspace(JSON.parse(JSON.stringify(unavailable))), unavailable);
const deep = { version: 1, tabs: [{ id: 'tab-deep', name: 'Deep', root: 'split-0', activeTile: 'tile-0' }], activeTab: 'tab-deep', nodes: [] };
for (let i = 0; i < 1500; i++) { deep.nodes.push({ kind: 'split', id: `split-${i}`, axis: i % 2 ? 'vertical' : 'horizontal', ratio: .5, first: `tile-${i}`, second: i === 1499 ? 'tile-final' : `split-${i + 1}` }, { kind: 'tile', id: `tile-${i}`, type: 'test.one', states: [defaults('test.one')] }); }
deep.nodes.push({ kind: 'tile', id: 'tile-final', type: 'test.one', states: [defaults('test.one')] });
const large = fresh(); assert.equal(large.restore(deep), null); const timing = performance.now(); const largeGeometry = geometry(large, 2000, 2000, () => ({ width: 1, height: 1 })); const deepGeometryMs = performance.now() - timing; assert.equal(largeGeometry.rects.size, 3001);
const start = performance.now(); for (let i = 0; i < 1000; i++) geometry(model, 1000 + i % 100, 800 + i % 50, minimum); const resizeGeometryMs = performance.now() - start;
const benchmark = fresh(); const queue = [{ tile: benchmark.tab().activeTile, axis: 'horizontal' }]; const structuralStart = performance.now();
for (let i = 0; i < 63; i++) { const item = queue.shift(); const next = benchmark.split(item.tile, item.axis); const axis = item.axis === 'horizontal' ? 'vertical' : 'horizontal'; queue.push({ tile: item.tile, axis }, { tile: next, axis }); }
const split64TileBuildMs = performance.now() - structuralStart; const benchGeometry = inspect(benchmark); partition(benchmark, benchGeometry); const joinStart = performance.now(); benchmark.join(queue[0].tile, queue[1].tile, benchGeometry); const join64TileLayoutMs = performance.now() - joinStart;
{
const grouped = fresh();
for (let i = 0; i < 4; i++) grouped.newTab();
const [a, b, c, d, loose] = grouped.tabs;
const groupA = { id: 'group-a', name: 'A', color: '#8ab4f8', collapsed: false };
const groupB = { id: 'group-b', name: 'B', color: '#81c995', collapsed: true };
grouped.groupTab(a.id, groupA); grouped.groupTab(b.id, groupA); grouped.groupTab(c.id, groupB); grouped.groupTab(d.id, groupB);
const selected = grouped.activeTab;
grouped.reorderGroup(groupA.id, c.id, true);
assert.deepEqual(grouped.tabs.map(tab => tab.id), [c.id, d.id, a.id, b.id, loose.id]);
grouped.reorderGroup(groupA.id, d.id, false);
assert.deepEqual(grouped.tabs.map(tab => tab.id), [a.id, b.id, c.id, d.id, loose.id]);
assert.equal(grouped.activeTab, selected); assert.equal(c.group.collapsed, true);
grouped.reorderGroup(groupB.id, null, true);
assert.deepEqual(grouped.tabs.map(tab => tab.id), [a.id, b.id, loose.id, c.id, d.id]);
assert.deepEqual(decodeWorkspace(JSON.parse(JSON.stringify(grouped.serialize()))), grouped.serialize());
}
const result = { passed: ['unequal recursive splits, exact partition and minimums', 'surface state/geometry and other-tab independence', 'layout undo/redo and faithful flat roundtrip', 'cross-branch adjacent join, survivor and invalid join', 'cyclic fallback and unknown-type data retention', '1500 nested splits without recursive traversal', 'whole-group reorder preserves members, target groups, selection, collapsed state and serialization'], measurements: { deepGeometryMs, resizeGeometry1000CallsMs: resizeGeometryMs, split64TileBuildMs, join64TileLayoutMs } };
await mkdir('benchmarks', { recursive: true }); await writeFile('benchmarks/workspace-model-verification.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));

