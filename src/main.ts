// Owns shell state and listeners; pagehide releases native subscriptions, timers, and frames.
import { setupProject } from './project';
import { createWorkspace } from './workspace';
import type { WorkspaceController } from './workspace';
import type { ProjectController } from './project';
import type { AppRequest } from './mcp';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

function required(selector: string): HTMLElement {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing shell element: ${selector}`);
  return element;
}

const boot = required('#boot');
const workspace = required('#workspace');
const tabs = required('#tabs');
const panel = required('#tab-panel');
const status = required('#status');
const maximize = required('#maximize');
const maximizeItem = required('#maximize-item');
const templateElement = required('#tab-template');
const aboutElement = required('#about');
if (!(templateElement instanceof HTMLTemplateElement) || !(aboutElement instanceof HTMLDialogElement)) {
  throw new Error('Invalid shell templates.');
}
const template = templateElement;
const about = aboutElement;

const lifetime = new AbortController();
const appWindow = isTauri() ? getCurrentWindow() : null;
const menuButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-menu]')];
let workspaceController: WorkspaceController | undefined;
let unsubscribeProject: (() => void) | undefined;
let resizeTimer: number | undefined;
let frame = 0;
let unlisten: (() => void) | undefined;
let disposeProject: (() => void) | undefined;
let projectController: ProjectController | undefined;
let editTarget: HTMLInputElement | HTMLTextAreaElement | null = null;

document.addEventListener('focusin', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) editTarget = event.target;
}, { signal: lifetime.signal });

function reportError(error: unknown): void {
  if (lifetime.signal.aborted) return;
  status.textContent = 'Window action failed. Try again.';
  console.error(error);
}

function tabButtons(): HTMLButtonElement[] {
  return [...tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter(button => !button.closest('[hidden]'));
}

function selectedTab(): HTMLButtonElement | null {
  return tabs.querySelector<HTMLButtonElement>('[aria-selected="true"]');
}

function selectTab(tab: HTMLButtonElement, focus = true): void {
  workspaceController?.execute({ action: 'tab.select', target: tab.id });
  tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); if (focus) tab.focus();
}
function createTab(focus = true): void { workspaceController?.execute({ action: 'tab.new' }); if (focus) selectedTab()?.focus(); }
function closeTab(tab: HTMLButtonElement | null = selectedTab()): void {
  if (!tab) return; workspaceController?.execute({ action: 'tab.close', target: tab.id });
  (selectedTab() ?? required('#new-tab')).focus();
}

function closeMenu(focus = false): void {
  const menu = document.querySelector<HTMLElement>('[popover]:popover-open');
  if (!menu) return;
  menu.hidePopover();
  if (focus) menuButtons.find(button => button.getAttribute('aria-controls') === menu.id)?.focus();
}

function openMenu(button: HTMLButtonElement, last = false): void {
  const menu = required(`#${button.getAttribute('aria-controls') ?? ''}`);
  if (menu.matches(':popover-open')) { closeMenu(true); return; }
  closeMenu();
  const bounds = button.getBoundingClientRect();
  menu.style.left = `${String(bounds.left)}px`;
  menu.style.top = `${String(bounds.bottom + 4)}px`;
  menu.showPopover();
  const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  (last ? items.at(-1) ?? menu : items[0] ?? menu).focus();
}

async function syncMaximized(): Promise<void> {
  if (!appWindow || lifetime.signal.aborted) return;
  const maximized = await appWindow.isMaximized();
  lifetime.signal.throwIfAborted();
  const label = maximized ? 'Restore' : 'Maximize';
  maximize.setAttribute('aria-label', label);
  maximize.setAttribute('title', label);
  maximize.dataset.maximized = String(maximized);
  maximizeItem.textContent = label;
}

async function command(action: string): Promise<void> {
  closeMenu(true);
  switch (action) {
    case 'cut': case 'copy': case 'paste': case 'delete': case 'selectAll': {
      if (!editTarget?.isConnected || editTarget.disabled) return;
      editTarget.focus();
      if (action === 'selectAll') { editTarget.select(); return; }
      const target = editTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      if (start === null || end === null) return;
      if (action === 'copy' || action === 'cut') await navigator.clipboard.writeText(target.value.slice(start, end));
      if (action === 'copy' || target.readOnly) return;
      const text = action === 'paste' ? await navigator.clipboard.readText() : '';
      if (!target.isConnected || target.disabled) return;
      target.focus();
      target.setRangeText(text, start, end, 'end');
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: action === 'paste' ? 'insertFromPaste' : 'deleteContentForward', data: text }));
      return;
    }
    case 'new-tab': createTab(); return;
    case 'close-tab': closeTab(); return;
    case 'about': about.showModal(); return;
    case 'close-about': about.close(); return;
    case 'minimize': if (!appWindow) throw new Error('Native window controls are unavailable.'); await appWindow.minimize(); return;
    case 'maximize': if (!appWindow) throw new Error('Native window controls are unavailable.'); await appWindow.toggleMaximize(); await syncMaximized(); return;
    case 'close-window': await projectController?.execute('close-window'); return;
    default: throw new Error(`Unknown shell action: ${action}`);
  }
}

