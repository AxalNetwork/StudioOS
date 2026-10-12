/**
 * Task #6 (NICE-MKT-07) — Contact form → GitHub Issue handler guards.
 *
 * Drives the real `contact` Hono app via app.request() with a mock env.
 * The live GitHub round-trip cannot be exercised in CI (the
 * GITHUB_ISSUES_TOKEN secret only exists in the prod Worker), so these
 * lock in the two honest, offline-verifiable paths plus input validation:
 *   (a) honeypot filled  → 200 {ok:true}, returns BEFORE any GitHub/env read
 *   (b) valid submission with no GITHUB_ISSUES_TOKEN → 503 github_token_missing
 *   (c) missing required fields → 400
 *
 * D680 adds the rebuilt form's fields (intent, company, link) below, with
 * fetch stubbed so the issue the route would file can be read.
 *
 * Turnstile fails OPEN in non-production when TURNSTILE_SECRET_KEY is unset
 * (see services/turnstile.ts), so (b) reaches the token check without any
 * network call.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/contact.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import contact, { CONTACT_INTENTS, contactLink, MAX_CONTACT_LINK } from '../src/routes/contact.ts';

const VALID = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  subject: 'Partnership enquiry',
  message: 'This is a sufficiently long contact message.',
};

function post(body: Record<string, unknown>, env: Record<string, unknown> = {}) {
  return contact.request(
    '/contact',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

test('honeypot submission returns 200 ok without creating an issue', async () => {
  const res = await post({ ...VALID, hp: 'i-am-a-bot' }, {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('valid submission with no GitHub token returns 503 github_token_missing', async () => {
  const res = await post(VALID, { ENVIRONMENT: 'development' });
  assert.equal(res.status, 503);
  const json = (await res.json()) as { code?: string };
  assert.equal(json.code, 'github_token_missing');
});

test('missing required fields returns 400', async () => {
  const res = await post({ name: '', email: '', subject: '', message: '' }, { ENVIRONMENT: 'development' });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// D680 (#1554) — the rebuilt /contact form sends an intent, a company and an
// optional link, and no subject. These pin what the route accepts and refuses,
// and what reaches the issue it files.
// ---------------------------------------------------------------------------
const ENQUIRY = {
  intent: 'lab',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  link: 'https://example.com/deck',
  message: 'We are building a difference engine and need a first customer.',
};

const GH_ENV = {
  ENVIRONMENT: 'development',
  GITHUB_ISSUES_TOKEN: 'test-token',
  GITHUB_REPO_OWNER: 'o',
  GITHUB_REPO_NAME: 'r',
};

/** Run one submission with fetch stubbed, returning the response and the issue it would file. */
async function postCapturing(body: Record<string, unknown>) {
  const realFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: { title: string; body: string; labels: string[] } }> = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/o/r/issues/7' }), { status: 201 });
  }) as unknown as typeof fetch;
  try {
    const res = await post(body, GH_ENV);
    return { res, calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('D680: the intents are the three canvas pills plus Licence', () => {
  assert.deepEqual(Object.keys(CONTACT_INTENTS), ['lab', 'invest', 'advise', 'licence']);
  assert.deepEqual(Object.values(CONTACT_INTENTS), ['Spin-Out Lab', 'Investing / LP', 'Advising', 'Licence']);
});

test('D680: an intent outside the set is refused before any issue is filed', async () => {
  const { res, calls } = await postCapturing({ ...ENQUIRY, intent: 'press' });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code?: string }).code, 'invalid_intent');
  assert.equal(calls.length, 0);
});

test('D680: a link must be an http(s) URL of at most 500 characters', async () => {
  assert.equal(contactLink(undefined), '');
  assert.equal(contactLink('   '), '');
  assert.equal(contactLink('https://example.com/a b'), 'https://example.com/a%20b');
  assert.equal(contactLink('http://example.com'), 'http://example.com/');
  for (const bad of ['javascript:alert(1)', 'ftp://example.com/x', 'example.com', 'mailto:a@b.co', 42]) {
    assert.equal(contactLink(bad), null, `${String(bad)} is not an http(s) link`);
  }
  const head = 'https://example.com/';
  assert.equal(MAX_CONTACT_LINK, 500);
  assert.equal(contactLink(head + 'a'.repeat(500 - head.length)), head + 'a'.repeat(500 - head.length), '500 characters is allowed');
  assert.equal(contactLink(head + 'a'.repeat(501 - head.length)), null, '501 characters is refused, not truncated');
  for (const bad of ['javascript:alert(1)', 'https://example.com/' + 'a'.repeat(600)]) {
    const { res, calls } = await postCapturing({ ...ENQUIRY, link: bad });
    assert.equal(res.status, 400, `${bad.slice(0, 30)} is refused`);
    assert.equal(((await res.json()) as { code?: string }).code, 'invalid_link');
    assert.equal(calls.length, 0);
  }
});

test('D680: an enquiry with no subject files an issue titled by its intent, carrying company and link', async () => {
  const { res, calls } = await postCapturing(ENQUIRY);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  const issue = calls[0].body;
  assert.equal(issue.title, '[contact-form] Spin-Out Lab — Analytical Engines');
  assert.match(issue.body, /\*\*Intent:\*\* Spin-Out Lab/);
  assert.match(issue.body, /\*\*Company or project:\*\* Analytical Engines/);
  assert.match(issue.body, /\*\*Link:\*\* https:\/\/example\.com\/deck/);
  assert.match(issue.body, /difference engine/);
  assert.deepEqual(issue.labels, ['contact-form']);

  // Licence is a real intent; with no company the title names the sender.
  const licence = await postCapturing({ ...ENQUIRY, intent: 'licence', company: '', link: '' });
  assert.equal(licence.res.status, 200);
  assert.equal(licence.calls[0].body.title, '[contact-form] Licence — Ada Lovelace');
  assert.doesNotMatch(licence.calls[0].body.body, /\*\*Link:\*\*|\*\*Company/);
});

test('D680: the old shape (subject, no intent) still files as before', async () => {
  const { res, calls } = await postCapturing(VALID);
  assert.equal(res.status, 200);
  assert.equal(calls[0].body.title, '[contact-form] Partnership enquiry');
  assert.doesNotMatch(calls[0].body.body, /\*\*Intent:\*\*/);
  // No intent and no subject is still a missing field.
  const { res: bare } = await postCapturing({ ...ENQUIRY, intent: '' });
  assert.equal(bare.status, 400);
});

test('D680: the honeypot still answers ok without filing, even with the new fields', async () => {
  const { res, calls } = await postCapturing({ ...ENQUIRY, hp: 'bot' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(calls.length, 0);
});
