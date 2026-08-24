import { chromium } from 'playwright';
import fs from 'fs';

const CHROMIUM = '/nix/store/5afrhwm7zqn1vb7p5z1mc2rkh2grsfgz-ungoogled-chromium-138.0.7204.100/bin/chromium';
const BASE = 'http://127.0.0.1:5000';
const login = JSON.parse(fs.readFileSync('/tmp/explorer_login.json', 'utf8'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addInitScript(([token, user]) => {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ accepted: true, ts: Date.now() }));
}, [login.token, login.user]);
const page = await ctx.newPage();
for (const pat of ['**/api/notifications*', '**/api/settings/**', '**/api/personas/**', '**/api/onboarding/**']) {
  await page.route(pat, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: pat.includes('notifications') ? '[]' : '{}' }));
}
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401|404|402/.test(m.text())) console.log('  [console.error]', m.text().slice(0, 160)); });

// 1. Workspace card navigates
await page.goto(`${BASE}/spinout-lab`, { waitUntil: 'networkidle' });
const card = page.locator('[data-testid="workspace-tool-cofounder-agreement"]');
check('workspace card visible', await card.isVisible().catch(() => false));
await card.click();
await page.waitForURL('**/spinout-lab/cofounder-agreement', { timeout: 8000 }).catch(() => {});
check('navigates to lab route', page.url().includes('/spinout-lab/cofounder-agreement'));
await page.waitForSelector('[data-testid="page-spinout-cofounder"]', { timeout: 10000 }).catch(() => {});
check('page renders', await page.locator('[data-testid="page-spinout-cofounder"]').isVisible().catch(() => false));

// 2. Builder shown (no existing docs), prefill from cap table
check('builder visible', await page.locator('[data-testid="card-builder"]').isVisible().catch(() => false));
const name0 = await page.locator('[data-testid="input-founder-name-0"]').inputValue().catch(() => '');
check('founder prefilled from cap table', name0 === 'Explorer', `got "${name0}"`);
const eq0 = await page.locator('[data-testid="input-founder-equity-0"]').inputValue().catch(() => '');
check('equity prefilled 100', Number(eq0) === 100, `got "${eq0}"`);
const clauseEquity = await page.locator('[data-testid="clause-equity"]').innerText().catch(() => '');
check('source tag "from Cap Table"', clauseEquity.includes('from Cap Table'));

// 3. Solo state: banner + generate disabled
check('solo banner shows', await page.locator('[data-testid="banner-solo"]').isVisible().catch(() => false));
check('generate disabled solo', await page.locator('[data-testid="button-generate"]').isDisabled().catch(() => false));

// 4. Add second founder → enabled
await page.locator('[data-testid="button-add-founder"]').click();
await page.locator('[data-testid="input-founder-name-1"]').fill('Jordan Vale');
await page.locator('[data-testid="input-founder-role-1"]').fill('CTO');
await page.locator('[data-testid="input-founder-equity-0"]').fill('55');
await page.locator('[data-testid="input-founder-equity-1"]').fill('45');
check('solo banner gone', !(await page.locator('[data-testid="banner-solo"]').isVisible().catch(() => true)));
const total = await page.locator('[data-testid="text-equity-total"]').innerText().catch(() => '');
check('equity total 100', total.includes('100.00'), `got "${total}"`);
check('generate enabled', await page.locator('[data-testid="button-generate"]').isEnabled().catch(() => false));

// 5. Snapshot reflects inputs
const snapEq = await page.locator('[data-testid="snap-equity"]').innerText().catch(() => '');
check('snapshot equity 55 / 45', snapEq.replace(/\s/g, '').includes('55/45'), `got "${snapEq}"`);
const snapVest = await page.locator('[data-testid="snap-vesting"]').innerText().catch(() => '');
check('snapshot vesting default', snapVest.includes('4yr') && snapVest.includes('12mo'), `got "${snapVest}"`);

// 6. Dispute toggle
await page.locator('[data-testid="dispute-binding-arbitration"]').click();
await page.locator('[data-testid="accel-double_trigger"]').click();

// 7. Generate (real document)
const [resp] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/legal/cofounder-agreement'), { timeout: 15000 }).catch(() => null),
  page.locator('[data-testid="button-generate"]').click(),
]);
check('generate POST 200', resp && resp.status() === 200, `status ${resp && resp.status()}`);
await page.waitForSelector('[data-testid="card-generated"]', { timeout: 8000 }).catch(() => {});
check('generated card shows', await page.locator('[data-testid="card-generated"]').isVisible().catch(() => false));
await page.waitForSelector('[data-testid="card-existing"]', { timeout: 8000 }).catch(() => {});
const status0 = await page.locator('[data-testid="doc-status-0"]').innerText().catch(() => '');
check('doc status awaiting signature', /awaiting/i.test(status0), `got "${status0}"`);
check('legal-capital link present', (await page.locator('a[href="/legal-capital"]').count().catch(() => 0)) > 0);

// 8. Reload → existing detection, builder hidden, new-version affordance
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="page-spinout-cofounder"]', { timeout: 10000 }).catch(() => {});
check('reload: existing card shown', await page.locator('[data-testid="card-existing"]').isVisible().catch(() => false));
check('reload: builder hidden', !(await page.locator('[data-testid="card-builder"]').isVisible().catch(() => true)));
await page.locator('[data-testid="button-new-version"]').click();
check('new-version reopens builder', await page.locator('[data-testid="card-builder"]').isVisible().catch(() => false));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