function moveTab(direction: number): void {
  const buttons = tabButtons();
  if (buttons.length === 0) return;
  const current = selectedTab();
  const index = buttons.findIndex(button => button === current);
  const next = buttons[(index + direction + buttons.length) % buttons.length];
  if (next) selectTab(next);
}

function menuKeys(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const menu = target.closest<HTMLElement>('[role="menu"]');
  const button = target.closest<HTMLButtonElement>('[data-menu]');
  if (!menu && !button) return false;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const current = button ?? menuButtons.find(item => item.getAttribute('aria-controls') === menu?.id);
    if (!current) return false;
    const index = menuButtons.indexOf(current);
    const next = menuButtons[(index + (event.key === 'ArrowRight' ? 1 : -1) + menuButtons.length) % menuButtons.length];
    if (next && menu) openMenu(next);
    else next?.focus();
    return true;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return false;
  if (button) { openMenu(button, event.key === 'ArrowUp' || event.key === 'End'); return true; }
  const items = [...(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  if (items.length === 0) return true;
  const index = items.findIndex(item => item === target);
  const offset = event.key === 'ArrowUp' ? -1 : 1;
  let next = items[(index + offset + items.length) % items.length];
  if (event.key === 'Home') next = items[0];
  if (event.key === 'End') next = items.at(-1);
  next?.focus();
  return true;
}

function click(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.menu !== undefined) { event.preventDefault(); openMenu(button); return; }
  if (button.hasAttribute('data-close-tab')) {
    closeTab(button.parentElement?.querySelector<HTMLButtonElement>('[role="tab"]') ?? null);
    return;
  }
  if (button.getAttribute('role') === 'tab' && tabs.contains(button)) { selectTab(button); return; }
  if (button.dataset.project || button.dataset.workspace) closeMenu();
  const action = button.dataset.command;
  if (action) command(action).catch(reportError);
}

document.addEventListener('click', click, { signal: lifetime.signal });
document.addEventListener('contextmenu', event => { event.preventDefault(); }, { signal: lifetime.signal });
document.addEventListener('toggle', event => {
  if (!(event.target instanceof HTMLElement)) return;
  const menu = event.target;
  const button = menuButtons.find(item => item.getAttribute('aria-controls') === menu.id);
  button?.setAttribute('aria-expanded', String(menu.matches(':popover-open')));
}, { capture: true, signal: lifetime.signal });

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]')) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable=true]')) return;
  if (event.key === 'Escape') { closeMenu(true); return; }
  if (event.altKey && !event.ctrlKey) {
    const index = ['f', 'e', 'w', 'h'].indexOf(event.key.toLowerCase());
    const button = menuButtons[index];
    if (!button) return;
    event.preventDefault();
    openMenu(button);
    return;
  }
  if (event.ctrlKey && !event.altKey) {
    const key = event.key.toLowerCase();
    if (!['t', 'w', 'tab'].includes(key)) return;
    event.preventDefault();
    if (key === 'tab') moveTab(event.shiftKey ? -1 : 1);
    else command(key === 't' ? 'new-tab' : 'close-tab').catch(reportError);
    return;
  }
  if (event.key === 'F10') { event.preventDefault(); menuButtons[0]?.focus(); return; }
  if (menuKeys(event)) { event.preventDefault(); return; }
  if (!(event.target instanceof Element) || !tabs.contains(event.target) || !event.target.closest('[role="tablist"]')) return;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Delete') { closeTab(); return; }
  if (event.key === 'Home' || event.key === 'End') {
    const buttons = tabButtons();
    const next = event.key === 'Home' ? buttons[0] : buttons.at(-1);
    if (next) selectTab(next);
    return;
  }
  moveTab(event.key === 'ArrowLeft' ? -1 : 1);
}, { signal: lifetime.signal });

window.addEventListener('pagehide', () => {
  lifetime.abort();
  clearTimeout(resizeTimer);
  cancelAnimationFrame(frame);
  unlisten?.();
  unsubscribeProject?.();
  workspaceController?.dispose();
  disposeProject?.();
}, { once: true });

function inspectState(): object {
  return {
    workspace: workspaceController?.state(),
    runtime: appWindow ? 'tauri' : 'browser', loading: !boot.hidden,
    project: projectController?.state(),
    tabs: tabButtons().map(tab => ({ id: tab.id, title: tab.textContent, selected: tab.getAttribute('aria-selected') === 'true' })),
    menu: document.querySelector('[popover]:popover-open')?.id ?? null,
    about: about.open, maximized: maximize.dataset.maximized === 'true',
    controls: [...document.querySelectorAll<HTMLButtonElement>('button')].map(button => ({
      label: button.textContent.trim() || button.getAttribute('aria-label') || '',
      command: button.dataset.command ?? button.dataset.project ?? button.dataset.link ?? button.dataset.menu ?? null,
      enabled: !button.disabled, visible: button.checkVisibility(),
    })),
    unavailable: ['edit', 'links.releases', 'links.donation'],
  };
}

