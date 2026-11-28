// Follow the Introductions guide into the real desk with one synthetic teammate request.
import { test as base, expect } from '@playwright/test';
import { startLocalWorker } from './_helpers.js';

// #9039: served the built SPA by `startLocalWorker()` (_helpers.js), so CI runs this with no preview and no account.
// Every /api/* answer still comes from the page.route fixture below; the local Worker only serves docs/.
const test = base.extend({
  localWorker: [async ({}, use) => {
    const worker = await startLocalWorker();
    await use(worker);
    await worker.close();
  }, { scope: 'worker' }],
  baseURL: async ({ localWorker }, use) => use(localWorker.origin),
});
// The built SPA registers its service worker (src/lib/pwa.js); a request it makes skips page.route and would reach the
// local Worker signed out, so a 401 there sends the page to /login. Blocked, as integrations.spec.js does.
test.use({ serviceWorkers: 'block' });

async function openIntro(page, baseURL, { status, delivery = null }) {
  const member = { id: 4639, name: 'Test partner', role: 'partner', licences: ['partner'], kyc_status: 'approved' };
  const intro = {
    uid: 'test-intro', status, delivery, requester: { name: 'Test requester' },
    person: { name: 'Test contact' }, note: 'Discuss a prototype.',
  };
  const writes = [];
  await page.addInitScript(user => localStorage.setItem('user', JSON.stringify(user)), member);
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname.slice('/api'.length);
    const json = data => route.fulfill({ json: data });
    if (path === '/auth/me') return json(member);
    if (path === '/onboarding/progress') return json({ flow: 'partner', completed_at: '2026-11-01T00:00:00Z' });
    if (path === '/projects') return json([]);
    if (path === '/relationships/intro-requests' && request.method() === 'GET') {
      return json({ sent: [], received: [intro], follow_ups_due: [] });
    }
    if (path === '/relationships/sharing') return json({ teams: [] });
    if (path === '/relationships/summary') return json({ sharing: { teams_shared: 0 }, requests: { made_90d: 0 } });
    if (request.method() === 'POST' && /^\/(relationships|mail)\//.test(path)) {
      const body = request.postDataJSON();
      writes.push({ path, body });
      if (path === '/relationships/intro-requests/test-intro/decide' && body.decision === 'accepted') {
        intro.status = 'accepted';
        return json({ request: intro });
      }
      if (path === '/mail/send/operations/test-send/resolve' && body.outcome === 'not_arrived') {
        intro.delivery = { state: 'not_sent', operation_uid: 'test-send' };
        return json({ operation: { uid: 'test-send', status: 'refused' } });
      }
    }
    return route.fulfill({ status: 503, json: { detail: 'Unavailable in this fixture' } });
  });
  await page.goto('/help/workflows/introductions');
  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { name: 'Steps', exact: true })).toBeVisible();
  const reject = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await reject.isVisible()) await reject.click();
  await page.getByTestId('help-guide-go').click();
  const card = page.getByTestId('introductions-ask-test-intro');
  await expect(card).toContainText('Test requester asks you to introduce them to Test contact');
  return { card, writes };
}

test('a teammate can accept an introduction without sending an email', async ({ page, baseURL }) => {
  const { card, writes } = await openIntro(page, baseURL, { status: 'pending' });
  await card.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Write the intro' })).toBeVisible();
  await page.reload();
  await expect(card.getByRole('button', { name: 'Write the intro' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
  expect(writes).toEqual([{ path: '/relationships/intro-requests/test-intro/decide', body: { decision: 'accepted' } }]);
});

test('an uncertain introduction requires a recorded mail outcome before another draft', async ({ page, baseURL }) => {
  const { card, writes } = await openIntro(page, baseURL, {
    status: 'accepted', delivery: { state: 'unconfirmed', operation_uid: 'test-send' },
  });
  await expect(card.getByRole('alert')).toContainText('Sent folder');
  await expect(card.getByRole('button', { name: 'Write the intro' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'It arrived', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'It did not arrive', exact: true }).click();
  await expect(card).toContainText('The last send of this intro did not go out.');
  await page.reload();
  await expect(card.getByRole('button', { name: 'Write the intro' })).toBeVisible();
  expect(writes).toEqual([{ path: '/mail/send/operations/test-send/resolve', body: { outcome: 'not_arrived' } }]);
});
