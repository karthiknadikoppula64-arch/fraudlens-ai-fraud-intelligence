// Real-browser (headless Chromium 141) audit of ChronoSentry interactive controls.
import { launch, track, ready, BASE, check, summary } from './common.mjs';
import fs from 'node:fs';

const SHOTS = process.env.SHOTS || 'qa-screenshots';
fs.mkdirSync(SHOTS, { recursive: true });
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true, colorScheme: 'light' });
const page = await ctx.newPage();
const log = [];
track(page, log);

const txt = async (sel) => (await page.locator(sel).first().innerText()).trim();
const setRange = async (sel, v) => page.locator(sel).first().evaluate((el, v) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);
const nav = async (label) => { await page.locator('#app-sidebar nav a', { hasText: label }).first().click(); await page.waitForTimeout(250); };
const replayPos = async () => Number((await page.locator('text=/position \\d+ of/').first().innerText()).match(/position (\d+) of/)[1]);
const srcBtn = (n) => page.locator('[aria-label="Ledger source"] button', { hasText: n });
const ONLY = (process.env.SECTIONS || 'nav,stream,manual,delayed,queue,models,shap,export,dataset').split(',');
const activeInfo = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute('aria-label') || a.textContent || a.id || a.tagName).trim().slice(0, 60) : null; });

