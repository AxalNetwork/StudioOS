// #4639: real Help pages, role filtering and task destinations with synthetic account data.
// Browser traffic to providers and the Worker is intercepted; no remote account is needed.
import { test, expect } from '@playwright/test';

async function useFixture(page, baseURL, role) {
  const user = role ? {
    id: 4639, name: 'Help test member', role, licences: [role], kyc_status: 'approved',
  } : null;
  await page.addInitScript((member) => {
    if (member) localStorage.setItem('user', JSON.stringify(member));
  }, user);
  const origin = new URL(baseURL).origin;
  await page.route('**/*', async route => {
    const { origin: target, pathname } = new URL(route.request().url());
    if (target !== origin) return route.abort();
    if (!pathname.startsWith('/api/')) return route.continue();
    if (pathname === '/api/auth/me') return route.fulfill({ status: user ? 200 : 401, json: user || {} });
    if (pathname === '/api/onboarding/progress') return route.fulfill({ json: { flow: role, completed_at: '2026-11-01T00:00:00Z' } });
    if (pathname === '/api/settings') return route.fulfill({ json: {} });
    if (pathname === '/api/projects' || pathname === '/api/tickets') return route.fulfill({ json: [] });
    if (pathname === '/api/help/popular') return route.fulfill({ json: { guides: [] } });
    if (pathname.endsWith('/feedback')) return route.fulfill({ json: { feedback: null } });
    if (pathname.endsWith('/view')) return route.fulfill({ json: { ok: true } });
    if (pathname === '/api/mail/accounts') return route.fulfill({ json: { accounts: [] } });
    if (pathname === '/api/mail/people') return route.fulfill({ json: { groups: [] } });
    if (pathname === '/api/mail/drafts') return route.fulfill({ json: { drafts: [] } });
    if (pathname === '/api/mail/shares') return route.fulfill({ json: { items: [] } });
    return route.fulfill({ status: 503, json: { detail: 'Unavailable in this fixture' } });
  });
}

async function dismissCookies(page) {
  const reject = page.getByRole('button', { name: 'Reject all', exact: true });
  if (await reject.isVisible()) await reject.click();
}

const workflows = [
  { guide: 'research', role: 'investor', path: '/research/ask', heading: 'Ask' },
  { guide: 'email', role: 'exploring', path: '/email', heading: 'Email' },
  { guide: 'record-discovery', role: 'founder', path: '/validate/record', empty: /There is no venture to show yet/ },
  { guide: 'introductions', role: 'partner', path: '/network/introductions', heading: 'Introductions' },
  { guide: 'build-week', role: 'founder', path: '/build/this-week', heading: 'No startup is available' },
  { guide: 'grow', role: 'founder', path: '/grow/focus', heading: "This month's focus" },
  { guide: 'connector-recovery', role: 'advisor', path: '/account/connectors', heading: 'Connectors' },
  { guide: 'connected-assistants', role: 'admin', path: '/account/builder', heading: 'Builder' },
];

for (const { guide, role, path, heading, empty } of workflows) {
  test(`${role} can follow the ${guide} guide to its task`, async ({ page, baseURL }) => {
    await useFixture(page, baseURL, role);
    await page.goto(`/help#workflows/${guide}`);
    const article = page.getByRole('article');
    await expect(article.getByRole('heading', { name: 'Steps', exact: true })).toBeVisible();
    await expect(page).toHaveURL(new URL(`/help/workflows/${guide}`, baseURL).href);
    await dismissCookies(page);
    await expect(article.locator('#related a[href="/help/troubleshooting/contact-support"]')).toBeVisible();
    if (guide === 'connector-recovery') {
      const table = article.getByRole('table', { name: 'Connector status and next action' });
      await expect(table.getByRole('rowheader')).toHaveCount(6);
      await expect(table.getByRole('row', { name: /Daily limit reached/ })).toContainText(/quota to reset/);
    }
    const open = page.getByTestId('help-guide-go');
    await expect(open).toHaveAttribute('href', path);
    await open.click();
    await expect(page).toHaveURL(new URL(path, baseURL).href);
    if (heading) await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    else await expect(page.getByText(empty)).toBeVisible();

    if (guide === 'email') {
      await page.getByRole('link', { name: 'Email settings', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Email settings', exact: true })).toBeVisible();
    }
  });
}

for (const [role, guide] of [['investor', 'record-discovery'], ['exploring', 'research'], [null, 'email']]) {
  test(`${role || 'signed-out visitor'} cannot discover or open the ${guide} guide`, async ({ page, baseURL }) => {
    await useFixture(page, baseURL, role);
    const path = `/help/workflows/${guide}`;
    await page.goto('/help');
    const search = page.getByRole('combobox').first();
    await expect(search).toBeVisible();
    await dismissCookies(page);
    await search.fill(guide === 'record-discovery' ? 'record discovery' : guide);
    await expect(page.locator(`a[href="${path}"]`)).toHaveCount(0);
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'No guide at this address.' })).toBeVisible();
    await expect(page.getByTestId('help-guide-go')).toHaveCount(0);
  });
}

