// Temporary D789 browser validation, using only synthetic data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
const fixture = {"sample":{"range":{"from":"2026-10-01","to":"2026-10-03","name":"mtd"},"group":"model","totals":{"runs":3,"input_tokens":120,"output_tokens":30,"charged_microusd":700000,"cost_usd":0.5,"not_recorded":1,"output_not_recorded":1,"by_kind":{"tokens":{"cost_usd":0.3},"audio_speech":{"cost_usd":0.2},"image":{"cost_usd":0},"other":{"cost_usd":0}}},"models":[{"model":"@cf/meta/llama-3.3-70b-instruct-fp8-fast","name":"Llama","runs":2,"input_tokens":120,"output_tokens":30,"units":{},"cost_usd":0.3,"charged_microusd":400000,"not_recorded":1},{"model":"@cf/openai/whisper-large-v3-turbo","name":"Whisper","runs":1,"input_tokens":0,"output_tokens":0,"units":{"audio_minutes":4},"cost_usd":0.2,"charged_microusd":300000,"not_recorded":0}],"days":[{"day":"2026-10-01","by_model":[{"model":"@cf/meta/llama-3.3-70b-instruct-fp8-fast","cost_usd":0.1,"input_tokens":40,"output_tokens":10},{"model":"@cf/openai/whisper-large-v3-turbo","cost_usd":0.2,"input_tokens":0,"output_tokens":0}]},{"day":"2026-10-02","by_model":[]},{"day":"2026-10-03","by_model":[{"model":"@cf/meta/llama-3.3-70b-instruct-fp8-fast","cost_usd":0.2,"input_tokens":80,"output_tokens":20}]}],"groups":[{"key":"draft","page":"validate","label":"Draft","runs":3,"input_tokens":120,"output_tokens":30,"charged_microusd":700000}],"truncated":false},"me":{"balance_microusd":2500000,"plan":{"monthly_microusd":20000000},"month_spend_microusd":5000000},"limit":{"charged_microusd":5000000,"limit_microusd":20000000,"resets_on":"2026-11-01","pack_orders":{"today":1,"per_day":5,"window_hours":24}}};
fixture.me = { ...fixture.me, licence: 'founder:growth', daily_microusd: 0, monthly_microusd: 20000000,
  day_spend_microusd: 0, day_reserved_microusd: 0, month_reserved_microusd: 0, topup_reserved_microusd: 0,
  held_for_review: [], daily_capped: false };
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
  let costRanges = [];
  let invoiceCalls = [];
  await page.clock.install({ time: new Date('2026-10-20T12:00:00Z') });
  await page.route('http://127.0.0.1:4173/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (/^\/api\/orders\/[^/]+\/invoice$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 synthetic fixture' });
    if (url.pathname.endsWith('/cost.csv')) {
      csvRead = url.search;
      return route.fulfill({ status: 200, contentType: 'text/csv', body: 'day,model\n2026-10-01,synthetic\n' });
    }
    let data;
    if (url.pathname.endsWith('/billing/invoices')) {
      invoiceCalls.push(url.search);
      data = { invoices: [
        { kind: 'order', id: 'ORDER-1', date: '2026-10-20T12:00:00Z', description: 'AI tokens, $25 pack', amount_cents: 2500, currency: 'USD', status: 'paid', pdf_url: '/api/orders/ORDER-1/invoice' },
        { kind: 'stripe', id: 'STRIPE-1', date: '2026-10-19T12:00:00Z', description: 'Plan invoice', amount_cents: 2000, currency: 'USD', status: 'paid', pdf_url: 'https://example.com/synthetic.pdf' },
        { kind: 'order', id: 'ORDER-2', date: '2026-10-18T12:00:00Z', description: 'Refunded token pack', amount_cents: 1000, currency: 'USD', status: 'refunded', pdf_url: null }
      ], page: 1, per: 3, total: 3 };
    }
    else if (url.pathname.endsWith('/cost')) { costRanges.push(url.searchParams.get('range')); data = { ...fixture.sample, group: url.searchParams.get('group') || 'model' }; }
    else if (url.pathname.endsWith('/ai-budget/me')) data = fixture.me;
    else if (url.pathname.endsWith('/limit')) data = fixture.limit;
    else if (url.pathname.endsWith('/overview')) data = { payment_methods: [], has_customer: false };
    else if (url.pathname.endsWith('/auto-reload')) data = { enabled: true };
    else if (url.pathname.endsWith('/history')) data = { items: [], pending: [] };
    else if (url.pathname.endsWith('/top-up')) data = { configured: false };
    else if (url.pathname.endsWith('/ai/me/spend')) data = {
      recorded: true, month: { calls: 3, spend_usd: .5 }, by_model_recorded: true, days_recorded: true,
      by_surface_recorded: true, by_task_recorded: true, last_run_recorded: true,
      by_model: fixture.sample.models.map((m) => ({ model: m.model, calls: m.runs, prompt_tokens: m.input_tokens,
        completion_tokens: m.output_tokens, spend_usd: m.cost_usd, uncounted_calls: 0, cached_calls: 0, fallback_calls: 0 })),
      days: fixture.sample.days.map((d) => ({ day: d.day, calls: d.by_model.length, spend_usd: d.by_model.reduce((n, m) => n+m.cost_usd, 0) })),
      by_surface: [], by_task: [], last_run: null,
    };
    else if (url.pathname.endsWith('/storage')) data = { total_bytes: 0, files: 0, unknown_size_files: 0,
      areas: ['data_room', 'diligence_files', 'research_library', 'message_attachments', 'interview_recordings'].map((key) => ({ key, recorded: true, files: 0, bytes: 0, unknown_size_files: 0 })) };
    else if (url.pathname.endsWith('/rates')) data = { models: fixture.sample.models.map((m) => ({ id: m.model, name: m.name, in_per_1m_usd: 1, out_per_1m_usd: 2 })) };
    else return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_unreadable"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.route('**/d789-**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><head></head><body style="margin:0"><div id="root"></div></body></html>' }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const screen of ['usage', 'cost']) {
      costRanges = [];
      invoiceCalls = [];
      await page.goto('http://127.0.0.1:4173/d789-' + screen);
      await page.addScriptTag({ type: 'module', content: "import RefreshRuntime from 'http://127.0.0.1:4173/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;" });
      await page.addScriptTag({ type: 'module', url: 'http://127.0.0.1:4173/test/_usage_preview_d789.jsx' });
      await page.getByTestId('daily-cost-chart').waitFor();
      if (screen === 'usage') {
        assert.deepEqual(costRanges, ['30d'], 'overview reuses its 30-day read');
        await page.getByTestId('overview-invoices').getByText('AI tokens, $25 pack', { exact: true }).waitFor();
        assert.deepEqual(invoiceCalls, ['?page=1&per=3']);
        const invoiceDownload = page.waitForEvent('download');
        await page.getByTestId('overview-invoices').getByRole('button', { name: 'PDF', exact: true }).click();
        assert.equal((await invoiceDownload).suggestedFilename(), 'ORDER-1.pdf');
      }
      if (screen === 'cost' && width === 390) await page.getByTestId('usage-phone-storage').waitFor();
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
  costRanges = [];
  await page.goto('http://127.0.0.1:4173/d789-usage#storage');
  await page.addScriptTag({ type: 'module', content: "import RefreshRuntime from 'http://127.0.0.1:4173/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;" });
  await page.addScriptTag({ type: 'module', url: 'http://127.0.0.1:4173/test/_usage_preview_d789.jsx' });
  await page.getByTestId('usage-cost-page').waitFor();
  await page.getByTestId('daily-cost-chart').waitFor();
  assert.ok(!costRanges.includes('30d'), 'legacy redirect never mounts overview reads');
  assert.deepEqual(errors, []);
  console.log('D789: desktop, phone, light, dark, chart focus, range/group/reset/model, authenticated CSV/PDF, unified invoice reads, reuse of the month slice and redirect-without-reads all pass.');
} finally {
  await browser?.close();
  preview.kill('SIGTERM');
}
