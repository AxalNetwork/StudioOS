/** #6094: native report printing uses an isolated light document and the admitted snapshot only. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';

const UID = 'c'.repeat(32);
const sent = (reader) => ({ uid: UID, status: 'sent', view: reader ? 'reader' : 'team', revision: 1,
  sent_at: '2026-10-02T10:00:00Z', title: 'Frozen September report', period: { label: 'Sep 2026', start: '2026-09-01', end: '2026-09-30' },
  body: 'Narrative as sent. <script>window.compromised = true</script>', highlights: [{ text: 'Pilot shipped', source: { label: 'Roadmap' } }],
  figures: [{ key: 'mrr', label: 'MRR', module: 'revenue-and-traction', unit: 'usd', value: 48000, included: true, source: { word: 'Connector', provider: 'stripe' }, as_of: '2026-09-30' },
    { key: 'cash', label: 'Confidential cash', module: 'revenue-and-traction', unit: 'usd', value: 987654321, included: true, team_only: true, shared: false }],
  recipients: [{ name: 'Private recipient', audience: 'investor', delivered: true }], documents: [], meets: [],
});

async function open(page, request, { dark = false, reader = false, printFailure = false } = {}) {
  const m = await prepare(page, request);
  await page.addInitScript(({ dark, printFailure }) => {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    window.__reportPrints = [];
    new MutationObserver(() => {
      for (const frame of document.querySelectorAll('iframe[title="Print sent report"]')) {
        if (frame.dataset.intercepted) continue;
        frame.dataset.intercepted = 'yes';
        frame.contentWindow.print = () => {
          if (printFailure) throw new Error('Synthetic print unavailable');
          const doc = frame.contentDocument;
          window.__reportPrints.push({ text: doc.body.innerText, scripts: doc.querySelectorAll('script').length,
            background: frame.contentWindow.getComputedStyle(doc.body).backgroundColor,
            color: frame.contentWindow.getComputedStyle(doc.body).color,
            colourScheme: frame.contentWindow.getComputedStyle(doc.documentElement).colorScheme });
        };
      }
    }).observe(document, { childList: true, subtree: true });
  }, { dark, printFailure });
  const reads = [];
  await page.route('**/api/reporting/reports/**', (route) => {
    reads.push(route.request().method());
    return route.fulfill({ json: sent(reader) });
  });
  await page.goto(`/grow/reporting/${UID}?project_id=${m.oneClick.projectId}`);
  await expect(page.getByTestId('report-print')).toBeVisible();
  return reads;
}

for (const { dark, reader } of [{ dark: true, reader: false }, { dark: false, reader: true }]) {
  test(`${reader ? 'read-only' : 'team'} report prints frozen provenance on light paper from ${dark ? 'dark' : 'light'} mode`, async ({ page, request }) => {
    const reads = await open(page, request, { dark, reader });
    await page.getByTestId('report-print').click();
    await expect.poll(() => page.evaluate(() => window.__reportPrints.length)).toBe(1);
    const printed = await page.evaluate(() => window.__reportPrints[0]);
    expect(printed.text).toContain('Frozen September report');
    expect(printed.text).toContain('Revision 1 · Sent 2026-10-02T10:00:00Z');
    expect(printed.text).toContain('Period: Sep 2026');
    expect(printed.text).toContain('$48,000');
    expect(printed.text).toContain('Connector · Stripe');
    expect(printed.text).toContain('2026-09-30');
    expect(printed.text).toContain('Pilot shipped');
    expect(printed.text).toContain('<script>window.compromised = true</script>');
    expect(printed.scripts).toBe(0);
    expect(printed.text).not.toContain('Private recipient');
    expect(printed.text).not.toContain('Eadwyn');
    if (reader) expect(printed.text).not.toContain('Confidential cash');
    else expect(printed.text).toContain('$987,654,321');
    expect(printed.background).toBe('rgb(255, 255, 255)');
    expect(printed.color).toBe('rgb(23, 23, 34)');
    expect(printed.colourScheme).toBe('light');
    expect(reads).toEqual(['GET']);
    await page.evaluate(() => document.querySelector('iframe[title="Print sent report"]').contentWindow.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('iframe[title="Print sent report"]')).toHaveCount(0);
    await expect(page.getByTestId('report-print')).toBeFocused();
  });
}

test('an unavailable browser print leaves the report readable and offers retry', async ({ page, request }) => {
  const reads = await open(page, request, { printFailure: true });
  await page.getByTestId('report-print').click();
  await expect(page.getByRole('alert')).toContainText('The print copy could not be prepared');
  await expect(page.getByTestId('report-print')).toBeEnabled();
  await expect(page.locator('iframe[title="Print sent report"]')).toHaveCount(0);
  expect(reads).toEqual(['GET']);
});
