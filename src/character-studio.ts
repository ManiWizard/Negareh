// Owns reference-board, appearance-study and relationship-map interactions.
import catalogue from './character-catalogue.json';
import { instanceValues, pruneReferenceLinks } from './characters';
import type { Character, CharacterValues, CharacterReference, CharacterConnection } from './characters';
import { icon } from './surfaces';
import { groupColors } from './workspace-model';

interface StudioAccess {
  read: () => { key: string; character: Character; values: CharacterValues; characters: Character[]; edit: boolean; select: boolean; connect: boolean; zoom: number } | undefined;
  zoom: (value: number) => void;
  write: (field: 'references' | 'connections', value: CharacterReference[] | CharacterConnection[]) => boolean;
  commit: () => boolean;
  prepareImage: (file: File) => Promise<string>;
  addImages: () => void;
  report: (message: string) => void;
  confirm: (title: string, owner: HTMLElement, message: string, run: () => void) => void;
  signal: AbortSignal;
}
type Editor = { input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; read: HTMLElement; dirty: boolean };
const pinProfile = [1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 18, 19, 18.5, 17, 14, 10, 8, 7.85, 7.7, 7.55, 7.4, 7.25, 7.1, 6.95, 6.8, 6.65, 6.5, 12, 14, 14, 13];
const defaultPinColor = groupColors[2] ?? '#f28b82';
const referenceRotation = (reference: CharacterReference): number => {
  if (reference.rotation !== undefined) return reference.rotation;
  let sum = 0; for (let index = 0; index < reference.id.length; index++) sum += reference.id.charCodeAt(index);
  return sum % 13 - 6;
};
export function mountCharacterStudio(board: HTMLElement, relationships: HTMLElement, studies: HTMLElement, access: StudioAccess): { update: () => void; commit: () => boolean; command: (command: 'reference.add-image' | 'reference.add-note') => void; collapseDetails: () => void; dispose: () => void } {
  const button = (name: string, run: () => void, path?: string): HTMLButtonElement => { const element = document.createElement('button'); element.type = 'button'; element.setAttribute('aria-label', name); element.title = name; if (path) element.append(icon(path)); else element.textContent = name; element.addEventListener('click', run); return element; };
  const heading = (title: string, description: string): HTMLElement => { const element = document.createElement('header'), h = document.createElement('h2'), p = document.createElement('p'); h.textContent = title; p.textContent = description; element.append(h, p); return element; };
  const error = document.createElement('p'); error.className = 'character-error'; error.setAttribute('role', 'alert');
  const boardStage = document.createElement('div'); boardStage.className = 'character-reference-board'; boardStage.setAttribute('aria-label', 'Reference board');
  const boardViewport = document.createElement('div'), boardSpace = document.createElement('div'); boardViewport.className = 'character-reference-viewport'; boardViewport.setAttribute('aria-label', 'Reference canvas'); boardSpace.className = 'character-reference-space'; boardSpace.append(boardStage); boardViewport.append(boardSpace);
  const emptyBoard = document.createElement('p'); emptyBoard.className = 'character-studio-empty'; emptyBoard.textContent = 'No references on this board yet. Add an image or note from the rail to begin.'; boardViewport.append(emptyBoard);
  const zoomControls = document.createElement('div'); zoomControls.className = 'character-canvas-zoom'; zoomControls.setAttribute('role', 'group'); zoomControls.setAttribute('aria-label', 'Canvas zoom');
  const zoomLevel = document.createElement('select'); zoomLevel.setAttribute('aria-label', 'Reference canvas zoom');
  for (const value of [25, 50, 75, 100, 125, 150, 175, 200]) { const option = document.createElement('option'); option.value = String(value); option.textContent = `${String(value)}%`; zoomLevel.append(option); }
  const changeZoom = (value: number): void => { access.zoom(Math.max(.25, Math.min(2, value))); };
  const zoomOut = button('Zoom out', () => { changeZoom((access.read()?.zoom ?? 1.5) - .25); }, 'M3 8h10'), zoomIn = button('Zoom in', () => { changeZoom((access.read()?.zoom ?? 1.5) + .25); }, 'M3 8h10M8 3v10');
  zoomLevel.addEventListener('change', () => { changeZoom(Number(zoomLevel.value) / 100); }); zoomControls.append(zoomOut, zoomLevel, zoomIn);
  const referenceInspector = document.createElement('section'); referenceInspector.className = 'character-studio-inspector'; referenceInspector.setAttribute('aria-label', 'Reference details');
  const boardToolbar = document.createElement('div'); boardToolbar.className = 'character-studio-toolbar';
  const finder = document.createElement('div'); finder.className = 'character-reference-finder'; finder.popover = 'auto'; finder.setAttribute('role', 'dialog'); finder.setAttribute('aria-label', 'Find reference'); finder.id = `reference-finder-${crypto.randomUUID()}`;
  const search = document.createElement('input'), results = document.createElement('div'); search.type = 'search'; search.placeholder = 'Search images and notes…'; search.setAttribute('aria-label', 'Search references'); search.autocomplete = 'off'; finder.append(search, results);
  const graph = document.createElement('div'); graph.className = 'character-connection-map'; graph.setAttribute('aria-label', 'Character relationship map');
  const connectionInspector = document.createElement('section'); connectionInspector.className = 'character-studio-inspector'; connectionInspector.setAttribute('aria-label', 'Relationship details');
  const relationToolbar = document.createElement('div'); relationToolbar.className = 'character-studio-toolbar';
  const relationshipPageSize = 5, relationshipPage = document.createElement('span'); relationshipPage.className = 'character-relationship-page'; relationshipPage.setAttribute('role', 'status');
  const referenceEditors = new Map<string, Editor>(), connectionEditors = new Map<string, Editor>();
  let referenceDetails = false, connectionDetails = false, boardFrame = 0, graphFrame = 0, wireFrame = 0, suppressClick = false;
  let linkSource = '', linkPoint: { x: number; y: number } | undefined;
  const wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); wires.classList.add('character-reference-wires'); wires.setAttribute('aria-hidden', 'true');
  const closeDetails = (details: HTMLElement, hide: () => void, owner: HTMLButtonElement): void => {
    const close = button('Close details', () => { if (!access.commit()) return; hide(); details.hidden = true; if (!owner.hidden) owner.focus(); else details.parentElement?.querySelector<HTMLElement>('.character-board-content, .character-connection-node[tabindex], button')?.focus(); }, 'M4 4l8 8M12 4l-8 8');
    close.className = 'character-inspector-close'; details.prepend(close);
    details.onkeydown = event => { if (event.key !== 'Escape') return; event.stopPropagation(); close.click(); };
  };
  let key = '', referenceId = '', connectionId = '', referenceSignature = '', graphSignature = '', referenceForm = '', connectionForm = '', studySignature = '', request = 0, page = 0;
  let drag: { id: string; pointer: number; startX: number; startY: number; x: number; y: number; rangeX: number; rangeY: number; width: number; card: HTMLElement; moved: boolean; rotation: number; angle: number; centerX: number; centerY: number; rotating: boolean } | undefined;
  const fail = (message: string): void => { error.textContent = message; access.report(message); };
  const setEditor = (editors: Map<string, Editor>, field: string, title: string, value: string, parent: HTMLElement, multiline = true, options?: { value: string; name: string }[]): void => {
    const label = document.createElement('label'), text = document.createElement('span'), read = document.createElement('p'); text.textContent = title; read.className = 'character-value'; read.dir = 'auto';
    const input = options ? document.createElement('select') : document.createElement(multiline ? 'textarea' : 'input'); input.setAttribute('aria-label', title); input.name = field; input.dir = 'auto';
    if (input instanceof HTMLSelectElement) for (const option of options ?? []) { const item = document.createElement('option'); item.value = option.value; item.textContent = option.name; input.append(item); }
    else { input.maxLength = field === 'caption' ? 200 : field === 'label' ? 80 : 10_000; input.autocomplete = 'off'; }
    input.value = value; const editor = { input, read, dirty: false }; editors.set(field, editor);
    input.addEventListener('input', () => { editor.dirty = true; }); input.addEventListener('change', () => { if (input instanceof HTMLSelectElement) { editor.dirty = true; commit(); } }); input.addEventListener('blur', () => { commit(); });
    input.addEventListener('keydown', event => { if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing && input instanceof HTMLInputElement) { event.preventDefault(); if (commit()) input.blur(); } }); label.append(text, input, read); parent.append(label);
  };
  const commit = (): boolean => {
    const state = access.read(); if (!state) return true;
    for (const [field, editors, id] of [['references', referenceEditors, referenceId], ['connections', connectionEditors, connectionId]] as const) {
      if (![...editors.values()].some(editor => editor.dirty)) continue;
      if (!state.edit) return false;
      const patch = Object.fromEntries([...editors].filter(([, editor]) => editor.dirty).map(([name, editor]) => [name, editor.input.value]));
      const values = field === 'references' ? state.values.references.map(item => { if (item.id !== id) return item; const updated = { ...item, ...patch }; if (patch.view === '') delete updated.view; return updated; }) : state.values.connections.map(item => item.id === id ? { ...item, ...patch } : item);
      if (!access.write(field, values)) { fail('Could not save these details. Check their limits and try again.'); return false; }
      for (const editor of editors.values()) editor.dirty = false;
    }
    error.textContent = ''; return true;
  };
  const updateEditors = (editors: Map<string, Editor>, value: CharacterReference | CharacterConnection, edit: boolean): void => {
    for (const [field, editor] of editors) { const content: unknown = Object.entries(value).find(([name]) => name === field)?.[1]; const text = typeof content === 'string' ? content : ''; if (!editor.dirty && document.activeElement !== editor.input) editor.input.value = text; editor.input.hidden = !edit; editor.input.disabled = !edit; editor.read.hidden = edit; editor.read.textContent = editor.input instanceof HTMLSelectElement ? editor.input.selectedOptions[0]?.textContent ?? 'None' : text || 'Not set'; }
  };
  const selectedReference = (): CharacterReference | undefined => access.read()?.values.references.find(item => item.id === referenceId);
  const focusDetails = (details: HTMLElement, canvas: HTMLElement, fallback?: HTMLElement | null): void => { if (Math.abs(details.getBoundingClientRect().left - canvas.getBoundingClientRect().left) < 2) { details.tabIndex = -1; details.focus(); } else fallback?.focus({ preventScroll: true }); };
  const selectReference = (id: string, details = true): void => { if (!access.commit()) return; referenceId = id; referenceDetails = details; update(); if (details) referenceInspector.querySelector<HTMLElement>('input:not([hidden]), textarea:not([hidden]), button')?.focus(); };
  const boardColumns = (): number => Math.max(1, Math.min(5, Math.floor((boardStage.clientWidth - 32) / 260)));
  const positions = (reference: CharacterReference, index: number): { x: number; y: number } => {
    const columns = boardColumns();
    return { x: reference.x ?? (index % columns) / Math.max(1, columns - 1), y: reference.y ?? Math.floor(index / columns) / Math.max(1, Math.ceil((access.read()?.values.references.length ?? 0) / columns) - 1) };
  };
  const paintCard = (card: HTMLElement, left: number, top: number, boardWidth: number, width: number): void => {
    const viewpoint = (left + width / 2 - boardWidth / 2) / Math.max(1, boardWidth / 2);
    card.style.left = `${String(left)}px`; card.style.top = `${String(top)}px`; card.style.setProperty('--pin-yaw', `${String(Math.abs(viewpoint) < .08 ? 0 : -viewpoint * 50)}deg`);
    card.style.setProperty('--paper-yaw', `${String(-viewpoint * 5)}deg`); queueWires();
  };
  const locate = (card: HTMLElement, position: { x: number; y: number }): void => { const width = card.offsetWidth, boardWidth = boardStage.clientWidth; paintCard(card, 40 + position.x * Math.max(0, boardWidth - width - 80), 40 + position.y * Math.max(1, boardStage.clientHeight - card.offsetHeight - 80), boardWidth, width); };
  const layoutBoard = (): void => {
    const state = access.read(); if (!state || drag) return;
    boardStage.style.width = `${String(boardViewport.clientWidth)}px`; boardStage.style.height = `${String(boardViewport.clientHeight)}px`;
    const minimum = `${String(Math.max(360, Math.ceil(state.values.references.length / boardColumns()) * 340))}px`; if (boardStage.style.minHeight !== minimum) boardStage.style.minHeight = minimum;
    const boardWidth = boardStage.clientWidth, boardHeight = boardStage.clientHeight;
    const cards = state.values.references.map((reference, index) => { const card = boardStage.querySelector<HTMLElement>(`[data-reference="${reference.id}"]`); return card ? { card, position: positions(reference, index), width: card.offsetWidth, height: card.offsetHeight } : undefined; });
    for (const item of cards) if (item) paintCard(item.card, 40 + item.position.x * Math.max(0, boardWidth - item.width - 80), 40 + item.position.y * Math.max(1, boardHeight - item.height - 80), boardWidth, item.width);
    boardSpace.style.width = `${String(Math.max(boardViewport.clientWidth, boardWidth * state.zoom))}px`; boardSpace.style.height = `${String(Math.max(boardViewport.clientHeight, boardHeight * state.zoom))}px`;
  };
  const moveReference = (id: string, x: number, y: number): void => { const state = access.read(); if (!state?.edit) return; access.write('references', state.values.references.map(item => item.id === id ? { ...item, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : item)); };
  const rotateReference = (id: string, rotation: number): void => { const state = access.read(); if (!state?.edit || !access.commit()) return; const angle = Math.round(((rotation + 180) % 360 + 360) % 360 - 180); access.write('references', state.values.references.map(item => item.id === id ? { ...item, rotation: angle } : item)); };
  const addNote = button('Add note', () => { const state = access.read(); if (!state?.edit || !access.commit()) return; const notes = state.values.references.filter(item => item.kind === 'note').length, reference: CharacterReference = { id: `reference-${crypto.randomUUID()}`, image: '', caption: 'Untitled note', kind: 'note', note: '', x: .1 + (notes % 4) * .18, y: .1 + (Math.floor(notes / 4) % 5) * .16 }; if (access.write('references', [...state.values.references, reference])) { referenceId = reference.id; referenceDetails = true; update(); referenceEditors.get('caption')?.input.focus(); } });
  const addImages = button('Add images', () => { if (access.read()?.edit && access.commit()) access.addImages(); });
  const drawWires = (): void => {
    const state = access.read(); if (!state || board.hidden) return;
    const bounds = boardStage.getBoundingClientRect(), anchors = new Map<string, { x: number; y: number; color: string }>();
    const pinParts = [...boardStage.querySelectorAll<HTMLElement>('.character-pin-shape > span:not(.character-pin-tie)')].map(part => part.getBoundingClientRect());
    for (const card of boardStage.querySelectorAll<HTMLElement>('[data-reference]')) { const tie = card.querySelector('.character-pin-tie')?.getBoundingClientRect(); if (tie && card.dataset.reference) anchors.set(card.dataset.reference, { x: (tie.left + tie.width / 2 - bounds.left) / state.zoom, y: (tie.top + tie.height / 2 - bounds.top) / state.zoom, color: card.style.getPropertyValue('--pin-color') || defaultPinColor }); }
    const paths = document.createDocumentFragment(), seen = new Set<string>(), defs = document.createElementNS(wires.namespaceURI, 'defs'); paths.append(defs);
    const mask = document.createElementNS(wires.namespaceURI, 'mask'), maskId = `pin-layer-${crypto.randomUUID()}`; mask.id = maskId; mask.setAttribute('maskUnits', 'userSpaceOnUse'); mask.setAttribute('x', '0'); mask.setAttribute('y', '0'); mask.setAttribute('width', String(boardStage.clientWidth)); mask.setAttribute('height', String(boardStage.clientHeight));
    const ground = document.createElementNS(wires.namespaceURI, 'rect'); ground.setAttribute('width', '100%'); ground.setAttribute('height', '100%'); ground.setAttribute('fill', 'white'); mask.append(ground);
    for (const part of pinParts) { const cover = document.createElementNS(wires.namespaceURI, 'ellipse'); cover.setAttribute('cx', String((part.left + part.width / 2 - bounds.left) / state.zoom)); cover.setAttribute('cy', String((part.top + part.height / 2 - bounds.top) / state.zoom)); cover.setAttribute('rx', String(part.width / state.zoom / 2)); cover.setAttribute('ry', String(part.height / state.zoom / 2)); cover.setAttribute('fill', 'black'); mask.append(cover); } defs.append(mask);
    const line = (from: { x: number; y: number; color: string }, to: { x: number; y: number; color?: string }, preview = false): void => {
      const length = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y)), dx = (to.x - from.x) / length * 4, dy = (to.y - from.y) / length * 4;
      const start = { x: from.x + dx, y: from.y + dy }, end = { x: to.x - (preview ? 0 : dx), y: to.y - (preview ? 0 : dy) };
      const gradient = document.createElementNS(wires.namespaceURI, 'linearGradient'), id = `cord-${crypto.randomUUID()}`; gradient.id = id; gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
      for (const [name, value] of Object.entries({ x1: start.x, y1: start.y, x2: end.x, y2: end.y })) gradient.setAttribute(name, String(value));
      for (const [offset, color] of [['0%', from.color], ['100%', to.color ?? from.color]]) { const stop = document.createElementNS(wires.namespaceURI, 'stop'); stop.setAttribute('offset', offset ?? '0%'); stop.setAttribute('stop-color', color ?? from.color); gradient.append(stop); } defs.append(gradient);
      const cord = document.createElementNS(wires.namespaceURI, 'g'); cord.classList.add('character-reference-cord'); cord.setAttribute('mask', `url(#${maskId})`); if (preview) cord.classList.add('character-reference-wire-preview');
      const d = `M${String(start.x)} ${String(start.y)} Q${String((start.x + end.x) / 2)} ${String((start.y + end.y) / 2 + Math.min(48, length * .07))} ${String(end.x)} ${String(end.y)}`;
      for (const material of ['shadow', 'edge', 'fiber', 'twist', 'light']) { const path = document.createElementNS(wires.namespaceURI, 'path'); path.classList.add(`character-cord-${material}`); path.setAttribute('d', d); if (material === 'fiber') path.setAttribute('stroke', `url(#${id})`); cord.append(path); }
      paths.append(cord);
    };
    for (const reference of state.values.references) for (const target of reference.links ?? []) { const pair = [reference.id, target].sort().join('/'), from = anchors.get(reference.id), to = anchors.get(target); if (!from || !to || seen.has(pair)) continue; seen.add(pair); line(from, to); }
    const source = anchors.get(linkSource); if (source && linkPoint) line(source, linkPoint, true);
    wires.replaceChildren(paths);
    for (const card of boardStage.querySelectorAll<HTMLElement>('[data-reference]')) card.dataset.linking = String(card.dataset.reference === linkSource);
  };
  const queueWires = (): void => { if (wireFrame) return; wireFrame = requestAnimationFrame(() => { wireFrame = 0; drawWires(); }); };
  const connectReference = (id: string): void => {
    const state = access.read(); if (!state?.edit || !state.connect || !access.commit()) return;
    if (!linkSource) { linkSource = id; linkPoint = undefined; queueWires(); return; }
    const source = linkSource; linkSource = ''; linkPoint = undefined;
    if (source !== id && !state.values.references.some(reference => reference.id === source && reference.links?.includes(id) || reference.id === id && reference.links?.includes(source))) access.write('references', state.values.references.map(reference => reference.id === source ? { ...reference, links: [...(reference.links ?? []), id] } : reference));
    queueWires();
  };
  boardStage.addEventListener('pointermove', event => { if (!linkSource) return; const bounds = boardStage.getBoundingClientRect(), zoom = access.read()?.zoom ?? 1.5; linkPoint = { x: (event.clientX - bounds.left) / zoom, y: (event.clientY - bounds.top) / zoom }; queueWires(); });
  const renderFinder = (): void => {
    const query = search.value.trim().toLocaleLowerCase(), references = access.read()?.values.references.filter(reference => `${reference.caption} ${reference.note ?? ''}`.toLocaleLowerCase().includes(query)) ?? []; results.replaceChildren();
    for (const reference of references) { const result = button(reference.caption || 'Untitled', () => { if (!access.commit()) return; finder.hidePopover(); selectReference(reference.id); }); const kind = document.createElement('small'); kind.textContent = reference.kind === 'note' ? 'Note' : 'Image'; result.append(kind); results.append(result); }
    if (!references.length) { const empty = document.createElement('p'); empty.setAttribute('role', 'status'); empty.textContent = query ? 'No matching references.' : 'No references yet.'; results.append(empty); }
  };
  const findReference = button('Find reference', () => {
    if (finder.matches(':popover-open')) { finder.hidePopover(); return; }
    const rect = findReference.getBoundingClientRect(); finder.style.left = `${String(Math.max(8, Math.min(window.innerWidth - 328, rect.right - 320)))}px`; finder.style.top = `${String(Math.max(8, Math.min(window.innerHeight - 180, rect.bottom + 8)))}px`; search.value = ''; renderFinder(); finder.showPopover(); search.focus();
  }, 'M10 10l4 4M7 2a5 5 0 1 0 0 10A5 5 0 0 0 7 2');
  const findLabel = document.createElement('span'); findLabel.textContent = 'Find reference'; findReference.append(findLabel); findReference.setAttribute('aria-haspopup', 'dialog'); findReference.setAttribute('aria-controls', finder.id);
  finder.addEventListener('toggle', () => { findReference.setAttribute('aria-expanded', String(finder.matches(':popover-open'))); }); search.addEventListener('input', renderFinder);
  finder.addEventListener('keydown', event => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); finder.hidePopover(); findReference.focus(); });
  const referencesShared = document.createElement('span'); referencesShared.className = 'character-shared'; referencesShared.textContent = 'Shared references';
  const connectionsShared = document.createElement('span'); connectionsShared.className = 'character-shared'; connectionsShared.textContent = 'Shared connections';
  boardToolbar.append(findReference); const boardBody = document.createElement('div'); boardBody.className = 'character-studio-columns'; boardBody.append(boardViewport, referenceInspector);
  board.append(boardToolbar, boardBody, zoomControls, error, finder);
  const cancelDrag = (): void => {
    if (!drag) return; const current = drag; drag = undefined; suppressClick = true; delete current.card.dataset.dragging;
    locate(current.card, current); current.card.style.setProperty('--reference-rotation', `${String(current.rotation)}deg`); queueWires();
    if (current.card.hasPointerCapture(current.pointer)) current.card.releasePointerCapture(current.pointer);
  };
  window.addEventListener('keydown', event => { if (event.key !== 'Escape') return; if (linkSource) { event.preventDefault(); linkSource = ''; linkPoint = undefined; queueWires(); return; } if (drag) { event.preventDefault(); event.stopPropagation(); cancelDrag(); return; } if (!referenceDetails && referenceId && !board.hidden) { referenceId = ''; update(); } }, { signal: access.signal });
  window.addEventListener('blur', cancelDrag, { signal: access.signal });
  boardStage.addEventListener('pointerdown', event => { if (event.target !== boardStage || !access.commit()) return; referenceId = ''; referenceDetails = false; linkSource = ''; linkPoint = undefined; queueWires(); update(); });
  const renderBoard = (): void => {
    const state = access.read(); if (!state) return; boardStage.replaceChildren(wires); boardStage.style.minHeight = `${String(Math.max(360, Math.ceil(state.values.references.length / boardColumns()) * 340))}px`;
    renderFinder();
    emptyBoard.hidden = state.values.references.length > 0;
    state.values.references.forEach((reference, index) => {
      const card = document.createElement('article'); card.className = `character-board-card${reference.kind === 'note' ? ' character-board-note' : ''}`; card.dataset.reference = reference.id; card.dataset.selected = String(reference.id === referenceId);
      card.style.setProperty('--reference-rotation', `${String(referenceRotation(reference))}deg`);
      card.style.setProperty('--pin-color', reference.pinColor ?? defaultPinColor);
      const paper = document.createElement('div'); paper.className = 'character-paper-object';
      const pin = button(`Rotate reference: ${reference.caption || 'Untitled'}`, () => { connectReference(reference.id); }), shape = document.createElement('span'); pin.className = 'character-board-pin'; pin.disabled = !state.edit; pin.title = 'Drag pin to rotate · Arrow keys to turn'; shape.className = 'character-pin-shape'; shape.setAttribute('aria-hidden', 'true'); const anchor = icon('M13 6a5 5 0 1 0 0 5M13 2v4H9'); anchor.classList.add('character-pin-anchor'); const connector = icon('M2 8h12M8 2v12'); connector.classList.add('character-pin-connector'); pin.replaceChildren(shape, anchor, connector);
      for (const [index, diameter] of pinProfile.entries()) {
        const layer = index - 8;
        const part = document.createElement('span'); part.className = layer < 0 ? 'character-pin-needle' : layer < 6 || layer > 16 ? 'character-pin-flange' : 'character-pin-neck';
        part.style.setProperty('--pin-diameter', `${String(diameter)}px`); part.style.transform = `translateZ(${String(layer)}px)`; shape.append(part);
      }
      const face = document.createElement('span'), tie = document.createElement('span'); face.className = 'character-pin-face'; tie.className = 'character-pin-tie'; shape.append(face, tie); card.append(pin);
      const open = button(`Select reference: ${reference.caption || 'Untitled'}`, () => { if (access.read()?.select && !suppressClick) selectReference(reference.id); suppressClick = false; }); open.className = 'character-board-content';
      if (reference.image) { const image = document.createElement('img'); image.addEventListener('load', () => { card.style.setProperty('--reference-aspect', String(image.naturalWidth / Math.max(1, image.naturalHeight))); locate(card, positions(reference, index)); }, { once: true }); image.src = reference.image; image.alt = reference.caption || 'Character reference'; image.width = 220; image.height = 160; open.replaceChildren(image); }
      else open.replaceChildren();
      if (reference.kind === 'note') { const caption = document.createElement('strong'); caption.textContent = reference.caption || 'Untitled note'; open.append(caption); }
      if (reference.kind === 'note' && reference.note) { const note = document.createElement('p'); note.textContent = reference.note; open.append(note); }
      if (reference.kind === 'note' && reference.category) { const category = document.createElement('small'); category.textContent = catalogue.find(item => item.id === reference.category)?.title ?? ''; open.append(category); }
      paper.append(open); card.append(paper);
      card.addEventListener('dragstart', event => { event.preventDefault(); });
      card.addEventListener('pointerdown', event => {
        const current = access.read(); if (event.button !== 0 || !current?.select || !access.commit()) return;
        suppressClick = false; selectReference(reference.id, false);
        if (!current.edit) return;
        event.preventDefault(); const position = positions(reference, index), bounds = pin.getBoundingClientRect(), centerX = bounds.left + bounds.width / 2, centerY = bounds.top + bounds.height / 2;
        drag = { id: reference.id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, ...position, rangeX: Math.max(1, boardStage.clientWidth - card.offsetWidth - 80), rangeY: Math.max(1, boardStage.clientHeight - card.offsetHeight - 80), width: card.offsetWidth, card, moved: false, rotation: referenceRotation(reference), angle: Math.atan2(event.clientY - centerY, event.clientX - centerX), centerX, centerY, rotating: event.target instanceof Node && pin.contains(event.target) };
        card.dataset.dragging = drag.rotating ? 'rotate' : 'move'; (drag.rotating ? pin : open).focus({ preventScroll: true }); card.setPointerCapture(event.pointerId);
      });
      card.addEventListener('pointermove', event => {
        if (!drag || drag.card !== card || drag.pointer !== event.pointerId) return;
        drag.moved ||= Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 3;
        if (drag.rotating) { const angle = Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX); card.style.setProperty('--reference-rotation', `${String(drag.rotation + (angle - drag.angle) * 180 / Math.PI)}deg`); queueWires(); return; }
        const x = Math.max(0, Math.min(1, drag.x + (event.clientX - drag.startX) / (drag.rangeX * (access.read()?.zoom ?? 1.5)))), y = Math.max(0, Math.min(1, drag.y + (event.clientY - drag.startY) / (drag.rangeY * (access.read()?.zoom ?? 1.5))));
        paintCard(card, 40 + x * drag.rangeX, 40 + y * drag.rangeY, drag.rangeX + drag.width + 80, drag.width);
      });
      const finish = (event: PointerEvent, save: boolean): void => {
        if (!drag || drag.card !== card || drag.pointer !== event.pointerId) return;
        const current = drag; drag = undefined; delete card.dataset.dragging; suppressClick = current.moved;
        if (!save || !current.moved) { locate(card, current); card.style.setProperty('--reference-rotation', `${String(current.rotation)}deg`); }
        else if (current.rotating) rotateReference(current.id, current.rotation + (Math.atan2(event.clientY - current.centerY, event.clientX - current.centerX) - current.angle) * 180 / Math.PI);
        else moveReference(current.id, current.x + (event.clientX - current.startX) / (current.rangeX * (access.read()?.zoom ?? 1.5)), current.y + (event.clientY - current.startY) / (current.rangeY * (access.read()?.zoom ?? 1.5)));
        if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
        if (save && !current.moved && !current.rotating) selectReference(current.id);
      };
      card.addEventListener('pointerup', event => { finish(event, true); }); card.addEventListener('pointercancel', event => { finish(event, false); }); card.addEventListener('lostpointercapture', cancelDrag);
      card.addEventListener('keydown', event => {
        if (!state.edit || !access.read()?.select || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key) || !access.commit()) return;
        event.preventDefault(); const current = access.read()?.values.references.find(item => item.id === reference.id); if (!current) return;
        const rotating = event.target === pin; referenceId = reference.id;
        if (rotating) rotateReference(reference.id, event.key === 'Home' ? 0 : referenceRotation(current) + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) * (event.shiftKey ? 15 : 1));
        else if (event.key !== 'Home') { const position = positions(current, index), step = event.shiftKey ? .04 : .01; moveReference(reference.id, position.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), position.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)); }
        boardStage.querySelector<HTMLButtonElement>(`[data-reference="${reference.id}"] ${rotating ? '.character-board-pin' : '.character-board-content'}`)?.focus({ preventScroll: true });
      });
      boardStage.append(card);
    });
    layoutBoard();
  };
  const renderReferenceInspector = (): void => {
    const state = access.read(), reference = selectedReference(); if (!state) return;
    const signature = `${state.key}/${reference?.id ?? ''}/${String(state.edit)}`;
    if (referenceForm !== signature) {
      referenceForm = signature; referenceEditors.clear(); referenceInspector.replaceChildren();
      if (!reference) { referenceInspector.append(heading('A closer look', 'Select an image or note to edit its details.')); return; }
      referenceInspector.append(heading(reference.kind === 'note' ? 'Note' : 'Reference', 'Link a visual detail to the part of the character it helps describe.'));
      const referenceLinks = document.createElement('section'); referenceLinks.className = 'character-reference-links'; referenceLinks.setAttribute('aria-label', 'Reference connections'); referenceInspector.append(referenceLinks);
      if (reference.image) { const image = document.createElement('img'); image.src = reference.image; image.alt = reference.caption || 'Selected reference'; image.width = 280; image.height = 200; referenceInspector.append(image); }
      setEditor(referenceEditors, 'caption', 'Reference title', reference.caption, referenceInspector, false);
      setEditor(referenceEditors, 'note', 'Reference note', reference.note ?? '', referenceInspector);
      setEditor(referenceEditors, 'category', 'Linked category', reference.category ?? '', referenceInspector, false, [{ value: '', name: 'No category' }, ...catalogue.map(item => ({ value: item.id, name: item.title }))]);
      if (reference.kind !== 'note') setEditor(referenceEditors, 'view', 'Appearance study', reference.view ?? '', referenceInspector, false, [{ value: '', name: 'Not a turnaround study' }, ...['front', 'side', 'back'].map(value => ({ value, name: `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}` }))]);
      if (state.edit) {
        const label = document.createElement('label'), color = document.createElement('input'); label.textContent = 'Pin color'; color.type = 'color'; color.name = 'pinColor'; color.setAttribute('aria-label', 'Pin color'); color.value = reference.pinColor ?? defaultPinColor; label.append(color);
        const presets = document.createElement('div'); presets.className = 'character-pin-colors'; presets.setAttribute('role', 'group'); presets.setAttribute('aria-label', 'Pin color presets');
        const saveColor = (value: string): void => { if (!access.read()?.edit || !access.commit()) return; const current = access.read(); if (current?.edit) access.write('references', current.values.references.map(item => item.id === reference.id ? { ...item, pinColor: value } : item)); };
        for (const [index, value] of groupColors.entries()) { const swatch = button(`Pin color: ${['White', 'Blue', 'Red', 'Yellow', 'Green', 'Pink', 'Purple', 'Teal', 'Orange'][index] ?? value}`, () => { color.value = value; saveColor(value); }); swatch.textContent = ''; swatch.style.background = value; swatch.dataset.color = value; presets.append(swatch); }
        referenceInspector.append(presets, label);
        color.addEventListener('input', () => { boardStage.querySelector<HTMLElement>(`[data-reference="${reference.id}"]`)?.style.setProperty('--pin-color', color.value); queueWires(); });
        color.addEventListener('change', () => { saveColor(color.value); });
      }
      if (state.edit) for (const [axis, title] of [['x', 'Horizontal position'], ['y', 'Vertical position']] as const) {
        const label = document.createElement('label'), input = document.createElement('input'); label.textContent = title; input.type = 'range'; input.min = '0'; input.max = '100'; input.dataset.axis = axis; input.setAttribute('aria-label', `Reference ${title.toLowerCase()}`); label.append(input); referenceInspector.append(label);
        input.addEventListener('change', () => { const current = selectedReference(); if (!current || !access.commit()) return; const position = positions(current, access.read()?.values.references.findIndex(item => item.id === current.id) ?? 0); moveReference(current.id, axis === 'x' ? Number(input.value) / 100 : position.x, axis === 'y' ? Number(input.value) / 100 : position.y); });
      }
      if (state.edit) {
        const label = document.createElement('label'), rotation = document.createElement('input'), value = document.createElement('output'); label.textContent = 'Rotation'; rotation.type = 'range'; rotation.min = '-180'; rotation.max = '180'; rotation.step = '1'; rotation.dataset.rotation = 'true'; rotation.setAttribute('aria-label', 'Reference rotation'); value.className = 'character-rotation-value'; label.append(rotation, value); referenceInspector.append(label);
        const restore = (): void => { const current = selectedReference(); if (!current) return; const angle = referenceRotation(current); rotation.value = String(angle); value.textContent = `${String(angle)}°`; boardStage.querySelector<HTMLElement>(`[data-reference="${current.id}"]`)?.style.setProperty('--reference-rotation', `${String(angle)}deg`); queueWires(); };
        rotation.addEventListener('input', () => { value.textContent = `${rotation.value}°`; boardStage.querySelector<HTMLElement>(`[data-reference="${reference.id}"]`)?.style.setProperty('--reference-rotation', `${rotation.value}deg`); queueWires(); });
        rotation.addEventListener('change', () => { if (!access.commit()) { restore(); return; } rotateReference(reference.id, Number(rotation.value)); });
        rotation.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); restore(); } });
        referenceInspector.append(button('Reset rotation', () => { rotateReference(reference.id, 0); }));
      }
      if (state.edit) { const erase = button('Remove reference', () => { if (!access.commit()) return; access.confirm('Remove reference', erase, `Remove “${reference.caption || 'Untitled'}” from this instance’s references?`, () => { const current = access.read(); if (current?.edit) access.write('references', pruneReferenceLinks(current.values.references.filter(item => item.id !== reference.id))); }); }); referenceInspector.append(erase); }
    }
    if (!referenceInspector.querySelector('.character-inspector-close')) closeDetails(referenceInspector, () => { referenceDetails = false; }, findReference);
    if (reference) { updateEditors(referenceEditors, reference, state.edit); const image = referenceInspector.querySelector('img'); if (image && image.getAttribute('src') !== reference.image) image.src = reference.image; }
    const pinColor = referenceInspector.querySelector<HTMLInputElement>('input[name="pinColor"]'); if (pinColor && document.activeElement !== pinColor) pinColor.value = reference?.pinColor ?? defaultPinColor;
    for (const swatch of referenceInspector.querySelectorAll<HTMLButtonElement>('.character-pin-colors button')) swatch.setAttribute('aria-pressed', String(swatch.dataset.color === (reference?.pinColor ?? defaultPinColor).toLowerCase()));
    const referenceLinks = referenceInspector.querySelector<HTMLElement>('.character-reference-links');
    if (reference && referenceLinks) {
      const connected = state.values.references.filter(other => reference.links?.includes(other.id) || other.links?.includes(reference.id)), signature = JSON.stringify(connected.map(other => [other.id, other.caption]));
      referenceLinks.hidden = connected.length === 0;
      if (referenceLinks.dataset.signature !== signature) {
        referenceLinks.dataset.signature = signature;
        referenceLinks.replaceChildren(...connected.map(other => {
          const row = document.createElement('div'), title = document.createElement('span'); title.textContent = other.caption || 'Untitled'; row.append(title);
          if (state.edit) row.append(button(`Disconnect reference: ${other.caption || 'Untitled'}`, () => { const current = access.read(); if (current?.edit && access.commit()) access.write('references', current.values.references.map(item => item.links ? { ...item, links: item.links.filter(target => !(item.id === reference.id && target === other.id || item.id === other.id && target === reference.id)) } : item)); }, 'M4 4l8 8M12 4l-8 8'));
          return row;
        }));
      }
    }
    for (const input of referenceInspector.querySelectorAll<HTMLInputElement>('input[data-axis]')) { const position = reference ? positions(reference, state.values.references.indexOf(reference)) : { x: 0, y: 0 }; if (document.activeElement !== input) input.value = String(Math.round((input.dataset.axis === 'x' ? position.x : position.y) * 100)); }
    const rotation = referenceInspector.querySelector<HTMLInputElement>('input[data-rotation]'), angle = reference ? referenceRotation(reference) : 0; if (rotation && document.activeElement !== rotation) rotation.value = String(angle); const rotationValue = referenceInspector.querySelector('output'); if (rotationValue) rotationValue.textContent = `${String(angle)}°`;
    if (referencesShared.parentElement !== referenceInspector) referenceInspector.append(referencesShared);
  };
  let addingConnection = false;
  const addConnection = button('Add relationship', () => { if (!access.read()?.edit || !access.commit()) return; addingConnection = true; connectionDetails = true; connectionId = ''; update(); connectionInspector.querySelector('select')?.focus(); });
  const previous = button('Previous relationships', () => { if (!access.commit()) return; page = Math.max(0, page - 1); connectionId = access.read()?.values.connections[page * relationshipPageSize]?.id ?? ''; graphSignature = ''; update(); });
  const next = button('Next relationships', () => { if (!access.commit()) return; page++; connectionId = access.read()?.values.connections[page * relationshipPageSize]?.id ?? ''; graphSignature = ''; update(); });
  relationToolbar.append(addConnection, previous, next, relationshipPage, connectionsShared); const relationshipBody = document.createElement('div'); relationshipBody.className = 'character-studio-columns'; relationshipBody.append(graph, connectionInspector);
  relationships.append(heading('The people in their life', 'Explore real connections between the characters in this project.'), relationToolbar, relationshipBody);
  const fullName = (values: CharacterValues): string => [values.name, values.middleName, values.familyName].filter(Boolean).join(' ');
  const layoutGraph = (): void => {
    const bounds = graph.getBoundingClientRect(), center = graph.querySelector('.character-connection-center > img, .character-connection-center > svg')?.getBoundingClientRect();
    if (!center || !bounds.width || !bounds.height) return;
    const cx = center.x + center.width / 2, cy = center.y + center.height / 2;
    const occupied = [...graph.querySelectorAll('.character-connection-node')].map(node => { const rect = node.getBoundingClientRect(); return { left: rect.left - bounds.left - 8, top: rect.top - bounds.top - 8, right: rect.right - bounds.left + 8, bottom: rect.bottom - bounds.top + 8 }; });
    const edges = [...graph.querySelectorAll<SVGLineElement>('line')].map(line => {
      const portrait = graph.querySelector(`[data-connection="${line.dataset.connection ?? ''}"] > img, [data-connection="${line.dataset.connection ?? ''}"] > svg`)?.getBoundingClientRect();
      if (!portrait) return undefined;
      const x = portrait.x + portrait.width / 2, y = portrait.y + portrait.height / 2, length = Math.hypot(x - cx, y - cy) || 1, dx = (x - cx) / length, dy = (y - cy) / length;
      const caption = graph.querySelector<HTMLElement>(`.character-connection-caption[data-connection="${line.dataset.connection ?? ''}"]`), size = caption?.getBoundingClientRect();
      return { line, caption, width: size?.width ?? 0, height: size?.height ?? 0, dx, dy, x1: (cx - bounds.x + dx * (center.width / 2 + 8)) / bounds.width * 1000, y1: (cy - bounds.y + dy * (center.height / 2 + 8)) / bounds.height * 600, x2: (x - bounds.x - dx * (portrait.width / 2 + 8)) / bounds.width * 1000, y2: (y - bounds.y - dy * (portrait.height / 2 + 8)) / bounds.height * 600 };
    });
    const lineDistance = (edge: NonNullable<typeof edges[number]>, x: number, y: number): number => {
      const startX = edge.x1 / 1000 * bounds.width, startY = edge.y1 / 600 * bounds.height, dx = (edge.x2 - edge.x1) / 1000 * bounds.width, dy = (edge.y2 - edge.y1) / 600 * bounds.height;
      const amount = Math.max(0, Math.min(1, ((x - startX) * dx + (y - startY) * dy) / Math.max(1, dx * dx + dy * dy)));
      return Math.hypot(x - startX - amount * dx, y - startY - amount * dy);
    };
    for (const edge of edges) {
      if (!edge) continue;
      for (const field of ['x1', 'y1', 'x2', 'y2'] as const) edge.line.setAttribute(field, String(edge[field]));
      const caption = edge.caption; if (!caption) continue;
      const clearance = Math.abs(edge.dy) * edge.width / 2 + Math.abs(edge.dx) * edge.height / 2 + 12;
      const candidates = [.5, .35, .65].flatMap(amount => [clearance, -clearance, clearance + 20, -clearance - 20].map(offset => { const x = (edge.x1 + (edge.x2 - edge.x1) * amount) / 1000 * bounds.width - edge.dy * offset, y = (edge.y1 + (edge.y2 - edge.y1) * amount) / 600 * bounds.height + edge.dx * offset; return { x, y, left: x - edge.width / 2, top: y - edge.height / 2, right: x + edge.width / 2, bottom: y + edge.height / 2 }; }));
      const position = candidates.find(candidate => candidate.left >= 12 && candidate.top >= 12 && candidate.right <= bounds.width - 12 && candidate.bottom <= bounds.height - 12 && !occupied.some(rect => candidate.left < rect.right && candidate.right > rect.left && candidate.top < rect.bottom && candidate.bottom > rect.top) && edges.every(other => !other || other === edge || lineDistance(other, candidate.x, candidate.y) > lineDistance(edge, candidate.x, candidate.y) + 8));
      caption.style.visibility = position ? 'visible' : 'hidden';
      if (position) { caption.style.left = `clamp(12px, ${String(position.left / bounds.width * 100)}%, calc(100% - ${String(edge.width + 12)}px))`; caption.style.top = `clamp(12px, ${String(position.top / bounds.height * 100)}%, calc(100% - ${String(edge.height + 12)}px))`; occupied.push(position); }
    }
  };
  const graphSize = new ResizeObserver(() => { if (graphFrame) return; graphFrame = requestAnimationFrame(() => { graphFrame = 0; layoutGraph(); }); });
  const renderGraph = (): void => {
    const state = access.read(); if (!state) return; graphSize.disconnect(); graph.replaceChildren();
    const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); lines.setAttribute('viewBox', '0 0 1000 600'); lines.setAttribute('preserveAspectRatio', 'none'); lines.setAttribute('aria-hidden', 'true'); graph.append(lines);
    const node = (name: string, portrait: string, label: string, x: number, y: number, run?: () => void): HTMLElement => {
      const element = run ? button(`Open relationship: ${name}`, run) : document.createElement('div'); element.className = `character-connection-node${run ? '' : ' character-connection-center'}`; element.style.left = `${String(x)}%`; element.style.top = `${String(y)}%`; element.replaceChildren();
      if (portrait) { const image = document.createElement('img'); image.src = portrait; image.alt = ''; image.width = image.height = run ? 76 : 120; element.append(image); } else element.append(icon('M11 5a3 3 0 1 0-6 0 3 3 0 0 0 6 0ZM2 15v-2a6 6 0 0 1 12 0v2'));
      const title = document.createElement('strong'), description = document.createElement('span'); title.textContent = name; title.title = name; description.textContent = label; element.append(title, description); graph.append(element); return element;
    };
    const center = node(fullName(state.values), state.values.portrait, state.values.roleSummary || 'This instance', 50, 58);
    if (state.values.quote) { const quote = document.createElement('em'); quote.textContent = `“${state.values.quote}”`; center.append(quote); }
    const connections = state.values.connections.slice(page * relationshipPageSize, (page + 1) * relationshipPageSize);
    const angles = connections.length === 1 ? [-30] : connections.length === 2 ? [-150, -30] : connections.length === 3 ? [-90, 150, 30] : connections.length === 4 ? [-150, -30, 150, 30] : [-90, -150, -30, 150, 30];
    connections.forEach((connection, index) => {
      const target = state.characters.find(item => item.id === connection.target); if (!target) return; const values = instanceValues(target), degrees = angles[index] ?? -30, angle = degrees * Math.PI / 180, x = 50 + Math.cos(angle) * 35, y = 50 + Math.sin(angle) * 35;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); line.dataset.connection = connection.id; line.dataset.selected = String(connectionId === connection.id); lines.append(line);
      const element = node(fullName(values), values.portrait, connection.label || 'Connection', x, y, () => { if (!access.commit()) return; addingConnection = false; connectionDetails = true; connectionId = connection.id; update(); focusDetails(connectionInspector, graph, connectionInspector.querySelector('input, button')); }); element.dataset.connection = connection.id; element.dataset.selected = String(connection.id === connectionId); element.dataset.slot = degrees === -90 ? 'top' : 'side';
      element.setAttribute('aria-description', connection.bond);
      if (connection.bond && (connections.length <= 5 || connection.id === connectionId)) { const caption = document.createElement('p'); caption.className = 'character-connection-caption'; caption.dataset.connection = connection.id; const words = connection.bond.trim().split(/\s+/u); caption.textContent = words.length > 7 ? `${words.slice(0, 7).join(' ')}…` : connection.bond; caption.title = connection.bond; graph.append(caption); }
    });
    if (!connections.length) { const help = document.createElement('p'); help.className = 'character-map-empty'; help.textContent = 'No relationships yet. Add a character relationship to begin.'; graph.append(help); }
    graphSize.observe(graph); for (const portrait of graph.querySelectorAll('.character-connection-node > img, .character-connection-node > svg')) graphSize.observe(portrait);
    layoutGraph();
  };
  const renderConnectionInspector = (): void => {
    const state = access.read(); if (!state) return; const connection = state.values.connections.find(item => item.id === connectionId), target = state.characters.find(item => item.id === connection?.target);
    const signature = `${state.key}/${connection?.id ?? ''}/${String(state.edit)}/${String(addingConnection)}`;
    if (connectionForm !== signature) {
      connectionForm = signature; connectionEditors.clear(); connectionInspector.replaceChildren();
      if (connection && target) {
        connectionInspector.append(heading(fullName(instanceValues(target)), connection.label || 'Connection'));
        setEditor(connectionEditors, 'label', 'Relationship label', connection.label, connectionInspector, false);
        setEditor(connectionEditors, 'bond', 'What connects them', connection.bond, connectionInspector);
        setEditor(connectionEditors, 'tension', 'Where it hurts', connection.tension, connectionInspector);
        setEditor(connectionEditors, 'context', 'What changes with context', connection.context, connectionInspector);
        if (state.edit) { const erase = button('Remove relationship', () => { if (!access.commit()) return; access.confirm('Remove relationship', erase, `Remove this connection to ${fullName(instanceValues(target))} from the current instance?`, () => { const current = access.read(); if (current?.edit) access.write('connections', current.values.connections.filter(item => item.id !== connection.id)); }); }); connectionInspector.append(erase); }
      } else {
        connectionInspector.append(heading('Add a connection', 'Choose an existing character. Describe what the relationship means to this instance.'));
        if (!state.edit) return;
        const available = state.characters.filter(item => item.id !== state.character.id && !state.values.connections.some(connection => connection.target === item.id));
        if (!available.length) { const help = document.createElement('p'); help.textContent = 'Create another character using the character switcher, or select an existing connection.'; connectionInspector.append(help); return; }
        const form = document.createElement('form'), label = document.createElement('label'), select = document.createElement('select'), title = document.createElement('input'); label.textContent = 'Character'; select.setAttribute('aria-label', 'Related character');
        for (const character of available) { const option = document.createElement('option'); option.value = character.id; option.textContent = fullName(instanceValues(character)); select.append(option); } label.append(select); title.setAttribute('aria-label', 'New relationship label'); title.placeholder = 'Brother, friend, mentor…'; title.maxLength = 80;
        const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Create relationship'; form.append(label, title, submit); connectionInspector.append(form);
        form.addEventListener('submit', event => { event.preventDefault(); const current = access.read(); if (!current?.edit || !access.commit()) return; const connection = { id: `connection-${crypto.randomUUID()}`, target: select.value, label: title.value.trim(), bond: '', tension: '', context: '' }; if (access.write('connections', [...current.values.connections, connection])) { addingConnection = false; connectionId = connection.id; page = Math.floor(current.values.connections.length / relationshipPageSize); update(); connectionEditors.get('bond')?.input.focus(); } });
      }
    }
    if (!connectionInspector.querySelector('.character-inspector-close')) closeDetails(connectionInspector, () => { connectionDetails = false; graph.dataset.focused = 'false'; }, addConnection);
    if (connection && target) { updateEditors(connectionEditors, connection, state.edit); const title = connectionInspector.querySelector('h2'), description = connectionInspector.querySelector('header p'); if (title) title.textContent = fullName(instanceValues(target)); if (description) description.textContent = connection.label || 'Connection'; }
  };
  const studyRequests = new Map<string, number>();
  const renderStudies = (): void => {
    const state = access.read(); if (!state) return; studies.replaceChildren(); studies.append(heading('Appearance studies', 'See every view together. Upload studies or use the current portrait as the front reference.'));
    const strip = document.createElement('div'); strip.className = 'character-study-strip'; studies.append(strip);
    for (const view of ['front', 'side', 'back'] as const) {
      const reference = state.values.references.find(item => item.kind !== 'note' && item.view === view), source = reference?.image || (view === 'front' ? state.values.portrait : '');
      const figure = document.createElement('figure'), caption = document.createElement('figcaption'); caption.textContent = `${(view[0] ?? '').toUpperCase()}${view.slice(1)}`;
      if (source) { const image = document.createElement('img'); image.src = source; image.alt = `${caption.textContent} appearance study`; image.width = 240; image.height = 400; figure.append(image); }
      else { const placeholder = document.createElement('div'); placeholder.className = 'character-study-empty'; placeholder.append(icon('M2 2h12v12H2zM3 12l4-5 3 3 3-4')); figure.append(placeholder); }
      figure.append(caption); strip.append(figure);
      if (source) {
        const notes = document.createElement('div'); notes.className = 'character-study-annotations';
        const fields = view === 'front' ? ['hair', 'posture'] : view === 'side' ? ['clothing'] : ['signature-possessions'];
        for (const trait of state.values.categories.find(category => category.id === 'appearance')?.traits.filter(trait => fields.includes(trait.id) && trait.value) ?? []) { const callout = document.createElement('div'), note = document.createElement('p'); note.textContent = trait.value; callout.append(note); notes.append(callout); }
        figure.append(notes);
      }
      if (state.edit) {
        const upload = document.createElement('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp'; upload.hidden = true; upload.setAttribute('aria-label', `Upload ${view} study`);
        figure.append(button(`${source ? 'Replace' : 'Add'} ${view} study`, () => { if (access.read()?.edit && access.commit()) upload.click(); }), upload);
        upload.addEventListener('change', () => {
          const file = upload.files?.[0]; upload.value = ''; if (!file || !access.read()?.edit) return; const epoch = request, uploadKey = state.key, token = (studyRequests.get(view) ?? 0) + 1; studyRequests.set(view, token);
          access.prepareImage(file).then(image => { const current = access.read(); if (access.signal.aborted || !current?.edit || current.key !== uploadKey || epoch !== request || token !== studyRequests.get(view)) return; const reference = current.values.references.find(item => item.view === view && item.kind !== 'note'), references = reference ? current.values.references.map(item => item.id === reference.id ? { ...item, image } : item) : [...current.values.references, { id: `reference-${crypto.randomUUID()}`, image, caption: `${caption.textContent} study`, view, category: 'appearance' }]; access.write('references', references); }).catch((error: unknown) => { if (!access.signal.aborted && epoch === request) fail(error instanceof Error ? error.message : 'Could not prepare this study.'); });
        });
        if (reference) { const erase = button(`Remove ${view} study`, () => { if (!access.commit()) return; access.confirm('Remove appearance study', erase, `Remove the ${view} study from this instance’s references?`, () => { const current = access.read(); if (current?.edit) access.write('references', pruneReferenceLinks(current.values.references.filter(item => item.id !== reference.id))); }); }); figure.append(erase); }
      }
    }
  };
  const update = (): void => {
    const state = access.read(), nextKey = `${state?.key ?? ''}/${String(state?.edit)}`;
    if (key !== nextKey) { key = nextKey; request++; drag = undefined; linkSource = ''; linkPoint = undefined; referenceEditors.clear(); connectionEditors.clear(); referenceId = ''; connectionId = ''; addingConnection = false; page = 0; referenceForm = connectionForm = referenceSignature = graphSignature = studySignature = ''; }
    if (!state) return;
    if (!state.values.references.some(item => item.id === referenceId)) referenceId = '';
    if (!addingConnection && !state.values.connections.some(item => item.id === connectionId)) connectionId = state.values.connections[0]?.id ?? '';
    page = Math.min(page, Math.max(0, Math.ceil(state.values.connections.length / relationshipPageSize) - 1));
    referencesShared.hidden = !('references' in (state.character.sharedValues ?? {})); connectionsShared.hidden = !('connections' in (state.character.sharedValues ?? {}));
    addImages.hidden = addNote.hidden = addConnection.hidden = !state.edit; addConnection.disabled = state.values.connections.length >= 24;
    addNote.disabled = state.values.references.filter(reference => reference.kind === 'note').length >= 50; addImages.disabled = state.values.references.filter(reference => reference.kind !== 'note').length >= 12;
    previous.hidden = next.hidden = relationshipPage.hidden = state.values.connections.length <= relationshipPageSize; previous.disabled = page === 0; next.disabled = (page + 1) * relationshipPageSize >= state.values.connections.length;
    relationshipPage.textContent = `${String(page * relationshipPageSize + 1)}–${String(Math.min((page + 1) * relationshipPageSize, state.values.connections.length))} of ${String(state.values.connections.length)} connections`;
    if (boardStage.dataset.zoom !== String(state.zoom)) {
      cancelDrag(); const previous = Number(boardStage.dataset.zoom) || state.zoom, centerX = (boardViewport.scrollLeft + boardViewport.clientWidth / 2) / previous, centerY = (boardViewport.scrollTop + boardViewport.clientHeight / 2) / previous;
      boardStage.dataset.zoom = String(state.zoom); boardStage.style.transform = `scale(${String(state.zoom)})`; boardViewport.style.setProperty('--canvas-grid', `${String(20 * state.zoom)}px`); layoutBoard();
      boardViewport.scrollLeft = Math.max(0, centerX * state.zoom - boardViewport.clientWidth / 2); boardViewport.scrollTop = Math.max(0, centerY * state.zoom - boardViewport.clientHeight / 2);
    }
    zoomLevel.value = String(Math.round(state.zoom * 100)); zoomOut.disabled = state.zoom <= .25; zoomIn.disabled = state.zoom >= 2;
    const references = JSON.stringify([state.values.references, state.edit]); if (referenceSignature !== references) { referenceSignature = references; renderBoard(); }
    if (!state.connect || !state.edit || board.hidden || !state.values.references.some(reference => reference.id === linkSource)) { linkSource = ''; linkPoint = undefined; }
    boardStage.dataset.connect = String(state.connect && state.edit); queueWires();
    for (const pin of boardStage.querySelectorAll<HTMLButtonElement>('.character-board-pin')) { const reference = state.values.references.find(reference => reference.id === pin.parentElement?.dataset.reference); pin.title = state.connect ? 'Click pin to connect' : 'Drag pin to rotate · Arrow keys to turn'; pin.setAttribute('aria-label', `${state.connect ? 'Connect' : 'Rotate'} reference: ${reference?.caption || 'Untitled'}`); }
    boardStage.dataset.select = String(state.select); for (const card of boardStage.querySelectorAll<HTMLElement>('.character-board-card')) card.dataset.selected = String(card.dataset.reference === referenceId);
    const connections = JSON.stringify([state.values.connections, state.values.portrait, state.values.name, state.values.middleName, state.values.familyName, connectionId, page, state.characters.filter(item => state.values.connections.some(connection => connection.target === item.id)).map(item => [item.id, item.name, item.middleName, item.familyName, item.portrait])]); if (graphSignature !== connections) { graphSignature = connections; renderGraph(); }
    const images = JSON.stringify([state.values.references.filter(item => item.view), state.values.portrait, state.values.categories.find(category => category.id === 'appearance'), state.edit]); if (studySignature !== images) { studySignature = images; renderStudies(); }
    renderReferenceInspector(); renderConnectionInspector();
    referenceInspector.hidden = !referenceDetails; connectionInspector.hidden = !connectionDetails;
    graph.dataset.focused = String(connectionDetails && !addingConnection); for (const caption of graph.querySelectorAll<HTMLElement>('.character-connection-caption')) caption.dataset.selected = String(caption.dataset.connection === connectionId);
  };
  const boardSize = new ResizeObserver(() => { if (boardFrame) return; boardFrame = requestAnimationFrame(() => { boardFrame = 0; layoutBoard(); }); }); boardSize.observe(boardStage); boardSize.observe(boardViewport);
  const dispose = (): void => { request++; drag = undefined; boardSize.disconnect(); graphSize.disconnect(); cancelAnimationFrame(boardFrame); cancelAnimationFrame(graphFrame); cancelAnimationFrame(wireFrame); boardFrame = graphFrame = wireFrame = 0; if (finder.matches(':popover-open')) finder.hidePopover(); };
  access.signal.addEventListener('abort', dispose, { once: true });
  return { update, commit, command: command => { if (!access.read()?.edit || board.hidden) return; if (command === 'reference.add-image') { if (addImages.disabled) { fail('This board already has 12 images. Remove an image before adding another.'); return; } addImages.click(); } else { if (addNote.disabled) { fail('This board already has 50 notes. Remove a note before adding another.'); return; } addNote.click(); } }, collapseDetails: () => { referenceDetails = connectionDetails = false; cancelDrag(); linkSource = ''; linkPoint = undefined; queueWires(); if (finder.matches(':popover-open')) finder.hidePopover(); }, dispose };
}
