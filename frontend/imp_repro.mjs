import { chromium } from 'playwright';
import fs from 'fs';

const admin = JSON.parse(fs.readFileSync('/tmp/admin_login.json', 'utf8'));
const BASE = 'http://localhost:5000';

const browser = await chromium.launch({ executablePath: '/nix/store/m7qi78k6711fpwnrm4r2kn4p3ga3jal9-ungoogled-chromium-123.0.6312.105/bin/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Keep the request budget for what matters — the dev rate limiter is 60/min
// shared, and background polling eats it.
await ctx.route('**/api/notifications/**', (r) => r.abort());
await ctx.route('**/api/settings/explainers**', (r) => r.abort());
await ctx.route('**/api/personas/**', (r) => r.abort());
await ctx.route('**/api/monitoring/**', (r) => r.abort());

const logs = [];
page.on('console', (m) => logs.push(`[console:${m.type()}] ${m.text()}`));
page.on('framenavigated', (f) => { if (f === page.mainFrame()) logs.push(`[nav] ${f.url()}`); });
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });

await page.addInitScript(([token, user]) => {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}, [admin.token, admin.user]);

try {
  await page.goto(BASE + '/admin/spinout-lab', { waitUntil: 'domcontentloaded' });
  logs.push(`--- loaded: ${page.url()}`);
  await page.waitForTimeout(3000);
  await page.getByTestId('tab-participants').click();
  let row = page.getByTestId('lab-participant-2');
  if (!(await row.isVisible().catch(() => false))) {
    logs.push('--- participants empty, waiting out rate-limit window then refreshing');
    await page.waitForTimeout(62000);
    await page.getByTestId('button-refresh-spinout-lab').click();
    await page.waitForTimeout(3000);
  }
  await page.getByTestId('lab-participant-2').click({ timeout: 10000 });
  await page.waitForTimeout(62000);
  await page.getByTestId('button-open-workspace-2').click({ timeout: 5000 });
  logs.push('--- clicked Open workspace');
  await page.waitForTimeout(5000);
  logs.push(`--- FINAL URL: ${page.url()}`);
} catch (e) {
  logs.push('--- ERROR: ' + e.message.split('\n')[0]);
  logs.push(`--- URL at error: ${page.url()}`);
}

console.log(logs.filter(l => l.includes('imp-debug') || l.startsWith('---') || l.startsWith('[nav]') || l.startsWith('[http')).join('\n'));
await browser.close();