// ============ 8. Navigation ============
if (ONLY.includes('nav')) {
await page.goto(BASE + '/'); await ready(page);
check('nav: / redirects to /overview', new URL(page.url()).pathname === '/overview');
const NAV = [['Executive Overview', '/overview', 'Executive Overview'], ['Real-Time Stream', '/stream', 'Real-Time Stream and Live Scoring'], ['Manual Transaction', '/manual', 'Manual Transaction'], ['Dataset & Ingestion', '/dataset', 'Dataset and Ingestion'], ['Model Benchmarking', '/models', 'Model Benchmarking and Cost-Sensitive Tuning'], ['SHAP Explanations', '/shap', 'SHAP Explanations and Local Attribution'], ['Drift Monitoring', '/drift', 'Confidence-Bounded Drift Monitoring'], ['Delayed-Label Evaluation', '/delayed', 'Delayed-Label Evaluation'], ['Review Queue Simulator', '/queue', 'Limited Review Queue Simulator'], ['Methodology & Limitations', '/methodology', 'Methodology and Limitations'], ['Technical Details', '/about', 'Technical Details']];
for (const [label, path, h1] of NAV) {
  await nav(label);
  const cur = await page.locator('#app-sidebar a[aria-current="page"]').innerText();
  const bc = await page.locator('nav[aria-label="Breadcrumb"] li[aria-current="page"]').getAttribute('title');
  check(`nav: sidebar "${label}"`, new URL(page.url()).pathname === path && (await txt('h1')) === h1 && cur.includes(label) && bc === h1 && (await page.title()).startsWith(h1), `url=${new URL(page.url()).pathname}`);
}
await page.goBack(); await page.waitForTimeout(200);
check('nav: Back', new URL(page.url()).pathname === '/methodology' && (await txt('h1')) === 'Methodology and Limitations');
await page.goForward(); await page.waitForTimeout(200);
check('nav: Forward', new URL(page.url()).pathname === '/about' && (await txt('h1')) === 'Technical Details');
await page.goto(BASE + '/transactions'); await ready(page);
check('nav: /transactions alias → /stream', new URL(page.url()).pathname === '/stream');
await page.goto(BASE + '/does-not-exist'); await ready(page);
check('nav: unknown path → /overview', new URL(page.url()).pathname === '/overview');
// overview contribution link uses the real route href
const contribHref = await page.locator('a', { hasText: 'Open delayed-label evaluation' }).getAttribute('href');
await page.locator('a', { hasText: 'Open delayed-label evaluation' }).click(); await page.waitForTimeout(200);
check('overview: contribution link', contribHref === '/delayed' && new URL(page.url()).pathname === '/delayed');
// theme
await page.goto(BASE + '/overview'); await ready(page);
const themeBtn = page.locator('header button[aria-label="Dark theme"]');
await themeBtn.click();
check('theme: header toggle → dark', await page.evaluate(() => document.documentElement.classList.contains('dark')) && (await themeBtn.getAttribute('aria-pressed')) === 'true');
await nav('Model Benchmarking');
check('theme: persists across navigation', await page.evaluate(() => document.documentElement.classList.contains('dark')));
await page.reload(); await ready(page);
check('theme: persists across reload', await page.evaluate(() => document.documentElement.classList.contains('dark')));
await page.locator('#app-sidebar button[aria-label="Dark theme"]').click();
check('theme: sidebar toggle → light', !(await page.evaluate(() => document.documentElement.classList.contains('dark'))));
// skip link
await page.goto(BASE + '/overview'); await ready(page);
await page.keyboard.press('Tab');
check('a11y: first Tab = skip link', (await activeInfo()) === 'Skip to content');

}
// ============ 2. Stream ============
if (ONLY.includes('stream')) {
await page.goto(BASE + '/stream'); await ready(page);
const p0 = await replayPos(); await page.waitForTimeout(3600); const p1 = await replayPos();
check('stream: starts running and advances', p1 > p0, `${p0}→${p1}`);
await page.locator('main button', { hasText: 'Pause stream' }).click();
const pp0 = await replayPos(); await page.waitForTimeout(3800); const pp1 = await replayPos();
check('stream: Pause freezes replay', pp0 === pp1 && (await page.locator('#app-sidebar').innerText()).includes('Stream: paused'), `${pp0}→${pp1}`);
await page.locator('main button', { hasText: 'Resume stream' }).click();
await page.waitForTimeout(3600);
check('stream: Resume advances again', (await replayPos()) > pp1);
// threshold drag while running must not stall the interval (bug fixed: interval restarted on each τ change)
const t0 = await replayPos();
for (let i = 0; i < 9; i++) { await setRange('#stream-threshold', (0.2 + i * 0.05).toFixed(2)); await page.waitForTimeout(800); }
const t1 = await replayPos();
check('stream: keeps ticking while τ slider is moved every 0.8 s', t1 - t0 >= 2, `${t0}→${t1} in 7.2 s`);
check('stream: τ label follows slider', (await page.locator('label[for="stream-threshold"]').innerText()).includes('0.60'));
await page.locator('main button', { hasText: /Use validation-tuned/ }).click();
const tauStar = (await page.locator('main button', { hasText: /Use validation-tuned/ }).innerText()).match(/= ([\d.]+)/)[1];
check('stream: "Use validation-tuned τ*" applies τ*', (await page.locator('label[for="stream-threshold"]').innerText()).includes(tauStar) && await page.locator('main button', { hasText: /Use validation-tuned/ }).isDisabled());
// speed 5x
await page.locator('[aria-labelledby="speed-label"] button', { hasText: '5×' }).click();
const s0 = await replayPos(); await page.waitForTimeout(3300); const s1 = await replayPos();
check('stream: speed 5× ≈ 5 ticks / 3.2 s', s1 - s0 >= 4 && (await page.locator('[aria-labelledby="speed-label"] button[aria-pressed="true"]').innerText()) === '5×', `${s0}→${s1}`);
await page.locator('[aria-labelledby="speed-label"] button', { hasText: '1×' }).click();
// analytics tabs
for (const [tab, want, notWant] of [['Spikes', 'Alert frequency', 'Comparative Error Cost'], ['Costs', 'Comparative Error Cost', 'Alert frequency'], ['Density', 'Probability Density', 'Comparative Error Cost'], ['All', 'Alert frequency', null]]) {
  await page.locator('[aria-label="Analytics view"] button', { hasText: tab }).click(); await page.waitForTimeout(150);
  const body = await page.locator('main').innerText();
  check(`stream: analytics tab ${tab}`, body.includes(want) && (!notWant || !body.includes(notWant)));
}
// ledger sources
await srcBtn('Test split').click(); await page.waitForTimeout(150);
const testTotal = Number((await srcBtn('Test split').innerText()).match(/\(([\d,]+)\)/)[1].replace(/,/g, ''));
check('ledger: Test split source total', (await page.locator('text=/Showing \\d+ of/').innerText()).includes(`(${testTotal.toLocaleString('en-US')} total)`));
// pagination on test split
await page.locator('nav[aria-label="Ledger pagination"] button[aria-label="Next page"]').click();
check('ledger: next page', (await page.locator('nav[aria-label="Ledger pagination"]').innerText()).includes('Page 2 /'));
await page.waitForTimeout(3500);
check('ledger: page kept across stream ticks', (await page.locator('nav[aria-label="Ledger pagination"]').innerText()).includes('Page 2 /'));
// filters
await page.locator('select:has(option[value="Unknown"])').selectOption('Unknown'); await page.waitForTimeout(150);
const unknownRows = await page.locator('table tbody tr').allInnerTexts();
check('ledger: status Unknown → only Pending/Unknown rows, back to page 1', unknownRows.length > 0 && unknownRows.every((r) => /Pending/i.test(r)) && !(await page.locator('nav[aria-label="Ledger pagination"]').count() && (await page.locator('nav[aria-label="Ledger pagination"]').innerText()).includes('Page 2')), `${unknownRows.length} rows`);
await page.locator('select:has(option[value="Unknown"])').selectOption('Confirmed Fraud'); await page.waitForTimeout(150);
const fraudRows = await page.locator('table tbody tr').allInnerTexts();
check('ledger: status Confirmed Fraud', fraudRows.length > 0 && fraudRows.every((r) => /Confirmed Fraud/i.test(r)));
await page.locator('select:has(option[value="Unknown"])').selectOption('All');
const cat = await page.locator('select:has(option[value="All"]:text("All categories")) option').nth(1).getAttribute('value');
await page.locator('select:has(option:text("All categories"))').selectOption(cat); await page.waitForTimeout(150);
const catRows = await page.locator('table tbody tr').allInnerTexts();
check(`ledger: category filter (${cat})`, catRows.every((r) => r.includes(cat)));
await page.locator('main button[aria-label="Clear all filters"]').click(); await page.waitForTimeout(150);
const search = 'TX-';
await page.locator('input[type="search"]').fill('zzzz-no-match'); await page.waitForTimeout(150);
check('ledger: search with no match → empty state', (await page.locator('main').innerText()).includes('No transactions match the current filters'));
await page.locator('main button[aria-label="Clear all filters"]').click();
// sort by amount
await page.locator('th button', { hasText: 'Amount' }).click(); await page.waitForTimeout(150);
const amts = (await page.locator('table tbody tr td:nth-child(3)').allInnerTexts()).map((t) => Number(t.replace(/[^0-9.]/g, '')));
check('ledger: sort amount desc + aria-sort', amts.every((v, i) => i === 0 || amts[i - 1] >= v) && (await page.locator('th[aria-sort="descending"]').innerText()).includes('Amount'));
// details drawer + Escape + focus return
const firstDetails = page.locator('table tbody tr button', { hasText: 'Details' }).first();
await firstDetails.click();
check('drawer: opens with focus on close', (await page.locator('[role="dialog"][aria-labelledby="drawer-title"]').count()) === 1 && (await activeInfo()) === 'Close details');
await page.keyboard.press('Tab'); const focusedInDrawer = await activeInfo();
await page.waitForTimeout(3500);
check('drawer: focus not stolen by stream ticks', (await activeInfo()) === focusedInDrawer, `${focusedInDrawer} → ${await activeInfo()}`);
await page.keyboard.press('Escape');
check('drawer: Escape closes and returns focus to Details button', (await page.locator('[aria-labelledby="drawer-title"]').count()) === 0 && (await activeInfo()).startsWith('Details for'));
// explain modal + backdrop
await page.locator('table tbody tr button', { hasText: 'Explain' }).first().click();
check('modal: Explain opens SHAP modal', (await page.locator('#shap-modal-title').count()) === 1);
await page.locator('[role="dialog"] button', { hasText: 'Keep in review' }).focus();
await page.waitForTimeout(3500);
check('modal: focus not stolen by stream ticks', (await activeInfo()) === 'Keep in review');
// Tab trap: from last button Tab goes to first focusable (close)
await page.keyboard.press('Tab');
check('modal: Tab wraps inside dialog', (await activeInfo()) === 'Close investigation dialog');
await page.mouse.click(5, 5);
check('modal: backdrop click closes', (await page.locator('#shap-modal-title').count()) === 0);
// synthetic stream + surge
await page.locator('[aria-label="Stream source"] button', { hasText: 'Synthetic stream' }).click();
await srcBtn('Live buffer').click();
await page.waitForTimeout(3600);
await page.locator('main button', { hasText: 'Simulate attack surge' }).click(); await page.waitForTimeout(200);
const liveRows = await page.locator('table tbody tr').allInnerTexts();
check('stream: synthetic stream + surge → SIM rows, Simulated & Pending', liveRows.length >= 4 && liveRows.slice(0, 4).every((r) => r.includes('SIM-') && /Simulated/i.test(r) && /Pending/i.test(r)), `${liveRows.length} rows`);
await page.locator('[aria-label="Stream source"] button', { hasText: 'Replay test split' }).click(); await page.waitForTimeout(200);
check('stream: back to replay mode', (await page.locator('main').innerText()).includes('Replay of held-out test split'));
await page.screenshot({ path: `${SHOTS}/stream-light.png`, fullPage: false });

}
// ============ 1. Manual Transaction (stream before / during / after) ============
if (ONLY.includes('manual')) {
await page.goto(BASE + '/manual'); await ready(page);
const procText = async () => Number((await page.locator('text=/[\\d,]+ processed/').innerText()).match(/([\d,]+) processed/)[1].replace(/,/g, ''));
const m0 = await procText();
const fields = await page.locator('main form label').count();
check('manual: form renders fields from feature space', fields === 8, `${fields} fields`);
const amount = page.getByLabel('Amount (USD)');
await amount.fill('-5');
await page.locator('main form button[type="submit"]').click();
check('manual: invalid amount → inline error, aria-invalid, value kept', (await amount.getAttribute('aria-invalid')) === 'true' && (await amount.inputValue()) === '-5' && (await page.locator('main form [role="alert"]').count()) >= 1);
await amount.fill('');
await page.locator('main form button[type="submit"]').click();
check('manual: empty amount → error, no submit', (await amount.getAttribute('aria-invalid')) === 'true' && (await page.locator('main').innerText()).includes('Manual test history (0)'));
await page.locator('main form button', { hasText: 'Reset to defaults' }).click();
check('manual: Reset restores default & clears errors', (await amount.inputValue()) !== '' && (await amount.getAttribute('aria-invalid')) === null);
await amount.fill('2500');
await page.keyboard.press('Enter'); // keyboard submit
await page.waitForTimeout(200);
check('manual: Enter submits → verdict + history 1 + form reset', (await page.locator('main').innerText()).includes('Manual test history (1)') && /Suspicious|Legitimate/.test(await page.locator('main section[aria-live]').innerText()) && (await amount.inputValue()) !== '2500');
for (let i = 0; i < 3; i++) { await page.locator('main form button[type="submit"]').click(); await page.waitForTimeout(1300); }
const m1 = await procText();
check('manual: stream keeps running during checks (3 checks in ~4 s)', m1 > m0 && (await page.locator('main').innerText()).includes('Manual test history (4)'), `${m0}→${m1}`);
// draft + result survive navigation
await amount.fill('777');
await nav('Model Benchmarking'); await nav('Manual Transaction');
check('manual: draft value persists across navigation', (await page.getByLabel('Amount (USD)').inputValue()) === '777');
check('manual: result + history persist across navigation', (await page.locator('main').innerText()).includes('Manual test history (4)') && /prediction/i.test(await page.locator('main section[aria-live]').innerText()));
// pause → check → still paused & frozen
await page.locator('#app-sidebar button[aria-label="Pause live stream"]').click();
const f0 = await procText();
await page.locator('main form button[type="submit"]').click(); await page.waitForTimeout(3500);
check('manual: check while paused keeps stream paused & frozen', (await procText()) === f0 && (await page.locator('main').innerText()).includes('Manual test history (5)') && (await page.locator('main').innerText()).includes('Live stream paused'));
await page.locator('#app-sidebar button[aria-label="Resume live stream"]').click();
await page.waitForTimeout(3500);
check('manual: stream resumes after manual checks', (await procText()) > f0);
// explain from history
await page.locator('main table button', { hasText: 'Explain' }).first().click();
const modalId = await page.locator('[role="dialog"] .font-mono.font-bold').first().innerText();
check('manual: history Explain opens modal for that row', modalId.startsWith('MAN') || modalId.includes('MAN'), modalId);
await page.keyboard.press('Escape');
// manual rows not in live buffer, present in Manual tests tab
await page.locator('main button', { hasText: 'Open stream ledger' }).click(); await page.waitForTimeout(250);
await srcBtn('Live buffer').click(); await page.waitForTimeout(150);
const liveIds = await page.locator('table tbody tr td:first-child').allInnerTexts();
await srcBtn('Manual tests').click(); await page.waitForTimeout(150);
const manRows = await page.locator('table tbody tr').allInnerTexts();
check('manual: rows only in "Manual tests" tab, never in live buffer', manRows.length === 5 && manRows.every((r) => /Manual/i.test(r)) && !liveIds.some((t) => t.includes(modalId)), `${manRows.length} manual rows`);
await srcBtn('Live buffer').click();
await nav('Manual Transaction');
await page.locator('main button', { hasText: 'Clear history' }).click();
check('manual: Clear history', (await page.locator('main').innerText()).includes('Manual test history (0)'));

}
// ============ 3. Delayed labels ============
if (ONLY.includes('delayed')) {
await page.goto(BASE + '/delayed'); await ready(page);
const expected = { 'Day 7': 437, 'Day 14': 952, 'Day 30': 1321, 'Day 60': 1467 };
const detailCount = async (k) => Number((await page.locator('#delayed-detail-title').locator('xpath=ancestor::section[1]').locator('dl >> div', { hasText: k }).first().locator('dd').innerText()).replace(/,/g, ''));
const plot = page.locator('.recharts-surface').first();
const box = await page.locator('.recharts-cartesian-grid').first().boundingBox();
const days = ['Day 7', 'Day 14', 'Day 30', 'Day 60'];
for (let i = 0; i < 4; i++) {
  // click near the TOP of each column (inside the plot area, where the amber/green segments are)
  await page.mouse.click(box.x + box.width * (i + 0.5) / 4, box.y + 8); await page.waitForTimeout(200);
  const title = await txt('#delayed-detail-title');
  const avail = await detailCount('Label available');
  const pressed = await page.locator('[aria-label="Evaluation horizon"] button[aria-pressed="true"]').innerText();
  check(`delayed: column click selects ${days[i]}`, title.startsWith(days[i] + ' ') && avail === expected[days[i]] && pressed.startsWith(days[i]), `title="${title}" available=${avail}`);
}
// thin red bar exact click on Day 30 via series rect
await page.locator('.recharts-bar').nth(0).locator('.recharts-bar-rectangle').nth(2).click({ force: true }); await page.waitForTimeout(150);
check('delayed: thin confirmed-fraud segment click → Day 30', (await txt('#delayed-detail-title')).startsWith('Day 30 '));
// mirrored cards + keyboard
await page.locator('[aria-label="Evaluation horizon"] button').nth(0).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
check('delayed: card button via keyboard → Day 7', (await txt('#delayed-detail-title')).startsWith('Day 7 ') && (await detailCount('Still pending')) === 1030);
// filters: pending rows all pending & arrive after day 7
await page.locator('[aria-label="Filter transactions by label status"] button', { hasText: 'Still pending' }).click(); await page.waitForTimeout(150);
const pendRows = await page.locator('#delayed-detail-title >> xpath=ancestor::section[1] >> table tbody tr').allInnerTexts();
check('delayed: "Still pending" filter rows are all pending with lag > 7', pendRows.length === 25 && pendRows.every((r) => /Pending \(arrives day (14|30|60)\)/.test(r)), `${pendRows.length} rows`);
await page.locator('#delayed-detail-title >> xpath=ancestor::section[1] >> button[aria-label="Next page"]').click();
check('delayed: pagination', (await page.locator('#delayed-detail-title >> xpath=ancestor::section[1]').innerText()).includes('Showing 26–50 of 1,030'));
await page.locator('[aria-label="Evaluation horizon"] button').nth(2).click(); await page.waitForTimeout(150);
const newly = await page.locator('[aria-label="Filter transactions by label status"] button', { hasText: 'Newly matured' });
await newly.click(); await page.waitForTimeout(150);
const newRows = await page.locator('#delayed-detail-title >> xpath=ancestor::section[1] >> table tbody tr').allInnerTexts();
check('delayed: Day 30 newly matured rows have lag 30, page reset on horizon change', newRows.length > 0 && newRows.every((r) => /\b30 d\b/.test(r)) && (await page.locator('#delayed-detail-title >> xpath=ancestor::section[1]').innerText()).includes('Showing 1–'), `${newRows.length}`);
await nav('Executive Overview'); await nav('Delayed-Label Evaluation');
check('delayed: selected horizon persists across navigation', (await txt('#delayed-detail-title')).startsWith('Day 30 '));
await page.screenshot({ path: `${SHOTS}/delayed-light.png`, fullPage: false });

}
// ============ 4. Review queue ============
if (ONLY.includes('queue')) {
await page.goto(BASE + '/queue'); await ready(page);
const qCount = async (k) => Number((await page.locator('dl >> div', { hasText: k }).first().locator('dd').innerText()).replace(/,/g, ''));
const inQ = await qCount('In queue'); const aw0 = await qCount('Awaiting review');
const pendingIds = async () => {
  const rows = page.locator('table tbody tr');
  const out = [];
  for (let i = 0; i < await rows.count(); i++) if (await rows.nth(i).locator('button', { hasText: 'Confirm fraud' }).isEnabled()) out.push((await rows.nth(i).locator('td:first-child span.font-mono').innerText()).trim());
  return out;
};
const firstRowId = (await pendingIds())[0];
const rowTop = await page.locator('table tbody tr').first().boundingBox();
await page.locator(`button[aria-label="Confirm ${firstRowId} as fraud (simulated)"]`).click();
check('queue: Confirm fraud → awaiting −1, confirmed +1, row stays in place with buttons disabled', (await qCount('Awaiting review')) === aw0 - 1 && (await qCount('Confirmed fraud (sim.)')) === 1 && await page.locator(`button[aria-label="Confirm ${firstRowId} as fraud (simulated)"]`).isDisabled() && (await page.locator('table tbody tr').first().boundingBox()).y === rowTop.y, `inQueue=${inQ}`);
const id2 = (await pendingIds())[0];
await page.locator(`button[aria-label="Mark ${id2} reviewed"]`).dblclick();
const id2next = (await pendingIds())[0];
check('queue: double-click Mark reviewed decides exactly one alert (no layout shift onto the next row)', (await qCount('Reviewed (sim.)')) === 1 && (await qCount('Awaiting review')) === aw0 - 2 && id2next !== id2);
const id3 = (await pendingIds())[0];
await page.locator(`button[aria-label="Mark ${id3} legitimate (simulated)"]`).click();
check('queue: Mark legitimate', (await qCount('Marked legitimate (sim.)')) === 1);
await page.locator('main button', { hasText: 'Undo last' }).click();
check('queue: Undo reverts only the last decision (row re-enabled)', (await qCount('Marked legitimate (sim.)')) === 0 && (await qCount('Reviewed (sim.)')) === 1 && (await qCount('Awaiting review')) === aw0 - 2 && await page.locator(`button[aria-label="Mark ${id3} legitimate (simulated)"]`).isEnabled());
await page.locator('[aria-label="Queue view"] button', { hasText: 'Decided' }).click();
const decidedRows = await page.locator('table tbody tr').allInnerTexts();
check('queue: Decided view lists decided rows with disabled actions', decidedRows.length === 2 && (await page.locator('table tbody tr button:disabled').count()) === 6);
await nav('Executive Overview'); await nav('Review Queue Simulator');
check('queue: decisions + view persist across navigation', (await qCount('Awaiting review')) === aw0 - 2 && (await page.locator('[aria-label="Queue view"] button[aria-pressed="true"]').innerText()).startsWith('Decided'));
await page.locator('[aria-label="Queue view"] button', { hasText: 'Awaiting' }).click();
if (await page.locator('main section[aria-labelledby="workbench-title"] button[aria-label="Next page"]').isEnabled()) {
  await page.locator('main section[aria-labelledby="workbench-title"] button[aria-label="Next page"]').click();
  check('queue: pagination', (await page.locator('main section[aria-labelledby="workbench-title"]').innerText()).includes('Showing 16–'));
}
await page.locator('main button', { hasText: /^\s*Reset$/ }).click();
check('queue: Reset clears all decisions', (await qCount('Awaiting review')) === inQ && (await page.locator('main button', { hasText: 'Undo last' }).isDisabled()));
// capacity simulation controls
const capBefore = await page.locator('main').innerText();
await setRange('input[aria-label="Reviews per day"]', 1); await page.waitForTimeout(150);
await page.locator('main button', { hasText: 'Highest Risk Score' }).first().click();
check('queue: capacity slider + strategy selection update', (await page.locator('main').innerText()) !== capBefore && (await page.locator('main button[aria-pressed="true"]', { hasText: 'Highest Risk Score' }).count()) === 1);

}
// ============ 6. Models ============
if (ONLY.includes('models')) {
await page.goto(BASE + '/models'); await ready(page);
await page.locator('main table button[aria-label="Select XGBoost as the active model"]').click(); await page.waitForTimeout(300);
check('models: select XGBoost → active everywhere', (await page.locator('main table button[aria-pressed="true"]').getAttribute('aria-label')).startsWith('XGBoost') && (await page.locator('header.sticky').innerText()).includes('XGBoost'));
const tauAfterSelect = Number((await page.locator('label[for="bench-threshold"] strong').innerText()));
const recAfterSelect = Number((await page.locator('main button', { hasText: /Apply validation-tuned/ }).innerText()).match(/\(([\d.]+)\)/)[1]);
check('models: selecting a model adopts its validation-tuned τ*', Math.abs(tauAfterSelect - recAfterSelect) < 1e-9, `${tauAfterSelect} vs ${recAfterSelect}`);
for (const c of ['Train', 'Validation', 'Test']) {
  await page.locator('[aria-label="Evaluation cohort"] button', { hasText: c }).click(); await page.waitForTimeout(150);
  check(`models: cohort ${c}`, (await page.locator('main').innerText()).includes(`Model performance – ${c} split`));
}
const atTauText = async () => page.locator('main div[aria-live="polite"]', { hasText: 'at the current τ' }).innerText();
const before = await atTauText();
await setRange('#bench-threshold', 0.9); await page.waitForTimeout(200);
const after = await atTauText();
check('models: τ slider updates live metrics at τ', before !== after && after.includes('τ = 0.90'));
await page.locator('main button', { hasText: /Apply validation-tuned/ }).click();
check('models: Apply τ* sets slider to τ*', Number(await page.locator('label[for="bench-threshold"] strong').innerText()) === recAfterSelect);
const rec0 = await page.locator('main button', { hasText: /Apply validation-tuned/ }).innerText();
const table0 = await page.locator('main table').innerText();
await setRange('main input[type="range"].accent-amber-500', 100); await page.waitForTimeout(300);
const table1 = await page.locator('main table').innerText();
check('models: cost slider changes cost-dependent metrics / τ*', table0 !== table1, `τ* ${rec0} → ${await page.locator('main button', { hasText: /Apply validation-tuned/ }).innerText()}`);
await setRange('main input[type="range"].accent-amber-500', 20);
await page.locator('main table button[aria-label="Select LightGBM as the active model"]').click();
await page.screenshot({ path: `${SHOTS}/models-light.png`, fullPage: false });

}
// ============ 7. SHAP & Drift ============
if (ONLY.includes('shap')) {
await page.goto(BASE + '/shap'); await ready(page);
const samplesBtns = page.locator('[aria-label="Sample cases"] button');
await samplesBtns.nth(2).click();
const sel = (await samplesBtns.nth(2).innerText()).split(' · ')[0];
check('shap: sample case selection', (await page.locator('main').innerText()).includes(sel) && (await samplesBtns.nth(2).getAttribute('aria-pressed')) === 'true');
await page.locator('#shap-search').fill(''); await page.locator('main button', { hasText: 'Find' }).click();
check('shap: empty search → message, selection unchanged', (await page.locator('main p[role="status"]').first().innerText()).includes('Enter a transaction ID') && (await samplesBtns.nth(2).getAttribute('aria-pressed')) === 'true');
await page.locator('#shap-search').fill('NOPE-123'); await page.keyboard.press('Enter');
check('shap: miss → "No transaction … matches"', (await page.locator('main p[role="status"]').first().innerText()).includes('No transaction in the active dataset matches'));
const anyId = sel;
await page.locator('#shap-search').fill(anyId.toLowerCase()); await page.keyboard.press('Enter');
check('shap: search hit (case-insensitive)', (await page.locator('main p[role="status"]').first().innerText()).includes(`Showing ${anyId}`));
await page.locator('main button', { hasText: 'Open in investigation modal' }).click();
check('shap: Open in investigation modal shows same id', (await page.locator('[role="dialog"]').innerText()).includes(anyId));
await page.locator('[role="dialog"] button[aria-label="Close investigation dialog"]').click();
check('modal: close button', (await page.locator('[role="dialog"]').count()) === 0);
await page.goto(BASE + '/drift'); await ready(page);
const tbl0 = await page.locator('main table').innerText();
const opts = await page.locator('select[aria-label="Feature group"] option').allInnerTexts();
await page.locator('select[aria-label="Feature group"]').selectOption({ index: opts.length - 1 }); await page.waitForTimeout(200);
check('drift: feature select updates trajectory + table', (await page.locator('main').innerText()).includes(`Trajectory – ${opts[opts.length - 1]}`) && (await page.locator('main table').innerText()) !== tbl0);
await page.locator('[aria-labelledby="ci-label"] button', { hasText: '99%' }).click(); await page.waitForTimeout(150);
check('drift: confidence 99% updates CI column', (await page.locator('main table thead').innerText()).includes('99% CI'));
await page.locator('[aria-labelledby="pop-label"] button', { hasText: 'All transactions' }).click(); await page.waitForTimeout(300);
check('drift: population toggle', (await page.locator('main').innerText()).includes('population: all transactions'));
await nav('Executive Overview'); await nav('Drift Monitoring');
check('drift: selections persist across navigation', (await page.locator('main table thead').innerText()).includes('99% CI') && (await page.locator('main').innerText()).includes('population: all transactions'));

}
// ============ 9/10. Exports ============
if (ONLY.includes('export')) {
for (const [where, path, sel] of [['header', '/overview', 'header button[aria-label="Export JSON audit report"]'], ['methodology', '/methodology', 'main button:has-text("Export audit report")'], ['about', '/about', 'main button:has-text("Export audit report")']]) {
  await page.goto(BASE + path); await ready(page);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.locator(sel).click()]);
  const f = await dl.path(); const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  check(`export: audit JSON from ${where}`, /^chronosentry-audit-\d+\.json$/.test(dl.suggestedFilename()) && j.application === 'ChronoSentry' && Array.isArray(j.testSplitMetrics) && j.testSplitMetrics.length === 4);
}

}
// ============ 5. Dataset ============
if (ONLY.includes('dataset')) {
await page.goto(BASE + '/dataset'); await ready(page);
const [sdl] = await Promise.all([page.waitForEvent('download'), page.locator('main button', { hasText: 'Download sample CSV' }).click()]);
const sampleCsv = fs.readFileSync(await sdl.path(), 'utf8');
check('dataset: Download sample CSV', sdl.suggestedFilename() === 'chronosentry_synthetic_sample.csv' && sampleCsv.split('\n').length > 8000);
// split cards
await page.locator('main button', { hasText: 'Validation (20%)' }).click(); await page.waitForTimeout(150);
check('dataset: split card filters records', (await page.locator('main').innerText()).includes('Records – validation split') && (await page.locator('[aria-label="Split filter"] button[aria-pressed="true"]').innerText()).toLowerCase() === 'validation');
await page.locator('[aria-label="Split filter"] button', { hasText: 'all' }).click();
// open / close modal variants
const openBtn = page.locator('main button', { hasText: 'Upload CSV' });
await openBtn.click();
check('upload: opens with focus on close', (await page.locator('#upload-title').count()) === 1 && (await activeInfo()) === 'Close upload dialog');
await page.locator('#csv-file').focus(); await page.waitForTimeout(3600);
check('upload: focus not stolen by stream ticks (bug fixed)', (await page.evaluate(() => document.activeElement?.id)) === 'csv-file');
await page.keyboard.press('Escape');
check('upload: Escape closes, focus back to opener', (await page.locator('#upload-title').count()) === 0 && (await activeInfo()).includes('Upload CSV'));
await openBtn.click(); await page.mouse.click(5, 5);
check('upload: backdrop click closes', (await page.locator('#upload-title').count()) === 0);
await page.locator('header button[aria-label^="Active dataset"]').click();
await page.locator('[role="dialog"] button[aria-label="Close upload dialog"]').click();
check('upload: header pill opens, close button closes', (await page.locator('#upload-title').count()) === 0);
// invalid file type
await openBtn.click();
await page.setInputFiles('#csv-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
check('upload: non-CSV rejected with message', (await page.locator('[role="dialog"]').innerText()).includes('Please choose a .csv file'));
// valid CSV with sensitive columns + bad rows + blank labels
const lines = ['transaction_id,timestamp,amount,merchant_category,is_fraud,distance_km,cc_num,email,fraud_score'];
for (let i = 0; i < 300; i++) {
  const ts = new Date(Date.UTC(2025, 0, 1) + i * 3600e3 * 6).toISOString();
  const label = i >= 291 ? '' : (i % 9 === 0 ? 1 : 0);
  lines.push(`T${i},${ts},${(5 + (i * 37) % 900).toFixed(2)},${['Grocery', 'Travel', 'Electronics'][i % 3]},${label},${(i * 7) % 500},4111111111111111,u${i}@x.com,${i % 9 === 0 ? 0.9 : 0.1}`);
}
lines.push('BAD1,not-a-date,10,Grocery,0,1,4111111111111111,a@b.com,0'); lines.push('BAD2,2025-01-01T00:00:00Z,-3,Grocery,0,1,4111111111111111,a@b.com,0'); lines.push('BAD3,2025-01-01T00:00:00Z,3,Grocery,maybe,1,4111111111111111,a@b.com,0');
const csv = lines.join('\n');
await page.setInputFiles('#csv-file', { name: 'upload-test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
await page.waitForSelector('text=Ready: 300 valid transactions');
const rep = await page.locator('[role="dialog"]').innerText();
check('upload: validation report (300 valid, 3 skipped, 9 unlabelled, sensitive dropped, label-derived excluded)', rep.includes('3 skipped') && rep.includes('9 unlabelled') && /sensitive-looking column/.test(rep) && rep.includes('fraud_score') && !rep.includes('4111111111111111') && !rep.includes('u1@x.com'));
// same file again must re-trigger (input value reset)
await page.setInputFiles('#csv-file', { name: 'upload-test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
await page.waitForSelector('text=Ready: 300 valid transactions');
check('upload: file input value reset after each pick (so the same file can be chosen again)', (await page.locator('#csv-file').inputValue()) === '');
// close + reopen keeps the report (not acted on)
await page.keyboard.press('Escape'); await openBtn.click();
check('upload: report kept after plain close', (await page.locator('[role="dialog"]').innerText()).includes('Ready: 300 valid'));
await page.locator('[role="dialog"] button', { hasText: 'Train on this dataset' }).click();
await ready(page);
check('upload: Train replaces dataset (Uploaded badge, name, retrain)', (await page.locator('main header').innerText()).includes('upload-test.csv') && /Uploaded/i.test(await page.locator('main header').innerText()) && !(await page.locator('main').innerText()).includes('4111111111111111'));
await openBtn.click();
check('upload: report cleared after training', !(await page.locator('[role="dialog"]').innerText()).includes('Ready: 300 valid'));
// drag & drop of the sample CSV
const dt = await page.evaluateHandle((text) => { const d = new DataTransfer(); d.items.add(new File([text], 'dropped.csv', { type: 'text/csv' })); return d; }, sampleCsv.slice(0, 200000));
const zone = page.locator('[role="dialog"] .border-dashed').first();
await zone.dispatchEvent('dragover', { dataTransfer: dt });
check('upload: dragover highlights zone', (await zone.getAttribute('class')).includes('bg-[#3988FF]/10'));
await zone.dispatchEvent('drop', { dataTransfer: dt });
await page.waitForSelector('text=/Ready: [\\d,]+ valid transactions/', { timeout: 15000 });
check('upload: drag & drop parses dropped file', (await page.locator('[role="dialog"]').innerText()).includes('dropped.csv'));
// a file dropped outside the zone (on the dialog backdrop) must not navigate away
const prevented = await page.evaluate((dt) => {
  const fire = (el) => { const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev.defaultPrevented; };
  const ov = (el) => { const ev = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev.defaultPrevented; };
  return { dialogDrop: fire(document.querySelector('[role="dialog"] h2')), bodyDrop: fire(document.body), bodyOver: ov(document.body) };
}, dt);
check('upload: file drop outside the zone is default-prevented (browser will not open the file)', prevented.dialogDrop && prevented.bodyDrop && prevented.bodyOver, JSON.stringify(prevented));
await page.locator('[role="dialog"] button', { hasText: 'Use synthetic sample' }).click();
await ready(page);
check('upload: Use synthetic sample restores sample', /Synthetic sample/i.test(await page.locator('main header').innerText()));
// after dataset swap, SHAP page falls back to a valid sample selection
await page.goto(BASE + '/shap'); await ready(page);
check('shap: remembered id from old dataset falls back to a sample', (await page.locator('[aria-label="Sample cases"] button[aria-pressed="true"]').count()) === 1);

}
// ============ console ============
const relevant = log.filter((l) => !/favicon/.test(l));
check('console: no errors / warnings / failed requests in the whole run', relevant.length === 0, relevant.slice(0, 8).join(' | '));

await b.close();
process.exit(summary() ? 1 : 0);
