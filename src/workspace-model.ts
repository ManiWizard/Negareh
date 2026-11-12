// Owns flat, versioned workspace trees and layout-only history; canonical project data never lives here.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Axis = 'horizontal' | 'vertical';
export interface SurfaceState { type: string; data: { [key: string]: Json }; mode: string; tool: string; toggles: string[]; rail: { width: number; visible: boolean }; view: { deck: 'opaque' | 'partial' | 'transparent'; zoom: number } }
export interface Tile { kind: 'tile'; id: string; type: string; states: SurfaceState[] }
export interface Split { kind: 'split'; id: string; axis: Axis; ratio: number; first: string; second: string }
export type LayoutNode = Tile | Split;
export interface TabGroup { id: string; name: string; color: string; collapsed: boolean }
export const groupColors = ['#b9bbbe', '#8ab4f8', '#f28b82', '#fdd663', '#81c995', '#f78bcb', '#c58af9', '#78d9ec', '#fcad70'];
export interface Tab { id: string; name: string; root: string; activeTile: string; scroll: { x: number; y: number }; group?: TabGroup; pinned?: boolean }
export interface Workspace { version: 1; tabs: Tab[]; activeTab: string | null; nodes: LayoutNode[] }
export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }
export interface Geometry { rects: Map<string, Rect>; minimums: Map<string, Size>; width: number; height: number }
interface Snapshot { tab: Tab; nodes: LayoutNode[] }
interface History { undo: Snapshot[]; redo: Snapshot[] }
const id = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^(tab|tile|split)-[a-zA-Z0-9-]{1,80}$/.test(value);
export const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
function text(value: unknown, max = 200): string { if (typeof value !== 'string' || value.length > max) throw new Error('Invalid workspace text.'); return value; }
function json(value: unknown): value is Json {
  const stack = [{ value, depth: 0 }]; const seen = new Set<object>(); let budget = 100_000;
  while (stack.length) {
    const item = stack.pop(); if (!item || --budget < 0 || item.depth > 32) return false;
    const entry = item.value;
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') continue;
    if (typeof entry === 'number') { if (!Number.isFinite(entry)) return false; continue; }
    if (typeof entry !== 'object' || seen.has(entry)) return false;
    seen.add(entry);
    for (const child of Object.values(entry)) stack.push({ value: child, depth: item.depth + 1 });
  }
  return true;
}
function surface(value: unknown): SurfaceState {
  if (!record(value) || !record(value.data) || !json(value.data) || !record(value.rail) || !record(value.view)) throw new Error('Invalid surface state.');
  if (!finite(value.rail.width, 20, 4096) || typeof value.rail.visible !== 'boolean' || !finite(value.view.zoom, .1, 8)) throw new Error('Invalid surface dimensions.');
  if (!['opaque', 'partial', 'transparent'].includes(String(value.view.deck)) || !Array.isArray(value.toggles) || value.toggles.length > 100) throw new Error('Invalid surface preferences.');
  const deck = value.view.deck;
  if (deck !== 'opaque' && deck !== 'partial' && deck !== 'transparent') throw new Error('Invalid deck.');
  return { type: text(value.type), data: value.data, mode: text(value.mode), tool: text(value.tool), toggles: value.toggles.map(entry => text(entry)), rail: { width: value.rail.width, visible: value.rail.visible }, view: { deck, zoom: value.view.zoom } };
}
export function decodeWorkspace(value: unknown): Workspace {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.tabs) || !Array.isArray(value.nodes) || value.nodes.length > 10_000 || value.tabs.length > 1000) throw new Error('Invalid workspace version or size.');
  if (new TextEncoder().encode(JSON.stringify(value)).length > 4_000_000) throw new Error('Workspace state exceeds the 4 MB limit.');
  const nodes: LayoutNode[] = []; const lookup = new Map<string, LayoutNode>();
  for (const entry of value.nodes) {
    if (!record(entry) || !identifier(entry.id) || lookup.has(entry.id)) throw new Error('Invalid or duplicate layout ID.');
    let node: LayoutNode;
    if (entry.kind === 'split') {
      if (!entry.id.startsWith('split-')) throw new Error('Invalid split ID.');
      if ((entry.axis !== 'horizontal' && entry.axis !== 'vertical') || !finite(entry.ratio, .000001, .999999) || !identifier(entry.first) || !identifier(entry.second)) throw new Error('Invalid split.');
      node = { kind: 'split', id: entry.id, axis: entry.axis, ratio: entry.ratio, first: entry.first, second: entry.second };
    } else {
      if (!entry.id.startsWith('tile-') || entry.kind !== 'tile' || !Array.isArray(entry.states) || entry.states.length < 1 || entry.states.length > 100) throw new Error('Invalid tile.');
      const states = entry.states.map(surface); const type = text(entry.type);
      if (!states.some(state => state.type === type) || new Set(states.map(state => state.type)).size !== states.length) throw new Error('Invalid surface instances.');
      node = { kind: 'tile', id: entry.id, type, states };
    }
    lookup.set(node.id, node); nodes.push(node);
  }
  const tabs: Tab[] = []; const visited = new Set<string>(); const tabIds = new Set<string>();
  for (const entry of value.tabs) {
    if (!record(entry) || !identifier(entry.id) || tabIds.has(entry.id) || !identifier(entry.root) || !identifier(entry.activeTile)) throw new Error('Invalid tab.');
    if (!entry.id.startsWith('tab-')) throw new Error('Invalid tab ID.');
    const scroll = record(entry.scroll) && finite(entry.scroll.x, 0, 100_000_000) && finite(entry.scroll.y, 0, 100_000_000) ? { x: entry.scroll.x, y: entry.scroll.y } : { x: 0, y: 0 };
    const tab: Tab = { id: entry.id, name: text(entry.name, 80), root: entry.root, activeTile: entry.activeTile, scroll };
    if (entry.pinned === true) tab.pinned = true;
    if (entry.group !== undefined) {
      if (!record(entry.group) || typeof entry.group.id !== 'string' || !/^group-[a-zA-Z0-9-]{1,80}$/.test(entry.group.id) || !groupColors.includes(String(entry.group.color)) || typeof entry.group.collapsed !== 'boolean') throw new Error('Invalid tab group.');
      tab.group = { id: entry.group.id, name: text(entry.group.name, 80), color: String(entry.group.color), collapsed: entry.group.collapsed };
    }
    tabIds.add(tab.id); const stack = [tab.root]; let active = false;
    while (stack.length) {
      const key = stack.pop(); if (!key || visited.has(key)) throw new Error('Cyclic or shared layout.');
      const node = lookup.get(key); if (!node) throw new Error('Missing layout node.');
      visited.add(key);
      if (node.kind === 'split') stack.push(node.second, node.first);
      else if (node.id === tab.activeTile) active = true;
    }
    if (!active) throw new Error('Invalid focused tile.');
    tabs.push(tab);
  }
  if (visited.size !== nodes.length || (value.activeTab !== null && (typeof value.activeTab !== 'string' || !tabIds.has(value.activeTab))) || (tabs.length > 0 && value.activeTab === null)) throw new Error('Invalid workspace selection.');
  return { version: 1, tabs, nodes, activeTab: value.activeTab };
}
export function defaults(type: string): SurfaceState { return { type, data: {}, mode: 'read', tool: '', toggles: [], rail: { width: 40, visible: true }, view: { deck: 'opaque', zoom: 1 } }; }

