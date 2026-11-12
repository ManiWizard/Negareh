// Owns the extensible surface contract and the initial application surfaces.
import catalogue from './character-catalogue.json';
import { mountCharacter } from './character-sheet';
import type { CharacterChange } from './characters';
import { defaults, record } from './workspace-model';
import type { Timeline, Character } from './project';
import type { Json, Size, SurfaceState } from './workspace-model';
export interface ProjectAccess { read: () => { name: string; notes: string; timelines: Timeline[]; characters: Character[]; busy: boolean }; write: (field: string, value: string) => void; createTimeline: () => Timeline; renameTimeline: (id: string, name: string) => void; createCharacter: () => Character; changeCharacter: (id: string, change: CharacterChange) => Character }
export interface Option { id: string; name: string; description: string; modifier?: string }
export interface Tool { id: string; name: string; description: string; shortcut: string; icon: string; writes?: boolean; options?: Option[]; command?: SurfaceCommand; available?: (context: SurfaceContext) => boolean }
export interface ToolGroup { name: string; tools: Tool[] }
export interface SurfaceContext { state: SurfaceState; signal: AbortSignal; project: ProjectAccess; effective: (option: string) => boolean; view: (update: (view: SurfaceState['view']) => void) => void; local: (update: (data: { [key: string]: Json }) => void) => void }
export type SurfaceCommand = 'instances' | 'new-instance' | 'sharing' | 'reference.add-image' | 'reference.add-note';
export interface SurfaceHandle { command?: (command: SurfaceCommand, owner: HTMLButtonElement) => void; commit?: () => boolean; update: () => void; dispose: () => void }
export interface SurfaceDefinition {
  category?: string;
  id: string; name: string; icon: string; minimum: Size; modes: { id: string; name: string; writes: boolean; icon?: string }[]; viewControls: { id: string; name: string; description: string; icon: string; run: (context: SurfaceContext) => void }[]; groups: ToolGroup[];
  menus: { name: string; items: { id: string; name: string; run: (context: SurfaceContext) => void }[] }[];
  defaultState: () => SurfaceState;
  restore: (data: unknown) => { [key: string]: Json };
  serialize: (data: { [key: string]: Json }) => { [key: string]: Json };
  mount: (host: HTMLElement, context: SurfaceContext) => SurfaceHandle;
}
export const icons = { file: 'M4 2h5l3 3v9H4zM9 2v4h3', inspect: 'M10 10l4 4M7 2a5 5 0 1 0 0 10A5 5 0 0 0 7 2', pointer: 'M3 1v12l3-4 3 5 2-1-3-5h5z', pencil: 'm3 10 7-7 3 3-7 7-4 1zM9 4l3 3', split: 'M2 2h12v12H2zM8 2v12', more: 'M3 8h1m3 0h1m3 0h1' };
export function icon(path: string): SVGSVGElement { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true'); const element = document.createElementNS(svg.namespaceURI, 'path'); element.setAttribute('d', path); svg.append(element); return svg; }
export const defaultSurface = 'overview';
export const surfaces = new Map<string, SurfaceDefinition>();
export function registerSurface(definition: SurfaceDefinition): void {
  if (!/^[a-z][a-z0-9.-]{0,199}$/.test(definition.id) || surfaces.has(definition.id) || definition.minimum.width < 160 || definition.minimum.height < 100 || !definition.modes.length) throw new Error('Invalid or duplicate surface definition.');
  if (definition.groups.some(group => !group.tools.length)) throw new Error('Tool groups must contain tools.');
  const modes = definition.modes.map(mode => mode.id), items = [...definition.menus.flatMap(menu => menu.items.map(item => item.id)), ...definition.viewControls.map(control => control.id)];
  if (new Set(modes).size !== modes.length || new Set(items).size !== items.length) throw new Error('Duplicate surface modes or contextual commands.');
  const tools = definition.groups.flatMap(group => group.tools);
  if (new Set(tools.map(tool => tool.id)).size !== tools.length) throw new Error('Duplicate surface tools.');
  surfaces.set(definition.id, definition);
}
export function toolsFor(definition: SurfaceDefinition): Tool[] { return definition.groups.flatMap(group => group.tools); }
export function newSurface(type: string): SurfaceState { return surfaces.get(type)?.defaultState() ?? defaults(type); }
function characterName(character: Character): string { return [character.name, character.middleName, character.familyName].filter(Boolean).join(' '); }
function characterListItem(character: Character): HTMLLIElement {
  const item = document.createElement('li');
  if (character.portrait) { const image = document.createElement('img'); image.src = character.portrait; image.alt = `${characterName(character)} portrait`; item.append(image); }
  const name = document.createElement('span'); name.textContent = characterName(character); item.append(name); return item;
}
function mountOverview(host: HTMLElement, context: SurfaceContext): SurfaceHandle {
  const section = document.createElement('section'); section.className = 'application-surface overview-surface'; section.dataset.surface = 'overview';
  const heading = document.createElement('h1'); heading.textContent = 'Overview'; section.append(heading); host.append(section);
  const lists = new Map<string, HTMLUListElement>();
  for (const title of ['Timelines', 'Characters']) {
    const group = document.createElement('section'), label = document.createElement('h2'), list = document.createElement('ul'); label.textContent = title; list.className = 'overview-list'; list.setAttribute('aria-label', title); group.append(label, list); section.append(group); lists.set(title, list);
  }
  let signature = '';
  const update = (): void => {
    const project = context.project.read(), next = JSON.stringify([project.timelines, project.characters]); if (signature === next) return; signature = next;
    for (const [title, list] of lists) {
      list.replaceChildren();
      if (title === 'Timelines') for (const timeline of project.timelines) { const item = document.createElement('li'); item.textContent = timeline.name; list.append(item); }
      else for (const character of project.characters) list.append(characterListItem(character));
      if (!list.children.length) { const item = document.createElement('li'); item.className = 'surface-info'; item.textContent = `No ${title.toLowerCase()} yet.`; list.append(item); }
    }
  };
  update(); return { update, dispose: () => { section.remove(); } };
}

function timelineData(data: unknown): { [key: string]: Json } {
  if (!record(data)) return {};
  const result: { [key: string]: Json } = {};
  if (typeof data.timeline === 'string') result.timeline = data.timeline;
  for (const key of ['panX', 'panY']) if (typeof data[key] === 'number' && Number.isFinite(data[key]) && Math.abs(data[key]) <= 100_000_000) result[key] = data[key];
  return result;
}
function mountTimeline(host: HTMLElement, context: SurfaceContext): SurfaceHandle {
  const section = document.createElement('section'); section.className = 'application-surface'; section.dataset.surface = 'timeline'; section.setAttribute('aria-label', 'Timeline'); host.append(section);
  const overlay = document.createElement('div'); overlay.className = 'timeline-panel-overlay'; overlay.dataset.open = 'false';
  const panel = document.createElement('aside'); panel.className = 'timeline-side-panel'; panel.id = `timeline-panel-${crypto.randomUUID()}`; panel.setAttribute('aria-label', 'Timeline panel'); panel.inert = true;
  const edgeArrow = document.createElement('button'); edgeArrow.type = 'button'; edgeArrow.className = 'timeline-edge-arrow'; edgeArrow.setAttribute('aria-controls', panel.id); edgeArrow.setAttribute('aria-expanded', 'false'); edgeArrow.setAttribute('aria-label', 'Open timeline panel'); edgeArrow.title = 'Open timeline panel'; edgeArrow.append(icon('M15 8H2m5-5L2 8l5 5'));
  overlay.append(edgeArrow, panel); section.append(overlay);
  const togglePanel = (open: boolean, instant = false): void => { const label = open ? 'Close timeline panel' : 'Open timeline panel'; overlay.dataset.instant = String(instant); overlay.dataset.open = String(open); panel.inert = !open; edgeArrow.setAttribute('aria-expanded', String(open)); edgeArrow.setAttribute('aria-label', label); edgeArrow.title = label; };
  edgeArrow.addEventListener('click', event => { togglePanel(overlay.dataset.open !== 'true', event.detail === 0); }, { signal: context.signal });
  let drag: { pointer: number; startX: number; startY: number; x: number; y: number; currentX: number; currentY: number } | null = null;
  let suppressMenu = false;
  const offset = (key: string): number => typeof context.state.data[key] === 'number' ? context.state.data[key] : 0;
  const zoom = (): number => Math.max(.25, Math.min(2, context.state.view.zoom));
  const paint = (x: number, y: number): void => {
    host.style.setProperty('--timeline-pan-x', `${String(x)}px`); host.style.setProperty('--timeline-pan-y', `${String(y)}px`);
    host.style.setProperty('--timeline-grid-size', `${String(128 * zoom())}px`); host.style.setProperty('--timeline-grid-half', `${String(64 * zoom())}px`);
  };
  const finish = (commit: boolean): void => {
    const previous = drag; if (!previous) return; drag = null; delete host.dataset.panning;
    if (host.hasPointerCapture(previous.pointer)) host.releasePointerCapture(previous.pointer);
    if (commit && (previous.x !== previous.currentX || previous.y !== previous.currentY)) context.local(data => { data.panX = previous.currentX; data.panY = previous.currentY; });
    paint(offset('panX'), offset('panY'));
  };
  host.addEventListener('pointerdown', event => {
    if (event.button === 2 && drag) { event.preventDefault(); suppressMenu = true; finish(false); return; }
    if (event.button !== 1 || drag || context.project.read().busy || (event.target instanceof Element && overlay.contains(event.target))) return;
    event.preventDefault(); host.setPointerCapture(event.pointerId);
    const x = offset('panX'), y = offset('panY'); drag = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x, y, currentX: x, currentY: y }; host.dataset.panning = 'true';
  }, { signal: context.signal });
  host.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    drag.currentX = Math.max(-100_000_000, Math.min(100_000_000, drag.x + event.clientX - drag.startX));
    drag.currentY = Math.max(-100_000_000, Math.min(100_000_000, drag.y + event.clientY - drag.startY)); paint(drag.currentX, drag.currentY);
  }, { signal: context.signal });
  host.addEventListener('pointerup', event => { if (event.button === 1 && drag?.pointer === event.pointerId) finish(true); }, { signal: context.signal });
  host.addEventListener('pointercancel', () => { finish(false); }, { signal: context.signal });
  host.addEventListener('lostpointercapture', () => { finish(false); }, { signal: context.signal });
  host.addEventListener('contextmenu', event => { if (suppressMenu || drag) { event.preventDefault(); event.stopPropagation(); suppressMenu = false; finish(false); } }, { signal: context.signal });
  host.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); }, { signal: context.signal });
  host.addEventListener('wheel', event => {
    if (context.project.read().busy || (event.target instanceof Element && overlay.contains(event.target))) return;
    event.preventDefault(); if (drag) return;
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? horizontal ? host.clientWidth : host.clientHeight : 1;
    if (horizontal) { context.local(data => { data.panX = Math.max(-100_000_000, Math.min(100_000_000, offset('panX') - event.deltaX * unit)); }); return; }
    if (!event.deltaY) return;
    const previous = zoom(), next = Math.max(.25, Math.min(2, previous * Math.exp(-event.deltaY * unit * .002)));
    if (next === previous) return;
    const rect = host.getBoundingClientRect(), x = event.clientX - rect.left - host.clientWidth / 2, y = event.clientY - rect.top - host.clientHeight / 2;
    context.local(data => { data.panX = Math.max(-100_000_000, Math.min(100_000_000, x - (x - offset('panX')) * next / previous)); data.panY = Math.max(-100_000_000, Math.min(100_000_000, y - (y - offset('panY')) * next / previous)); });
    context.view(view => { view.zoom = next; });
  }, { signal: context.signal, passive: false });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (drag) { event.preventDefault(); finish(false); }
    else if (overlay.dataset.open === 'true') { event.preventDefault(); togglePanel(false, true); edgeArrow.focus({ preventScroll: true }); }
  }, { signal: context.signal });
  window.addEventListener('blur', () => { finish(false); }, { signal: context.signal });
  const update = (): void => { if (context.project.read().busy) finish(false); if (!drag) paint(offset('panX'), offset('panY')); };
  update(); return { update, dispose: () => { finish(false); section.remove(); for (const name of ['--timeline-pan-x', '--timeline-pan-y', '--timeline-grid-size', '--timeline-grid-half']) host.style.removeProperty(name); } };
}
for (const [id, name] of [['overview', 'Overview'], ['timeline', 'Timeline'], ['world', 'World'], ['character', 'Character'], ['page-designer', 'Page Designer'], ['species-designer', 'Species Designer']] as const) registerSurface({
  id, name, icon: icons.file, minimum: { width: 240, height: 180 },
  modes: id === 'character' ? [{ id: 'read', name: 'Read', writes: false }, { id: 'edit', name: 'Edit', writes: true }] : [{ id: 'read', name: 'Read', writes: false }], viewControls: [], groups: id === 'character' ? [{ name: 'Selection', tools: [
    { id: 'reference.select', name: 'Select', description: 'Select and move references; drag a pin to rotate', shortcut: 'V', icon: 'M3 1v13l4-4 3 5 2-1-3-5h5Z', writes: false, available: context => context.state.data.category === 'references' && context.project.read().characters.some(character => character.id === context.state.data.character) },
  ] }, { name: 'Connections', tools: [
    { id: 'reference.connect', name: 'Connect', description: 'Click a pin, then another pin to connect references; Escape cancels', shortcut: 'C', icon: 'M5 5 11 11M5 1a4 4 0 1 0 0 8 4 4 0 0 0 0-8M11 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8', writes: true, available: context => context.state.mode === 'edit' && context.state.data.category === 'references' && context.project.read().characters.some(character => character.id === context.state.data.character) },
  ] }, { name: 'Images', tools: [
    { id: 'reference.add-image', name: 'Add images', description: 'Import images onto the reference canvas', shortcut: 'I', icon: 'M2 2h12v12H2zM3 12l4-5 3 3 3-4M10 5h.01', writes: true, command: 'reference.add-image', available: context => context.state.mode === 'edit' && context.state.data.category === 'references' && context.project.read().characters.some(character => character.id === context.state.data.character) },
  ] }, { name: 'Notes', tools: [
    { id: 'reference.add-note', name: 'Add note', description: 'Pin a note to the reference canvas', shortcut: 'N', icon: 'M3 1h10v10l-4 4H3ZM9 15v-4h4M5 5h6M5 8h4', writes: true, command: 'reference.add-note', available: context => context.state.mode === 'edit' && context.state.data.category === 'references' && context.project.read().characters.some(character => character.id === context.state.data.character) },
  ] }] : [], menus: id === 'character' ? [{ name: 'View', items: [
    { id: 'categories.horizontal', name: 'Horizontal categories', run: context => { context.local(data => { data.categoryLayout = 'horizontal'; }); } },
    { id: 'categories.vertical', name: 'Vertical categories', run: context => { context.local(data => { data.categoryLayout = 'vertical'; }); } },
    { id: 'categories.expand', name: 'Expand all categories', run: context => { context.local(data => { data.collapsed = []; }); } },
    { id: 'categories.collapse', name: 'Collapse all categories', run: context => { context.local(data => { data.collapsed = catalogue.map(category => category.id); }); } },
    { id: 'sheet.reset', name: 'Reset sheet view', run: context => { context.local(data => { data.collapsed = []; data.category = 'overview'; data.categoryLayout = 'horizontal'; }); context.view(view => { view.zoom = 1; }); } },
  ] }] : [],
  defaultState: () => { const state = defaults(id); if (id === 'character') { state.mode = 'edit'; state.tool = 'reference.select'; } return state; }, restore: data => id === 'timeline' ? timelineData(data) : id === 'character' && record(data) ? { character: typeof data.character === 'string' ? data.character : '', instance: typeof data.instance === 'string' ? data.instance : '', category: typeof data.category === 'string' && ['overview', 'identity', 'references', ...catalogue.map(category => category.id)].includes(data.category) ? data.category : 'overview', categoryLayout: data.categoryLayout === 'vertical' ? 'vertical' : 'horizontal', overviewField: typeof data.overviewField === 'string' && data.overviewField.length < 100 ? data.overviewField : 'roleSummary', referenceZoom: typeof data.referenceZoom === 'number' && Number.isFinite(data.referenceZoom) ? Math.max(.25, Math.min(2, data.referenceZoom)) : 1.5, overviewConnection: typeof data.overviewConnection === 'string' && data.overviewConnection.length <= 80 ? data.overviewConnection : '', collapsed: Array.isArray(data.collapsed) ? data.collapsed.filter((value): value is string => typeof value === 'string' && catalogue.some(category => category.id === value)) : [] } : {}, serialize: data => data,
  mount: (host, context) => {
    if (id === 'timeline') return mountTimeline(host, context);
    if (id === 'overview') return mountOverview(host, context);
    if (id === 'character') return mountCharacter(host, context);
    const section = document.createElement('section'); section.className = 'application-surface'; section.dataset.surface = id; section.setAttribute('aria-label', name);
    const heading = document.createElement('h1'), info = document.createElement('p'); heading.textContent = name; info.className = 'surface-info';
    info.textContent = id === 'world' ? 'Worldbuilding, locations, and lore notes are coming in a future release. Use Overview, Timeline, and Character to develop your story in v0.1.' : id === 'page-designer' ? 'Page layouts, panel gutters, and lettering tools are coming in a future release.' : 'Species and ancestry templates are coming in a future release. Character Species and Race fields will connect here automatically.';
    section.append(heading, info); host.append(section);
    return { update: () => undefined, dispose: () => { section.remove(); } };
  },
});
