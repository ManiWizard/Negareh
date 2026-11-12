// Owns one serializable project and shared UI/MCP actions; native IO remains constrained in Rust.
import { changeCharacter, characterInstances, instanceValues, newCharacter, validateCharacter } from './characters';
import type { Character, CharacterChange } from './characters';
export type { Character, CharacterCategory } from './characters';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface Timeline { id: string; name: string }
interface Project { version: number; name: string; notes: string; timelines: Timeline[]; characters: Character[]; workspace?: unknown }
export interface WorkspaceAdapter { serialize: () => unknown; restore: (value: unknown) => string | null }
interface Session { project: Project; path: string | null }
interface Startup { recent: string | null; recovery: boolean; version: string }
export interface ProjectOptions { automation?: boolean; path?: string; savePath?: string; decision?: string; overwrite?: boolean }
export interface ProjectController {
  execute: (action: string, options?: ProjectOptions) => Promise<{ status: string; error?: string }>;
  edit: (field: string, value: string) => Promise<void>;
  respond: (choice: string) => void;
  update: (field: string, value: string) => void;
  createTimeline: () => Timeline;
  renameTimeline: (id: string, name: string) => void;
  createCharacter: () => Character;
  changeCharacter: (id: string, change: CharacterChange) => Character;
  subscribe: (listener: () => void) => () => void;
  bindWorkspace: (adapter: WorkspaceAdapter) => void;
  workspaceChanged: () => void;
  state: () => { project: Project; path: string | null; dirty: boolean; contentDirty: boolean; layoutDirty: boolean; busy: boolean; welcome: boolean; prompt: boolean; recent: string | null; recovery: boolean; message: string };
  dispose: () => void;
}
const blank = (): Project => ({ version: 1, name: 'Untitled', notes: '', timelines: [], characters: [] });
const destinations: { releases: string | null; donation: string | null } = { releases: null, donation: null };

