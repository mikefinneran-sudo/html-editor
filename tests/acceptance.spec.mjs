// Acceptance contract for WAL issue "html-editor: move/resize with mouse, touch and Apple Pencil".
// Written before the build; the builder must make these pass without editing this file.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FIXTURE = path.resolve('tests/fixtures/site/index.html');
let server, root, base;

test.beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'he-site-'));
  fs.copyFileSync(FIXTURE, path.join(root, 'index.html'));
  const port = 8700 + Math.floor(Math.random() * 200);
  base = `http://127.0.0.1:${port}`;
  server = spawn('node', ['server.js', '--root', root, '--port', String(port)], { stdio: 'inherit' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server.js did not start');
});

test.afterEach(() => { server?.kill(); });

const original = () => fs.readFileSync(FIXTURE, 'utf8');
const onDisk = () => fs.readFileSync(path.join(root, 'index.html'), 'utf8');

async function openFixture(page) {
  await page.goto(base + '/?file=index.html');
  await expect(page.frameLocator('#canvas').locator('#card')).toBeVisible();
}

async function select(page, id) {
  await page.frameLocator('#canvas').locator('#' + id).click();
  await expect(page.locator('[data-handle="se"]')).toBeVisible();
}

async function center(page, handle) {
  const b = await page.locator(`[data-handle="${handle}"]`).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// Real input through CDP so the page sees genuine mouse, pen and touch pointer events.
async function drag(page, from, to, pointerType = 'mouse') {
  const cdp = await page.context().newCDPSession(page);
  const steps = 10;
  const at = (i) => ({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  if (pointerType === 'touch') {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(i)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    const ev = (type, p, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', pointerType, ...extra });
    await ev('mouseMoved', from, { button: 'none' });
    await ev('mousePressed', from, { buttons: 1, clickCount: 1 });
    for (let i = 1; i <= steps; i++) await ev('mouseMoved', at(i), { buttons: 1 });
    await ev('mouseReleased', to, { buttons: 0, clickCount: 1 });
  }
}

async function cardSize(page, id = 'card') {
  return page.frameLocator('#canvas').locator('#' + id).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
}

async function save(page) {
  const before = onDisk();
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => onDisk() !== before, { timeout: 5000 }).toBe(true);
  return onDisk();
}

for (const pointerType of ['mouse', 'pen', 'touch']) {
  test(`resize with ${pointerType} via the bottom-right handle`, async ({ page }) => {
    await openFixture(page);
    await select(page, 'card');
    const from = await center(page, 'se');
    await drag(page, from, { x: from.x + 60, y: from.y + 40 }, pointerType);
    const s = await cardSize(page);
    expect(Math.abs(s.w - 260)).toBeLessThanOrEqual(4);
    expect(Math.abs(s.h - 160)).toBeLessThanOrEqual(4);
  });
}

test('save after a resize changes only the resized element line on disk', async ({ page }) => {
  await openFixture(page);
  await select(page, 'card');
  const from = await center(page, 'se');
  await drag(page, from, { x: from.x + 60, y: from.y + 40 });
  const saved = await save(page);
  const a = original().split('\n'), b = saved.split('\n');
  expect(b.length).toBe(a.length);
  const changed = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
  expect(changed.length).toBe(1);
  expect(b[changed[0]]).toContain('id="card"');
  expect(b[changed[0]]).toMatch(/width:\s*2[56]\dpx/);
});

test('move: drag the move grip to put Card A after Card B, then save', async ({ page }) => {
  await openFixture(page);
  await select(page, 'card');
  const from = await center(page, 'move');
  const b = await page.frameLocator('#canvas').locator('#second').boundingBox();
  await drag(page, from, { x: b.x + b.width - 5, y: b.y + b.height / 2 }, 'pen');
  const order = await page.frameLocator('#canvas').locator('#row').evaluate((el) => [...el.children].map((c) => c.id));
  expect(order).toEqual(['second', 'card']);
  const saved = await save(page);
  expect(saved.indexOf('Card B')).toBeLessThan(saved.indexOf('Card A'));
  expect(saved).toContain('<p id="footer">Footer text</p>');
});

test('padding: drag the left padding handle of the row', async ({ page }) => {
  await openFixture(page);
  await select(page, 'row');
  const from = await center(page, 'pad-left');
  await drag(page, from, { x: from.x + 20, y: from.y }, 'pen');
  const pl = await page.frameLocator('#canvas').locator('#row').evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(Math.abs(pl - 44)).toBeLessThanOrEqual(3);
});

test('server refuses writes outside the site root and non-html files', async () => {
  const bad = await fetch(base + '/api/file?path=' + encodeURIComponent('../evil.html'), { method: 'PUT', body: 'x' });
  expect([400, 403]).toContain(bad.status);
  expect(fs.existsSync(path.join(path.dirname(root), 'evil.html'))).toBe(false);
  const js = await fetch(base + '/api/file?path=evil.js', { method: 'PUT', body: 'x' });
  expect([400, 403]).toContain(js.status);
  const ok = await fetch(base + '/api/file?path=index.html');
  expect(ok.status).toBe(200);
  expect(await ok.text()).toBe(original());
});
