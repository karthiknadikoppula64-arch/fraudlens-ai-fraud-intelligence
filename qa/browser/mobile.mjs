// Mobile drawer, touch targets, font sizes, contrast, dark mode screenshots.
import { launch, track, ready, BASE, check, summary } from './common.mjs';
const SHOTS = process.env.SHOTS || 'qa-screenshots';
const b = await launch();
const log = [];

// ---------- mobile (iPhone-ish) ----------
const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await m.newPage(); track(page, log);
const activeInfo = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 50) : null; });
await page.goto(BASE + '/overview'); await ready(page);
const menu = page.locator('button[aria-label="Open navigation menu"]');
check('mobile: drawer closed initially, links not focusable', (await menu.getAttribute('aria-expanded')) === 'false' && (await page.locator('#app-sidebar').evaluate((el) => getComputedStyle(el).visibility)) === 'hidden');
await menu.click(); await page.waitForTimeout(300);
check('mobile: menu opens drawer, focus on close', (await menu.getAttribute('aria-expanded')) === 'true' && (await activeInfo()) === 'Close navigation menu');
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
check('mobile: Escape closes drawer, focus back to menu button', (await menu.getAttribute('aria-expanded')) === 'false' && (await activeInfo()) === 'Open navigation menu');
await menu.click(); await page.waitForTimeout(300);
await page.mouse.click(380, 400); await page.waitForTimeout(300);
check('mobile: backdrop tap closes drawer', (await menu.getAttribute('aria-expanded')) === 'false');
await menu.click(); await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/mobile-drawer-light.png` });
await page.locator('#app-sidebar nav a', { hasText: 'Delayed-Label Evaluation' }).click(); await page.waitForTimeout(400);
check('mobile: nav link navigates and closes drawer', new URL(page.url()).pathname === '/delayed' && (await menu.getAttribute('aria-expanded')) === 'false');
// breadcrumb truncation exposes the full title
const bc = page.locator('nav[aria-label="Breadcrumb"] li[aria-current="page"]');
check('mobile: breadcrumb has full title attribute', (await bc.getAttribute('title')) === 'Delayed-Label Evaluation');

// touch targets & font sizes on several pages
for (const path of ['/overview', '/stream', '/manual', '/delayed', '/queue', '/models', '/dataset', '/drift', '/shap']) {
  await page.goto(BASE + path); await ready(page);
  const r = await page.evaluate(() => {
    const vis = (el) => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0; };
    const small = [];
    for (const el of document.querySelectorAll('button, #app-sidebar nav a, a.cs-btn, select, .cs-input')) {
      if (!vis(el) || el.closest('#app-sidebar') && getComputedStyle(document.getElementById('app-sidebar')).visibility === 'hidden') continue;
      const b = el.getBoundingClientRect();
      if (b.height < 43.5) small.push(`${el.tagName}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)} h=${b.height.toFixed(0)}`);
      if (el.tagName === 'BUTTON' && el.getAttribute('aria-label') && !el.querySelector('span:not(.sr-only)') && b.width < 43.5) small.push(`icon ${el.getAttribute('aria-label')} w=${b.width.toFixed(0)}`);
    }
    const tiny = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.textContent.trim()) continue;
      const el = n.parentElement; if (!vis(el) || el.closest('.sr-only')) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12) tiny.add(`${fs}px "${n.textContent.trim().slice(0, 25)}"`);
    }
    return { small, tiny: [...tiny] };
  });
  check(`mobile ${path}: all buttons/links/inputs ≥ 44 px`, r.small.length === 0, r.small.slice(0, 6).join(' | '));
  check(`mobile ${path}: no visible text < 12 px`, r.tiny.length === 0, r.tiny.slice(0, 6).join(' | '));
}
await page.goto(BASE + '/manual'); await ready(page);
await page.screenshot({ path: `${SHOTS}/mobile-manual-light.png`, fullPage: false });
await page.goto(BASE + '/drift'); await ready(page);
await page.locator('[role="img"][aria-label^="Drift trajectory"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/mobile-drift-light.png`, fullPage: false });
await m.close();

// ---------- contrast: filled buttons & chart legends (light + dark) ----------
const lum = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const parse = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
for (const scheme of ['light', 'dark']) {
  const c = await b.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: scheme });
  const p = await c.newPage(); track(p, log);
  await p.goto(BASE + '/models'); await ready(p);
  const cols = await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.cs-btn-primary, .cs-seg > button[aria-pressed="true"]')) { const s = getComputedStyle(el); out.push(['btn ' + el.textContent.trim().slice(0, 20), s.color, s.backgroundColor]); }
    const bg = getComputedStyle(document.querySelector('.cs-card')).backgroundColor;
    for (const outer of document.querySelectorAll('.recharts-legend-item-text')) { const el = outer.querySelector('span') ?? outer; out.push(['legend ' + el.textContent.trim(), getComputedStyle(el).color, bg]); }
    for (const el of document.querySelectorAll('.recharts-cartesian-axis-tick-value, .recharts-label')) out.push(['svg ' + el.textContent.trim().slice(0, 12), getComputedStyle(el).fill, bg]);
    return out;
  });
  const bad = cols.filter(([, fg, bg]) => ratio(parse(fg), parse(bg)) < 4.5).map(([n, fg, bg]) => `${n} ${ratio(parse(fg), parse(bg)).toFixed(2)}`);
  check(`contrast ${scheme} /models: filled buttons, legend text, axis/ref labels ≥ 4.5:1`, bad.length === 0 && cols.length > 5, bad.slice(0, 6).join(' | ') || `${cols.length} checked`);
  for (const path of ['/overview', '/stream', '/delayed', '/queue', '/drift', '/manual']) {
    await p.goto(BASE + path); await ready(p);
    if (path === '/manual') { await p.getByLabel('Amount (USD)').fill('4200'); await p.locator('main form button[type="submit"]').click(); await p.waitForTimeout(300); }
    await p.screenshot({ path: `${SHOTS}${path}-${scheme}.png` });
  }
  await p.goto(BASE + '/models'); await ready(p); await p.screenshot({ path: `${SHOTS}/models-${scheme}.png` });
  await c.close();
}
check('console (mobile + contrast runs): no errors / warnings / failed requests', log.length === 0, log.slice(0, 6).join(' | '));
await b.close();
process.exit(summary() ? 1 : 0);