async function automationAction(request: AppRequest): Promise<object> {
  const { action } = request;
  if (!projectController || lifetime.signal.aborted) throw new Error('Application is not ready.');
  if (action === 'state') return { ok: true, state: inspectState() };
  if (['tab.', 'tile.', 'layout.', 'surface.', 'rail.'].some(prefix => action.startsWith(prefix))) { if (!workspaceController) throw new Error('Workspace is not ready.'); workspaceController.execute(request); return { ok: true, status: 'completed', state: inspectState() }; }
  if (action === 'dialog.respond') { projectController.respond(request.decision ?? ''); return { ok: true, status: 'completed', state: inspectState() }; }
  if (action === 'project.name' || action === 'project.notes') {
    await projectController.edit(action.slice(8), request.value ?? '');
    return { ok: true, status: 'completed', state: inspectState() };
  }
  const projectActions: Record<string, string> = { 'project.new': 'new', 'project.open': 'open', 'project.save': 'save', 'project.close': 'close-project', 'project.recent': 'recent', 'project.recover': 'recover', 'welcome.show': 'welcome', 'welcome.dismiss': 'dismiss', 'window.close': 'close-window' };
  const projectAction = projectActions[action];
  if (projectAction) {
    const options = { automation: true, ...(request.path ? { path: request.path } : {}), ...(request.savePath ? { savePath: request.savePath } : {}), ...(request.decision ? { decision: request.decision } : {}), overwrite: request.overwrite ?? false };
    const result = await projectController.execute(projectAction, options);
    return { ok: result.status !== 'failed', ...result, state: inspectState() };
  }
  if (action === 'menu.close') closeMenu();
  else if (action === 'menu.open') {
    const button = menuButtons.find(item => item.dataset.menu === request.target);
    if (!button) throw new Error('Unknown menu.');
    openMenu(button);
  } else if (action === 'tab.select' || action === 'tab.close') {
    const tab = tabButtons().find(item => item.id === request.target);
    if (!tab) throw new Error('Unknown tab.');
    if (action === 'tab.select') selectTab(tab, false);
    else closeTab(tab);
  } else if (action === 'window.move' || action === 'window.resize') {
    if (!appWindow) throw new Error('Native window geometry is unavailable in a browser.');
    await invoke('automation_geometry', { x: request.x ?? null, y: request.y ?? null, width: request.width ?? null, height: request.height ?? null });
  } else {
    const shellActions: Record<string, string> = { 'tab.new': 'new-tab', 'about.show': 'about', 'about.close': 'close-about', 'window.minimize': 'minimize', 'window.maximize': 'maximize' };
    const shellAction = shellActions[action];
    if (!shellAction) throw new Error(`Action is unknown or unavailable: ${action}`);
    await command(shellAction);
  }
  return { ok: true, status: 'completed', state: inspectState() };
}

async function start(): Promise<void> {
  projectController = await setupProject(lifetime.signal, reportError);
  disposeProject = projectController.dispose;
  const controller = projectController;
  workspaceController = createWorkspace(panel, tabs, template, {
    read: () => { const state = controller.state(); return { name: state.project.name, notes: state.project.notes, timelines: state.project.timelines, characters: state.project.characters, busy: state.busy }; },
    write: controller.update,
    createCharacter: controller.createCharacter, changeCharacter: controller.changeCharacter,
    createTimeline: controller.createTimeline, renameTimeline: controller.renameTimeline,
  }, controller.workspaceChanged, reportError, lifetime.signal);
  controller.bindWorkspace(workspaceController);
  unsubscribeProject = controller.subscribe(workspaceController.updateProject);
  if (import.meta.env.DEV) {
    const { setupMcp } = await import('./mcp');
    setupMcp(automationAction, lifetime.signal);
  }
  if (appWindow) {
    const dispose = await appWindow.onResized(() => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => { syncMaximized().catch(reportError); }, 80);
    });
    if (lifetime.signal.aborted) { dispose(); return; }
    unlisten = dispose;
    await syncMaximized();
  } else {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-command="minimize"], [data-command="maximize"], [data-command="close-window"]')) button.disabled = true;
  }
  if (lifetime.signal.aborted) return;
  status.textContent = 'Ready';
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      const bootPaintMs = performance.now();
      boot.hidden = true;
      workspace.hidden = false;
      frame = requestAnimationFrame(() => {
        if (appWindow) invoke('ready', { bootPaintMs, frontendReadyMs: performance.now() }).catch(reportError);
      });
    });
  });
}

start().catch((error: unknown) => {
  boot.querySelector('p')?.replaceChildren('Could not start the window controls. Close Negareh and try again.');
  reportError(error);
});