export async function setupProject(signal: AbortSignal, report: (error: unknown) => void): Promise<ProjectController> {
  const element = <T extends HTMLElement>(selector: string, type: new () => T): T => {
    const found = document.querySelector(selector);
    if (!(found instanceof type)) throw new Error(`Missing project control: ${selector}`);
    return found;
  };
  const welcome = element('#welcome', HTMLDialogElement);
  const prompt = element('#save-prompt', HTMLDialogElement);
  const recent = element('#recent-project', HTMLButtonElement);
  const recover = element('#recover-project', HTMLButtonElement);
  const message = element('#project-message', HTMLElement);
  let project = blank();
  let path: string | null = null;
  const content = (): string => JSON.stringify({ version: project.version, name: project.name, notes: project.notes, timelines: project.timelines, characters: project.characters });
  let saved = content();
  let layoutRevision = 0, savedLayoutRevision = 0;
  let workspace: WorkspaceAdapter | undefined;
  const subscribers = new Set<() => void>();
  const notify = (): void => { for (const listener of subscribers) listener(); };
  let busy = false;
  let timer: number | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let disposeClose: (() => void) | undefined;
  let allowClose = false;
  let closeTimer: number | undefined;
  const native = isTauri();
  const appWindow = native ? getCurrentWindow() : null;
  const dirty = (): boolean => content() !== saved || layoutRevision !== savedLayoutRevision;
  function error(value: unknown): string {
    const text = value instanceof Error ? value.message : String(value);
    if (signal.aborted) return text;
    message.textContent = text;
    const welcomeMessage = document.querySelector('#welcome-message');
    if (welcomeMessage) welcomeMessage.textContent = text;
    report(value);
    return text;
  }
  function setBusy(value: boolean): void { busy = value; notify(); }
  function render(): void {
    notify();
    const label = `${project.name}${dirty() ? ' •' : ''}`;
    const title = document.querySelector('#project-title');
    if (title) title.textContent = label;
    document.title = `${label} — Negareh`;
  }
  function recentPath(value: string): void {
    recent.disabled = false; recent.textContent = value.split(/[\\/]/).at(-1) ?? value; recent.title = value;
    const hint = document.querySelector('.recent-hint');
    if (hint) hint.textContent = 'Most recently saved project on this device.';
  }
  function collect(): Project {
    const layout = workspace?.serialize() ?? project.workspace;
    if (layout !== undefined && new TextEncoder().encode(JSON.stringify(layout)).length > 4_000_000) throw new Error('Workspace state exceeds the 4 MB limit.');
    return { version: project.version, name: project.name, notes: project.notes, timelines: project.timelines, characters: project.characters, ...(layout === undefined ? {} : { workspace: layout }) };
  }
  function restoreWorkspace(): void {
    layoutRevision = 0; savedLayoutRevision = 0;
    const warning = workspace?.restore(project.workspace); if (warning) message.textContent = warning;
  }
  function scheduleSnapshot(): void { clearTimeout(timer); timer = globalThis.setTimeout(() => { snapshot().catch(error); }, 300); }
  function snapshot(): Promise<unknown> {
    clearTimeout(timer);
    if (!native) return Promise.resolve();
    const copy = structuredClone(collect());
    queue = queue.catch(() => undefined).then(() => invoke('project_recovery', { project: copy, restore: false })).then(() => { recover.disabled = false; });
    return queue;
  }
  async function save(options: ProjectOptions, beforeReplace = false): Promise<boolean> {
    if (!native) throw new Error('Saving is available in the desktop app.');
    const destination = beforeReplace ? options.savePath : options.path;
    if (options.automation && !path && !destination) throw new Error('An unsaved project requires an explicit savePath (or path for project.save).');
    const result = await invoke<string | null>('project_save', { project: collect(), destination: destination ?? null, overwrite: options.overwrite ?? false });
    if (!result) return false;
    path = result; saved = content(); savedLayoutRevision = layoutRevision;
    await snapshot(); recentPath(path); render(); message.textContent = 'Project saved.';
    return true;
  }
  function respond(choice: string): void {
    if (!prompt.open || !['save', 'discard', 'cancel'].includes(choice)) throw new Error('No matching save decision is pending.');
    prompt.close(choice);
  }
  async function protect(options: ProjectOptions): Promise<boolean> {
    if (!dirty()) return true;
    let choice = options.decision;
    if (!choice && options.automation) throw new Error('Unsaved changes: supply decision=save, discard or cancel.');
    if (!choice) {
      if (welcome.open) welcome.close();
      prompt.returnValue = 'cancel'; prompt.showModal();
      choice = await new Promise<string>(resolve => { prompt.addEventListener('close', () => { resolve(prompt.returnValue); }, { once: true, signal }); });
    }
    if (choice === 'discard') return true;
    if (choice !== 'save') return false;
    return save(options, true);
  }
  async function execute(action: string, options: ProjectOptions = {}): Promise<{ status: string; error?: string }> {
    if (busy || signal.aborted) return { status: 'failed', error: 'Project is busy or disposed.' };
    if (!document.dispatchEvent(new Event('character-commit', { cancelable: true }))) return { status: 'failed', error: 'Correct the invalid character field before continuing.' };
    setBusy(true); message.textContent = '';
    const welcomeMessage = document.querySelector('#welcome-message');
    if (welcomeMessage) welcomeMessage.textContent = '';
    try { return { status: await perform(action, options) ? (action === 'close-window' ? 'requested' : 'completed') : 'cancelled' }; }
    catch (value) { return { status: 'failed', error: error(value) }; }
    finally { if (!allowClose) setBusy(false); }
  }
  async function perform(action: string, options: ProjectOptions): Promise<boolean> {
    if (action === 'welcome') { welcome.showModal(); return true; }
    if (action === 'dismiss') { welcome.close(); return true; }
    if (action === 'save') return save(options);
    if (!['new', 'open', 'recent', 'recover', 'close-project', 'close-window'].includes(action)) throw new Error('Unknown project action.');
    if (!(await protect(options))) return false;
    clearTimeout(timer);
    if (dirty() || path) await snapshot();
    await queue.catch(() => undefined);
    if (action === 'close-window') {
      if (!appWindow) throw new Error('Native window controls are unavailable in a browser.');
      allowClose = true;
      closeTimer = globalThis.setTimeout(() => { appWindow.close().catch((value: unknown) => { allowClose = false; setBusy(false); error(value); }); }, 0);
      return true;
    }
    if (action === 'close-project' || action === 'new') {
      if (native) await invoke('project_reset');
      project = blank(); path = null; saved = content(); restoreWorkspace(); render(); welcome.close(); return true;
    }
    if (!native) throw new Error('Project files and recovery are available in the desktop app.');
    if (options.automation && action === 'open' && !options.path) throw new Error('project.open requires an explicit path for automation.');
    let session: Session | null = null;
    if (action === 'open' || action === 'recent') session = await invoke<Session | null>('project_open', { recent: action === 'recent', path: options.path ?? null });
    if (action === 'recover') session = await invoke<Session | null>('project_recovery', { project: null, restore: true });
    if (!session) return false;
    project = session.project; path = session.path; saved = action === 'recover' ? '' : content(); restoreWorkspace();
    render(); welcome.close(); await snapshot();
    if (path) recentPath(path);
    return true;
  }
  function update(field: string, value: string): void {
    if (busy || signal.aborted) throw new Error('Project is busy or disposed.');
    if (field === 'name' && value.length <= 200) project.name = value.trim() || 'Untitled';
    else if (field === 'notes' && value.length <= 1_000_000) project.notes = value;
    else throw new Error('Invalid project field or length.');
    render(); scheduleSnapshot();
  }
  const outsideWelcome = (event: MouseEvent): boolean => { const rect = welcome.getBoundingClientRect(); return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom; };
  let backdropPressed = false;
  welcome.addEventListener('pointerdown', event => { backdropPressed = event.target === welcome && outsideWelcome(event); }, { signal });
  welcome.addEventListener('click', event => { if (backdropPressed && event.target === welcome && outsideWelcome(event)) execute('dismiss').catch(error); backdropPressed = false; }, { signal });
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-project]');
    if (!button || button.disabled || !button.dataset.project) return;
    execute(button.dataset.project).catch(error);
  }, { signal });
  document.addEventListener('keydown', event => {
    if (!event.ctrlKey || event.altKey || prompt.open || event.isComposing || busy) return;
    const command = { s: 'save', o: 'open', n: 'new' }[event.key.toLowerCase()];
    if (!command) return;
    event.preventDefault(); execute(command).catch(error);
  }, { signal });
  prompt.addEventListener('cancel', event => { event.preventDefault(); respond('cancel'); }, { signal });
  prompt.addEventListener('submit', event => {
    event.preventDefault();
    if (event.submitter instanceof HTMLButtonElement) respond(event.submitter.value);
  }, { signal });
  const controller: ProjectController = {
    execute, respond,
    update,
    createTimeline: () => {
      if (busy || signal.aborted) throw new Error('Project is busy or disposed.');
      if (project.timelines.length >= 1000) throw new Error('Timeline limit reached.');
      const timeline = { id: `timeline-${crypto.randomUUID()}`, name: 'Unnamed' };
      project.timelines.push(timeline); render(); scheduleSnapshot(); return timeline;
    },
    renameTimeline: (id, name) => {
      if (busy || signal.aborted) throw new Error('Project is busy or disposed.');
      const timeline = project.timelines.find(timeline => timeline.id === id);
      if (!timeline || name.length > 80) throw new Error('Invalid timeline name.');
      timeline.name = name.trim() || 'Unnamed'; render(); scheduleSnapshot();
    },
    createCharacter: () => {
      if (busy || signal.aborted) throw new Error('Project is busy or disposed.');
      if (project.characters.length >= 1000) throw new Error('Character limit reached.');
      const character = newCharacter(); validateCharacter(character); project.characters.push(character); render(); scheduleSnapshot(); return character;
    },
    changeCharacter: (id, change) => {
      if (busy || signal.aborted) throw new Error('Project is busy or disposed.');
      const index = project.characters.findIndex(character => character.id === id), original = project.characters[index];
      if (!original) throw new Error('The character is unavailable.');
      const character = changeCharacter(original, change);
      if (characterInstances(character).some(instance => instanceValues(character, instance.id).connections.some(connection => !project.characters.some(target => target.id === connection.target)))) throw new Error('Choose a character from this project.');
      if (JSON.stringify(character) === JSON.stringify(original)) return original;
      project.characters[index] = character; render(); scheduleSnapshot(); return character;
    },
    async edit(field, value) { update(field, value); await snapshot(); },
    subscribe: listener => { subscribers.add(listener); return () => { subscribers.delete(listener); }; },
    bindWorkspace: adapter => { workspace = adapter; restoreWorkspace(); },
    workspaceChanged: () => { layoutRevision++; render(); scheduleSnapshot(); },
    state: () => ({ project: { ...project }, path, dirty: dirty(), contentDirty: content() !== saved, layoutDirty: layoutRevision !== savedLayoutRevision, busy, welcome: welcome.open, prompt: prompt.open, recent: recent.title || null, recovery: !recover.disabled, message: message.textContent }),
    dispose: () => { clearTimeout(timer); clearTimeout(closeTimer); subscribers.clear(); disposeClose?.(); },
  };
  if (appWindow) {
    const dispose = await appWindow.onCloseRequested(event => {
      if (allowClose) return;
      event.preventDefault(); execute('close-window').catch(error);
    });
    disposeClose = dispose;
    if (signal.aborted) { dispose(); return controller; }
    const startup = await invoke<Startup>('project_start').catch((value: unknown) => { error(value); return { recent: null, recovery: false, version: '0.1.0' }; });
    const version = document.querySelector('#welcome-version');
    if (version) version.textContent = `v${startup.version}`;
    if (startup.recent) recentPath(startup.recent);
    recover.disabled = !startup.recovery;
  }
  for (const [key, url] of Object.entries(destinations)) {
    const button = document.querySelector<HTMLButtonElement>(`[data-link="${key}"]`);
    if (!button) continue;
    button.disabled = url === null; button.title = 'Repository destination has not been configured.';
  }
  render(); return controller;
}


