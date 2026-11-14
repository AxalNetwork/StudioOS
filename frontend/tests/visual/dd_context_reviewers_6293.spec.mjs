/** #6293: the existing Assign entrypoint offers recorded suggestions and an independent name search. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';

const UID = 'd'.repeat(32);
const record = { case: { uid: UID, subject_type: 'project', subject_id: 7, subject_label: 'Synthetic Venture', status: 'open',
  template_depth: 'standard', lead_name: 'Synthetic Lead', round_label: 'Seed', cheque_cents: 12345, cheque_currency: 'EUR' },
  allowed: { assign: true, update: true }, sections: [{ id: 1, section_key: 'financial', title: 'Financial review', items: [], reviewers: [] }],
  findings: [], items: [], activity: [], requests: [], attachments: [], sources: [] };

for (const failure of [false, true]) {
  test(`${failure ? 'unreadable suggestions retain name search on phone' : 'recorded suggestions precede search on desktop'}`, async ({ page, request }) => {
    await prepare(page, request, { as: 'security' });
    if (failure) await page.setViewportSize({ width: 390, height: 844 });
    const writes = [];
    await page.route('**/api/dd/**', async (route) => {
      const req = route.request(); const path = new URL(req.url()).pathname;
      if (req.method() === 'POST') { writes.push({ path, body: req.postDataJSON() }); return route.fulfill({ json: { ok: true } }); }
      if (path === `/api/dd/cases/${UID}`) return route.fulfill({ json: record });
      if (path === '/api/dd/experts') return route.fulfill(failure ? { status: 403, json: { detail: 'Not permitted' } }
        : { json: { suggestions: [{ id: 5, name: 'Suggested Reviewer', role: 'partner', prior_reviews: 2, email: 'hidden-suggested@example.test' }] } });
      if (path === '/api/dd/people') return route.fulfill({ json: { items: [{ id: 6, name: 'Searched Person', role: 'partner', email: 'hidden-search@example.test' }] } });
      return route.fulfill({ json: { items: [] } });
    });
    await page.goto(`/admin/due-diligence/${UID}`);
    await page.getByTestId('dd-assign-open-1').click();
    const dialog = page.getByTestId('dd-assign');
    await expect(dialog).toBeVisible();
    if (failure) {
      await expect(dialog).toContainText('Suggested reviewers could not be read');
      await page.getByTestId('dd-assign-q').fill('Searched');
      await page.getByTestId('dd-assign-person-6').click();
    } else {
      const suggestion = page.getByTestId('dd-assign-suggestion-5');
      await expect(suggestion).toContainText('2 prior reviews');
      const suggestionBox = await suggestion.boundingBox(); const searchBox = await page.getByTestId('dd-assign-q').boundingBox();
      expect(suggestionBox.y + suggestionBox.height).toBeLessThan(searchBox.y);
      await suggestion.click();
    }
    await expect(dialog).not.toContainText('hidden-suggested@');
    await expect(dialog).not.toContainText('hidden-search@');
    await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([{ path: `/api/dd/cases/${UID}/sections/1/assign`, body: { user_id: failure ? 6 : 5, role: 'reviewer' } }]);
  });
}

test('Overview edits deal context in-page, retaining a refused edit and saving exact native minor units on phone', async ({ page, request }) => {
  await prepare(page, request, { as: 'security' });
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = []; let fail = true;
  await page.route('**/api/dd/**', async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (req.method() === 'PATCH') {
      writes.push({ path, body: req.postDataJSON() });
      if (fail) return route.fulfill({ status: 503, json: { detail: 'Synthetic save unavailable' } });
      return route.fulfill({ json: { ok: true } });
    }
    if (path === `/api/dd/cases/${UID}`) return route.fulfill({ json: record });
    if (path === '/api/dd/subjects') return route.fulfill({ json: { items: [{ id: 7, deals: [{ id: 12, instrument: 'Equity' }] }] } });
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto(`/admin/due-diligence/${UID}`);
  const opener = page.getByTestId('dd-deal-context-open');
  expect((await opener.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await opener.click();
  const dialog = page.getByTestId('dd-deal-context');
  await expect(dialog).toContainText('Activity records which fields changed');
  await expect(dialog).toContainText('No notification is sent');
  await expect(page.getByTestId('dd-context-cheque')).toHaveValue('123.45');
  await page.getByTestId('dd-context-round').fill('Series A');
  await page.getByTestId('dd-context-currency').selectOption('KWD');
  await page.getByTestId('dd-context-cheque').fill('12.345');
  await page.getByTestId('dd-context-deal').selectOption('12');
  await dialog.getByRole('button', { name: 'Save deal context', exact: true }).click();
  await expect(page.getByTestId('dd-deal-context-error')).toContainText('Synthetic save unavailable');
  await expect(page.getByTestId('dd-context-round')).toHaveValue('Series A');
  await expect(page.getByTestId('dd-context-cheque')).toHaveValue('12.345');
  fail = false;
  await dialog.getByRole('button', { name: 'Save deal context', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const expected = { path: `/api/dd/cases/${UID}`, body: { round_label: 'Series A', cheque_cents: 12345, cheque_currency: 'KWD', deal_id: 12 } };
  expect(writes).toEqual([expected, expected]);
});

test('Overview explains context ownership without an edit action for a read-only case', async ({ page, request }) => {
  await prepare(page, request, { as: 'security' });
  await page.route(`**/api/dd/cases/${UID}`, (route) => route.fulfill({ json: { ...record, allowed: { update: false, assign: false } } }));
  await page.goto(`/admin/due-diligence/${UID}`);
  await expect(page.getByTestId('dd-who-context')).toContainText('The case lead or an Admin');
  await expect(page.getByTestId('dd-deal-context-open')).toHaveCount(0);
});
