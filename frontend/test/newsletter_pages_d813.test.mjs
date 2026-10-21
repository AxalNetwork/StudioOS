/**
 * D813 (#2259) — the website's newsletter signup (W1), its confirm (W2) and
 * preferences (W3) pages, and Account › Notifications › Newsletters (D1).
 *
 * This pins:
 *   - the topics are migration 515's: the six public ones in its order, and
 *     every label equal to its seed;
 *   - the signup's every state renders, and the sent state is one sentence
 *     for every address: nothing on the page says whether it is subscribed;
 *   - the token pages handle a confirmed, an expired, a used or bad token and
 *     an unexplained failure, each with its own words;
 *   - Save sends only what changed; unsubscribing shows the unsubscribed page
 *     and Resubscribe restores what was on;
 *   - the member's switches round-trip through `PUT /api/me/newsletters` and
 *     a refusal says why; loading, empty and Unreadable each draw;
 *   - the phone layout, the routes, the public route lists and the headers.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/newsletter_pages_d813.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const model = await import('../src/pages/site/newsletterModel.js');
const { newsletterApi } = await import('../src/lib/api/newsletter.js');
const signup = await import('../src/components/site/NewsletterSignup.jsx');
const { ConfirmView } = await import('../src/pages/site/NewsletterConfirmPage.jsx');
const prefs = await import('../src/pages/site/NewsletterPreferencesPage.jsx');
const account = await import('../src/pages/account/AccountNewsletters.jsx');

const render = (el, url = '/') => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [url] }, el));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Replace newsletterApi's methods for one test, and put them back after. */
function stubApi(t, stubs) {
  const saved = {};
  for (const [k, fn] of Object.entries(stubs)) { saved[k] = newsletterApi[k]; newsletterApi[k] = fn; }
  t.after(() => Object.assign(newsletterApi, saved));
}
const refusal = (status, code, message = '') => Object.assign(new Error(message || code), { status, code });

// ---------------------------------------------------------------- topics

