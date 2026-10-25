# Real-browser audit (optional QA, not part of `npm test`)

Clicks through every critical control in headless Chromium against `vite preview`.

```bash
npm run build && npx vite preview --port 4173 &
cd qa/browser && npm i --no-save playwright-core@1.56.0 && npx playwright install chromium
SECTIONS=nav,stream node audit.mjs          # sections: nav,stream,manual,delayed,queue,models,shap,export,dataset
SECTIONS=manual,delayed,queue node audit.mjs
SECTIONS=models,shap,export,dataset node audit.mjs
node mobile.mjs                              # mobile drawer, 44 px targets, ≥12 px text, contrast, light/dark screenshots
```

Env: `BASE` (default http://localhost:4173), `CHROMIUM_PATH`, `SHOTS` (screenshot folder).
Expects the bundled synthetic sample as the active dataset (fresh page load).
