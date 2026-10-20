// Temporary D789 browser validation, using only synthetic data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
const fixture = {"sample":{"range":{"from":"2026-10-01","to":"2026-10-03","name":"mtd"},"group":"model","totals":{"runs":3,"input_tokens":120,"output_tokens":30,"charged_microusd":700000,"cost_usd":0.5,"not_recorded":1,"output_not_recorded":1,"by_kind":{"tokens":{"cost_usd":0.3},"audio_speech":{"cost_usd":0.2},"image":{"cost_usd":0},"other":{"cost_usd":0}}},"models":[{"model":"@cf/meta/llama-3.3-70b-instruct-fp8-fast","name":"Llama","runs":2,"input_tokens":120,"output_tokens":30,"units":{},"cost_usd":0.3,"charged_microusd":400000,"not_recorded":1},{"model":"@cf/openai/whisper-large-v3-turbo","name":"Whisper","runs":1,"input_tokens":0,"output_tokens":0,"units":{"audio_minutes":4},"cost_usd":0.2,"charged_microusd":300000,"not_recorded":0}],"days":[{"day":"2026-10-01","by_model":[{"model":"@cf/meta/llama-3.3-70b-instruct-fp8-fast","cost_usd":0.1,"input_tokens":40,"output_tokens":10},{"model":"@cf/openai/whisper-large-v3-turbo","cost_usd":0.2,"input_tokens":0,"output_tokens":0}]},{"day":"2026-10-02","by_model":[]},{"day":"2026-10-03","by_model":[{"model":"@cf/meta/llama-3.3-70b-instruct-fp8-fast","cost_usd":0.2,"input_tokens":80,"output_tokens":20}]}],"groups":[{"key":"draft","page":"validate","label":"Draft","runs":3,"input_tokens":120,"output_tokens":30,"charged_microusd":700000}],"truncated":false},"me":{"balance_microusd":2500000,"plan":{"monthly_microusd":20000000},"month_spend_microusd":5000000},"limit":{"charged_microusd":5000000,"limit_microusd":20000000,"resets_on":"2026-11-01","pack_orders":{"today":1,"per_day":5,"window_hours":24}}};
const preview = spawn('npm', ['--prefix', 'frontend', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173'], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:4173/'); if (r.ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let csvRead = '';
  await page.route('http://127.0.0.1:4173/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/cost.csv')) {
      csvRead = url.search;
      return route.fulfill({ status: 200, contentType: 'text/csv', body: 'day,model\n2026-10-01,synthetic\n' });
    }
    let data;
    if (url.pathname.endsWith('/cost')) data = { ...fixture.sample, group: url.searchParams.get('group') || 'model' };
    else if (url.pathname.endsWith('/ai-budget/me')) data = fixture.me;
    else if (url.pathname.endsWith('/limit')) data = fixture.limit;
    else if (url.pathname.endsWith('/overview')) data = { payment_methods: [], has_customer: false };
    else if (url.pathname.endsWith('/auto-reload')) data = { enabled: true };
    else if (url.pathname.endsWith('/history')) data = { items: [], pending: [] };
    else if (url.pathname.endsWith('/rates')) data = { models: [] };
    else return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_unreadable"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.route('**/d789-**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><head></head><body style="margin:0"><div id="root"></div></body></html>' }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const screen of ['usage', 'cost']) {
      await page.goto('http://127.0.0.1:4173/d789-' + screen);
      await page.addScriptTag({ type: 'module', content: "import RefreshRuntime from 'http://127.0.0.1:4173/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;" });
      await page.addScriptTag({ type: 'module', url: 'http://127.0.0.1:4173/test/_usage_preview_d789.jsx' });
      await page.getByTestId('daily-cost-chart').waitFor();
      if (width === 390) await page.getByRole('link', { name: screen === 'cost' ? '‹ Usage' : '‹ Account', exact: true }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: /^2026-10-01:/ }).focus();
      await page.getByTestId('daily-cost-tooltip').waitFor();
      assert.match(await page.getByTestId('daily-cost-tooltip').innerText(), /Llama/);
      assert.match(await page.getByTestId('daily-cost-tooltip').innerText(), /Whisper/);
      for (const dark of [false, true]) {
        await page.evaluate((on) => document.documentElement.classList.toggle('dark', on), dark);
        await page.waitForTimeout(100);
        const layout = await page.evaluate(() => ({
          width: innerWidth, scroll: document.documentElement.scrollWidth,
          background: getComputedStyle(document.querySelector('#root > div')).backgroundColor,
          foreground: getComputedStyle(document.querySelector('#root > div')).color,
        }));
        assert.ok(layout.scroll <= width + 1, 'no horizontal overflow: ' + JSON.stringify({ width, screen, dark, layout }));
        assert.notEqual(layout.background, layout.foreground);
        console.log(JSON.stringify({ screen, width, dark, layout }));
      }
      if (screen === 'cost') {
        await page.getByLabel('Range', { exact: true }).selectOption('prev_month');
        await page.getByLabel('Group by', { exact: true }).selectOption('page');
        await page.getByRole('heading', { name: 'By page', exact: true }).waitFor();
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download CSV · all models', exact: true }).click();
        await download;
        assert.match(csvRead, /range=prev_month/);
        assert.match(csvRead, /group=page/);
        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        await page.getByRole('heading', { name: 'By model', exact: true }).waitFor();
        await page.getByLabel('Model', { exact: true }).selectOption('@cf/openai/whisper-large-v3-turbo');
        assert.equal(await page.getByTestId('daily-cost-segment').count(), 1);
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log('D789: desktop, phone, light, dark, chart focus, range/group/reset/model and authenticated CSV all pass.');
} finally {
  await browser?.close();
  preview.kill('SIGTERM');
}
