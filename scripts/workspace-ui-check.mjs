// Owns isolated browser gesture/lifecycle checks; uses an existing Playwright installation and no OS input.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1000, height: 740 } });
const failures = []; page.on('pageerror', error => failures.push(error.message));
// This browser never enrolls alongside the user's native MCP session.
await page.route('**/src/mcp.ts', route => route.fulfill({ contentType: 'text/javascript', body: 'export function setupMcp() {}' }));
const output = resolve('benchmarks'); await mkdir(output, { recursive: true });
const checks = [];
async function settle() { await page.waitForTimeout(50); }
async function undoLayout() { await page.locator('.workspace-corner').first().focus(); await page.keyboard.press('Control+Alt+z'); await settle(); }
async function bottomRightCorner(tile) {
  const box = await tile.boundingBox(); assert.ok(box);
  const index = await page.locator('.workspace-corner').evaluateAll((elements, target) => {
    let best = 0, distance = Infinity;
    elements.forEach((element, index) => { const [x, y] = element.dataset.corner.split(',').map(Number), canvas = element.parentElement.getBoundingClientRect(); const next = Math.hypot(canvas.x + x - target.x, canvas.y + y - target.y); if (next < distance) { best = index; distance = next; } }); return best;
  }, { x: box.x + box.width, y: box.y + box.height });
  return page.locator('.workspace-corner').nth(index);
}
async function drag(locator, destination, cancel = false, shift = false) {
  const box = await locator.boundingBox(); assert.ok(box);
  const start = await locator.evaluate(element => { const [x, y] = element.dataset.corner.split(',').map(Number), canvas = element.parentElement.getBoundingClientRect(); return { x: canvas.x + x - 2, y: canvas.y + y - 2 }; });
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 5 }); await settle();
  assert.equal(await page.locator('.layout-preview').isVisible(), true);
  if (!shift) {
    const ghosts = page.locator('.layout-preview .split-ghost'); assert.equal(await ghosts.count(), 2);
    const first = await ghosts.nth(0).boundingBox(), second = await ghosts.nth(1).boundingBox(); assert.ok(first && second);
    assert.ok(first.width > 100 && first.height > 100 && second.width > 100 && second.height > 100);
    await page.screenshot({ path: resolve(output, 'workspace-split-ghosts.png') });
  }
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up(); if (shift) await page.keyboard.up('Shift'); await settle();
}
try {
  await page.goto(process.env.NEGAREH_TEST_URL ?? 'http://127.0.0.1:5174');
  await page.getByRole('tab', { name: 'Overview', exact: true }).waitFor();
  const welcome = page.getByRole('dialog', { name: 'Welcome to Negareh', exact: true }); assert.equal(await welcome.isVisible(), false);
  await page.locator('#welcome').evaluate(dialog => dialog.showModal()); await welcome.waitFor();
  assert.equal(await welcome.getByRole('button', { name: /Continue to/ }).count(), 0);
  assert.equal(await welcome.getByText('Every story starts with a blank page.', { exact: true }).count(), 0);
  assert.equal(await welcome.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(32, 32, 32)');
  await welcome.getByRole('heading', { name: 'Negareh', exact: true }).click(); assert.equal(await welcome.isVisible(), true);
  await page.screenshot({ path: resolve(output, 'welcome-app-colors.png') });
  await page.mouse.click(5, 5); await settle(); assert.equal(await welcome.isVisible(), false);
  checks.push('welcome matches app palette, has no continue/footer copy, stays open for inside clicks and dismisses to the project for outside clicks');
  assert.equal(await page.getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.tab-label').first().textContent(), 'Overview');
  assert.equal(await page.locator('.tab-label').nth(1).textContent(), 'Timeline');
  assert.equal(await page.locator('.tab-label').nth(2).textContent(), 'Character');
  assert.equal(await page.getByRole('tab', { name: 'Character', exact: true }).locator('..').evaluate(element => element.classList.contains('tab-pinned')), false);
  await page.getByRole('tab', { name: 'Character', exact: true }).click(); await settle();
  const characterSurface = page.locator('.workspace-tile:visible .character-surface');
  const characterDeck = page.getByRole('group', { name: 'Character selector', exact: true });
  assert.equal(await characterSurface.getByRole('textbox').count(), 0);
  await characterDeck.getByRole('button', { name: 'New character', exact: true }).click();
  assert.equal(await characterSurface.getByRole('tab', { name: 'Character Overview', exact: true }).getAttribute('aria-selected'), 'true');
  await characterSurface.getByRole('tab', { name: 'Character Identity', exact: true }).click();
  const name = characterSurface.getByRole('textbox', { name: 'Name', exact: true });
  assert.equal(await name.inputValue(), 'Unnamed'); await name.fill('Mira'); await page.keyboard.press('Tab');
  assert.equal(await characterDeck.getByRole('button', { name: 'Character instances', exact: true }).locator('span').textContent(), 'Mira');
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  assert.deepEqual(await page.getByRole('list', { name: 'Characters', exact: true }).locator('li').allTextContents(), ['Mira']);
  await page.getByRole('button', { name: 'Close Character', exact: true }).click();
  checks.push('Character mandatory tabs, canonical identity editing and Overview integration; comprehensive instances/media checks live in character-ui-check.mjs');
  assert.deepEqual(failures, []);
  if (process.env.NEGAREH_TEST_CHARACTER_ONLY === '1') {
    await writeFile(resolve(output, 'character-ui-verification.json'), JSON.stringify({ passed: checks, date: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ passed: checks }, null, 2));
  } else {
  await page.getByRole('tab', { name: 'Timeline', exact: true }).click(); await settle();
  const timelineTile = page.locator('.workspace-tile:visible'), selector = timelineTile.getByRole('group', { name: 'Timeline selector', exact: true });
  const areaBox = await timelineTile.locator('.surface-area').boundingBox(), arrowBox = await timelineTile.locator('.timeline-edge-arrow').boundingBox();
  assert.equal(arrowBox.width, 16); assert.equal(arrowBox.height, 32); assert.ok(Math.abs(arrowBox.x + arrowBox.width - areaBox.x - areaBox.width) < 1); assert.ok(Math.abs(arrowBox.y - areaBox.y - 16) < 1);
  assert.equal(await timelineTile.locator('.timeline-edge-arrow').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(21, 21, 21)');
  const emptyPanel = timelineTile.getByRole('complementary', { name: 'Timeline panel', exact: true });
  assert.equal(await emptyPanel.isVisible(), false);
  const canvasBeforePanel = await timelineTile.locator('.surface-content').boundingBox();
  await timelineTile.getByRole('button', { name: 'Open timeline panel', exact: true }).click(); await page.waitForTimeout(250);
  assert.equal(await emptyPanel.isVisible(), true); assert.equal(await emptyPanel.innerHTML(), '');
  assert.equal(await timelineTile.getByRole('button', { name: 'Close timeline panel', exact: true }).getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await timelineTile.locator('.surface-content').boundingBox(), canvasBeforePanel);
  assert.equal(await timelineTile.locator('.timeline-panel-overlay').evaluate(element => getComputedStyle(element).transitionDuration), '0.22s');
  await page.screenshot({ path: resolve(output, 'timeline-empty-panel.png') });
  await timelineTile.getByRole('button', { name: 'Close timeline panel', exact: true }).click(); await page.waitForTimeout(250); assert.equal(await emptyPanel.isVisible(), false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await timelineTile.getByRole('button', { name: 'Open timeline panel', exact: true }).click();
  assert.equal(await timelineTile.locator('.timeline-panel-overlay').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await page.keyboard.press('Escape'); assert.equal(await emptyPanel.isVisible(), false);
  assert.equal(await timelineTile.getByRole('button', { name: 'Open timeline panel', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  checks.push('edge arrow toggles an empty animated overlay without resizing the canvas; Escape and reduced motion work');
  assert.equal(await timelineTile.locator('.surface-content').textContent(), '');
  assert.equal(await timelineTile.locator('.surface-rail').count(), 1); assert.equal(await timelineTile.locator('.surface-rail').isVisible(), false);
  assert.equal(await timelineTile.getByRole('button', { name: 'Pan', exact: true }).count(), 0);
  const overlayGeometry = await timelineTile.evaluate(tile => {
    const rail = tile.querySelector('.surface-rail'), body = tile.querySelector('.surface-content'), before = body.getBoundingClientRect().toJSON();
    const original = rail.getAttribute('style'); rail.hidden = false; rail.style.width = '160px'; const expanded = body.getBoundingClientRect().toJSON();
    rail.style.width = '48px'; const compact = body.getBoundingClientRect().toJSON(); rail.hidden = true;
    if (original === null) rail.removeAttribute('style'); else rail.setAttribute('style', original);
    return { before, expanded, compact, position: getComputedStyle(rail).position };
  });
  assert.equal(overlayGeometry.position, 'absolute'); assert.deepEqual(overlayGeometry.expanded, overlayGeometry.before); assert.deepEqual(overlayGeometry.compact, overlayGeometry.before);
  const viewport = timelineTile.locator('.surface-content'), panBox = await viewport.boundingBox();
  const panOrigin = { x: panBox.x + panBox.width / 2, y: panBox.y + panBox.height / 2 };
  const panOffset = () => viewport.evaluate(element => [element.style.getPropertyValue('--timeline-pan-x'), element.style.getPropertyValue('--timeline-pan-y')]);
  assert.deepEqual(await panOffset(), ['0px', '0px']);
  await page.mouse.move(panOrigin.x, panOrigin.y); await page.mouse.down(); await page.mouse.move(panOrigin.x + 53, panOrigin.y + 37); await page.mouse.up();
  assert.deepEqual(await panOffset(), ['0px', '0px']);
  await page.mouse.move(panOrigin.x, panOrigin.y); await page.mouse.down({ button: 'middle' }); await page.mouse.move(panOrigin.x + 53, panOrigin.y + 37); await page.mouse.up({ button: 'middle' });
  assert.deepEqual(await panOffset(), ['53px', '37px']);
  await page.getByRole('tab', { name: 'Overview', exact: true }).click(); await page.getByRole('tab', { name: 'Timeline', exact: true }).click(); await settle();
  assert.deepEqual(await panOffset(), ['53px', '37px']);
  for (const cancel of ['Escape', 'right']) {
    await page.mouse.move(panOrigin.x, panOrigin.y); await page.mouse.down({ button: 'middle' }); await page.mouse.move(panOrigin.x + 20, panOrigin.y + 15);
    if (cancel === 'Escape') await page.keyboard.press('Escape'); else { await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); }
    await page.mouse.up({ button: 'middle' }); assert.deepEqual(await panOffset(), ['53px', '37px']);
  }
  checks.push('Timeline grid starts centered, pans only with middle mouse, retains its offset across tabs, and rolls back on Escape/right-click');
  const gridSize = () => viewport.evaluate(element => parseFloat(element.style.getPropertyValue('--timeline-grid-size')));
  assert.equal(await gridSize(), 128);
  await viewport.evaluate(element => { element.addEventListener('wheel', event => { const rect = element.getBoundingClientRect(); element.dataset.wheelX = String(event.clientX - rect.left - element.clientWidth / 2); element.dataset.wheelY = String(event.clientY - rect.top - element.clientHeight / 2); }, { once: true }); });
  await page.mouse.move(panOrigin.x + 100, panOrigin.y + 50); await page.mouse.wheel(0, -100); await settle();
  const zoomedSize = await gridSize(), zoomedPan = (await panOffset()).map(parseFloat);
  assert.ok(zoomedSize > 128 && zoomedSize < 256);
  const anchor = await viewport.evaluate(element => [Number(element.dataset.wheelX), Number(element.dataset.wheelY)]);
  assert.ok(Math.abs(zoomedPan[0] - (anchor[0] - (anchor[0] - 53) * zoomedSize / 128)) < .1);
  assert.ok(Math.abs(zoomedPan[1] - (anchor[1] - (anchor[1] - 37) * zoomedSize / 128)) < .1);
  await page.mouse.wheel(40, 0); await settle(); assert.equal(await gridSize(), zoomedSize);
  const sidewaysPan = (await panOffset()).map(parseFloat); assert.ok(Math.abs(sidewaysPan[0] - zoomedPan[0] + 40) < .1); assert.equal(sidewaysPan[1], zoomedPan[1]);
  await page.mouse.wheel(0, -10000); await settle(); assert.equal(await gridSize(), 256);
  await page.getByRole('tab', { name: 'Overview', exact: true }).click(); await page.getByRole('tab', { name: 'Timeline', exact: true }).click(); await settle(); assert.equal(await gridSize(), 256);
  await page.mouse.move(panOrigin.x, panOrigin.y); await page.mouse.wheel(0, 10000); await settle(); assert.equal(await gridSize(), 32);
  assert.deepEqual(await viewport.boundingBox(), panBox);
  checks.push('vertical wheel zooms 25–200% around the cursor; horizontal wheel pans without zoom; zoom survives tab switches and leaves viewport dimensions unchanged');
  const deckBox = await timelineTile.locator('.surface-deck').boundingBox(), selectorBox = await selector.boundingBox();
  assert.ok(Math.abs(selectorBox.x + selectorBox.width / 2 - deckBox.x - deckBox.width / 2) < 1);
  await selector.getByRole('button', { name: 'New timeline', exact: true }).click(); await settle();
  assert.equal(await selector.getByRole('button', { name: 'Rename timeline', exact: true }).textContent(), 'Unnamed');
  await selector.getByRole('button', { name: 'Rename timeline', exact: true }).click();
  await selector.getByRole('textbox', { name: 'Timeline name', exact: true }).fill('Main history'); await page.keyboard.press('Enter'); await settle();
  assert.equal(await selector.getByRole('button', { name: 'Rename timeline', exact: true }).textContent(), 'Main history');
  await selector.getByRole('button', { name: 'Rename timeline', exact: true }).click(); await selector.getByRole('textbox', { name: 'Timeline name', exact: true }).fill('Cancelled'); await page.keyboard.press('Escape'); await settle();
  assert.equal(await selector.getByRole('button', { name: 'Rename timeline', exact: true }).textContent(), 'Main history');
  await selector.getByRole('button', { name: 'Timelines', exact: true }).click();
  assert.deepEqual(await page.getByRole('menu', { name: 'Timelines', exact: true }).getByRole('menuitemradio').allTextContents(), ['No timeline selected', 'Main history']);
  await page.getByRole('menuitemradio', { name: 'No timeline selected', exact: true }).click(); await settle();
  assert.equal(await selector.getByRole('button', { name: 'New timeline', exact: true }).textContent(), 'New');
  await selector.getByRole('button', { name: 'New timeline', exact: true }).click(); await settle();
  await selector.getByRole('button', { name: 'Timelines', exact: true }).click();
  assert.deepEqual(await page.getByRole('menu', { name: 'Timelines', exact: true }).getByRole('menuitemradio').allTextContents(), ['No timeline selected', 'Main history', 'Unnamed']);
  await page.getByRole('menuitemradio', { name: 'Main history', exact: true }).click(); await settle();
  await page.getByRole('tab', { name: 'Overview', exact: true }).click(); await settle();
  assert.deepEqual(await page.getByRole('list', { name: 'Timelines', exact: true }).locator('li').allTextContents(), ['Main history', 'Unnamed']);
  await page.getByRole('tab', { name: 'Timeline', exact: true }).click(); await settle();
  await page.screenshot({ path: resolve(output, 'timeline-selector.png') });
  await page.getByRole('button', { name: 'Close Timeline', exact: true }).click(); await settle();
  checks.push('Overview and Timeline default tab order; empty Timeline with centered selector, unnamed creation, rename commit/cancel, list selection and deselection');
  assert.equal(await page.locator('.application-surface').count(), 1);
  assert.equal(await page.locator('.surface-rail').count(), 1); assert.equal(await page.locator('.surface-rail').isVisible(), false);
  await page.getByRole('button', { name: 'Surface type', exact: true }).click();
  assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), ['Overview', 'Timeline', 'World', 'Character', 'Page Designer', 'Species Designer']); await page.keyboard.press('Escape');
  for (const name of ['Timeline', 'World', 'Character', 'Page Designer', 'Species Designer', 'Overview']) {
    await page.getByRole('button', { name: 'Surface type', exact: true }).click(); await page.getByRole('menuitemradio', { name, exact: true }).click(); await settle();
    if (name === 'Timeline') assert.equal(await page.locator('.application-surface').textContent(), '');
    else assert.equal(await page.locator('.application-surface h1').textContent(), name);
    assert.equal(await page.locator('.surface-rail').count(), 1); assert.equal(await page.locator('.surface-rail').isVisible(), false);
  }
  checks.push('Overview is the first selected tab with all six application surfaces registered; its empty rail is retained but hidden');
  const original = await page.locator('.application-surface').elementHandle();
  const host = await page.locator('#tab-panel').boundingBox(); assert.ok(host);
  const start = await page.locator('.workspace-tile').boundingBox();
  const middle = { x: host.x + host.width / 2, y: host.y + host.height - 8 };
  assert.equal(await page.locator('.workspace-corner').count(), 4);
  for (const point of [{ x: host.x + 2, y: host.y + host.height / 2 }, { x: host.x + host.width - 2, y: host.y + host.height / 2 }, { x: host.x + host.width / 2, y: host.y + 2 }, { x: host.x + host.width / 2, y: host.y + host.height - 2 }, { x: host.x + 2, y: host.y + 2 }]) {
    await page.mouse.click(point.x, point.y, { button: 'right' }); await settle();
    const menu = page.getByRole('menu', { name: 'Surface options', exact: true }); assert.equal(await menu.isVisible(), true);
    assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['Split vertically', 'Split horizontally']);
    await page.keyboard.press('Escape');
  }
  for (const corner of await page.locator('.workspace-corner').all()) {
    const point = await corner.evaluate(element => { const [x, y] = element.dataset.corner.split(',').map(Number), canvas = element.parentElement.getBoundingClientRect(); return { x: canvas.x + x + (x === 0 ? 2 : -2), y: canvas.y + y + (y === 0 ? 2 : -2) }; });
    await page.mouse.move(point.x, point.y);
    assert.equal(await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)).cursor, point), 'crosshair');
    await page.mouse.down(); await page.mouse.move(host.x + host.width / 2, host.y + host.height / 2, { steps: 5 }); await settle();
    assert.equal(await page.locator('.layout-preview').isVisible(), true);
    await page.keyboard.press('Escape'); await page.mouse.up(); await settle();
    assert.equal(await page.locator('.workspace-tile').count(), 1);
  }
  checks.push('all four invisible outside corners hit-test, preview and cancel');
  const cancelCorner = await bottomRightCorner(page.locator('.workspace-tile'));
  const cancelPoint = await cancelCorner.evaluate(element => { const [x, y] = element.dataset.corner.split(',').map(Number), canvas = element.parentElement.getBoundingClientRect(); return { x: canvas.x + x - 2, y: canvas.y + y - 2 }; });
  await page.mouse.move(cancelPoint.x, cancelPoint.y); await page.mouse.down();
  await page.mouse.move(cancelPoint.x - 10, host.y + host.height / 2, { steps: 5 }); await settle();
  const verticalGhosts = page.locator('.layout-preview .split-ghost'); assert.equal(await verticalGhosts.count(), 2);
  const topGhost = await verticalGhosts.nth(0).boundingBox(), bottomGhost = await verticalGhosts.nth(1).boundingBox();
  assert.ok(topGhost && bottomGhost && Math.abs(bottomGhost.y - topGhost.y - topGhost.height - 3) < 1);
  await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); await page.mouse.up(); await settle();
  assert.equal(await page.locator('.layout-preview').isVisible(), false);
  assert.equal(await page.locator('.workspace-tile').count(), 1);
  assert.equal(await page.locator('.workspace-menu:popover-open').count(), 0);
  checks.push('two stacked ghost surfaces preview the split; right-click cancels without committing or opening a menu');
  await drag(await bottomRightCorner(page.locator('.workspace-tile')), middle, true); assert.equal(await page.locator('.workspace-tile').count(), 1);
  await drag(await bottomRightCorner(page.locator('.workspace-tile')), middle); assert.equal(await page.locator('.workspace-tile').count(), 2);
  assert.equal(await page.locator('.workspace-corner').count(), 6);
  assert.equal(await original.evaluate(element => element.isConnected), true);
  const tiles = page.locator('.workspace-tile'); const left = tiles.nth(0), right = tiles.nth(1);
  assert.ok(Math.abs((await left.boundingBox()).width - (host.width / 2 - 4.5)) < 1);
  const divider = page.locator('.workspace-divider'); let box = await divider.boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(host.x + host.width * .62, box.y + box.height / 2, { steps: 6 }); await settle();
  assert.ok(Math.abs((await left.boundingBox()).width - (host.width * .62 - 4.5)) < 2); await page.mouse.up(); await settle();
  const resized = await left.boundingBox(); box = await divider.boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(host.x + host.width * .7, box.y + box.height / 2); await settle(); await page.keyboard.press('Escape'); await page.mouse.up(); await settle();
  assert.ok(Math.abs((await left.boundingBox()).width - resized.width) < 1);
  checks.push('corner preview/cancel/commit, captured continuous divider and Escape rollback, retained original content node');
  const rightBox = await right.boundingBox(); const joinPoint = { x: rightBox.x + rightBox.width / 2, y: rightBox.y + rightBox.height - 8 };
  await left.locator('.surface-content').focus();
  await drag(await bottomRightCorner(left), joinPoint, true, true); assert.equal(await page.locator('.workspace-tile').count(), 2);
  await drag(await bottomRightCorner(left), joinPoint, false, true); assert.equal(await page.locator('.workspace-tile').count(), 1);
  assert.equal(await original.evaluate(element => element.isConnected), true); assert.equal(await page.locator('.workspace-tile .application-surface h1').textContent(), 'Overview');
  checks.push('join preview/cancel and survivor lifecycle without deleting shared content');
  await page.getByRole('button', { name: 'New tab', exact: true }).click(); await settle();
  assert.equal(await page.locator('.tab-label').count(), 2); assert.equal(await page.locator('.workspace-tile:visible .application-surface h1').textContent(), 'Overview');
  await page.locator('.tab-label').nth(1).press('F2'); await page.getByRole('textbox', { name: 'Rename tab' }).fill('Second context'); await page.getByRole('textbox', { name: 'Rename tab' }).press('Enter');
  assert.equal(await page.locator('.tab-label').nth(1).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('F2'); await page.getByRole('textbox', { name: 'Rename tab' }).fill('Storyboard — نور الهدى / 王秀英 🎨 '.repeat(3).slice(0, 80)); await page.keyboard.press('Enter');
  assert.equal(Math.round((await page.locator('.tab').nth(1).boundingBox()).width), 136);
  await page.keyboard.press('F2'); await page.getByRole('textbox', { name: 'Rename tab' }).fill('Second context'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('.tab-label').nth(1).getAttribute('title'), 'Second context');
  await page.keyboard.press('F2'); await page.getByRole('textbox', { name: 'Rename tab' }).press('Escape');
  assert.equal(await page.locator('.tab-label').nth(1).evaluate(element => element === document.activeElement), true);
  await page.getByRole('tab', { name: 'Second context', exact: true }).press('Control+Shift+PageUp');
  assert.equal(await page.locator('.tab-label').first().textContent(), 'Second context');
  await page.getByRole('tab', { name: 'Overview', exact: true }).click(); await settle(); assert.equal(await original.evaluate(element => element.isConnected), true);
  assert.equal(await page.locator('.workspace-tile:visible').count(), 1);
  checks.push('native-looking tabs new/rename/reorder/switch and hidden-tab DOM preservation');
  await page.locator('.workspace-tile:visible').getByRole('button', { name: 'Tile layout', exact: true }).click(); await page.getByRole('menuitem', { name: 'Split vertically', exact: true }).click(); await settle();
  const beforeSmall = await page.locator('.workspace-tile:visible').first().boundingBox();
  await page.setViewportSize({ width: 420, height: 360 }); await settle();
  for (const tile of await page.locator('.workspace-tile:visible').all()) assert.ok((await tile.boundingBox()).width >= 240 - 6);
  await page.screenshot({ path: resolve(output, 'workspace-narrow.png') });
  await page.setViewportSize({ width: 1000, height: 740 }); await settle(); assert.ok(Math.abs((await page.locator('.workspace-tile:visible').first().boundingBox()).width - beforeSmall.width) < 1);
  assert.equal((await page.locator('.workspace-tile:visible').first().locator('.application-surface h1').textContent()), 'Overview');
  checks.push('window constraint overflow, proportional restoration and unchanged surface data');
  const boundary = { x: host.x + host.width / 2, y: host.y + host.height / 4 };
  async function boundaryMenu() { await page.mouse.click(boundary.x, boundary.y, { button: 'right' }); await settle(); return page.getByRole('menu', { name: 'Surface options', exact: true }); }
  let areaMenu = await boundaryMenu();
  await page.screenshot({ path: resolve(output, 'workspace-surface-options.png') });
  assert.equal(await areaMenu.locator('.menu-title').first().textContent(), 'Surface options');
  assert.deepEqual(await areaMenu.getByRole('menuitem').allTextContents(), ['Split vertically', 'Split horizontally', 'Join right', 'Join left', 'Swap areas']);
  assert.equal(await areaMenu.locator('hr').count(), 3);
  assert.equal(await areaMenu.locator('.menu-title').first().evaluate(title => title.nextElementSibling?.tagName), 'HR');
  assert.equal(await areaMenu.evaluate(menu => menu.classList.contains('deck-menu')), false);
  assert.deepEqual(await areaMenu.evaluate(menu => { const style = getComputedStyle(menu), reference = getComputedStyle(document.querySelector('#file-menu')); return ['backgroundColor', 'padding', 'borderRadius', 'boxShadow'].map(key => style[key] === reference[key]); }), [true, true, true, true]);
  const beforeAreas = await page.locator('.workspace-tile:visible').evaluateAll(tiles => tiles.map(tile => ({ id: tile.dataset.tile, x: tile.getBoundingClientRect().x })));
  const retainedArea = await page.locator('.workspace-tile:visible').first().elementHandle();
  await areaMenu.getByRole('menuitem', { name: 'Swap areas', exact: true }).click(); await settle();
  assert.equal(await retainedArea.evaluate(tile => tile.isConnected), true);
  assert.ok(Math.abs(await retainedArea.evaluate(tile => tile.getBoundingClientRect().x) - beforeAreas[1].x) < 1);
  await undoLayout(); assert.ok(Math.abs(await retainedArea.evaluate(tile => tile.getBoundingClientRect().x) - beforeAreas[0].x) < 1);
  for (const [direction, survivor] of [['right', beforeAreas[0].id], ['left', beforeAreas[1].id]]) {
    areaMenu = await boundaryMenu(); await areaMenu.getByRole('menuitem', { name: `Join ${direction}`, exact: true }).click(); await settle();
    assert.equal(await page.locator('.workspace-tile:visible').count(), 1);
    assert.equal(await page.locator('.workspace-tile:visible').getAttribute('data-tile'), survivor);
    await undoLayout(); assert.equal(await page.locator('.workspace-tile:visible').count(), 2);
  }
  await page.mouse.click(boundary.x, host.y + host.height - 2); await settle();
  assert.equal(await page.locator('.workspace-menu:popover-open').count(), 0);
  await page.mouse.click(boundary.x, host.y + host.height - 2, { button: 'right' }); await settle();
  areaMenu = page.getByRole('menu', { name: 'Surface options', exact: true });
  assert.equal(await areaMenu.getByRole('menuitem', { name: 'Swap areas', exact: true }).count(), 0);
  assert.equal(await areaMenu.getByRole('menuitem', { name: /Undo|Redo|Split side by side|Split top and bottom/ }).count(), 0);
  await page.keyboard.press('Escape');
  checks.push('edge context menu matches global styling, swaps retained surfaces with undo, joins in either direction; corner clicks do nothing and corner menus omit swap');
  const columns = await page.locator('.workspace-tile:visible').all();
  if ((await columns[0].boundingBox()).x > (await columns[1].boundingBox()).x) columns.reverse();
  for (const tile of [...columns].reverse()) {
    await tile.getByRole('button', { name: 'Tile layout', exact: true }).click(); await page.getByRole('menuitem', { name: 'Split horizontally', exact: true }).click(); await settle();
    if (await page.locator('.workspace-tile:visible').count() === 3) {
      const canvas = await page.locator('.workspace-canvas').boundingBox();
      const junction = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
      await page.mouse.click(junction.x + 2, junction.y - 2, { button: 'right' }); await settle();
      assert.equal(await page.locator('.workspace-menu:popover-open').count(), 0);
      const whole = columns[0], before = await whole.boundingBox();
      for (const cancel of [true, false]) {
        await page.mouse.move(junction.x + 2, junction.y - 2); await page.mouse.down();
        await page.mouse.move(canvas.x + canvas.width / 4, junction.y, { steps: 5 }); await settle();
        const preview = await page.locator('.layout-preview').boundingBox(); assert.ok(preview);
        assert.ok(preview.x < junction.x && Math.abs(preview.height - canvas.height) < 1);
        if (cancel) await page.keyboard.press('Escape');
        await page.mouse.up(); await settle();
        assert.equal(await page.locator('.workspace-tile:visible').count(), cancel ? 3 : 4);
        if (cancel) assert.deepEqual(await whole.boundingBox(), before);
      }
      await undoLayout();
      assert.equal(await page.locator('.workspace-tile:visible').count(), 3);
      checks.push('T-junction drag into the surface across a straight edge previews, cancels, commits and undoes');
    }
  }
  assert.equal(await page.locator('.workspace-tile:visible').count(), 4);
  assert.equal(await page.locator('.workspace-corner').count(), 9);
  const canvasBox = await page.locator('.workspace-canvas').boundingBox();
  const center = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };
  for (const tile of await page.locator('.workspace-tile:visible').all()) {
    const rect = await tile.boundingBox(), dx = rect.x < center.x ? -1 : 1, dy = rect.y < center.y ? -1 : 1;
    const point = { x: center.x + dx * 2, y: center.y + dy * 2 };
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).classList.contains('workspace-corner'), point), true);
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2, center.y + dy * 30, { steps: 5 }); await settle();
    const preview = await page.locator('.layout-preview').boundingBox(); assert.ok(preview);
    const ghost = await page.locator('.layout-preview .split-ghost').first().boundingBox(); assert.ok(ghost);
    assert.ok(ghost.x >= rect.x - 1 && ghost.x < rect.x + rect.width);
    assert.ok(Math.abs(preview.y - (rect.y - (dy < 0 ? 3 : 1.5))) < 1);
    await page.keyboard.press('Escape'); await page.mouse.up(); await settle();
  }
  await page.screenshot({ path: resolve(output, 'workspace-shared-corners.png') });
  checks.push('four meeting surfaces share one corner and all four drag directions select the correct surface');
  const horizontalEdge = { x: canvasBox.x + canvasBox.width / 4, y: center.y };
  await page.mouse.click(horizontalEdge.x, horizontalEdge.y, { button: 'right' }); await settle();
  areaMenu = page.getByRole('menu', { name: 'Surface options', exact: true });
  assert.deepEqual(await areaMenu.getByRole('menuitem').allTextContents(), ['Split vertically', 'Split horizontally', 'Join down', 'Join up', 'Swap areas']);
  await page.keyboard.press('Escape');
  await page.mouse.click(center.x + 2, center.y + 2, { button: 'right' }); await settle();
  assert.equal(await page.locator('.workspace-menu:popover-open').count(), 0);
  checks.push('right-click works on every outside edge and corner, stacked surfaces offer up/down joins, four-surface junctions show no menu');
  assert.deepEqual(failures, []);
  await page.screenshot({ path: resolve(output, 'workspace-ui-final.png') });
  await writeFile(resolve(output, 'workspace-ui-verification.json'), JSON.stringify({ passed: checks, initial: start, date: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ passed: checks, screenshot: resolve(output, 'workspace-ui-final.png') }, null, 2));
  }
} catch (error) { await page.screenshot({ path: resolve(output, 'workspace-ui-failure.png') }); throw error; }
finally { await browser.close(); }