test('investor can keep an Ask answer and reopen its cited passage after reload', async ({ page, baseURL }) => {
  await useFixture(page, baseURL, 'investor');
  const title = 'Synthetic pilot report';
  const passage = 'The pilot ran for twelve weeks.';
  const doc = { uid: 'pilot-doc', title, index_state: 'indexed', in_ask: true };
  let answer;
  await page.route('**/api/research/documents', route => route.fulfill({ json: { answerable: 1, items: [doc] } }));
  await page.route('**/api/research/ask', route => {
    const { question } = route.request().postDataJSON();
    answer = {
      uid: 'pilot-answer', question, answer: 'Twelve weeks [1].', reason: 'answered', saved: false,
      citations: [{ document_uid: doc.uid, title, passage, chunk: 0, cited: true }],
    };
    return route.fulfill({ json: { reason: 'answered', session_uid: 'pilot-session' } });
  });
  await page.route('**/api/research/ask/sessions?*', route => {
    const savedOnly = new URL(route.request().url()).searchParams.get('scope') === 'saved';
    const items = answer && (!savedOnly || answer.saved) ? [answer] : [];
    return route.fulfill({ json: { session: { uid: 'pilot-session' }, items, has_more: false } });
  });
  await page.route('**/api/research/ask/answers/pilot-answer', route => {
    expect(route.request().method()).toBe('PATCH');
    expect(route.request().postDataJSON()).toEqual({ saved: true });
    answer.saved = true;
    return route.fulfill({ json: { saved: true } });
  });
  await page.goto('/help/workflows/research');
  const open = page.getByTestId('help-guide-go');
  await expect(open).toBeVisible();
  await dismissCookies(page);
  await open.click();
  const form = page.getByRole('form', { name: 'Ask your library' });
  await form.getByLabel('What do you want to know?').fill('How long was the pilot?');
  await form.getByRole('button', { name: 'Ask', exact: true }).click();
  const exchange = page.getByTestId('ask-exchange-pilot-answer');
  await expect(exchange).toContainText('How long was the pilot?');
  await exchange.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(exchange.getByRole('button', { name: 'Kept', exact: true })).toBeVisible();
  await page.reload();
  const savedRead = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/research/ask/sessions' && url.searchParams.get('scope') === 'saved';
  });
  const saved = page.getByRole('tab', { name: 'Saved answers' });
  await saved.click();
  await savedRead;
  await expect(saved).toHaveAttribute('aria-selected', 'true');
  await expect(exchange).toContainText('Twelve weeks');
  await exchange.getByRole('button', { name: /Open passage.*Synthetic pilot report/ }).click();
  await expect(page.getByTestId('ask-source-sheet-passage')).toHaveText(passage);
});

test('a founder can find the Build guide on a phone and reach its prerequisite', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useFixture(page, baseURL, 'founder');
  await page.goto('/help');
  const search = page.getByRole('combobox').first();
  await expect(search).toBeVisible();
  await dismissCookies(page);
  await search.fill('weekly operating cycle');
  await page.locator('a[href="/help/workflows/build-week"]').click();
  await expect(page.getByRole('article').getByRole('heading', { name: 'Steps', exact: true })).toBeVisible();
  await page.getByTestId('help-guide-go').click();
  await expect(page.getByRole('heading', { name: 'No startup is available' })).toBeVisible();
});
