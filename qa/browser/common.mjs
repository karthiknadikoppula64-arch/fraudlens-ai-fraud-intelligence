import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
// Requires `playwright-core` resolvable from this folder (e.g. `npm i --no-save playwright-core`); it is not a project dependency.

export const BASE = process.env.BASE || 'http://localhost:4173';
// CHROMIUM_PATH: any Chromium/Chrome binary. Defaults to the first Playwright headless shell found.
const exe = process.env.CHROMIUM_PATH || execSync("find $HOME/.cache/ms-playwright -name headless_shell -type f | head -1").toString().trim();

export async function launch() {
  return chromium.launch({ executablePath: exe, args: ['--no-sandbox'], env: { ...process.env } });
}

export function track(page, log) {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[console.${m.type()}] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => log.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) log.push(`[http ${r.status()}] ${r.url()}`); });
}

export async function ready(page) {
  await page.waitForFunction(() => !document.body.innerText.includes('Training 4 models'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

let pass = 0, fail = 0;
export const results = [];
export function check(name, cond, detail = '') {
  if (cond) pass++; else fail++;
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
export function summary() { console.log(`\n${pass} passed, ${fail} failed`); return fail; }
