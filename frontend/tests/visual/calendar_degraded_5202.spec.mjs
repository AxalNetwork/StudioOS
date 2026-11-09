/**
 * D5202 (#5202) — one external calendar failing, in a real browser on the built SPA.
 *
 * Production showed "26 of 28 sources answered" with both Google and Outlook event reads failing while the
 * Connected calendars rail reported both providers Connected. This drives that state and holds what the member
 * must see: the rest of the calendar, the provider's read named as degraded next to its Connected credential,
 * and a Retry that re-reads that provider alone.
 *
 *   · Axal's own events and the healthy provider's events are still on the agenda;
 *   · the rail says Connected AND "Events temporarily unavailable" for the failed one;
 *   · the rail says Connected, with nothing added, for the healthy one;
 *   · Retry asks for `kinds=external_google` only — no other source is re-read;
 *   · after the retry answers, the degraded wording goes and the recovered event is on the agenda.
 *
 * The signed-in member and the session come from this folder's server (`server.ts`); `/api/calendar/*` is this
 * spec's own, because the local Worker has no Google or Outlook to fail. Nothing leaves 127.0.0.1.
 */
import { test, expect } from '@playwright/test';

const FROM_TITLE = 'Axal own session';
const OUTLOOK_TITLE = 'Outlook own event';
const GOOGLE_TITLE = 'Google own event';

const iso = (dayOffset, hour) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

const axalEvent = () => ({
  id: 'manual:1', kind: 'manual', source_id: 1, source_uid: 'axal:manual:1', title: FROM_TITLE,
  start_at: iso(1, 9), end_at: iso(1, 10), status: 'scheduled', attendees: [],
});
const providerEvent = (kind, title) => ({
  id: `${kind}:x1`, kind, source_id: 0, source_uid: 'x1', title,
  start_at: iso(1, 15), end_at: iso(1, 16), status: 'confirmed', attendees: [], read_only: true,
  external: { provider: kind === 'external_google' ? 'google' : 'microsoft', ical_uid: 'x1@example.test', account: { provider: 'google', address: null } },
});

/** The member's calendar, with Google's read failing until `state.googleOk` flips. */
async function wire(page, manifest, state) {
  await page.addInitScript(({ token, user }) => {
    try {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: 1, decided: true, updatedAt: '2026-11-09T00:00:00Z', categories: { essential: true } }));
    } catch { /* storage off: the journey fails loudly on its first check */ }
  }, { token: manifest.token, user: manifest.user });
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort('blockedbyclient'));

  await page.route('**/api/calendar/events*', async (route) => {
    const url = new URL(route.request().url());
    const kinds = (url.searchParams.get('kinds') || '').split(',').filter(Boolean);
    state.reads.push(kinds.length ? kinds.join(',') : 'all');
    const only = kinds.length ? (k) => kinds.includes(k) : () => true;
    const items = [];
    const sources = [];
    // Axal's own sources: a handful that answer, so a degraded provider is clearly not the whole calendar.
    for (const kind of ['manual', 'ic_meeting', 'founder_checkin']) {
      if (!only(kind)) continue;
      sources.push({ kind, ok: true, error: null, items: kind === 'manual' ? 1 : 0, latency_ms: 4, at: new Date().toISOString() });
      if (kind === 'manual') items.push(axalEvent());
    }
    if (only('external_microsoft')) {
      sources.push({ kind: 'external_microsoft', ok: true, error: null, items: 1, latency_ms: 120, at: new Date().toISOString() });
      items.push(providerEvent('external_microsoft', OUTLOOK_TITLE));
    }
    if (only('external_google')) {
      if (state.googleOk) {
        sources.push({ kind: 'external_google', ok: true, error: null, items: 1, latency_ms: 130, at: new Date().toISOString() });
        items.push(providerEvent('external_google', GOOGLE_TITLE));
      } else {
        sources.push({ kind: 'external_google', ok: false, error: 'unreadable', reason: 'http_5xx', items: 0, latency_ms: 9000, at: new Date().toISOString() });
      }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', json: { items, sources } });
  });

  // Both credentials are good: that is the whole point of the state under test.
  const status = { connected: true, configured: true, available: true, last_synced_at: new Date().toISOString(), sync_error: null, sync_error_read: true };
  await page.route('**/api/calendar/google/status*', (route) => route.fulfill({ status: 200, contentType: 'application/json', json: { ...status, scope: 'https://www.googleapis.com/auth/calendar' } }));
  await page.route('**/api/calendar/microsoft/status*', (route) => route.fulfill({ status: 200, contentType: 'application/json', json: status }));
  await page.route('**/api/calendar/sources*', (route) => route.fulfill({ status: 200, contentType: 'application/json', json: { families: [], sources: [], copy_target: 'all' } }));
  await page.route('**/api/connectors*', (route) => route.fulfill({ status: 200, contentType: 'application/json', json: { items: [] } }));
}

async function manifestOf(request) {
  const res = await request.get('/__visual/manifest');
  expect(res.ok()).toBeTruthy();
  return res.json();
}

for (const [width, height, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  test.describe(`${label} (${width}px)`, () => {
    test.use({ viewport: { width, height } });

    test('a failed Google read leaves the calendar standing, is named next to Connected, and retries alone', async ({ page, request }) => {
      const manifest = await manifestOf(request);
      const state = { googleOk: false, reads: [] };
      await wire(page, manifest, state);

      await page.goto('/calendar');
      // The rest of the calendar is there: Axal's own event and the provider that answered.
      await expect(page.getByText(FROM_TITLE).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(OUTLOOK_TITLE).first()).toBeVisible();
      await expect(page.getByText(GOOGLE_TITLE)).toHaveCount(0);

      // The Connected calendars panel is a route of its own (`CONNECTED_PATH`), and the page reads its events there too.
      await page.goto('/calendar/connected');
      const googleRow = page.getByTestId('cal-conn-google');
      await expect(googleRow).toBeVisible({ timeout: 20_000 });
      await expect(googleRow).toHaveAttribute('data-state', 'connected');
      await expect(googleRow).toContainText('Connected');
      await expect(page.getByTestId('cal-conn-google-sub')).toContainText('could not be read just now');
      await expect(page.getByTestId('cal-conn-google-health')).toContainText('Events temporarily unavailable');
      // Outlook read fine, so nothing is added to its row.
      await expect(page.getByTestId('cal-conn-microsoft')).toHaveAttribute('data-state', 'connected');
      await expect(page.getByTestId('cal-conn-microsoft-health')).toHaveCount(0);

      // Retry re-reads Google alone.
      state.googleOk = true;
      const before = state.reads.length;
      await page.getByRole('button', { name: 'Try reading its events again' }).click();
      await expect.poll(() => state.reads.length).toBeGreaterThan(before);
      expect(state.reads.slice(before)).toEqual(['external_google']);

      // The degraded wording goes on the spot, from the scoped read alone: no reload, no other source re-read.
      await expect(page.getByTestId('cal-conn-google-health')).toHaveCount(0);
      await expect(page.getByTestId('cal-conn-google-sub')).not.toContainText('could not be read just now');
      expect(state.reads.slice(before)).toEqual(['external_google']);
      // And the recovered event is on the agenda, beside the ones that never went away.
      await page.goto('/calendar');
      await expect(page.getByText(GOOGLE_TITLE).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(OUTLOOK_TITLE).first()).toBeVisible();
      await expect(page.getByText(FROM_TITLE).first()).toBeVisible();
    });
  });
}
