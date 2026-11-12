// Owns retained tile views, scoped input, deck/rail controls and cancellable geometry gestures.
import { WorkspaceModel, geometry, adjacent, union, groupColors } from './workspace-model';
import type { Axis, Geometry, Rect, SurfaceState, Tile, Workspace, TabGroup } from './workspace-model';
import { defaultSurface, icon, icons, newSurface, surfaces, toolsFor } from './surfaces';
import type { ProjectAccess, SurfaceContext, SurfaceDefinition, SurfaceHandle, Tool } from './surfaces';
import { characterInstance, instanceValues } from './characters';
function characterInstanceName(button: HTMLButtonElement, name: string, instance: string): void {
  button.classList.add('character-instance-selector');
  let title = button.querySelector('span'), label = button.querySelector('small');
  if (!title || !label) { title = document.createElement('span'); label = document.createElement('small'); button.replaceChildren(title, label); }
  title.textContent = name; label.textContent = instance; label.title = `Active character instance: ${instance} (click to switch or manage instances)`;
}
function characterPortrait(button: HTMLButtonElement, portrait: string): void {
  if (!portrait) { if (button.querySelector('img')) button.replaceChildren(icon('M2 3h2m3 0h7M2 8h2m3 0h7M2 13h2m3 0h7')); return; }
  let image = button.querySelector('img');
  if (!image) { image = document.createElement('img'); image.alt = ''; image.width = image.height = 20; button.replaceChildren(image); }
  if (image.getAttribute('src') !== portrait) image.src = portrait;
}
export interface WorkspaceRequest { action: string; target?: string | undefined; other?: string | undefined; value?: string | undefined; axis?: string | undefined; ratio?: number | undefined; index?: number | undefined; width?: number | undefined; enabled?: boolean | undefined; field?: string | undefined }
interface TileView { element: HTMLElement; deck: HTMLElement; rail: HTMLElement; body: HTMLElement; type: string; state: SurfaceState; definition: SurfaceDefinition | undefined; context: SurfaceContext; handle: SurfaceHandle; scope: AbortController; signature: string; railMetrics: { compact: number; grid: number; expanded: number }; railGrip: HTMLElement }
type Preview = { kind: 'split'; tile: string; axis: Axis; ratio: number } | { kind: 'join'; survivor: string; removed: string } | { kind: 'resize'; node: string; ratio: number } | { kind: 'rail'; tile: string; width: number };
interface Gesture { kind: 'corner' | 'divider' | 'rail'; id: string; pointer: number; owner: HTMLElement; x: number; y: number; currentX: number; currentY: number; shift: boolean; alt: boolean; moved: boolean; rect: Rect; startWidth: number }
export function createWorkspace(host: HTMLElement, tabsHost: HTMLElement, template: HTMLTemplateElement, project: ProjectAccess, changed: () => void, report: (error: unknown) => void, signal: AbortSignal) {
  const model = new WorkspaceModel(newSurface, defaultSurface, 'Overview');
  const views = new Map<string, TileView>(), tabViews = new Map<string, HTMLElement>(), tabButtons = new Map<string, HTMLElement>(), dividers = new Map<string, HTMLElement>();
  const corners = new Map<string, { element: HTMLButtonElement; tiles: string[] }>();
  const canvas = document.createElement('div'); canvas.className = 'workspace-canvas'; host.append(canvas); host.classList.add('workspace-host');
  const overlay = document.createElement('div'); overlay.className = 'layout-preview'; overlay.hidden = true; canvas.append(overlay);
  const splitGhosts = [document.createElement('div'), document.createElement('div')];
  for (const ghost of splitGhosts) { ghost.className = 'split-ghost'; ghost.setAttribute('aria-hidden', 'true'); }
  const popup = document.createElement('div'); popup.className = 'menu workspace-menu'; popup.popover = 'auto'; popup.setAttribute('role', 'menu'); popup.tabIndex = -1; document.body.append(popup);
  let popupOwner: HTMLElement | null = null;
  const hoverCard = document.createElement('div'); hoverCard.className = 'tab-preview'; hoverCard.popover = 'manual'; document.body.append(hoverCard);
  let hoverTimer: number | undefined;
  const hidePreview = (): void => { clearTimeout(hoverTimer); if (hoverCard.matches(':popover-open')) hoverCard.hidePopover(); };
  tabsHost.addEventListener('pointerover', event => {
    if (!(event.target instanceof Element)) return; const owner = event.target.closest<HTMLElement>('[role="tab"]'); if (!owner || owner.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) return;
    hidePreview(); if (owner.id === model.activeTab) return; hoverTimer = globalThis.setTimeout(() => {
      if (popup.matches(':popover-open') || signal.aborted || owner.id === model.activeTab) return; const tab = model.tabs.find(tab => tab.id === owner.id); if (!tab) return;
      hoverCard.replaceChildren(); const heading = document.createElement('div'); heading.textContent = tab.name; hoverCard.append(heading);
      const source = tabViews.get(tab.id); if (source) {
        const frame = document.createElement('div'); frame.className = 'tab-preview-frame'; const clone = source.cloneNode(true); if (clone instanceof HTMLElement) {
          clone.hidden = false; clone.inert = true; clone.removeAttribute('id'); for (const element of clone.querySelectorAll('[id]')) element.removeAttribute('id');
          clone.style.width = `${String(metrics.width)}px`; clone.style.height = `${String(metrics.height)}px`; clone.style.transform = `scale(${String(250 / Math.max(1, metrics.width))})`; frame.append(clone);
        } hoverCard.append(frame);
      }
      const rect = owner.getBoundingClientRect(); hoverCard.style.left = `${String(Math.max(8, Math.min(rect.left, window.innerWidth - 270)))}px`; hoverCard.style.top = `${String(rect.bottom + 6)}px`; hoverCard.showPopover();
    }, 500);
  }, { signal });
  tabsHost.addEventListener('pointerout', event => { if (event.target instanceof Element && event.target.closest('[role="tab"]') && !(event.relatedTarget instanceof Element && event.relatedTarget.closest('[role="tab"]') === event.target.closest('[role="tab"]'))) hidePreview(); }, { signal });
  tabsHost.addEventListener('pointerdown', hidePreview, { signal });
  signal.addEventListener('abort', () => { hidePreview(); hoverCard.remove(); }, { once: true });
  const positions = new WeakMap<HTMLElement, Rect>();
  const held = new Set<string>(); let gesture: Gesture | null = null, preview: Preview | null = null, frame = 0, lastFocus = '', mounted = 0, disposed = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let groupMotion: { id: string; collapsed: boolean; animations: Animation[] } | null = null;
  function cancelGroupMotion(): void { const motion = groupMotion; groupMotion = null; for (const animation of motion?.animations ?? []) animation.cancel(); }
  function toggleGroup(owner: HTMLElement, group: TabGroup): void {
    const collapsed = groupMotion?.id === group.id ? !groupMotion.collapsed : !group.collapsed;
    cancelGroupMotion();
    if (reducedMotion.matches) { model.updateGroup(group.id, { collapsed }); return; }
    const motion = { id: group.id, collapsed, animations: [] as Animation[] }; groupMotion = motion;
    const before = new Map([...tabButtons.values()].map(element => [element, element.getBoundingClientRect()]));
    const origin = owner.getBoundingClientRect().right;
    const animate = (element: HTMLElement, frames: Keyframe[]): void => { motion.animations.push(element.animate(frames, { duration: 160, easing: 'cubic-bezier(.23, 1, .32, 1)' })); };
    const moveNeighbors = (): void => { for (const [element, rect] of before) { if (element.hidden || rect.width === 0) continue; const next = element.getBoundingClientRect(); if (Math.abs(rect.left - next.left) > .5) animate(element, [{ transform: `translateX(${String(rect.left - next.left)}px)` }, { transform: 'translateX(0)' }]); } };
    if (collapsed) {
      for (const element of model.tabs.filter(tab => tab.group?.id === group.id).flatMap(tab => { const element = tabButtons.get(tab.id); return element ? [element] : []; })) { animate(element, [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${String(origin - element.getBoundingClientRect().left)}px) scaleX(.8)`, opacity: 0 }]); }
      void Promise.allSettled(motion.animations.map(animation => animation.finished)).then(() => {
        if (groupMotion !== motion || signal.aborted) return;
        model.updateGroup(group.id, { collapsed: true }); moveNeighbors();
        void Promise.allSettled(motion.animations.map(animation => animation.finished)).then(() => { if (groupMotion === motion) groupMotion = null; }).catch(report);
      }).catch(report);
    } else {
      model.updateGroup(group.id, { collapsed: false }); moveNeighbors();
      for (const element of model.tabs.filter(tab => tab.group?.id === group.id).flatMap(tab => { const element = tabButtons.get(tab.id); return element ? [element] : []; })) { animate(element, [{ transform: `translateX(${String(origin - element.getBoundingClientRect().left)}px) scaleX(.8)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }]); }
      void Promise.allSettled(motion.animations.map(animation => animation.finished)).then(() => { if (groupMotion === motion) groupMotion = null; }).catch(report);
    }
  }
  signal.addEventListener('abort', cancelGroupMotion, { once: true });
  let lastTab: string | null = null, scrollTimer: number | undefined;
  let restoreScroll: { x: number; y: number } | null = null;
  let metrics: Geometry = { rects: new Map(), minimums: new Map(), width: 0, height: 0 };
  const activeState = (tile: Tile): SurfaceState => { const state = tile.states.find(state => state.type === tile.type); if (!state) throw new Error('Missing surface instance.'); return state; };
  function request(action: string, options: Omit<WorkspaceRequest, 'action'> = {}): void { try { execute({ action, ...options }); } catch (error) { report(error); } }
  function optionEffective(tile: Tile, option: string): boolean {
    const state = activeState(tile); const tool = surfaces.get(tile.type)?.groups.flatMap(group => group.tools).find(tool => tool.id === state.tool);
    const definition = tool?.options?.find(entry => entry.id === option);
    return state.toggles.includes(option) || (model.activeTab !== null && model.tab().activeTile === tile.id && definition?.modifier !== undefined && held.has(definition.modifier));
  }
  function railWidth(view: TileView, width = preview?.kind === 'rail' && preview.tile === view.element.dataset.tile ? preview.width : view.state.rail.width): number {
    if (!view.definition?.groups.length || !view.state.rail.visible) return 0;
    const available = metrics.rects.get(view.element.dataset.tile ?? '')?.width;
    if (available !== undefined) width = Math.min(width, Math.max(view.railMetrics.compact, available - 160));
    if (available !== undefined && available - 160 < view.railMetrics.grid) return view.railMetrics.compact;
    if (width <= (view.railMetrics.compact + view.railMetrics.grid) / 2) return view.railMetrics.compact;
    if (width <= view.railMetrics.expanded) return view.railMetrics.grid;
    return Math.max(view.railMetrics.expanded + 1, width);
  }
  function minimum(): { width: number; height: number } { return { width: 240, height: 180 }; }
  function measure(): Geometry { metrics = geometry(model, host.clientWidth, host.clientHeight, minimum, preview?.kind === 'resize' ? { id: preview.node, ratio: preview.ratio } : undefined); return metrics; }
  function position(element: HTMLElement, rect: Rect): void { const previous = positions.get(element); if (previous && previous.x === rect.x && previous.y === rect.y && previous.width === rect.width && previous.height === rect.height) return; positions.set(element, rect); element.style.left = `${String(rect.x)}px`; element.style.top = `${String(rect.y)}px`; element.style.width = `${String(rect.width)}px`; element.style.height = `${String(rect.height)}px`; }
  function surfaceRect(rect: Rect): Rect {
    const left = rect.x > 0 ? 1.5 : 3, top = rect.y > 0 ? 1.5 : 3, right = rect.x + rect.width < metrics.width ? 1.5 : 3, bottom = rect.y + rect.height < metrics.height ? 1.5 : 3;
    return { x: rect.x + left, y: rect.y + top, width: rect.width - left - right, height: rect.height - top - bottom };
  }
  function paint(): void {
    frame = 0; measure(); canvas.style.width = `${String(metrics.width)}px`; canvas.style.height = `${String(metrics.height)}px`;
    if (!model.activeTab) { syncCorners(); overlay.hidden = true; return; }
    for (const node of model.branch(model.tab().root)) {
      const rect = metrics.rects.get(node.id); if (!rect) continue;
      if (node.kind === 'tile') { const view = views.get(node.id); if (view) { position(view.element, surfaceRect(rect)); updateRail(view); } continue; }
      const divider = dividers.get(node.id), first = metrics.rects.get(node.first); if (!divider || !first) continue;
      position(divider, node.axis === 'horizontal' ? { x: first.x + first.width - 4, y: rect.y, width: 8, height: rect.height } : { x: rect.x, y: first.y + first.height - 4, width: rect.width, height: 8 });
      divider.setAttribute('aria-valuenow', String(Math.round(node.ratio * 100)));
    }
    syncCorners(); paintPreview();
    if (restoreScroll) { host.scrollLeft = restoreScroll.x; host.scrollTop = restoreScroll.y; restoreScroll = null; }
  }
  function schedule(): void { if (!frame && !signal.aborted) frame = requestAnimationFrame(paint); }
  function syncCorners(): void {
    const points = new Map<string, { x: number; y: number; tiles: string[] }>();
    const tiles = model.activeTab ? model.branch(model.tab().root).filter((node): node is Tile => node.kind === 'tile') : [];
    for (const tile of tiles) {
      const rect = metrics.rects.get(tile.id); if (!rect) continue;
      for (const x of [rect.x, rect.x + rect.width]) for (const y of [rect.y, rect.y + rect.height]) {
        const key = `${x.toFixed(2)},${y.toFixed(2)}`, point = points.get(key) ?? { x, y, tiles: [] }; point.tiles.push(tile.id); points.set(key, point);
      }
    }
    for (const [key, corner] of corners) if (!points.has(key)) { corner.element.remove(); corners.delete(key); }
    for (const [key, point] of points) {
      let corner = corners.get(key);
      if (!corner) {
        const element = document.createElement('button'); element.className = 'workspace-corner'; element.dataset.corner = key;
        element.setAttribute('aria-label', 'Drag to split or join at shared corner'); element.title = 'Drag into a surface to split; Shift-drag to join; right-click for surface options';
        canvas.append(element); corner = { element, tiles: [] }; corners.set(key, corner);
      }
      corner.tiles = tiles.filter(tile => { const rect = metrics.rects.get(tile.id); return rect && point.x >= rect.x - .01 && point.x <= rect.x + rect.width + .01 && point.y >= rect.y - .01 && point.y <= rect.y + rect.height + .01; }).map(tile => tile.id);
      const left = Math.max(0, Math.min(metrics.width - 16, point.x - 8)), top = Math.max(0, Math.min(metrics.height - 16, point.y - 8));
      position(corner.element, { x: left, y: top, width: 16, height: 16 });
      const x = point.x - left, y = point.y - top;
      const path = point.tiles.map(key => { const rect = metrics.rects.get(key); if (!rect) return ''; const dx = Math.abs(point.x - rect.x) < .01 ? 8 : -8, dy = Math.abs(point.y - rect.y) < .01 ? 8 : -8; return `M ${String(x)} ${String(y)} l ${String(dx)} 0 l ${String(-dx)} ${String(dy)} Z`; }).join(' ');
      corner.element.style.clipPath = `path('${path}')`;
    }
  }
  function paintPreview(): void {
    overlay.hidden = true; if (!preview) return;
    if (preview.kind === 'split') {
      const rect = metrics.rects.get(preview.tile); if (!rect) return;
      position(overlay, rect);
      const first = { ...rect }, second = { ...rect };
      if (preview.axis === 'horizontal') { first.width *= preview.ratio; second.x += first.width; second.width -= first.width; }
      else { first.height *= preview.ratio; second.y += first.height; second.height -= first.height; }
      if (overlay.firstChild !== splitGhosts[0]) overlay.replaceChildren(...splitGhosts);
      for (const [index, region] of [first, second].entries()) { const ghost = splitGhosts[index]; if (!ghost) continue; const painted = surfaceRect(region); position(ghost, { ...painted, x: painted.x - rect.x, y: painted.y - rect.y }); }
      overlay.dataset.kind = 'split'; overlay.hidden = false;
    } else if (preview.kind === 'join') {
      const a = metrics.rects.get(preview.survivor), b = metrics.rects.get(preview.removed); if (!a || !b) return;
      position(overlay, union(a, b)); overlay.textContent = 'Join · keep starting surface · Alt swaps survivor'; overlay.dataset.kind = 'join'; overlay.hidden = false;
    }
  }
  function popupAt(owner: HTMLElement, entries: { name: string; run: () => void; disabled?: boolean; icon?: string; selected?: boolean; category?: string | undefined; separator?: boolean }[], columns = false, label = columns ? 'Surface types' : 'Workspace actions'): void {
    if (popup.matches(':popover-open')) popup.hidePopover();
    if (popupOwner?.hasAttribute('aria-expanded')) popupOwner.setAttribute('aria-expanded', 'false');
    popup.replaceChildren(); popupOwner = owner; popup.id = label === 'Surface options' ? 'surface-options-menu' : ''; popup.classList.toggle('surface-picker', columns); popup.classList.toggle('deck-menu', owner.classList.contains('deck-dropdown')); popup.setAttribute('aria-label', label);
    const groups = new Map<string, HTMLElement>();
    for (const entry of entries) {
      if (entry.separator) popup.append(document.createElement('hr'));
      const control = document.createElement('button'); control.textContent = entry.name; control.setAttribute('role', entry.selected === undefined ? 'menuitem' : 'menuitemradio'); control.disabled = entry.disabled ?? false;
      if (entry.icon) control.prepend(icon(entry.icon));
      if (entry.selected !== undefined) control.setAttribute('aria-checked', String(entry.selected));
      control.addEventListener('click', () => { popup.hidePopover(); owner.focus({ preventScroll: true }); entry.run(); }, { once: true });
      if (!columns) { popup.append(control); continue; }
      const category = entry.category ?? 'General'; let group = groups.get(category);
      if (!group) { group = document.createElement('section'); group.className = 'surface-picker-column'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', category); const heading = document.createElement('h2'); heading.textContent = category; group.append(heading); groups.set(category, group); popup.append(group); }
      group.append(control);
    }
    const rect = owner.getBoundingClientRect(); popup.showPopover(); const bounds = popup.getBoundingClientRect();
    popup.style.left = `${String(Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8)))}px`; popup.style.top = `${String(Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - bounds.height - 8)))}px`;
    if (owner.hasAttribute('aria-expanded')) owner.setAttribute('aria-expanded', 'true');
    (popup.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)') ?? popup.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
  }
  function button(label: string, description: string, action: () => void, path?: string): HTMLButtonElement {
    const element = document.createElement('button'); element.type = 'button'; element.title = description; element.setAttribute('aria-label', label);
    if (path) element.append(icon(path)); else element.textContent = label;
    element.addEventListener('click', action); return element;
  }
  function dropdown(label: string, description: string, open: (owner: HTMLButtonElement) => void, path?: string, text?: string): HTMLButtonElement {
    const trigger = button(label, description, () => { if (popupOwner === trigger && popup.matches(':popover-open')) { popup.hidePopover(); return; } open(trigger); }, path);
    trigger.className = 'deck-dropdown';
    if (text !== undefined) { const name = document.createElement('span'); name.textContent = text; trigger.append(name); }
    const caret = icon('m5 6 3 3 3-3'); caret.classList.add('picker-caret'); trigger.append(caret);
    trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false'); trigger.popoverTargetElement = popup;
    trigger.addEventListener('click', event => { event.preventDefault(); }); return trigger;
  }
  function layoutMenu(key: string, owner: HTMLElement): void {
    surfaceMenu([key], key, owner, true);
  }
  function surfaceMenu(tiles: string[], key: string, owner: HTMLElement, corner: boolean, point?: { x: number; y: number }): void {
    measure(); const rect = metrics.rects.get(key); if (!rect) return;
    const entries: { name: string; run: () => void; disabled?: boolean; separator?: boolean }[] = [
      { name: 'Split vertically', run: () => { request('layout.split', { target: key, axis: 'horizontal' }); }, disabled: rect.width < minimum().width * 2 },
      { name: 'Split horizontally', run: () => { request('layout.split', { target: key, axis: 'vertical' }); }, disabled: rect.height < minimum().height * 2 },
    ];
    if (tiles.length === 2) {
      const ordered = tiles.map(id => ({ id, rect: metrics.rects.get(id) })).filter((item): item is { id: string; rect: Rect } => Boolean(item.rect));
      const a = ordered[0], b = ordered[1]; if (!a || !b) return;
      const horizontal = Math.abs(a.rect.x - b.rect.x) > .01;
      ordered.sort((a, b) => horizontal ? a.rect.x - b.rect.x : a.rect.y - b.rect.y);
      const first = ordered[0], second = ordered[1]; if (!first || !second) return;
      const disabled = !compatible(first.id, second.id);
      entries.push(
        { name: horizontal ? 'Join right' : 'Join down', separator: true, disabled, run: () => { request('layout.join', { target: first.id, other: second.id }); } },
        { name: horizontal ? 'Join left' : 'Join up', disabled, run: () => { request('layout.join', { target: second.id, other: first.id }); } },
      );
      if (!corner) entries.push({ name: 'Swap areas', separator: true, run: () => { request('layout.swap', { target: first.id, other: second.id }); } });
    }
    popupAt(owner, entries, false, 'Surface options');
    const title = document.createElement('div'); title.className = 'menu-title'; title.textContent = 'Surface options'; popup.prepend(title);
    if (tiles.length === 2) { const heading = document.createElement('div'); heading.className = 'menu-title'; heading.textContent = 'Join'; popup.querySelector('hr')?.after(heading); }
    title.after(document.createElement('hr'));
    if (point) { const bounds = popup.getBoundingClientRect(); popup.style.left = `${String(Math.max(8, Math.min(point.x, window.innerWidth - bounds.width - 8)))}px`; popup.style.top = `${String(Math.max(8, Math.min(point.y, window.innerHeight - bounds.height - 8)))}px`; }
  }
  function buildDeck(key: string, view: TileView): void {
    const focused = view.deck.contains(document.activeElement) ? document.activeElement?.getAttribute('aria-label') : null;
    const state = view.state, definition = view.definition; view.deck.replaceChildren(); view.deck.dataset.opacity = state.view.deck; view.deck.dataset.surface = view.type;
    const left = document.createElement('div'); left.className = 'deck-left'; const center = document.createElement('div'); center.className = 'deck-center'; const right = document.createElement('div'); right.className = 'deck-right';
    const type = dropdown('Surface type', `Change surface: ${definition?.name ?? view.type}`, owner => {
      const entries = [...surfaces.values()].map(surface => ({ name: surface.name, icon: surface.icon, category: surface.category, selected: surface.id === view.type, run: () => { request('surface.switch', { target: key, value: surface.id }); views.get(key)?.deck.querySelector<HTMLButtonElement>('.surface-changer')?.focus({ preventScroll: true }); } }));
      if (!definition) entries.unshift({ name: `Unavailable: ${view.type}`, icon: icons.file, category: undefined, selected: true, run: () => undefined });
      popupAt(owner, entries, true);
    }, definition?.icon ?? icons.file);
    type.classList.add('surface-changer'); type.dataset.surfaceType = view.type; left.append(type);
    if (definition && definition.modes.length > 1) {
      const current = definition.modes.find(mode => mode.id === state.mode);
      const modeIcon = (mode: { writes: boolean; icon?: string }): string => mode.icon ?? (mode.writes ? icons.pencil : icons.inspect);
      const mode = dropdown('Surface mode', `Change mode: ${current?.name ?? state.mode}`, owner => {
        popupAt(owner, definition.modes.map(mode => ({ name: mode.name, icon: modeIcon(mode), selected: mode.id === state.mode, run: () => { if (view.handle.commit?.() !== false) request('surface.mode', { target: key, value: mode.id }); } })), false, 'Surface modes');
      }, current ? modeIcon(current) : icons.inspect, current?.name ?? state.mode);
      mode.dataset.surfaceMode = state.mode; left.append(mode);
    }
    if (definition?.menus.length) {
      const surfaceMenu = dropdown('Surface menu', 'Surface view and layout options', owner => {
        popupAt(owner, definition.menus.flatMap(menu => menu.items.map((item, index) => ({ name: item.name, separator: index === 0, run: () => { if (view.handle.commit?.() !== false) request('surface.action', { target: key, value: item.id }); } }))), false, 'Surface menu');
        for (const [index, heading] of [...popup.querySelectorAll('hr')].entries()) { const label = document.createElement('div'); label.className = 'menu-title'; label.textContent = definition.menus[index]?.name ?? ''; heading.after(label); }
      }, icons.more); left.append(surfaceMenu);
    }
    const tool = definition ? toolsFor(definition).find(tool => tool.id === state.tool) : undefined;
    for (const option of tool?.options ?? []) {
      const control = button(option.name, `${option.description}${option.modifier ? ` Hold ${option.modifier} for temporary activation.` : ''}`, () => { request('surface.toggle', { target: key, value: option.id }); });
      control.setAttribute('aria-pressed', String(state.toggles.includes(option.id))); control.dataset.effective = String(optionEffective(model.tile(key), option.id)); center.append(control);
    }
    if (definition?.groups.length && view.type !== 'character') right.append(button('Toggle tool rail', 'Show or hide the Surface Rail', () => { request('rail.visible', { target: key, enabled: !state.rail.visible }); }, icons.pointer));
    for (const control of definition?.viewControls ?? []) right.append(button(control.name, control.description, () => { request('surface.view', { target: key, value: control.id }); }, control.icon));
    const viewMenu = button('Deck appearance', 'Change Surface Deck transparency', () => { popupAt(viewMenu, ['opaque', 'partial', 'transparent'].map(value => ({ name: `${value[0]?.toUpperCase() ?? ''}${value.slice(1)} deck`, run: () => { request('surface.view', { target: key, value: `deck.${value}` }); } }))); }, icons.more);
    const layout = button('Tile layout', 'Surface options', () => { layoutMenu(key, layout); }, icons.split); right.append(viewMenu, layout);
    if (view.type === 'timeline' || view.type === 'character') {
      const character = view.type === 'character', title = character ? 'Character' : 'Timeline', noun = title.toLowerCase();
      const items = () => character ? project.read().characters.map(item => ({ id: item.id, name: item.name, label: [item.name, item.middleName, item.familyName].filter(Boolean).join(' ') })) : project.read().timelines.map(item => ({ ...item, label: item.name }));
      const selected = items().find(item => item.id === state.data[noun]);
      const characterName = (): string => { const record = project.read().characters.find(item => item.id === selected?.id); return record ? instanceValues(record, typeof state.data.instance === 'string' ? state.data.instance : undefined).name : 'Unnamed'; };
      const canEdit = (): boolean => !character || state.mode === 'edit';
      const group = document.createElement('div'); group.className = 'timeline-selector'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', `${title} selector`);
      const list = button(`${title}s`, `Choose a ${noun}`, () => {
        popupAt(list, [
          { name: `No ${noun} selected`, selected: !selected, run: () => { if (view.handle.commit?.() === false) return; model.local(key, state => { state.data[noun] = ''; if (character) state.data.instance = ''; }); } },
          ...(character && canEdit() ? [{ name: 'New character', run: () => { if (view.handle.commit?.() === false || project.read().busy) return; try { const created = project.createCharacter(); model.local(key, state => { state.data.character = created.id; state.data.instance = ''; }); } catch (error) { report(error); } } }] : []),
          ...items().map(timeline => ({ name: timeline.label, selected: timeline.id === selected?.id, run: () => { if (view.handle.commit?.() === false) return; model.local(key, state => { state.data[noun] = timeline.id; if (character) state.data.instance = ''; }); } })),
        ], false, `${title}s`);
      }, 'M2 3h2m3 0h7M2 8h2m3 0h7M2 13h2m3 0h7');
      list.setAttribute('aria-haspopup', 'menu'); list.setAttribute('aria-expanded', 'false');
      const name = button(selected ? character ? 'Character instances' : `Rename ${noun}` : `New ${noun}`, selected ? `Rename selected ${noun}` : `Create a ${noun}`, () => {
        if (view.handle.commit?.() === false) return;
        if (character && selected) { view.handle.command?.('instances', name); return; }
        if (!canEdit()) return;
        if (!selected) {
          try { const timeline = character ? project.createCharacter() : project.createTimeline(); model.local(key, state => { state.data[noun] = timeline.id; }); } catch (error) { report(error); }
          return;
        }
        const input = document.createElement('input'); input.className = 'timeline-name'; input.setAttribute('aria-label', `${title} name`); input.maxLength = 80; input.value = character ? characterName() : items().find(item => item.id === selected.id)?.name ?? selected.name;
        let finished = false;
        const finish = (save: boolean): void => {
          if (finished) return; finished = true;
          const restoreFocus = document.activeElement === input;
          if (character) input.replaceWith(name);
          try {
            const current = character ? project.read().characters.find(item => item.id === selected.id) : undefined;
            if (save && current && canEdit()) project.changeCharacter(current.id, { type: 'field', instance: characterInstance(current, typeof state.data.instance === 'string' ? state.data.instance : undefined).id, field: 'name', value: input.value.trim() || 'Unnamed' });
            if (save && !character) project.renameTimeline(selected.id, input.value);
          } catch (error) { report(error); }
          if (!character) buildDeck(key, view);
          if (character) name.textContent = characterName();
          if (!character || restoreFocus) view.deck.querySelector<HTMLButtonElement>(`[aria-label="Rename ${noun}"]`)?.focus({ preventScroll: true });
        };
        input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); finish(true); } if (event.key === 'Escape') { event.preventDefault(); finish(false); } });
        input.addEventListener('blur', () => { finish(true); }, { once: true }); name.replaceWith(input); input.focus(); input.select();
      });
      name.textContent = selected ? character ? characterName() : selected.name : 'New';
      list.disabled = project.read().busy; name.disabled = project.read().busy || (!selected && !canEdit());
      if (character && selected) { name.setAttribute('aria-haspopup', 'menu'); const record = project.read().characters.find(item => item.id === selected.id); const currentInstance = record ? characterInstance(record, typeof state.data.instance === 'string' ? state.data.instance : undefined).label : ''; name.title = currentInstance ? `Choose instance: ${currentInstance}` : 'Choose a character instance'; const portrait = record ? instanceValues(record, typeof state.data.instance === 'string' ? state.data.instance : undefined).portrait : ''; characterPortrait(list, portrait); if (record) characterInstanceName(name, characterName(), currentInstance); }
      group.append(list, name); center.append(group);
    }
    view.deck.append(left, center, right);
    if (focused) [...view.deck.querySelectorAll<HTMLElement>('[aria-label]')].find(control => control.getAttribute('aria-label') === focused)?.focus({ preventScroll: true });
  }
  function buildRail(key: string, view: TileView): void {
    view.rail.replaceChildren();
    for (const group of view.definition?.groups ?? []) {
      const element = document.createElement('div'); element.className = 'rail-group'; element.setAttribute('role', 'group'); element.setAttribute('aria-label', group.name);
      for (const tool of group.tools) {
        const control = button(tool.name, '', () => { request('surface.tool', { target: key, value: tool.id }); }, tool.icon);
        control.dataset.tool = tool.id; const label = document.createElement('span'); label.className = 'tool-label'; label.textContent = tool.name; control.append(label); element.append(control);
      }
      view.rail.append(element);
    }
    view.rail.append(view.railGrip); updateRail(view, undefined, true);
  }
  function updateRail(view: TileView, proposed?: number, controls = false): void {
    const width = railWidth(view, proposed);
    const mode = width <= view.railMetrics.compact ? 'compact' : width <= view.railMetrics.grid ? 'grid' : 'expanded';
    if (!controls && view.rail.style.width === String(width) + 'px' && view.rail.dataset.mode === mode) return;
    const animate = gesture?.kind === 'rail' && gesture.id === view.element.dataset.tile && mode !== view.rail.dataset.mode && !reducedMotion.matches;
    const positions = animate ? new Map([...view.rail.querySelectorAll('button')].map(control => [control, control.getBoundingClientRect()])) : null;
    view.rail.hidden = width === 0; view.rail.style.width = `${String(width)}px`;
    view.rail.dataset.mode = mode;
    for (const tool of view.definition ? toolsFor(view.definition) : []) updateTool(view, tool);
    for (const group of view.rail.querySelectorAll<HTMLElement>('.rail-group')) group.hidden = [...group.querySelectorAll('button')].every(control => control.hidden);
    if (positions) animateRail(positions);
  }
  function animateRail(positions: Map<HTMLButtonElement, DOMRect>): void {
    for (const control of positions.keys()) for (const animation of control.getAnimations()) animation.cancel();
    for (const [control, before] of positions) {
      const after = control.getBoundingClientRect(), x = before.x - after.x, y = before.y - after.y;
      if (Math.abs(x) < 1 && Math.abs(y) < 1) continue;
      control.dataset.reflow = 'true';
      const animation = control.animate([{ transform: `translate(${String(x)}px, ${String(y)}px)` }, { transform: 'none' }], { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
      const finish = (): void => { if (!control.getAnimations().some(current => current.playState === 'running')) delete control.dataset.reflow; };
      animation.finished.then(finish, finish).catch(report);
    }
  }
  function updateTool(view: TileView, tool: Tool): void {
    const control = [...view.rail.querySelectorAll<HTMLButtonElement>('[data-tool]')].find(button => button.dataset.tool === tool.id); if (!control) return;
    control.disabled = tool.writes === true && !view.definition?.modes.find(mode => mode.id === view.state.mode)?.writes; control.setAttribute('aria-pressed', String(tool.id === view.state.tool));
    control.hidden = tool.available ? !tool.available(view.context) : false;
    if (tool.command) control.removeAttribute('aria-pressed');
    control.title = `${view.rail.dataset.mode === 'expanded' ? '' : `${tool.name} · `}${tool.description} (${tool.shortcut})`;
  }
  function makeView(tile: Tile): TileView {
    const element = document.createElement('section'); element.className = 'workspace-tile'; element.dataset.tile = tile.id; element.tabIndex = -1; element.setAttribute('aria-label', 'Workspace tile');
    const deck = document.createElement('header'); deck.className = 'surface-deck'; deck.setAttribute('aria-label', 'Surface Deck');
    const area = document.createElement('div'); area.className = 'surface-area';
    const rail = document.createElement('aside'); rail.className = 'surface-rail'; rail.setAttribute('aria-label', 'Surface Rail');
    const body = document.createElement('div'); body.className = 'surface-content'; body.tabIndex = 0;
    const railGrip = document.createElement('div'); railGrip.className = 'rail-grip'; railGrip.dataset.rail = tile.id; railGrip.tabIndex = 0; railGrip.setAttribute('role', 'separator'); railGrip.setAttribute('aria-label', 'Resize tool rail'); railGrip.title = 'Drag to resize tool rail'; railGrip.setAttribute('aria-orientation', 'vertical');
    area.append(rail, body); element.append(deck, area); canvas.append(element);
    const scope = new AbortController(); const state = activeState(tile); const definition = surfaces.get(tile.type);
    if (definition) {
      state.data = definition.restore(state.data);
      if (!definition.modes.some(mode => mode.id === state.mode)) state.mode = definition.defaultState().mode;
      if (!toolsFor(definition).some(tool => tool.id === state.tool)) state.tool = definition.defaultState().tool;
    }
    const context: SurfaceContext = {
      state, signal: scope.signal,
      view: update => { model.local(tile.id, state => { update(state.view); }); },
      project: { read: project.read, createTimeline: () => project.createTimeline(), renameTimeline: (id, name) => { project.renameTimeline(id, name); }, createCharacter: () => { if (definition?.id !== 'character' || state.mode !== 'edit') throw new Error('Character editing is unavailable.'); return project.createCharacter(); }, changeCharacter: (id, change) => { if (definition?.id !== 'character' || state.mode !== 'edit') throw new Error('Character editing is unavailable.'); return project.changeCharacter(id, change); }, write: (field, value) => { const tool = definition ? toolsFor(definition).find(tool => tool.id === state.tool) : undefined; if (!definition?.modes.find(mode => mode.id === state.mode)?.writes || !tool?.writes) throw new Error('This surface is read only.'); project.write(field, value); } },
      effective: option => optionEffective(tile, option), local: update => { const next = structuredClone(state.data); update(next); if ((next.character !== state.data.character || next.instance !== state.data.instance) && handle.commit?.() === false) return; model.local(tile.id, state => { state.data = next; }); },
    };
    const handle = definition?.mount(body, context) ?? unavailable(body, tile.type);
    scope.signal.addEventListener('abort', () => { for (const animation of rail.getAnimations({ subtree: true })) animation.cancel(); }, { once: true });
    const view = { element, deck, rail, body, type: tile.type, state, definition, context, handle, scope, signature: '', railMetrics: { compact: 48, grid: 84, expanded: 104 }, railGrip };
    buildRail(tile.id, view); mounted++;
    const tool = rail.querySelector('button');
    if (tool instanceof HTMLElement) { const style = getComputedStyle(rail), gap = parseFloat(getComputedStyle(rail.querySelector('.rail-group') ?? rail).gap) || 0; const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth); const size = Math.max(tool.getBoundingClientRect().width, 36); view.railMetrics = { compact: size + padding, grid: size * 2 + gap + padding, expanded: Math.max(size * 2 + gap + padding, size + padding + labelWidth(rail, definition) + (parseFloat(getComputedStyle(tool).gap) || gap)) }; }
    return view;
  }
  function labelWidth(rail: HTMLElement, definition: SurfaceDefinition | undefined): number {
    const context = document.createElement('canvas').getContext('2d'); if (!context || !definition) return 0;
    context.font = getComputedStyle(rail).font;
    return Math.ceil(Math.max(0, ...toolsFor(definition).map(tool => context.measureText(tool.name).width)));
  }
  function unavailable(host: HTMLElement, type: string): SurfaceHandle { const text = document.createElement('p'); text.className = 'surface-info'; text.textContent = `Surface “${type}” is unavailable. Its saved state is preserved; choose another type above.`; host.append(text); return { update: () => undefined, dispose: () => { text.remove(); } }; }
  function disposeView(key: string, view: TileView): void { if (popupOwner && view.element.contains(popupOwner)) { if (popup.matches(':popover-open')) popup.hidePopover(); popup.replaceChildren(); popupOwner = null; } view.scope.abort(); view.handle.dispose(); view.element.remove(); views.delete(key); disposed++; }
  function refresh(key: string, view: TileView): void {
    const state = view.state; const signature = JSON.stringify([state.mode, state.tool, state.toggles, state.rail, state.view, view.type === 'timeline' ? [state.data.timeline, project.read().timelines, project.read().busy] : view.type === 'character' ? [state.data.character, state.data.instance, state.data.category, project.read().characters.some(character => character.id === state.data.character), project.read().busy] : null, view.definition ? toolsFor(view.definition).find(tool => tool.id === state.tool)?.options?.map(option => optionEffective(model.tile(key), option.id)) : []]);
    if (signature !== view.signature) { view.signature = signature; buildDeck(key, view); updateRail(view, undefined, true); }
    if (view.type === 'character') {
      const name = view.deck.querySelector<HTMLButtonElement>('[aria-label="Character instances"]');
      const selected = project.read().characters.find(character => character.id === state.data.character);
      if (name && selected) {
        const values = instanceValues(selected, typeof state.data.instance === 'string' ? state.data.instance : undefined);
        characterInstanceName(name, values.name, characterInstance(selected, typeof state.data.instance === 'string' ? state.data.instance : undefined).label);
        name.title = `Choose instance: ${characterInstance(selected, typeof state.data.instance === 'string' ? state.data.instance : undefined).label}`;
        const list = view.deck.querySelector<HTMLButtonElement>('[aria-label="Characters"]'); if (list) characterPortrait(list, values.portrait);
      }
    }
    view.handle.update();
  }
  function syncTabs(): void {
    const focused = tabsHost.contains(document.activeElement) && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    for (const badge of tabsHost.querySelectorAll('.tab-group-label')) badge.remove();
    const ids = new Set(model.tabs.map(tab => tab.id));
    for (const [key, element] of tabButtons) if (!ids.has(key)) { element.remove(); tabButtons.delete(key); }
    const groups = new Set<string>();
    for (const tab of model.tabs) {
      let wrapper = tabButtons.get(tab.id);
      if (!wrapper) { const clone = template.content.firstElementChild?.cloneNode(true); if (!(clone instanceof HTMLElement)) throw new Error('Missing tab template.'); wrapper = clone; tabButtons.set(tab.id, wrapper); }
      const button = wrapper.querySelector<HTMLButtonElement>('[role="tab"]'), close = wrapper.querySelector<HTMLButtonElement>('[data-close-tab]'); if (!button || !close) throw new Error('Invalid tab template.');
      const tiles = model.branch(tab.root).filter((node): node is Tile => node.kind === 'tile');
      const surfaceIcon = tiles.length > 1 ? icons.split : surfaces.get(tiles[0]?.type ?? '')?.icon ?? icons.file;
      const label = document.createElement('span'); label.textContent = tab.name; button.replaceChildren(icon(surfaceIcon), label);
      button.setAttribute('aria-label', tab.name); button.setAttribute('aria-description', tiles.length > 1 ? `${String(tiles.length)} surfaces in a tiled layout` : surfaces.get(tiles[0]?.type ?? '')?.name ?? 'Unavailable surface');
      button.id = tab.id; button.title = tab.name; button.setAttribute('aria-selected', String(tab.id === model.activeTab)); button.tabIndex = tab.id === model.activeTab ? 0 : -1; close.setAttribute('aria-label', `Close ${tab.name}`); close.title = `Close ${tab.name}`;
      wrapper.draggable = false; wrapper.dataset.group = tab.group?.id ?? ''; wrapper.dataset.selected = String(tab.id === model.activeTab); wrapper.classList.toggle('tab-pinned', tab.pinned === true); wrapper.classList.toggle('tab-grouped', tab.group !== undefined); wrapper.style.setProperty('--group-color', tab.group?.color ?? 'transparent'); wrapper.hidden = tab.group?.collapsed === true;
      if (tab.group && !groups.has(tab.group.id)) {
        const group = tab.group; groups.add(group.id); const badge = document.createElement('button'); badge.className = 'tab-group-label'; badge.dataset.group = group.id; badge.textContent = group.name; badge.style.setProperty('--group-color', group.color); badge.setAttribute('aria-label', `Tab group ${group.name || 'Unnamed'}`); badge.setAttribute('aria-expanded', String(!group.collapsed));
        badge.addEventListener('click', () => { toggleGroup(badge, group); });
        badge.addEventListener('contextmenu', event => { event.preventDefault(); groupMenu(badge, group); }); tabsHost.append(badge);
      }
      tabsHost.append(wrapper);
    }
    const preferredWidth = model.tabs.reduce((width, tab) => width + (tab.group?.collapsed ? 0 : tab.pinned ? 42 : 142), 22);
    const groupWidth = [...tabsHost.querySelectorAll<HTMLElement>('.tab-group-label')].reduce((width, badge) => width + badge.offsetWidth + 12, 0);
    tabsHost.style.flexBasis = `${String(preferredWidth + groupWidth)}px`;
    if (focused?.isConnected && !focused.hidden && document.activeElement !== focused) focused.focus({ preventScroll: true });
    const close = document.querySelector<HTMLButtonElement>('#close-tab-item'); if (close) close.disabled = model.activeTab === null;
    host.setAttribute('aria-label', model.activeTab ? model.tab().name : 'No tabs open'); host.removeAttribute('aria-labelledby');
  }
  function reconcile(reason: string): void {
    hidePreview();
    if (gesture) cancel();
    if (reason === 'restore') { for (const [key, view] of views) disposeView(key, view); for (const element of dividers.values()) element.remove(); dividers.clear(); for (const element of tabViews.values()) element.remove(); tabViews.clear(); lastTab = null; }
    if (lastFocus !== `${model.activeTab ?? ''}/${model.activeTab ? `${model.tab().activeTile}/${model.tile().type}/${activeState(model.tile()).mode}/${activeState(model.tile()).tool}` : ''}`) { held.clear(); lastFocus = `${model.activeTab ?? ''}/${model.activeTab ? `${model.tab().activeTile}/${model.tile().type}/${activeState(model.tile()).mode}/${activeState(model.tile()).tool}` : ''}`; }
    if (lastTab !== model.activeTab) { lastTab = model.activeTab; restoreScroll = model.activeTab ? model.tab().scroll : { x: 0, y: 0 }; }
    syncTabs(); const existing = new Set<string>(); const splits = new Set<string>();
    for (const tab of model.tabs) {
      const branch = model.branch(tab.root);
      for (const node of branch) { if (node.kind === 'tile') existing.add(node.id); else splits.add(node.id); }
      if (tab.id !== model.activeTab && !tabViews.has(tab.id)) continue;
      let group = tabViews.get(tab.id); if (!group) { group = document.createElement('div'); group.className = 'tab-layout'; canvas.append(group); tabViews.set(tab.id, group); }
      group.hidden = tab.id !== model.activeTab;
      for (const node of branch) {
        if (node.kind === 'split') { syncDivider(node.id, node.axis, group); splits.add(node.id); continue; }
        existing.add(node.id); let view = views.get(node.id);
        if (view && (view.type !== node.type || view.state !== activeState(node))) { disposeView(node.id, view); view = undefined; }
        if (!view) { view = makeView(node); views.set(node.id, view); group.append(view.element); }
        view.element.dataset.active = String(tab.id === model.activeTab && tab.activeTile === node.id);
        if (tab.id === model.activeTab) refresh(node.id, view);
      }
    }
    for (const [key, view] of views) if (!existing.has(key)) disposeView(key, view);
    for (const [key, element] of dividers) if (!splits.has(key)) { element.remove(); dividers.delete(key); }
    for (const [key, element] of tabViews) if (!model.tabs.some(tab => tab.id === key)) { element.remove(); tabViews.delete(key); }
    canvas.dataset.empty = String(!model.activeTab); schedule(); updateHistoryControls(); if (reason !== 'restore') changed();
  }
  function syncDivider(key: string, axis: Axis, group: HTMLElement): void {
    if (dividers.has(key)) return;
    const element = document.createElement('div'); element.className = 'workspace-divider'; element.dataset.node = key; element.dataset.axis = axis; element.tabIndex = 0; element.setAttribute('role', 'separator'); element.setAttribute('aria-label', 'Resize adjacent tiles'); element.title = 'Drag to resize adjacent tiles · Right-click for surface options'; element.setAttribute('aria-orientation', axis === 'horizontal' ? 'vertical' : 'horizontal'); element.setAttribute('aria-valuemin', '0'); element.setAttribute('aria-valuemax', '100'); group.append(element); dividers.set(key, element);
  }
  function updateHistoryControls(): void { for (const [action, enabled] of [['layout.undo', model.activeTab ? model.canUndo() : false], ['layout.redo', model.activeTab ? model.canRedo() : false]] as const) { const button = document.querySelector<HTMLButtonElement>(`[data-workspace="${action}"]`); if (button) button.disabled = !enabled; } }
  function compatible(a: string, b: string): boolean { const first = metrics.rects.get(a), second = metrics.rects.get(b); return Boolean(first && second && adjacent(first, second)); }
  function previewSplit(key: string, axis: Axis, ratio: number): void {
    model.tile(key); const rect = measure().rects.get(key); if (!rect || !Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) throw new Error('Invalid proposed split.');
    const a = minimum(), b = a;
    const length = axis === 'horizontal' ? rect.width : rect.height, first = axis === 'horizontal' ? a.width : a.height, second = axis === 'horizontal' ? b.width : b.height;
    if (length < first + second) throw new Error('This tile is too small to split in that direction.');
    preview = { kind: 'split', tile: key, axis, ratio: Math.max(first / length, Math.min(ratio, 1 - second / length)) }; schedule();
  }
  function resizeRatio(key: string, ratio: number): number {
    const node = model.nodes.get(key); const geo = measure(); if (node?.kind !== 'split' || !Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) throw new Error('Invalid divider ratio.');
    const rect = geo.rects.get(key), a = geo.minimums.get(node.first), b = geo.minimums.get(node.second); if (!rect || !a || !b) throw new Error('Divider is outside the active tab.');
    const length = node.axis === 'horizontal' ? rect.width : rect.height;
    return Math.max((node.axis === 'horizontal' ? a.width : a.height) / length, Math.min(ratio, 1 - (node.axis === 'horizontal' ? b.width : b.height) / length));
  }
  function commit(): void {
    const proposal = preview; preview = null;
    if (!proposal) return;
    if (proposal.kind === 'split') { model.focus(proposal.tile); model.split(proposal.tile, proposal.axis, proposal.ratio); }
    if (proposal.kind === 'join') model.join(proposal.survivor, proposal.removed, measure());
    if (proposal.kind === 'resize') model.resize(proposal.node, proposal.ratio);
    if (proposal.kind === 'rail') model.local(proposal.tile, state => { state.rail.width = proposal.width; });
    schedule();
  }
  function cancel(): void { const previous = gesture; gesture = null; preview = null; overlay.hidden = true; if (previous?.owner.hasPointerCapture(previous.pointer)) previous.owner.releasePointerCapture(previous.pointer); for (const view of views.values()) { for (const animation of view.rail.getAnimations({ subtree: true })) animation.cancel(); updateRail(view); } schedule(); }
  function execute(args: WorkspaceRequest): void {
    const { action } = args;
    if (signal.aborted) throw new Error('Workspace has been disposed.');
    if (document.querySelector('dialog[open]')) throw new Error('Dismiss the active dialog before changing the workspace.');
    if (project.read().busy) throw new Error('Project is busy.');
    if (action === 'tab.new') { model.newTab(); return; }
    if (action === 'tab.select') { if (model.activeTab) model.tab().scroll = { x: host.scrollLeft, y: host.scrollTop }; model.selectTab(args.target ?? ''); return; }
    if (action === 'tab.close') { model.closeTab(args.target ?? model.tab().id); return; }
    if (action === 'tab.rename') { model.renameTab(args.target ?? model.tab().id, args.value ?? ''); return; }
    if (action === 'tab.reorder') { model.reorderTab(args.target ?? model.tab().id, args.index ?? -1); return; }
    if (action === 'layout.cancel') { cancel(); return; }
    if (action === 'layout.commit') { commit(); return; }
    if (action === 'layout.undo' || action === 'layout.redo') { model.history(action === 'layout.undo' ? 'undo' : 'redo'); return; }
    const key = args.target ?? model.tab().activeTile;
    if (action === 'tile.focus') { model.focus(key); return; }
    if (action === 'layout.split' || action === 'layout.preview-split') { if (args.axis !== 'horizontal' && args.axis !== 'vertical') throw new Error('Choose a horizontal or vertical split.'); previewSplit(key, args.axis, args.ratio ?? .5); if (action === 'layout.split') commit(); return; }
    if (action === 'layout.join' || action === 'layout.preview-join') { model.tile(key); model.tile(args.other ?? ''); measure(); if (!compatible(key, args.other ?? '')) throw new Error('Tiles are not adjacent compatible regions.'); preview = { kind: 'join', survivor: key, removed: args.other ?? '' }; if (action === 'layout.join') commit(); else schedule(); return; }
    if (action === 'layout.resize') { const ratio = resizeRatio(key, args.ratio ?? NaN); model.resize(key, ratio); return; }
    if (action === 'layout.swap') { model.swap(key, args.other ?? ''); return; }
    if (action === 'surface.switch') { if (!surfaces.has(args.value ?? '')) throw new Error('Unregistered surface type.'); model.switchSurface(key, args.value ?? ''); return; }
    const tile = model.tile(key), state = activeState(tile), definition = surfaces.get(tile.type), view = views.get(key);
    if (action === 'surface.view') {
      if (args.value === 'deck.opaque' || args.value === 'deck.partial' || args.value === 'deck.transparent') {
        const opacity = args.value;
        model.local(key, state => { state.view.deck = opacity === 'deck.opaque' ? 'opaque' : opacity === 'deck.partial' ? 'partial' : 'transparent'; }); return;
      }
      const control = definition?.viewControls.find(control => control.id === args.value);
      if (!control || !view) throw new Error('Unknown or unsupported local view control.');
      control.run({ ...view.context, project: { read: project.read, createTimeline: () => { throw new Error('View controls cannot modify timelines.'); }, renameTimeline: () => { throw new Error('View controls cannot modify timelines.'); }, createCharacter: () => { throw new Error('View controls cannot modify characters.'); }, changeCharacter: () => { throw new Error('View controls cannot modify characters.'); }, write: () => { throw new Error('View controls cannot modify authored project content.'); } } }); return;
    }
    if (!definition || !view) throw new Error('Surface is unavailable.');
    if (action === 'surface.write') { if (args.field !== 'name' && args.field !== 'notes') throw new Error('Unknown shared field.'); view.context.project.write(args.field, args.value ?? ''); return; }
    if (action === 'surface.mode' && view.handle.commit?.() === false) throw new Error('Correct the invalid character field before changing mode.');
    if (action === 'surface.mode') { if (!definition.modes.some(mode => mode.id === args.value)) throw new Error('Unsupported mode.'); model.local(key, state => { state.mode = args.value ?? ''; if (!definition.modes.find(mode => mode.id === state.mode)?.writes && toolsFor(definition).find(tool => tool.id === state.tool)?.writes) state.tool = toolsFor(definition).find(tool => !tool.writes)?.id ?? '';  }); return; }
    if (action === 'surface.tool') { const tool = toolsFor(definition).find(tool => tool.id === args.value); if (!tool || (tool.writes && !definition.modes.find(mode => mode.id === state.mode)?.writes)) throw new Error('Tool is unavailable in this mode.'); if (tool.available && !tool.available(view.context)) throw new Error('Tool is unavailable in this context.'); held.clear(); if (tool.command) { const owner = [...view.rail.querySelectorAll<HTMLButtonElement>('[data-tool]')].find(control => control.dataset.tool === tool.id); if (owner) view.handle.command?.(tool.command, owner); return; } model.local(key, state => { state.tool = tool.id; }); return; }
    if (action === 'surface.toggle') { const tool = toolsFor(definition).find(tool => tool.id === state.tool); if (!tool?.options?.some(option => option.id === args.value)) throw new Error('Option does not belong to the active tool.'); model.local(key, state => { const value = args.value ?? ''; state.toggles = state.toggles.includes(value) ? state.toggles.filter(option => option !== value) : [...state.toggles, value]; }); return; }
    if (action === 'surface.modifier') { if (!['Shift', 'Alt'].includes(args.value ?? '') || model.tab().activeTile !== key) throw new Error('Modifier is outside the focused tool context.'); if (args.enabled) held.add(args.value ?? ''); else held.delete(args.value ?? ''); refresh(key, view); return; }
    if (action === 'surface.action') { const item = definition.menus.flatMap(menu => menu.items).find(item => item.id === args.value); if (!item) throw new Error('Unknown contextual surface action.'); item.run(view.context); return; }
    if (action === 'rail.visible') { if (!definition.groups.length || typeof args.enabled !== 'boolean') throw new Error('Rail visibility is unavailable.'); model.local(key, state => { state.rail.visible = args.enabled ?? false; }); return; }
    if (action === 'rail.resize') { const width = args.width; if (!state.rail.visible || !definition.groups.length || width === undefined || !Number.isFinite(width) || width < 20 || width > 4096) throw new Error('Invalid rail width.'); const snapped = railWidth(view, width); model.local(key, state => { state.rail.width = snapped; }); return; }
    throw new Error('Unknown workspace action.');
  }
  let suppressContextMenu = false;
  function pointerDown(event: PointerEvent): void {
    if (event.button === 2 && (gesture || preview)) { event.preventDefault(); suppressContextMenu = true; cancel(); return; }
    if (event.button !== 0 || project.read().busy || !(event.target instanceof Element)) return;
    const tile = event.target.closest<HTMLElement>('[data-tile]'); if (tile?.dataset.tile) model.focus(tile.dataset.tile);
    const owner = event.target.closest<HTMLElement>('[data-corner], [data-node], [data-rail]'); if (!owner) return;
    const kind = owner.dataset.corner ? 'corner' : owner.dataset.node ? 'divider' : 'rail', key = owner.dataset.corner ?? owner.dataset.node ?? owner.dataset.rail ?? '';
    const candidates = kind === 'corner' ? corners.get(key)?.tiles ?? [] : [];
    const source = kind === 'corner' ? event.shiftKey ? candidates.find(tile => tile === model.tab().activeTile) ?? candidates[0] ?? '' : '' : key;
    const rect = kind === 'corner' && !source ? { x: 0, y: 0, width: 0, height: 0 } : measure().rects.get(source); if (!rect) return;
    cancel(); event.preventDefault(); owner.setPointerCapture(event.pointerId);
    delete owner.dataset.dragged;
    gesture = { kind, id: source, pointer: event.pointerId, owner, x: event.clientX, y: event.clientY, currentX: event.clientX, currentY: event.clientY, shift: event.shiftKey, alt: event.altKey, moved: false, rect, startWidth: views.get(key)?.state.rail.width ?? 40 };
  }
  function moveGesture(): void {
    const active = gesture; if (!active) return;
    const dx = active.currentX - active.x, dy = active.currentY - active.y; if (Math.hypot(dx, dy) < 6 && !active.moved) return;
    active.moved = true; if (active.kind === 'corner') active.owner.dataset.dragged = 'true';
    const bounds = canvas.getBoundingClientRect(), x = active.currentX - bounds.left, y = active.currentY - bounds.top;
    if (active.kind === 'corner' && !active.id) {
      const tile = corners.get(active.owner.dataset.corner ?? '')?.tiles.find(key => { const rect = metrics.rects.get(key); return rect && x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height; });
      const rect = tile ? metrics.rects.get(tile) : undefined;
      if (!tile || !rect) { preview = null; paintPreview(); return; }
      active.id = tile; active.rect = rect;
    }
    try {
      if (active.kind === 'divider') { const node = model.nodes.get(active.id); if (node?.kind === 'split') { const ratio = node.axis === 'horizontal' ? (x - active.rect.x) / active.rect.width : (y - active.rect.y) / active.rect.height; preview = { kind: 'resize', node: active.id, ratio: resizeRatio(active.id, Math.max(.000001, Math.min(.999999, ratio))) }; } }
      else if (active.kind === 'rail') { const view = views.get(active.id); if (view) { const width = railWidth(view, Math.max(20, Math.min(4096, active.startWidth + dx))); preview = { kind: 'rail', tile: active.id, width }; updateRail(view, width); } }
      else if (active.shift) {
        const target = model.branch(model.tab().root).find(node => { const rect = metrics.rects.get(node.id); return node.kind === 'tile' && node.id !== active.id && rect && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height && compatible(active.id, node.id); });
        preview = target ? { kind: 'join', survivor: active.alt ? target.id : active.id, removed: active.alt ? active.id : target.id } : null;
      } else { const axis = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical'; const ratio = axis === 'horizontal' ? (x - active.rect.x) / active.rect.width : (y - active.rect.y) / active.rect.height; previewSplit(active.id, axis, Math.max(.000001, Math.min(.999999, ratio))); }
    } catch { preview = null; }
    paint();
  }
  let moveFrame = 0;
  host.addEventListener('pointerdown', pointerDown, { signal });
  host.addEventListener('contextmenu', event => {
    if (suppressContextMenu || gesture || preview) { event.preventDefault(); suppressContextMenu = false; cancel(); return; }
    if (!model.activeTab || project.read().busy || document.querySelector('dialog[open]') || !(event.target instanceof Element)) return;
    measure(); const bounds = canvas.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    const corner = event.target.closest<HTMLElement>('[data-corner]');
    const tiles = corner ? corners.get(corner.dataset.corner ?? '')?.tiles ?? [] : model.branch(model.tab().root).filter(node => {
      const rect = metrics.rects.get(node.id); return node.kind === 'tile' && rect && x >= rect.x - 4 && x <= rect.x + rect.width + 4 && y >= rect.y - 4 && y <= rect.y + rect.height + 4 && Math.min(Math.abs(x - rect.x), Math.abs(x - rect.x - rect.width), Math.abs(y - rect.y), Math.abs(y - rect.y - rect.height)) <= 4;
    }).map(node => node.id);
    if (!tiles.length) return;
    event.preventDefault(); if (popup.matches(':popover-open')) popup.hidePopover();
    if (tiles.length > 2) return;
    const clicked = event.target.closest<HTMLElement>('[data-tile]')?.dataset.tile;
    const key = tiles.find(tile => tile === clicked) ?? tiles.find(tile => tile === model.tab().activeTile) ?? tiles[0]; if (!key) return;
    surfaceMenu(tiles, key, views.get(key)?.element ?? host, Boolean(corner), { x: event.clientX, y: event.clientY });
  }, { signal });
  host.addEventListener('pointermove', event => { if (!gesture || gesture.pointer !== event.pointerId) return; gesture.currentX = event.clientX; gesture.currentY = event.clientY; gesture.shift = event.shiftKey; gesture.alt = event.altKey; if (!moveFrame) moveFrame = requestAnimationFrame(() => { moveFrame = 0; moveGesture(); }); }, { signal });
  host.addEventListener('pointerup', event => { const active = gesture; if (!active || active.pointer !== event.pointerId) return; cancelAnimationFrame(moveFrame); moveFrame = 0; moveGesture(); gesture = null; if (active.owner.hasPointerCapture(active.pointer)) active.owner.releasePointerCapture(active.pointer); if (active.moved) { if (active.kind === 'corner') active.owner.dataset.dragged = 'true'; try { commit(); } catch (error) { cancel(); report(error); } } }, { signal });
  host.addEventListener('pointercancel', cancel, { signal }); host.addEventListener('lostpointercapture', () => { if (gesture) cancel(); }, { signal });
  host.addEventListener('focusin', event => { if (!(event.target instanceof Element)) return; const key = event.target.closest<HTMLElement>('[data-tile]')?.dataset.tile; if (key) model.focus(key); }, { signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (gesture || preview)) { event.preventDefault(); cancel(); return; }
    if (!(event.target instanceof Element) || event.target.closest('input, textarea, select, [contenteditable="true"], dialog[open]') || !model.activeTab || document.querySelector('dialog[open]')) return;
    if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'z') { event.preventDefault(); request(event.shiftKey ? 'layout.redo' : 'layout.undo'); return; }
    if (event.ctrlKey || event.metaKey) return;
    const separator = event.target.closest<HTMLElement>('[data-node], [data-rail]');
    if (separator && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const amount = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1; const node = model.nodes.get(separator.dataset.node ?? ''); if (node?.kind === 'split') request('layout.resize', { target: node.id, ratio: Math.max(.000001, Math.min(.999999, node.ratio + amount * .02)) }); else { const view = views.get(separator.dataset.rail ?? ''); if (view) request('rail.resize', { target: separator.dataset.rail, width: Math.max(20, view.state.rail.width + amount * 32) }); } return; }
    const tileOwner = event.target.closest<HTMLElement>('[data-tile]'); if (tileOwner?.dataset.tile !== model.tab().activeTile) return;
    if (event.key === 'Shift' || event.key === 'Alt') { request('surface.modifier', { value: event.key, enabled: true }); return; }
    const tile = model.tile(), definition = surfaces.get(tile.type), view = views.get(tile.id); const tool = definition && view ? toolsFor(definition).find(tool => tool.shortcut.toLowerCase() === event.key.toLowerCase() && (!tool.available || tool.available(view.context))) : undefined;
    if (tool && !event.altKey) { event.preventDefault(); request('surface.tool', { value: tool.id }); }
  }, { signal });
  document.addEventListener('keyup', event => { if (!held.delete(event.key) || !model.activeTab) return; const view = views.get(model.tab().activeTile); if (view) refresh(model.tab().activeTile, view); }, { signal });
  document.addEventListener('focusin', event => {
    if (!(event.target instanceof Node) || host.contains(event.target) || !held.size || !model.activeTab) return;
    held.clear(); const key = model.tab().activeTile, view = views.get(key); if (view) refresh(key, view);
  }, { signal });
  popup.addEventListener('toggle', () => { if (popupOwner?.hasAttribute('aria-expanded')) popupOwner.setAttribute('aria-expanded', String(popup.matches(':popover-open'))); }, { signal });
  popup.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); popup.hidePopover(); popupOwner?.focus(); return; }
    if (!popup.classList.contains('surface-picker') && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const items = [...popup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = Math.max(0, items.findIndex(item => item === document.activeElement));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[next]?.focus(); return;
    }
    if (!popup.classList.contains('surface-picker') || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const columns = [...popup.querySelectorAll<HTMLElement>('.surface-picker-column')], column = Math.max(0, columns.findIndex(group => group.contains(document.activeElement)));
    const group = columns[column]; if (!group) return;
    const controls = [...group.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = Math.max(0, controls.findIndex(control => control === document.activeElement));
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const next = columns[(column + (event.key === 'ArrowRight' ? 1 : -1) + columns.length) % columns.length], items = [...(next?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      items[Math.min(index, items.length - 1)]?.focus(); return;
    }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
    controls[next]?.focus();
  }, { signal });
  window.addEventListener('blur', () => { held.clear(); cancel(); if (model.activeTab) { const view = views.get(model.tab().activeTile); if (view) refresh(model.tab().activeTile, view); } }, { signal });
  function rename(key: string): void {
    const tab = model.tabs.find(tab => tab.id === key), wrapper = tabButtons.get(key); if (!tab || !wrapper || wrapper.querySelector('input')) return;
    const input = document.createElement('input'); input.className = 'tab-rename'; input.value = tab.name; input.maxLength = 80; input.setAttribute('aria-label', 'Rename tab'); wrapper.append(input); input.focus(); input.select();
    let done = false; const finish = (save: boolean): void => { if (done) return; done = true; if (save && input.value.trim()) request('tab.rename', { target: key, value: input.value }); input.remove(); };
    input.addEventListener('blur', () => { finish(true); }, { once: true }); input.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter'); wrapper.querySelector<HTMLButtonElement>('[role="tab"]')?.focus(); } });
  }
  const titlebar = tabsHost.closest<HTMLElement>('.titlebar') ?? tabsHost;
  let tabDrag: { key: string; group: string | null; owner: HTMLElement; pointer: number; start: number; moved: boolean; rects: Map<HTMLElement, DOMRect>; target: HTMLElement | null; after: boolean } | null = null;
  let suppressTabClick = false;
  const resetTabTransforms = (): void => { for (const element of tabsHost.querySelectorAll<HTMLElement>('.tab, .tab-group-label')) { element.style.removeProperty('transform'); element.removeAttribute('data-dragging'); element.removeAttribute('data-shifting'); element.removeAttribute('data-drop'); } };
  function finishTabDrag(commit: boolean): void {
    const drag = tabDrag; if (!drag) return; tabDrag = null;
    if (titlebar.hasPointerCapture(drag.pointer)) titlebar.releasePointerCapture(drag.pointer);
    const before = new Map([...tabsHost.querySelectorAll<HTMLElement>('.tab, .tab-group-label')].map(element => [element, element.getBoundingClientRect()])); resetTabTransforms();
    if (!drag.moved) return;
    suppressTabClick = true; globalThis.setTimeout(() => { suppressTabClick = false; }, 0);
    const target = drag.target;
    if (commit && target && drag.group) {
      const targetId = target.querySelector<HTMLElement>('[role="tab"]')?.id ?? model.tabs.find(tab => tab.group?.id === target.dataset.group)?.id ?? null;
      model.reorderGroup(drag.group, targetId, drag.after);
    }
    if (commit && target && !drag.group) {
      const targetId = target.querySelector<HTMLElement>('[role="tab"]')?.id;
      const other = model.tabs.find(tab => tab.id === targetId);
      const group = other?.group ?? model.tabs.find(tab => tab.group?.id === target.dataset.group)?.group;
      if (target !== drag.owner) {
        model.groupTab(drag.key, group);
        if (other) { const index = model.tabs.indexOf(other), from = model.tabs.findIndex(tab => tab.id === drag.key); model.reorderTab(drag.key, Math.max(0, Math.min(model.tabs.length - 1, index + (drag.after ? 1 : 0) - (from < index ? 1 : 0)))); }
        else if (!group) model.reorderTab(drag.key, model.tabs.length - 1);
      }
    }
    if (!reducedMotion.matches && !signal.aborted) for (const [previous, rect] of before) { const element = previous.isConnected ? previous : [...tabsHost.querySelectorAll<HTMLElement>('.tab-group-label')].find(badge => badge.dataset.group === previous.dataset.group); if (!element || element.hidden) continue; const next = element.getBoundingClientRect(); const offset = rect.left - next.left; if (Math.abs(offset) > .5) element.animate([{ transform: `translateX(${String(offset)}px)` }, { transform: 'translateX(0)' }], { duration: 160, easing: 'cubic-bezier(.23, 1, .32, 1)' }); }
  }
  tabsHost.addEventListener('dragstart', event => { event.preventDefault(); }, { signal });
  tabsHost.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest('input, [data-close-tab]')) return;
    const owner = event.target.closest<HTMLElement>('.tab, .tab-group-label'), group = owner?.classList.contains('tab-group-label') ? owner.dataset.group ?? null : null;
    const key = group ?? owner?.querySelector<HTMLElement>('[role="tab"]')?.id; if (!owner || !key) return;
    finishTabDrag(false); if (!group) { cancelGroupMotion(); for (const animation of tabsHost.getAnimations({ subtree: true })) animation.cancel(); }
    tabDrag = { key, group, owner, pointer: event.pointerId, start: event.clientX, moved: false, rects: new Map([...tabsHost.querySelectorAll<HTMLElement>('.tab:not([hidden]), .tab-group-label')].map(element => [element, element.getBoundingClientRect()])), target: owner, after: false };
  }, { signal });
  function moveGroupDrag(drag: NonNullable<typeof tabDrag>, dx: number, x: number): void {
    const units = new Map<string, { elements: HTMLElement[]; left: number; right: number }>();
    for (const [element, rect] of drag.rects) {
      const key = element.dataset.group || element.querySelector<HTMLElement>('[role="tab"]')?.id; if (!key) continue;
      const unit = units.get(key) ?? { elements: [], left: rect.left, right: rect.right }; unit.elements.push(element); unit.left = Math.min(unit.left, rect.left); unit.right = Math.max(unit.right, rect.right); units.set(key, unit);
    }
    const entries = [...units.entries()], from = entries.findIndex(([key]) => key === drag.group), own = entries[from]?.[1]; if (!own) return;
    const strip = tabsHost.getBoundingClientRect(), offset = Math.max(strip.left + 11 - own.left, Math.min(strip.right - 11 - own.right, dx));
    let to = entries.findIndex(([key, unit]) => key !== drag.group && x >= unit.left && x <= unit.right);
    drag.target = to >= 0 ? entries[to]?.[1].elements[0] ?? drag.owner : x >= strip.right - 8 ? tabsHost : drag.owner;
    const target = entries[to]?.[1]; drag.after = target !== undefined && x > (target.left + target.right) / 2;
    if (drag.target === tabsHost) to = entries.length; else if (to >= 0 && drag.after) to++;
    if (to > from) to--; if (to < 0) to = from;
    const width = own.right - own.left + 6;
    for (const [index, [, unit]] of entries.entries()) for (const element of unit.elements) {
      element.toggleAttribute('data-dragging', index === from); element.toggleAttribute('data-shifting', index !== from);
      const shift = index === from ? offset : index > from && index <= to ? -width : index < from && index >= to ? width : 0; element.style.transform = `translateX(${String(shift)}px)`;
    }
  }
  document.addEventListener('pointermove', event => {
    const drag = tabDrag; if (!drag || event.pointerId !== drag.pointer) return;
    const dx = event.clientX - drag.start; if (!drag.moved && Math.abs(dx) < 5) return;
    event.preventDefault(); hidePreview(); if (!drag.moved) { cancelGroupMotion(); drag.moved = true; titlebar.setPointerCapture(drag.pointer); drag.owner.setAttribute('data-dragging', ''); }
    if (drag.group) { moveGroupDrag(drag, dx, event.clientX); const bounds = titlebar.getBoundingClientRect(); if (event.clientY < bounds.top - 12 || event.clientY > bounds.bottom + 12) drag.target = null; return; }
    const original = drag.rects.get(drag.owner), strip = tabsHost.getBoundingClientRect();
    const offset = original ? Math.max(strip.left + 11 - original.left, Math.min(strip.right - 11 - original.right, dx)) : dx;
    drag.owner.style.transform = `translateX(${String(offset)}px)`;
    const bounds = titlebar.getBoundingClientRect(); drag.target = null;
    if (event.clientY >= bounds.top - 12 && event.clientY <= bounds.bottom + 12) {
      drag.target = [...drag.rects].find(([element, rect]) => element !== drag.owner && event.clientX >= rect.left && event.clientX <= rect.right)?.[0] ?? (event.clientX >= (tabsHost.getBoundingClientRect().right - 4) ? tabsHost : drag.owner);
    }
    const targetRect = drag.target ? drag.rects.get(drag.target) : undefined; drag.after = targetRect !== undefined && event.clientX > targetRect.left + targetRect.width / 2;
    const entries = [...drag.rects].filter(([element]) => element.classList.contains('tab')).map(([element]) => element);
    const from = entries.indexOf(drag.owner); let to = drag.target ? entries.indexOf(drag.target) : from;
    if (drag.target === tabsHost) to = entries.length; else if (to >= 0 && drag.after) to++;
    if (to > from) to--; if (to < 0) to = from;
    const width = (drag.rects.get(drag.owner)?.width ?? 136) + 6;
    for (const [index, element] of entries.entries()) { if (element === drag.owner) continue; element.setAttribute('data-shifting', ''); const offset = index > from && index <= to ? -width : index < from && index >= to ? width : 0; element.style.transform = `translateX(${String(offset)}px)`; }
    for (const badge of tabsHost.querySelectorAll('.tab-group-label')) badge.toggleAttribute('data-drop', badge === drag.target);
  }, { signal });
  document.addEventListener('pointerup', event => { if (tabDrag?.pointer === event.pointerId) finishTabDrag(true); }, { signal });
  document.addEventListener('pointercancel', event => { if (tabDrag?.pointer === event.pointerId) finishTabDrag(false); }, { signal });
  titlebar.addEventListener('lostpointercapture', () => { finishTabDrag(false); }, { signal });
  titlebar.addEventListener('click', event => { if (suppressTabClick) { event.preventDefault(); event.stopImmediatePropagation(); } }, { capture: true, signal });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && tabDrag) { event.preventDefault(); finishTabDrag(false); } }, { capture: true, signal });
  window.addEventListener('blur', () => { finishTabDrag(false); }, { signal });
  signal.addEventListener('abort', () => { finishTabDrag(false); }, { once: true });
  tabsHost.addEventListener('dblclick', event => { if (event.target instanceof Element) { const tab = event.target.closest<HTMLButtonElement>('[role="tab"]'); if (tab) rename(tab.id); } }, { signal });
  function groupMenu(owner: HTMLElement, group: TabGroup): void {
    const members = (): string[] => model.tabs.filter(tab => tab.group?.id === group.id).map(tab => tab.id);
    popupAt(owner, [
      { name: 'New tab in group', run: () => { const tab = model.newTab(false); model.groupTab(tab.id, group); } },
      { name: 'Close group', run: () => { for (const key of members()) model.closeTab(key); } },
      { name: 'Ungroup', separator: true, run: () => { for (const key of members()) model.groupTab(key); } },
      { name: 'Delete group', run: () => { for (const key of members()) model.closeTab(key); } },
    ], false, 'Tab group'); popup.classList.add('deck-menu');
    const name = document.createElement('input'); name.className = 'group-name'; name.placeholder = 'Name this group'; name.setAttribute('aria-label', 'Group name'); name.maxLength = 80; name.value = group.name;
    name.addEventListener('change', () => { model.updateGroup(group.id, { name: name.value.trim() }); });
    const colors = document.createElement('div'); colors.className = 'group-colors'; colors.setAttribute('role', 'group'); colors.setAttribute('aria-label', 'Group color');
    for (const [index, color] of groupColors.entries()) { const swatch = document.createElement('button'); swatch.style.background = color; swatch.setAttribute('aria-label', `Group color ${String(index + 1)}`); swatch.setAttribute('aria-pressed', String(color === group.color)); swatch.addEventListener('click', () => { model.updateGroup(group.id, { color }); for (const control of colors.querySelectorAll('button')) control.setAttribute('aria-pressed', String(control === swatch)); }); colors.append(swatch); }
    popup.prepend(name, colors, document.createElement('hr')); name.focus();
  }
  tabsHost.addEventListener('contextmenu', event => {
    if (!(event.target instanceof Element)) return; const owner = event.target.closest<HTMLButtonElement>('[role="tab"]'); if (!owner) return; event.preventDefault();
    const tab = model.tabs.find(tab => tab.id === owner.id); if (!tab) return; const index = model.tabs.indexOf(tab);
    popupAt(owner, [
      { name: 'New tab to the right', run: () => { const next = model.newTab(false); if (tab.group) next.group = tab.group; model.reorderTab(next.id, index + 1); } },
      { name: 'Add tab to new split view', run: () => { model.selectTab(tab.id); request('layout.split', { axis: 'horizontal' }); } },
      { name: 'Add tab to group', run: () => {
        const groups = [...new Map(model.tabs.flatMap(tab => tab.group ? [[tab.group.id, tab.group] as const] : [])).values()];
        popupAt(owner, [{ name: 'New group', run: () => { const group = { id: `group-${crypto.randomUUID()}`, name: '', color: groupColors[1] ?? '#8ab4f8', collapsed: false }; model.groupTab(tab.id, group); const badge = [...tabsHost.querySelectorAll<HTMLElement>('.tab-group-label')].find(element => element.dataset.group === group.id); if (badge) groupMenu(badge, group); } }, ...groups.map(group => ({ name: group.name || 'Unnamed group', run: () => { model.groupTab(tab.id, group); } }))], false, 'Add tab to group'); popup.classList.add('deck-menu');
      } },
      { name: 'Remove from group', disabled: !tab.group, run: () => { model.groupTab(tab.id); } },
      { name: 'Duplicate', separator: true, run: () => { model.duplicateTab(tab.id); } },
      { name: tab.pinned ? 'Unpin' : 'Pin', run: () => { const pinned = !tab.pinned; delete tab.group; tab.pinned = pinned; model.reorderTab(tab.id, pinned ? 0 : Math.max(0, model.tabs.filter(item => item.pinned).length)); } },
      { name: 'Close', separator: true, run: () => { model.closeTab(tab.id); } },
      { name: 'Close other tabs', disabled: model.tabs.length < 2, run: () => { for (const other of [...model.tabs]) if (other.id !== tab.id && !other.pinned) model.closeTab(other.id); } },
      { name: 'Close tabs to the right', disabled: index === model.tabs.length - 1, run: () => { for (const other of model.tabs.slice(index + 1)) if (!other.pinned) model.closeTab(other.id); } },
    ], false, 'Tab actions'); popup.classList.add('deck-menu');
  }, { signal });
  tabsHost.addEventListener('keydown', event => { if (!(event.target instanceof HTMLButtonElement) || event.target.getAttribute('role') !== 'tab') return; if (event.key === 'F2') { event.preventDefault(); rename(event.target.id); } if (event.ctrlKey && event.shiftKey && ['PageUp', 'PageDown'].includes(event.key)) { event.preventDefault(); const index = model.tabs.findIndex(tab => tab.id === (event.target instanceof HTMLButtonElement ? event.target.id : '')); request('tab.reorder', { target: event.target.id, index: Math.max(0, Math.min(model.tabs.length - 1, index + (event.key === 'PageUp' ? -1 : 1))) }); } }, { signal });
  document.addEventListener('click', event => { if (event.target instanceof Element) { const control = event.target.closest<HTMLButtonElement>('[data-workspace]'); if (control?.dataset.workspace) request(control.dataset.workspace); } }, { signal });
  host.addEventListener('scroll', () => {
    if (!model.activeTab || restoreScroll) return;
    const key = model.activeTab, x = host.scrollLeft, y = host.scrollTop;
    clearTimeout(scrollTimer);
    scrollTimer = globalThis.setTimeout(() => {
      const tab = model.tabs.find(tab => tab.id === key); if (!tab || (tab.scroll.x === x && tab.scroll.y === y)) return;
      tab.scroll = { x, y }; model.changed('scroll');
    }, 150);
  }, { signal });
  const observer = new ResizeObserver(() => { if (gesture) cancel(); schedule(); }); observer.observe(host); const unsubscribe = model.subscribe(reconcile); reconcile('restore');
  return {
    execute,
    serialize: (): Workspace => { const workspace = model.serialize(); return { ...workspace, nodes: workspace.nodes.map(node => node.kind === 'tile' ? { ...node, states: node.states.map(state => ({ ...state, data: surfaces.get(state.type)?.serialize(state.data) ?? state.data })) } : node) }; },
    restore: (value: unknown): string | null => {
      cancel(); const warning = model.restore(value);
      for (const node of model.nodes.values()) if (node.kind === 'tile' && (node.type === 'test.text' || node.type === 'test.inspect')) model.nodes.set(node.id, { ...node, type: defaultSurface, states: [...node.states.filter(state => state.type !== defaultSurface), newSurface(defaultSurface)] });
      const overview = model.tabs.find(tab => tab.name === 'Overview' && model.branch(tab.root).some(node => node.kind === 'tile' && node.type === defaultSurface)) ?? model.newTab(false);
      overview.name = 'Overview'; delete overview.group; delete overview.pinned;
      let timeline = model.tabs.find(tab => tab.name === 'Timeline' && model.branch(tab.root).some(node => node.kind === 'tile' && node.type === 'timeline'));
      if (!timeline) { timeline = model.newTab(false); timeline.name = 'Timeline'; const tile = model.nodes.get(timeline.root); if (tile?.kind === 'tile') model.nodes.set(tile.id, { ...tile, type: 'timeline', states: [newSurface('timeline')] }); }
      delete timeline.group; delete timeline.pinned;
      let character = model.tabs.find(tab => tab.name === 'Character' && model.branch(tab.root).some(node => node.kind === 'tile' && node.type === 'character'));
      if (!character) { character = model.newTab(false); character.name = 'Character'; const tile = model.nodes.get(character.root); if (tile?.kind === 'tile') model.nodes.set(tile.id, { ...tile, type: 'character', states: [newSurface('character')] }); }
      delete character.group; delete character.pinned;
      model.tabs = [overview, timeline, character, ...model.tabs.filter(tab => tab !== overview && tab !== timeline && tab !== character)]; model.activeTab = overview.id; model.changed('restore');
      return warning;
    },
    updateProject: (): void => { for (const [key, view] of views) { if (!view.element.closest<HTMLElement>('.tab-layout')?.hidden) refresh(key, view); else view.handle.update(); } },
    state: () => { measure(); return { ...model.serialize(), focus: model.activeTab ? { tab: model.activeTab, tile: model.tab().activeTile, surface: model.tile().type, tool: activeState(model.tile()).tool, context: document.activeElement?.closest('.workspace-tile') ? 'surface' : document.activeElement?.closest('[role=tab]') ? 'tab' : 'app' } : null, geometry: Object.fromEntries(metrics.rects), minimums: Object.fromEntries(metrics.minimums), preview, held: [...held], lifecycle: { mounted, disposed, live: views.size }, history: { undo: model.activeTab ? model.canUndo() : false, redo: model.activeTab ? model.canRedo() : false }, surfaces: [...surfaces.values()].map(definition => ({ id: definition.id, name: definition.name, modes: definition.modes, viewControls: definition.viewControls.map(control => ({ id: control.id, name: control.name, description: control.description })), menus: definition.menus.map(menu => ({ name: menu.name, items: menu.items.map(item => ({ id: item.id, name: item.name })) })), groups: definition.groups.map(group => ({ name: group.name, tools: group.tools.map(tool => ({ id: tool.id, name: tool.name, description: tool.description, shortcut: tool.shortcut, options: tool.options ?? [] })) })) })), rails: Object.fromEntries([...views].map(([key, view]) => [key, { mode: view.rail.dataset.mode, width: railWidth(view), thresholds: view.railMetrics }])) }; },
    dispose: (): void => { finishTabDrag(false); cancelGroupMotion(); unsubscribe(); clearTimeout(scrollTimer); hidePreview(); hoverCard.remove(); observer.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(moveFrame); for (const [key, view] of views) disposeView(key, view); popup.remove(); canvas.remove(); },
  };
}
export type WorkspaceController = ReturnType<typeof createWorkspace>;