test('the topics are migration 515\'s, the public six first in its order', () => {
  const sql = read('cloudflare-worker/sql/migrations/515_newsletter_lists.sql');
  const seeds = [...sql.matchAll(/^\s*\('(\w+)', '((?:[^']|'')+)', '(?:[^']|'')+', '(public|investors)', (\d+)\)/gm)]
    .map(([, key, label, audience, order]) => ({ key, label: label.replace(/''/g, "'"), audience, order: Number(order) }))
    .sort((a, b) => a.order - b.order);
  assert.equal(seeds.length, 8, 'the seed rows were read');
  assert.deepEqual(model.NEWSLETTER_TOPICS, seeds.map(({ key, label, audience }) => ({ key, label, audience })));
  assert.deepEqual(model.PUBLIC_TOPIC_KEYS, ['brief', 'portfolio', 'founder_calls', 'events', 'insights', 'announcements']);
  for (const k of model.PUBLIC_TOPIC_KEYS) assert.equal(seeds.find((s) => s.key === k).audience, 'public');
  // And the Worker's own list agrees.
  const svc = read('cloudflare-worker/src/services/newsletter.ts');
  const workerKeys = [...svc.match(/NEWSLETTER_TOPICS = Object\.freeze\(\[([^\]]+)\]/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(workerKeys, model.NEWSLETTER_TOPICS.map((t) => t.key));
});

test('the subscribe body sends only the picked public topics, trimmed address', () => {
  const body = model.signupBody({ email: '  a@example.com ', picked: { brief: true, events: true, partner_letter: true, x: true }, turnstileToken: 't', hp: '' });
  assert.deepEqual(body, { email: 'a@example.com', topics: ['brief', 'events'], turnstileToken: 't', hp: '' });
});

// ---------------------------------------------------------------- W1

test('the footer block draws the board\'s title, line, field, button and fine print', () => {
  const html = render(React.createElement(signup.default));
  const t = text(html);
  assert.match(t, /The Axal VC Brief/);
  assert.match(t, /Monthly: essays, portfolio news, open roles and events\./);
  assert.match(html, /type="email"/);
  assert.match(t, /Subscribe/);
  assert.match(t, /We'll email you to confirm\. Unsubscribe in one click from any email\. Privacy policy/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /name="hp"[^>]*tabindex="-1"|tabindex="-1"[^>]*name="hp"/, 'the honeypot is out of the tab order');
  assert.doesNotMatch(html, /role="switch"/, 'the block has no topic switches');
});

test('the /newsletter page draws the six public topics as switches, the Brief on and monthly', () => {
  const html = render(React.createElement(signup.default, { variant: 'page' }));
  const switches = [...html.matchAll(/role="switch" aria-checked="(true|false)" aria-label="([^"]+)"/g)].map(([, on, l]) => [l, on]);
  assert.deepEqual(switches, [
    ['The Axal VC Brief', 'true'], ['Portfolio news', 'false'], ['Founder calls', 'false'],
    ['Events', 'false'], ['Insights', 'false'], ['Announcements', 'false'],
  ]);
  assert.match(text(html), /The Axal VC Brief \(monthly\)/);
});

test('every SitePage draws the block above the footer; the newsletter pages opt out', () => {
  const src = read('frontend/src/components/site/SitePage.jsx');
  assert.match(src, /<\/main>\s*\{signup && <NewsletterSignup \/>\}\s*<PublicFooter \/>/);
  for (const f of ['NewsletterPage', 'NewsletterConfirmPage', 'NewsletterPreferencesPage']) {
    assert.match(read(`frontend/src/pages/site/${f}.jsx`), /<SitePage [^>]*signup=\{false\}/, `${f} does not draw a second form`);
  }
});

async function mountSignup(t, variant, subscribe) {
  stubApi(t, { subscribe });
  const view = await mountContracts(React.createElement(signup.default, { variant }), '/newsletter');
  t.after(() => view.unmount());
  const find = (pred) => view.nodes().find((n) => { const p = view.props(n); return p && pred(n, p); });
  return {
    ...view,
    async type(value) {
      const input = find((n, p) => n.tagName === 'INPUT' && p.type === 'email');
      await act(async () => { view.props(input).onChange({ target: { value } }); });
    },
    /** Submits; with `wait: false` it returns while the request is still out. */
    async submit({ wait = true } = {}) {
      const form = find((n) => n.tagName === 'FORM');
      let pending;
      await act(async () => { pending = view.props(form).onSubmit({ preventDefault() {} }); });
      if (wait) await act(async () => { await pending; });
      return { pending };
    },
    find,
  };
}

test('sending, then one sent state for any address: it never says whether the address is subscribed', async (t) => {
  let release;
  const calls = [];
  const v = await mountSignup(t, 'block', (body) => { calls.push(body); return new Promise((r) => { release = r; }); });
  await v.type('person@example.com');
  const { pending } = await v.submit({ wait: false });
  assert.match(v.text(), /Sending…/, 'the button says it is sending');
  assert.ok(v.find((n, p) => n.tagName === 'INPUT' && p.type === 'email' && p.disabled), 'the field is locked while sending');
  await act(async () => { release({ ok: true, message: 'Check your inbox: we have sent you an email to confirm.' }); await pending; });
  assert.deepEqual(calls, [{ email: 'person@example.com', topics: ['brief'], turnstileToken: '', hp: '' }]);
  const sent = v.text();
  assert.match(sent, /Check your inbox to confirm\./);
  assert.match(sent, /If that email is already subscribed, we've sent a link to manage your topics instead\./);
  // The answer for an address that is already subscribed is the route's same
  // answer, so the page has nothing else it could say.
  assert.doesNotMatch(sent, /is already subscribed\.|you are subscribed|not subscribed|welcome back/i);
});

test('the sent state is drawn from no part of the answer', () => {
  const src = read('frontend/src/components/site/NewsletterSignup.jsx');
  const submit = src.slice(src.indexOf('async function submit'), src.indexOf('const id = page'));
  assert.match(submit, /await newsletterApi\.subscribe\(body\);\n\s*setStatus\(\{ state: 'sent', error: '' \}\);/, 'the answer is awaited and never read');
  assert.doesNotMatch(submit, /const \w+ = await newsletterApi\.subscribe/);
});

test('the error state: a bad address is refused before the request, a refusal says the route\'s reason', async (t) => {
  let calls = 0;
  const v = await mountSignup(t, 'block', async () => { calls += 1; throw refusal(403, 'turnstile_failed'); });
  await v.type('not-an-email');
  await v.submit();
  assert.equal(calls, 0);
  assert.match(v.text(), /Enter a valid email address\./);
  await v.type('person@example.com');
  await v.submit();
  assert.equal(calls, 1);
  assert.match(v.text(), /Verification failed\. Complete the challenge again\./);
  assert.equal(model.signupError(refusal(429, 'rate_limited')), 'Too many attempts. Wait a minute, then try again.');
  assert.equal(model.signupError(refusal(503, 'newsletter_unconfigured')), 'Newsletter signups are not open yet. Try again later.');
  assert.equal(model.signupError(refusal(500, 'x')), 'Your signup could not be sent. Try again.');
  // No refusal sentence speaks about the address's state.
  for (const s of ['invalid_email', 'turnstile_failed', 'newsletter_unconfigured', 'x']) {
    assert.doesNotMatch(model.signupError({ code: s }), /subscribed|already|exists/i);
  }
});

test('the page refuses an empty topic list before the request', async (t) => {
  let calls = 0;
  const v = await mountSignup(t, 'page', async () => { calls += 1; return {}; });
  const brief = v.find((n, p) => p.role === 'switch' && p['aria-label'] === 'The Axal VC Brief');
  await act(async () => { v.props(brief).onClick(); });
  await v.type('person@example.com');
  await v.submit();
  assert.equal(calls, 0);
  assert.match(v.text(), /Pick at least one newsletter\./);
});

// ---------------------------------------------------------------- W2

test('the confirm page: confirmed, expired, used, unconfigured and an unexplained failure', () => {
  const draw = (view) => text(render(React.createElement(ConfirmView, { view, onRetry() {} })));
  assert.deepEqual(model.confirmView({ ok: true, status: 'confirmed' }, null), { state: 'confirmed', topics: null });
  assert.match(draw(model.confirmView({ ok: true, status: 'confirmed' }, null)), /^You're subscribed\. Thank you\./);
  // Should the route ever carry the topics, the count and the list are drawn from them.
  const withTopics = model.confirmView({ ok: true, topics: ['brief', 'events'] }, null);
  assert.match(draw(withTopics), /You're subscribed to 2 newsletters\. The Axal VC Brief Events/);
  assert.equal(model.confirmedTitle(['x']), "You're subscribed to 1 newsletter.");
  // D810's POST answers the labels themselves.
  assert.deepEqual(model.confirmView({ ok: true, status: 'confirmed', topics: ['The Axal VC Brief', 'Events'] }, null).topics, ['The Axal VC Brief', 'Events']);

  const expired = draw(model.confirmView(null, refusal(410, 'token_expired')));
  assert.match(expired, /This link has expired\..*Subscribe again/);
  assert.match(render(React.createElement(ConfirmView, { view: { state: 'expired' } })), /href="\/newsletter"/);
  assert.match(draw(model.confirmView(null, refusal(410, 'token_invalid'))), /already been used or is not valid/);
  assert.match(draw(model.confirmView(null, refusal(503, 'newsletter_unconfigured'))), /not open yet/);
  const failed = draw(model.confirmView(null, refusal(500, 'internal')));
  assert.match(failed, /could not be confirmed.*has not been used.*Try again/);
  assert.match(draw({ state: 'loading' }), /Checking your link…/);
  // The check's answer (GET, which changes nothing) waits for the button.
  assert.deepEqual(model.checkView({ ok: true, status: 'pending' }, null), { state: 'ready' });
  assert.equal(model.checkView(null, refusal(410, 'token_expired')).state, 'expired');
  assert.match(draw({ state: 'ready' }), /Confirm your subscription\..*Nothing is sent until you do\. Confirm subscription/);
  assert.match(draw({ state: 'confirming' }), /Confirming…/);
});

test('opening the link only checks it; the button confirms, once', async (t) => {
  const calls = [];
  let release;
  stubApi(t, {
    checkConfirm: async (token) => { calls.push(['check', token]); return { ok: true, status: 'pending' }; },
    confirm: (token) => { calls.push(['confirm', token]); return new Promise((r) => { release = r; }); },
  });
  const { ConfirmFlow: Page } = await import('../src/pages/site/NewsletterConfirmPage.jsx');
  const v = await mountContracts(React.createElement(Page), '/newsletter/confirm?token=abcdefghijklmnopqrstuvwxyz');
  t.after(() => v.unmount());
  await v.flush();
  assert.deepEqual(calls, [['check', 'abcdefghijklmnopqrstuvwxyz']], 'opening the page confirms nothing');
  assert.match(v.text(), /Confirm your subscription\./);
  await v.click('Confirm subscription');
  const button = v.nodes().find((n) => n.tagName === 'BUTTON' && v.props(n)?.disabled);
  assert.ok(button, 'the button is locked while the confirm is out');
  await act(async () => { v.props(button).onClick(); });
  assert.deepEqual(calls.filter(([k]) => k === 'confirm').length, 1, 'the single-use token is posted once');
  await act(async () => { release({ ok: true, status: 'confirmed' }); });
  await v.flush();
  assert.match(v.text(), /You're subscribed\./);
});

test('a used link is found by the check, before any confirm', async (t) => {
  let confirms = 0;
  stubApi(t, {
    checkConfirm: async () => { throw refusal(410, 'token_invalid'); },
    confirm: async () => { confirms += 1; return {}; },
  });
  const { ConfirmFlow: Page } = await import('../src/pages/site/NewsletterConfirmPage.jsx');
  const v = await mountContracts(React.createElement(Page), '/newsletter/confirm?token=abcdefghijklmnopqrstuvwxyz');
  t.after(() => v.unmount());
  await v.flush();
  assert.match(v.text(), /already been used or is not valid/);
  assert.equal(confirms, 0);
});

test('a link with no token is a bad link, and nothing is sent', async (t) => {
  let calls = 0;
  stubApi(t, { checkConfirm: async () => { calls += 1; return {}; }, confirm: async () => { calls += 1; return {}; } });
  const { ConfirmFlow: Page } = await import('../src/pages/site/NewsletterConfirmPage.jsx');
  const v = await mountContracts(React.createElement(Page), '/newsletter/confirm');
  t.after(() => v.unmount());
  await v.flush();
  assert.equal(calls, 0);
  assert.match(v.text(), /already been used or is not valid/);
});

// ---------------------------------------------------------------- W3

const PREFS = { email: 'p***@example.com', status: 'confirmed', topics: { brief: true, portfolio: false, events: true, insights: false } };

async function mountPrefs(t, stubs, url = '/newsletter/preferences?token=test-token-placeholder') {
  stubApi(t, stubs);
  const v = await mountContracts(React.createElement(prefs.PreferencesFlow), url);
  t.after(() => v.unmount());
  await v.flush();
  const sw = (label) => v.nodes().find((n) => v.props(n)?.role === 'switch' && v.props(n)['aria-label'] === label);
  return { ...v, async toggle(label) { await act(async () => { v.props(sw(label)).onClick(); }); }, sw };
}

test('preferences: the read topics as switches in 515\'s order, and Save sends only what changed', async (t) => {
  const saves = [];
  const v = await mountPrefs(t, {
    preferences: async () => PREFS,
    savePreferences: async (token, topics) => { saves.push([token, topics]); return { ok: true, ...PREFS, topics: { ...PREFS.topics, ...topics } }; },
  });
  assert.match(v.text(), /Your newsletters\s*For p\*\*\*@example\.com/);
  const order = v.nodes().filter((n) => v.props(n)?.role === 'switch').map((n) => v.props(n)['aria-label']);
  assert.deepEqual(order, ['The Axal VC Brief', 'Portfolio news', 'Events', 'Insights']);
  const save = () => v.nodes().find((n) => n.tagName === 'BUTTON' && v.props(n)?.children === 'Save');
  assert.equal(v.props(save()).disabled, true, 'nothing to save until a switch moves');
  await v.toggle('Portfolio news');
  await v.click('Save');
  assert.deepEqual(saves, [['test-token-placeholder', { portfolio: true }]]);
  assert.match(v.text(), /Saved\./);
  assert.equal(v.props(v.sw('Portfolio news'))['aria-checked'], 'true', 'redrawn from the answer');
});

test('unsubscribe from everything, then Resubscribe restores what was on and says the link is retired', async (t) => {
  const calls = [];
  const v = await mountPrefs(t, {
    preferences: async () => PREFS,
    unsubscribe: async (token, topic) => { calls.push(['unsubscribe', topic]); return { ok: true, topic, status: 'unsubscribed' }; },
    savePreferences: async (token, topics) => { calls.push(['save', topics]); return { ok: true, ...PREFS, topics }; },
  });
  await v.click('Unsubscribe from everything');
  assert.match(v.text(), /You're unsubscribed from every Axal VC newsletter\./);
  await v.click('Resubscribe');
  assert.deepEqual(calls, [['unsubscribe', null], ['save', { brief: true, events: true }]]);
  assert.match(v.text(), /You're subscribed again\..*new link/);
});

test('a link that names a topic offers "Unsubscribe from [topic]"; Resubscribe turns that one back on', async (t) => {
  const calls = [];
  const v = await mountPrefs(t, {
    preferences: async () => PREFS,
    unsubscribe: async (token, topic) => { calls.push(['unsubscribe', topic]); return { ok: true, topic, status: 'confirmed' }; },
    savePreferences: async (token, topics) => { calls.push(['save', topics]); return { ok: true, ...PREFS }; },
  }, '/newsletter/preferences?token=test-token-placeholder&topic=events');
  await v.click('Unsubscribe from Events');
  assert.match(v.text(), /You're unsubscribed from Events\.\s*Your other topics are unchanged\./);
  await v.click('Resubscribe');
  assert.deepEqual(calls, [['unsubscribe', 'events'], ['save', { events: true }]]);
  assert.match(v.text(), /Your newsletters/);
});

test('a bad or expired preferences token reads as a bad link', async (t) => {
  const bad = await mountPrefs(t, { preferences: async () => { throw refusal(403, 'token_invalid'); } });
  assert.match(bad.text(), /This link is not valid any more\..*latest email/);
  assert.equal(model.preferencesFailure(refusal(503, 'newsletter_unconfigured')), 'unconfigured');
});

test('a link with no token reads as a bad link, and nothing is read', async (t) => {
  let calls = 0;
  const none = await mountPrefs(t, { preferences: async () => { calls += 1; return PREFS; } }, '/newsletter/preferences');
  assert.match(none.text(), /This link is not valid any more\./);
  assert.equal(calls, 0);
});

test('an unreadable preferences read says so, and Try again reads again', async (t) => {
  let n = 0;
  const flaky = await mountPrefs(t, { preferences: async () => { n += 1; if (n === 1) throw refusal(500, 'internal'); return PREFS; } });
  assert.match(flaky.text(), /Your topics could not be read\.\s*Nothing was changed\./);
  await flaky.click('Try again');
  await flaky.flush();
  assert.match(flaky.text(), /Your newsletters/);
});

test('a write refused for its token goes to the bad-link page, not a silent failure', async (t) => {
  const v = await mountPrefs(t, {
    preferences: async () => PREFS,
    savePreferences: async () => { throw refusal(403, 'token_invalid'); },
  });
  await v.toggle('Insights');
  await v.click('Save');
  assert.match(v.text(), /This link is not valid any more\./);
});

test('an unsubscribed subscriber opening the link reads that, and saving a topic resubscribes', () => {
  const html = render(React.createElement(prefs.PreferencesView, {
    view: { state: 'ready', data: { ...PREFS, status: 'unsubscribed', topics: { brief: false } } },
    draft: { brief: false }, onDraft() {}, onSave() {}, onUnsubscribe() {}, onResubscribe() {}, onRetry() {},
  }));
  assert.match(text(html), /You're unsubscribed from every Axal VC newsletter\. Turn a topic on and save to subscribe again\./);
  assert.doesNotMatch(text(html), /Unsubscribe from everything/);
});

test('changedChoices and preferenceRows', () => {
  assert.equal(model.changedChoices({ a: true }, { a: true }), null);
  assert.deepEqual(model.changedChoices({ a: true, b: false }, { a: false, b: false }), { a: false });
  assert.deepEqual(model.preferenceRows({ zz_new: true, events: false, brief: true }).map((r) => r.key), ['brief', 'events', 'zz_new']);
  assert.equal(model.preferenceRows({ zz_new: true })[0].label, 'Zz new');
});

// ---------------------------------------------------------------- D1

const MINE = {
  email: 'member@example.com',
  status: 'confirmed',
  topics: [
    { key: 'brief', label: 'The Axal VC Brief', description: 'The studio letter.', audience: 'public', enabled: true },
    { key: 'insights', label: 'Insights', description: '', audience: 'public', enabled: false },
    { key: 'partner_letter', label: 'Partner letter', description: 'For LPs.', audience: 'investors', enabled: false },
    { key: 'testing_calls', label: 'Testing calls', description: '', audience: 'public', enabled: true },
  ],
};

async function mountMine(t, stubs) {
  stubApi(t, stubs);
  const v = await mountContracts(React.createElement(account.default), '/account/notifications');
  t.after(() => v.unmount());
  await v.flush();
  const sw = (label) => v.nodes().find((n) => v.props(n)?.role === 'switch' && v.props(n)['aria-label'] === label);
  return { ...v, sw, async toggle(label) { await act(async () => { await v.props(sw(label)).onClick(); }); } };
}

test('the member\'s switches round-trip through PUT /api/me/newsletters, redrawn from the answer', async (t) => {
  const puts = [];
  const v = await mountMine(t, {
    mine: async () => MINE,
    saveMine: async (topics) => {
      puts.push(topics);
      return { ok: true, ...MINE, topics: MINE.topics.map((x) => (x.key in topics ? { ...x, enabled: topics[x.key] } : x)) };
    },
  });
  assert.match(v.text(), /Sent to member@example\.com by Axal VC Mail\./);
  assert.equal(v.props(v.sw('Insights'))['aria-checked'], 'false');
  await v.toggle('Insights');
  await v.flush();
  assert.deepEqual(puts, [{ insights: true }]);
  assert.equal(v.props(v.sw('Insights'))['aria-checked'], 'true');
  assert.match(v.text(), /Saved\./);
});

test('a refused member switch stays where the Worker holds it and says why', async (t) => {
  const v = await mountMine(t, {
    mine: async () => MINE,
    saveMine: async () => { throw refusal(403, 'topic_not_allowed', 'The partner letter is for investors and LPs.'); },
  });
  await v.toggle('Partner letter');
  await v.flush();
  assert.equal(v.props(v.sw('Partner letter'))['aria-checked'], 'false');
  assert.match(v.text(), /The partner letter is for investors and LPs\./);
});

test('D1 draws the role topics after the website\'s, and loading, empty and Unreadable', () => {
  const draw = (read) => render(React.createElement(account.NewslettersCard, { read: { reload() {}, ...read }, busyKey: null, outcome: null, onToggle() {} }));
  const ready = draw({ status: 'ready', data: MINE });
  const order = [...ready.matchAll(/data-testid="member-nl-([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['brief', 'insights', 'partner_letter', 'testing_calls']);
  assert.equal((ready.match(/For your role/g) || []).length, 2);
  assert.match(draw({ status: 'loading' }), /data-testid="account-loading"/);
  assert.match(text(draw({ status: 'ready', data: { email: 'm@example.com', topics: [] } })), /No newsletter is offered on your account yet\./);
  const unreadable = text(draw({ status: 'unreadable' }));
  assert.match(unreadable, /Your newsletters could not be read\. This is not a claim that you receive none\. Retry/);
  assert.doesNotMatch(text(draw({ status: 'ready', data: { topics: MINE.topics } })), /Sent to/, 'no address, no line');
});

test('D1 is in Account › Notifications, and the Insights page links there instead of its own toggle', () => {
  const settings = read('frontend/src/pages/SettingsPage.jsx');
  assert.match(settings, /safeActive === 'notifications' && \(\s*<>\s*<NotificationsSection[^>]*\/>\s*<AccountNewsletters \/>/);
  const insights = read('frontend/src/pages/PartnerInsightsPage.jsx');
  assert.doesNotMatch(insights, /insightsNewsletter(Status|Subscribe|Unsubscribe)|Subscribe to weekly digest|toggleSub/);
  assert.match(insights, /<Link to="\/account\/notifications"/);
});

test('dark mode: every light colour on D1 has its dark pair', () => {
  const src = read('frontend/src/pages/account/AccountNewsletters.jsx');
  for (const [, cls] of src.matchAll(/className="([^"]+)"/g)) {
    if (/text-axal-(ink|muted)/.test(cls)) assert.match(cls, /dark:text-/, cls);
    if (/divide-axal-hairline/.test(cls)) assert.match(cls, /dark:divide-/, cls);
  }
});

// ---------------------------------------------------------------- phone, routes, headers

test('the phone layout: one column, full-width actions and 44px targets', () => {
  const css = read('frontend/src/components/site/newsletter.css');
  const phone = css.slice(css.indexOf('@media (max-width: 760px)'));
  assert.match(phone, /\.ax-nl-block-in \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(phone, /\.ax-nl-row \{ flex-direction: column; \}/);
  assert.match(phone, /\.ax-nl-send, \.ax-site \.ax-nl-action \{ width: 100%; min-height: 44px; \}/);
  assert.match(phone, /\.ax-nl-input \{ min-height: 44px; \}/);
  for (const [, v] of css.matchAll(/font-family:\s*([^;}]+)/g)) assert.match(v.trim(), /^(inherit|var\(--font-mono\))$/, 'the site\'s CSS rule on fonts');
  assert.match(read('frontend/src/pages/account/AccountNewsletters.jsx'), /max-sm:min-h-\[44px\]/);
});

test('the three pages are routed, public, previewable, in the sitemap and smoked live', () => {
  const app = read('frontend/src/App.jsx');
  const api = read('frontend/src/lib/api.js');
  for (const [path, el] of [['/newsletter', 'NewsletterPage'], ['/newsletter/confirm', 'NewsletterConfirmPage'], ['/newsletter/preferences', 'NewsletterPreferencesPage']]) {
    assert.match(app, new RegExp(`<Route path="${path}" element=\\{<${el} />\\} />`));
    assert.match(api, new RegExp(`currentPath === '${path}'`), `${path} never bounces to /login`);
    assert.match(read('scripts/check-spa-live.mjs'), new RegExp(`\\{ path: '${path}', shell: true \\}`));
  }
  assert.match(read('frontend/src/lib/ogRegistry.js'), /path: '\/newsletter',/);
  assert.match(read('frontend/public/sitemap.xml'), /<loc>https:\/\/axal\.vc\/newsletter<\/loc>/);
  assert.doesNotMatch(read('frontend/public/sitemap.xml'), /newsletter\/(confirm|preferences)/, 'the token pages are not for crawlers');
});

test('the public pages carry the D529 security headers: `_headers` covers them and the Worker does not take them', () => {
  const headers = read('frontend/public/_headers');
  const rules = headers.split('\n').filter((l) => !l.startsWith('#'));
  const all = rules.indexOf('/*');
  assert.ok(all >= 0, '`/*` is the rule every shell path matches');
  const end = rules.findIndex((l, i) => i > all && l.trim() && !/^\s/.test(l));
  const block = rules.slice(all + 1, end < 0 ? undefined : end);
  for (const h of ['Strict-Transport-Security', 'X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Referrer-Policy']) {
    assert.ok(block.some((l) => l.trim().startsWith(h)), `${h} on /*`);
  }
  assert.doesNotMatch(headers, /^\/newsletter/m, 'no rule of its own detaches a header from these paths');
  // The assets binding serves them only while no `run_worker_first` glob takes them.
  // `*` matches any run of characters; everything else is literal. No RegExp is built from the file.
  const globMatches = (glob, path) => {
    const [first, ...rest] = glob.split('*');
    if (!path.startsWith(first)) return false;
    if (!rest.length) return path === first;
    let at = first.length;
    for (const [i, part] of rest.entries()) {
      if (i === rest.length - 1) return path.length - part.length >= at && path.endsWith(part);
      const found = path.indexOf(part, at);
      if (found < 0) return false;
      at = found + part.length;
    }
    return true;
  };
  assert.ok(globMatches('/api/*', '/api/x') && globMatches('/mcp', '/mcp') && !globMatches('/mcp', '/mcp/x') && !globMatches('/api/*', '/newsletter'), 'the matcher reads a glob');
  const toml = read('wrangler.toml');
  const globs = [...toml.matchAll(/run_worker_first = \[([^\]]+)\]/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((g) => g[1]));
  assert.ok(globs.length >= 2, 'both tables were read');
  for (const path of ['/newsletter', '/newsletter/confirm', '/newsletter/preferences']) {
    for (const g of globs) assert.ok(!globMatches(g, path), `${g} would take ${path} from the assets binding and its headers`);
  }
});