export class WorkspaceModel {
  tabs: Tab[] = [];
  activeTab: string | null = null;
  nodes = new Map<string, LayoutNode>();
  private histories = new Map<string, History>();
  private listeners = new Set<(reason: string) => void>();
  private makeSurface: (type: string) => SurfaceState;
  private defaultType: string;
  private initialTabName: string;
  constructor(makeSurface: (type: string) => SurfaceState, defaultType: string, initialTabName = 'Tab 1') { this.makeSurface = makeSurface; this.defaultType = defaultType; this.initialTabName = initialTabName; this.newTab(false); }
  subscribe(listener: (reason: string) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  changed(reason: string): void { for (const listener of this.listeners) listener(reason); }
  serialize(): Workspace { return { version: 1, tabs: this.tabs.map(tab => ({ ...tab })), activeTab: this.activeTab, nodes: [...this.nodes.values()] }; }
  restore(value: unknown): string | null {
    try { this.install(value === undefined || value === null ? null : decodeWorkspace(value)); return null; }
    catch { this.install(null); return 'Saved UI layout was invalid; project content is intact. A default layout was restored.'; }
  }
  private install(value: Workspace | null): void {
    this.nodes.clear(); this.histories.clear(); this.tabs = []; this.activeTab = null;
    if (value) { this.tabs = value.tabs; this.activeTab = value.activeTab; this.nodes = new Map(value.nodes.map(node => [node.id, node])); }
    else this.newTab(false);
    this.changed('restore');
  }
  tab(): Tab { const tab = this.tabs.find(tab => tab.id === this.activeTab); if (!tab) throw new Error('No active tab.'); return tab; }
  tile(key = this.tab().activeTile): Tile { const node = this.nodes.get(key); if (node?.kind !== 'tile' || !this.branch(this.tab().root).some(node => node.id === key)) throw new Error('Tile is not in the active tab.'); return node; }
  branch(root: string): LayoutNode[] {
    const result: LayoutNode[] = []; const stack = [root];
    while (stack.length) { const key = stack.pop(); const node = key ? this.nodes.get(key) : undefined; if (!node) throw new Error('Missing branch.'); result.push(node); if (node.kind === 'split') stack.push(node.second, node.first); }
    return result;
  }
  newTab(notify = true): Tab {
    if (this.tabs.length >= 1000 || this.nodes.size >= 9999) throw new Error('Workspace resource limit reached.');
    const tile: Tile = { kind: 'tile', id: id('tile'), type: this.defaultType, states: [this.makeSurface(this.defaultType)] };
    const tab = { id: id('tab'), name: this.tabs.length === 0 ? this.initialTabName : `Tab ${String(this.tabs.length + 1)}`, root: tile.id, activeTile: tile.id, scroll: { x: 0, y: 0 } };
    this.nodes.set(tile.id, tile); this.tabs.push(tab); this.activeTab = tab.id;
    if (notify) this.changed('tabs'); return tab;
  }
  selectTab(key: string): void { if (!this.tabs.some(tab => tab.id === key)) throw new Error('Unknown tab.'); if (key === this.activeTab) return; this.activeTab = key; this.changed('focus'); }
  closeTab(key: string): void {
    const index = this.tabs.findIndex(tab => tab.id === key); const tab = this.tabs[index]; if (!tab) throw new Error('Unknown tab.');
    for (const node of this.branch(tab.root)) this.nodes.delete(node.id);
    this.tabs.splice(index, 1); this.histories.delete(key);
    if (this.activeTab === key) this.activeTab = (this.tabs[index] ?? this.tabs[index - 1])?.id ?? null;
    this.changed('tabs');
  }
  renameTab(key: string, name: string): void { const tab = this.tabs.find(tab => tab.id === key); if (!tab || !name.trim() || name.length > 80) throw new Error('Invalid tab name.'); tab.name = name.trim(); this.changed('tabs'); }
  duplicateTab(key: string): void {
    const source = this.tabs.find(tab => tab.id === key); if (!source) throw new Error('Unknown tab.');
    const branch = structuredClone(this.branch(source.root));
    if (this.tabs.length >= 1000 || this.nodes.size + branch.length > 10_000) throw new Error('Workspace resource limit reached.');
    const ids = new Map(branch.map(node => [node.id, id(node.kind === 'tile' ? 'tile' : 'split')]));
    for (const node of branch) { const key = ids.get(node.id); if (!key) throw new Error('Missing cloned node.'); node.id = key; if (node.kind === 'split') { node.first = ids.get(node.first) ?? ''; node.second = ids.get(node.second) ?? ''; } this.nodes.set(key, node); }
    const tab: Tab = { ...structuredClone(source), id: id('tab'), root: ids.get(source.root) ?? '', activeTile: ids.get(source.activeTile) ?? '' };
    this.tabs.splice(this.tabs.indexOf(source) + 1, 0, tab); this.activeTab = tab.id; this.changed('tabs');
  }
  groupTab(key: string, group?: TabGroup): void {
    const tab = this.tabs.find(tab => tab.id === key); if (!tab) throw new Error('Unknown tab.');
    delete tab.pinned; delete tab.group;
    if (group) { tab.group = group; const siblings = this.tabs.filter(item => item !== tab && item.group?.id === group.id); const last = siblings.at(-1); if (last) { this.tabs.splice(this.tabs.indexOf(tab), 1); this.tabs.splice(this.tabs.indexOf(last) + 1, 0, tab); } }
    this.changed('tabs');
  }
  updateGroup(key: string, update: Partial<Omit<TabGroup, 'id'>>): void { for (const tab of this.tabs) if (tab.group?.id === key) Object.assign(tab.group, update); this.changed('tabs'); }
  reorderGroup(key: string, target: string | null, after: boolean): void {
    const members = this.tabs.filter(tab => tab.group?.id === key);
    if (!members.length) throw new Error('Unknown tab group.');
    if (members.some(tab => tab.id === target)) return;
    const remaining = this.tabs.filter(tab => tab.group?.id !== key);
    const other = remaining.find(tab => tab.id === target);
    const targets = other?.group ? remaining.filter(tab => tab.group?.id === other.group?.id) : other ? [other] : [];
    const edge = after ? targets.at(-1) : targets[0];
    const index = edge ? remaining.indexOf(edge) + (after ? 1 : 0) : remaining.length;
    remaining.splice(index, 0, ...members); this.tabs = remaining; this.changed('tabs');
  }
  reorderTab(key: string, index: number): void { const from = this.tabs.findIndex(tab => tab.id === key); if (from < 0 || !Number.isInteger(index) || index < 0 || index >= this.tabs.length) throw new Error('Invalid tab order.'); const tab = this.tabs.splice(from, 1)[0]; if (tab) this.tabs.splice(index, 0, tab); this.changed('tabs'); }
  focus(key: string): void { this.tile(key); if (this.tab().activeTile === key) return; this.tab().activeTile = key; this.changed('focus'); }
  local(key: string, update: (state: SurfaceState) => void): void { const tile = this.tile(key); const state = tile.states.find(state => state.type === tile.type); if (!state) throw new Error('Missing surface state.'); update(state); this.changed('local'); }
  private snapshot(): Snapshot { return { tab: { ...this.tab() }, nodes: this.branch(this.tab().root) }; }
  private edit(change: () => void): void {
    const before = this.snapshot(); change();
    const history = this.histories.get(before.tab.id) ?? { undo: [], redo: [] };
    history.undo.push(before); if (history.undo.length > 100) history.undo.shift(); history.redo = []; this.histories.set(before.tab.id, history); this.changed('layout');
  }
  history(direction: 'undo' | 'redo'): void {
    const tab = this.tab(); const history = this.histories.get(tab.id); const snapshot = history?.[direction].pop(); if (!history || !snapshot) return;
    history[direction === 'undo' ? 'redo' : 'undo'].push(this.snapshot());
    for (const node of this.branch(tab.root)) this.nodes.delete(node.id);
    for (const node of snapshot.nodes) this.nodes.set(node.id, node);
    Object.assign(tab, snapshot.tab); this.changed('history');
  }
  canUndo(): boolean { return (this.histories.get(this.tab().id)?.undo.length ?? 0) > 0; }
  canRedo(): boolean { return (this.histories.get(this.tab().id)?.redo.length ?? 0) > 0; }
  private replace(key: string, next: string): void {
    const tab = this.tab(); if (tab.root === key) { tab.root = next; return; }
    const parent = this.branch(tab.root).find(node => node.kind === 'split' && (node.first === key || node.second === key));
    if (parent?.kind !== 'split') throw new Error('Missing parent.');
    this.nodes.set(parent.id, { ...parent, first: parent.first === key ? next : parent.first, second: parent.second === key ? next : parent.second });
  }
  split(key: string, axis: Axis, ratio = .5): string {
    if (this.nodes.size > 9998) throw new Error('Workspace resource limit reached.');
    const original = this.tile(key); if (!finite(ratio, .000001, .999999)) throw new Error('Invalid split ratio.');
    const tile: Tile = { kind: 'tile', id: id('tile'), type: this.defaultType, states: [this.makeSurface(this.defaultType)] };
    this.edit(() => { const split: Split = { kind: 'split', id: id('split'), axis, ratio, first: original.id, second: tile.id }; this.replace(key, split.id); this.nodes.set(split.id, split); this.nodes.set(tile.id, tile); });
    return tile.id;
  }
  resize(key: string, ratio: number): void {
    const node = this.nodes.get(key); if (node?.kind !== 'split' || !this.branch(this.tab().root).includes(node) || !finite(ratio, .000001, .999999)) throw new Error('Invalid divider.');
    if (Math.abs(node.ratio - ratio) < .000001) return;
    this.edit(() => { this.nodes.set(key, { ...node, ratio }); });
  }
  switchSurface(key: string, type: string): void {
    const tile = this.tile(key); if (!type || type.length > 200 || tile.type === type) return;
    this.edit(() => { if (!tile.states.some(state => state.type === type)) tile.states.push(this.makeSurface(type)); this.nodes.set(key, { ...tile, type }); });
  }
  swap(first: string, second: string): void {
    this.tile(first); this.tile(second); if (first === second) return;
    const exchange = (key: string): string => key === first ? second : key === second ? first : key;
    this.edit(() => {
      for (const node of this.branch(this.tab().root)) if (node.kind === 'split' && [node.first, node.second].some(key => key === first || key === second)) this.nodes.set(node.id, { ...node, first: exchange(node.first), second: exchange(node.second) });
    });
  }
  join(first: string, second: string, geometry: Geometry): void {
    const survivor = this.tile(first); this.tile(second);
    const a = geometry.rects.get(first), b = geometry.rects.get(second); if (!a || !b || !adjacent(a, b)) throw new Error('Tiles must share an entire matching edge.');
    const parents = new Map<string, string>();
    for (const node of this.branch(this.tab().root)) if (node.kind === 'split') { parents.set(node.first, node.id); parents.set(node.second, node.id); }
    const ancestors = new Set<string>(); let key: string | undefined = first;
    while (key) { ancestors.add(key); key = parents.get(key); }
    key = second; while (key && !ancestors.has(key)) key = parents.get(key);
    if (!key) throw new Error('No common region.');
    const root = key; const branch = this.branch(root); const region = geometry.rects.get(root); if (!region) throw new Error('Missing region.');
    const rects = new Map(geometry.rects); rects.set(first, union(a, b));
    const leaves = branch.filter((node): node is Tile => node.kind === 'tile' && node.id !== second);
    const rebuilt = rebuild(leaves, rects, region);
    this.edit(() => { this.replace(root, rebuilt.root); for (const node of branch) this.nodes.delete(node.id); for (const node of rebuilt.nodes) this.nodes.set(node.id, node); this.tab().activeTile = survivor.id; });
  }
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < .01;
export function adjacent(a: Rect, b: Rect): boolean { return (near(a.y, b.y) && near(a.height, b.height) && (near(a.x + a.width, b.x) || near(b.x + b.width, a.x))) || (near(a.x, b.x) && near(a.width, b.width) && (near(a.y + a.height, b.y) || near(b.y + b.height, a.y))); }
export function union(a: Rect, b: Rect): Rect { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }; }
function rebuild(leaves: Tile[], rects: Map<string, Rect>, region: Rect): { root: string; nodes: LayoutNode[] } {
  const nodes: LayoutNode[] = []; const root = leaves.length === 1 ? leaves[0]?.id : id('split'); if (!root) throw new Error('Empty join.');
  const stack = [{ leaves, region, id: root }];
  while (stack.length) {
    const group = stack.pop(); if (!group) break;
    if (group.leaves.length === 1) { const leaf = group.leaves[0]; if (leaf) nodes.push(leaf); continue; }
    const cut = findCut(group.leaves, rects, group.region); if (!cut) throw new Error('These regions cannot form a compatible rectangular layout.');
    const first = cut.first.length === 1 ? cut.first[0]?.id : id('split'), second = cut.second.length === 1 ? cut.second[0]?.id : id('split');
    if (!first || !second) throw new Error('Invalid join partition.');
    nodes.push({ kind: 'split', id: group.id, first, second, axis: cut.axis, ratio: cut.ratio });
    stack.push({ leaves: cut.first, region: cut.a, id: first }, { leaves: cut.second, region: cut.b, id: second });
  }
  return { root, nodes };
}
function partitionAt(leaves: Tile[], rects: Map<string, Rect>, axis: Axis, point: number): { first: Tile[]; second: Tile[]; crossed: boolean } {
  const first: Tile[] = [], second: Tile[] = [];
  for (const leaf of leaves) {
    const rect = rects.get(leaf.id); if (!rect) throw new Error('Missing rectangle.');
    const from = axis === 'horizontal' ? rect.x : rect.y, end = from + (axis === 'horizontal' ? rect.width : rect.height);
    if (end <= point + .01) first.push(leaf); else if (from >= point - .01) second.push(leaf); else return { first, second, crossed: true };
  }
  return { first, second, crossed: false };
}
function findCut(leaves: Tile[], rects: Map<string, Rect>, region: Rect): { axis: Axis; ratio: number; first: Tile[]; second: Tile[]; a: Rect; b: Rect } | null {
  for (const axis of ['horizontal', 'vertical'] as const) {
    const start = axis === 'horizontal' ? region.x : region.y, length = axis === 'horizontal' ? region.width : region.height;
    const cuts = new Set(leaves.map(leaf => { const rect = rects.get(leaf.id); if (!rect) throw new Error('Missing tile geometry.'); return axis === 'horizontal' ? rect.x + rect.width : rect.y + rect.height; }));
    for (const point of cuts) {
      if (point <= start + .01 || point >= start + length - .01) continue;
      const first: Tile[] = [], second: Tile[] = []; let crossed = false;
      const partition = partitionAt(leaves, rects, axis, point);
      first.push(...partition.first); second.push(...partition.second); crossed = partition.crossed;
      if (crossed || !first.length || !second.length) continue;
      const a = { ...region }, b = { ...region };
      if (axis === 'horizontal') { a.width = point - start; b.x = point; b.width = length - a.width; }
      else { a.height = point - start; b.y = point; b.height = length - a.height; }
      return { axis, ratio: (point - start) / length, first, second, a, b };
    }
  }
  return null;
}
export function geometry(model: WorkspaceModel, width: number, height: number, minimum: (tile: Tile) => Size, preview?: { id: string; ratio: number }): Geometry {
  const rects = new Map<string, Rect>(), minimums = new Map<string, Size>();
  if (!model.activeTab) return { rects, minimums, width, height };
  const branch = model.branch(model.tab().root);
  for (let index = branch.length - 1; index >= 0; index--) {
    const node = branch[index]; if (!node) continue;
    if (node.kind === 'tile') { minimums.set(node.id, minimum(node)); continue; }
    const a = minimums.get(node.first), b = minimums.get(node.second); if (!a || !b) throw new Error('Invalid minimum geometry.');
    minimums.set(node.id, { width: node.axis === 'horizontal' ? a.width + b.width : Math.max(a.width, b.width), height: node.axis === 'vertical' ? a.height + b.height : Math.max(a.height, b.height) });
  }
  const rootMin = minimums.get(model.tab().root); if (!rootMin) throw new Error('Missing minimum.');
  width = Math.max(width, rootMin.width); height = Math.max(height, rootMin.height);
  rects.set(model.tab().root, { x: 0, y: 0, width, height });
  for (const node of branch) {
    if (node.kind !== 'split') continue;
    const rect = rects.get(node.id), a = minimums.get(node.first), b = minimums.get(node.second); if (!rect || !a || !b) throw new Error('Invalid geometry.');
    const ratio = preview?.id === node.id ? preview.ratio : node.ratio;
    const length = node.axis === 'horizontal' ? rect.width : rect.height;
    const first = Math.max(node.axis === 'horizontal' ? a.width : a.height, Math.min(length * ratio, length - (node.axis === 'horizontal' ? b.width : b.height)));
    if (node.axis === 'horizontal') { rects.set(node.first, { ...rect, width: first }); rects.set(node.second, { ...rect, x: rect.x + first, width: length - first }); }
    else { rects.set(node.first, { ...rect, height: first }); rects.set(node.second, { ...rect, y: rect.y + first, height: length - first }); }
  }
  return { rects, minimums, width, height };
}



