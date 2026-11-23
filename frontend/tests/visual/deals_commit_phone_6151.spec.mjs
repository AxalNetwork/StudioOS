/** #6151 part 3 (D6151-p3): the Investment committee (DE27) at 390 and 1440, light and dark, its reads stubbed. Every person and decision is made up. */
import { test, expect } from '@playwright/test';
import { prepare } from './_editor.mjs';
test.setTimeout(60_000);

const VOTES = [
  { user_id: 11, user_name: 'Example Partner A', vote: 'yes', rationale: 'Pilots convert; the cap is inside our range.', created_at: '2026-11-07 10:12:00' },
  { user_id: 12, user_name: 'Example Partner B', vote: 'no', rationale: 'Valuation is ahead of the traction.', created_at: '2026-11-07 11:30:00' },
  { user_id: 13, user_name: 'Example Partner C', vote: 'abstain', rationale: null, created_at: '2026-11-06 18:00:00' },
  { user_id: 14, user_name: 'Example Partner D', vote: 'recused', rationale: 'Advisor to the company.', created_at: '2026-11-06 17:00:00' },
];
const DECISION = (me) => ({
  uid: 'd-open', title: 'Example Copperline · Seed SAFE', status: 'voting', created_by: 11, deal_id: 3,
  tally: { yes: 1, no: 1, abstain: 1, recused: 1 }, votes: VOTES,
  roster: { available: true, eligible: 5, members: [11, 12, 13, 14, me].map((id) => ({ user_id: id, name: `Member ${id}` })) },
});
const ROOM = (me) => ({
  decisions: { available: true, total: 1, rows: [DECISION(me)] },
  current: DECISION(me),
  rationale: { recorded: 2, total: 3, enforced: true },
  room: { available: false },
  conditions: { available: true, rows: [
    { uid: 'c1', decision_uid: 'd-open', decision_title: 'Example Copperline · Seed SAFE', body: 'Customer reference calls', status: 'open', created_at: '2026-11-07 10:00:00' },
    { uid: 'c2', decision_uid: 'd-open', decision_title: 'Example Copperline · Seed SAFE', body: 'Board observer seat', status: 'met', resolved_at: '2026-11-09 10:00:00', created_at: '2026-11-07 10:00:00' },
    { uid: 'c3', decision_uid: 'd-open', decision_title: 'Example Copperline · Seed SAFE', body: 'Pro-rata side letter', status: 'waived', resolved_at: '2026-11-08 10:00:00', created_at: '2026-11-07 10:00:00' },
  ] },
  minutes: { available: true, recorded: false, meeting_title: 'IC', may_record: false },
});

async function open(page, request, { width, dark = false }) {
  const m = await prepare(page, request, { as: 'security' });
  const user = { ...m.security.user, role: 'investor', is_superadmin: false, kyc_status: 'approved', subscription_tier: 'pro' };
  await page.addInitScript((u) => { localStorage.setItem('user', JSON.stringify(u)); localStorage.setItem('viewMode', 'investor'); }, user);
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/auth/me') return route.fulfill({ json: user });
    if (p === '/api/onboarding/progress') return route.fulfill({ json: { flow: 'investor', completed_at: '2026-10-01' } });
    if (p === '/api/settings/appearance') return route.fulfill({ json: { theme: dark ? 'dark' : 'light' } });
    if (p === '/api/ic/commit-room') return route.fulfill({ json: ROOM(user.id) });
    if (p === '/api/ic/conditions') return route.fulfill({ json: { items: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/deals/commit');
}

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    test(`DE27 Investment committee at ${width}px${dark ? ', dark' : ''}`, async ({ page, request }, testInfo) => {
      await open(page, request, { width, dark });
      if (width < 768) {
        await expect(page.getByTestId('commit-phone')).toBeVisible();
        await expect(page.getByTestId('commit-desktop')).toBeHidden();
        await expect(page.getByTestId('commit-strip')).toBeHidden();
        await expect(page.getByTestId('commit-phone-tally-recused')).toContainText('Recused · not in the tally');
        await expect(page.getByTestId('commit-phone-voted')).toHaveText('4 of 5 eligible have voted. You have not voted.');
        const vote = page.getByTestId('commit-phone-vote');
        await expect(vote).toBeVisible();
        const box = await vote.boundingBox();
        expect(box.width).toBeGreaterThan(300);
        expect(box.height).toBeGreaterThanOrEqual(44);
      } else {
        await expect(page.getByTestId('commit-desktop')).toBeVisible();
        await expect(page.getByTestId('commit-phone')).toBeHidden();
        await expect(page.getByTestId('commit-strip')).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`de27-${width}${dark ? '-dark' : ''}.png`), fullPage: true });
      if (width < 768) {
        await page.getByTestId('commit-phone-conditions').scrollIntoViewIfNeeded();
        await expect(page.getByTestId('commit-phone-condition-closing')).toHaveAttribute('href', '/deals/closing?deal=3');
        await page.screenshot({ path: testInfo.outputPath(`de27b-${width}${dark ? '-dark' : ''}.png`) });
        await page.getByTestId('commit-phone-vote').click();
        await expect(page.getByTestId('commit-vote-submit')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`de27c-${width}${dark ? '-dark' : ''}.png`) });
      }
    });
  }
}
