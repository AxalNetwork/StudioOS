/**
 * Task #6 (NICE-MKT-07), D680 — the public contact form's handler.
 *
 * Drives the real `contact` Hono app via app.request() with a mock env and a
 * real SQLite D1 (`_d1_sqlite.mjs`) built from migration 448 itself, so the
 * route's INSERT runs against the schema production will have.
 *
 * Since D680 a submission is stored in `contact_submissions` and emailed to
 * the firm's mailbox for its intent. It is never filed to GitHub: the
 * repository the route used to file to is public (D680, AGENTS.md). fetch is
 * stubbed for the Gmail calls and records every request, so a call to
 * api.github.com — or anywhere else — would show.
 *
 * Turnstile fails OPEN in non-production when TURNSTILE_SECRET_KEY is unset
 * (see services/turnstile.ts), so a valid submission reaches the store without
 * any network call of its own.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/contact.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import contact, {
  CONTACT_INTENTS, CONTACT_MAILBOX, contactIpHash, contactLink, contactMailbox, MAX_CONTACT_LINK,
} from '../src/routes/contact.ts';
import { makeD1 } from './_d1_sqlite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(resolve(HERE, '../sql/migrations/448_contact_submissions.sql'), 'utf8');
const ROUTE_SRC = readFileSync(resolve(HERE, '../src/routes/contact.ts'), 'utf8');

const VALID = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  subject: 'Partnership enquiry',
  message: 'This is a sufficiently long contact message.',
};

const ENQUIRY = {
  intent: 'lab',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  link: 'https://example.com/deck',
  message: 'We are building a difference engine and need a first customer.',
};

const IP = '203.0.113.7';
const SECRET = 'test-secret';
const MAIL_ENV = { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' };

type Row = Record<string, unknown>;
type Call = { url: string; body: string };

/**
 * One submission against a fresh store. `mail` gives the env Gmail credentials;
 * `gmailOk` is what the Gmail send answers. Every outbound request is recorded.
 */
async function submit(body: Record<string, unknown>, opts: { mail?: boolean; gmailOk?: boolean; db?: boolean } = {}) {
  const { mail = true, gmailOk = true, db: withDb = true } = opts;
  const { DB, db } = makeD1(SCHEMA);
  const env: Record<string, unknown> = { ENVIRONMENT: 'development', JWT_SECRET: SECRET, ...(withDb ? { DB } : {}), ...(mail ? MAIL_ENV : {}) };
  const calls: Call[] = [];
  const warnings: string[] = [];
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : String(init?.body ?? '') });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    if (url.startsWith('https://gmail.googleapis.com/')) return new Response('{}', { status: gmailOk ? 200 : 500 });
    return new Response('unexpected', { status: 599 });
  }) as unknown as typeof fetch;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try {
    const res = await contact.request('/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': IP, 'User-Agent': `Agent/${'x'.repeat(300)}` },
      body: JSON.stringify(body),
    }, env);
    const rows = db.prepare('SELECT * FROM contact_submissions').all() as Row[];
    return { res, json: (await res.json()) as Record<string, unknown>, rows, calls, warnings };
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }
}

/** The decoded raw message of each Gmail send. */
function mailsSent(calls: Call[]): string[] {
  return calls
    .filter((c) => c.url.startsWith('https://gmail.googleapis.com/'))
    .map((c) => {
      const raw = (JSON.parse(c.body) as { raw: string }).raw.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(raw, 'base64').toString('utf8');
    });
}
const recipient = (mail: string) => (mail.match(/^To: (.+)$/m) || [])[1];
/** Each base64 body part of a raw message, decoded. */
const parts = (mail: string) => [...mail.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)]
  .map((m) => Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8'));

test('honeypot submission returns 200 ok without storing or sending anything', async () => {
  const { res, json, rows, calls } = await submit({ ...ENQUIRY, hp: 'i-am-a-bot' });
  assert.equal(res.status, 200);
  assert.deepEqual(json, { ok: true });
  assert.equal(rows.length, 0);
  assert.equal(calls.length, 0);
});

test('missing required fields returns 400', async () => {
  const { res, rows } = await submit({ name: '', email: '', subject: '', message: '' });
  assert.equal(res.status, 400);
  assert.equal(rows.length, 0);
});

test('a submission that cannot be stored is refused, not dropped', async () => {
  const { res, json, calls } = await submit(ENQUIRY, { db: false });
  assert.equal(res.status, 500);
  assert.equal(json.code, 'store_failed');
  assert.equal(calls.length, 0, 'nothing is emailed for a row that does not exist');
});

// ---------------------------------------------------------------------------
// D680 (#1554) — the rebuilt /contact form sends an intent, a company and an
// optional link, and no subject.
// ---------------------------------------------------------------------------

test('D680: the intents are the three canvas pills plus Licence', () => {
  assert.deepEqual(Object.keys(CONTACT_INTENTS), ['lab', 'invest', 'advise', 'licence']);
  assert.deepEqual(Object.values(CONTACT_INTENTS), ['Spin-Out Lab', 'Investing / LP', 'Advising', 'Licence']);
});

test('D680: an intent outside the set is refused before anything is stored', async () => {
  const { res, json, rows, calls } = await submit({ ...ENQUIRY, intent: 'press' });
  assert.equal(res.status, 400);
  assert.equal(json.code, 'invalid_intent');
  assert.equal(rows.length, 0);
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
    const { res, json, rows } = await submit({ ...ENQUIRY, link: bad });
    assert.equal(res.status, 400, `${bad.slice(0, 30)} is refused`);
    assert.equal(json.code, 'invalid_link');
    assert.equal(rows.length, 0);
  }
});

test('D680: a valid submission is stored with every field and a hash of the IP, never the IP', async () => {
  const { res, json, rows } = await submit(ENQUIRY);
  assert.equal(res.status, 200);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(json.ok, true);
  assert.equal(json.reference, row.uid, 'the answer quotes the stored row');
  assert.equal(row.kind, 'contact');
  assert.equal(row.intent, 'lab');
  assert.equal(row.name, 'Ada Lovelace');
  assert.equal(row.email, 'ada@example.com');
  assert.equal(row.company, 'Analytical Engines');
  assert.equal(row.link, 'https://example.com/deck');
  assert.equal(row.subject, 'Spin-Out Lab — Analytical Engines', 'the subject is derived from the intent');
  assert.match(String(row.message), /difference engine/);
  assert.equal(String(row.user_agent).length, 200, 'the user agent is cut to 200 characters');

  assert.match(String(row.ip_hash), /^[0-9a-f]{64}$/, 'a SHA-256');
  assert.equal(row.ip_hash, await contactIpHash(SECRET, IP), 'salted with the secret and the day');
  assert.notEqual(row.ip_hash, await contactIpHash('', IP), 'the secret is part of the salt');
  for (const [col, v] of Object.entries(row)) {
    assert.ok(!String(v ?? '').includes(IP), `the raw IP is stored in ${col}`);
  }

  // The old shape (a subject, no intent) is stored as before.
  const old = await submit(VALID);
  assert.equal(old.res.status, 200);
  assert.equal(old.rows[0].subject, 'Partnership enquiry');
  assert.equal(old.rows[0].intent, null);
  // No intent and no subject is still a missing field.
  const bare = await submit({ ...ENQUIRY, intent: '' });
  assert.equal(bare.res.status, 400);
  assert.equal(bare.rows.length, 0);
});

test('D680: each submission is emailed to its intent\'s mailbox, with the fields', async () => {
  assert.deepEqual(CONTACT_MAILBOX, {
    lab: 'founders@axal.vc',
    invest: 'guillaume.lauzier@axal.vc',
    advise: 'network@axal.vc',
    licence: 'network@axal.vc',
  });
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ...ENQUIRY, intent: 'lab' }, 'founders@axal.vc'],
    [{ ...ENQUIRY, intent: 'invest' }, 'guillaume.lauzier@axal.vc'],
    [{ ...ENQUIRY, intent: 'advise' }, 'network@axal.vc'],
    [{ ...ENQUIRY, intent: 'licence' }, 'network@axal.vc'],
    [VALID, 'founders@axal.vc'],
    [{ ...VALID, kind: 'support' }, 'founders@axal.vc'],
    [{ ...ENQUIRY, intent: 'invest', kind: 'support' }, 'founders@axal.vc'],
  ];
  for (const [body, to] of cases) {
    const { res, rows, calls } = await submit(body);
    assert.equal(res.status, 200);
    const mails = mailsSent(calls);
    assert.equal(mails.length, 1, `one email for ${String(body.intent || body.kind || 'no intent')}`);
    assert.equal(recipient(mails[0]), to, `${String(body.intent || 'no intent')}/${String(body.kind || 'contact')} goes to ${to}`);
    assert.ok(rows[0].notified_at, 'the row records that the email went');
  }
  assert.equal(contactMailbox('', 'contact'), 'founders@axal.vc');

  const { calls } = await submit(ENQUIRY);
  const [text] = parts(mailsSent(calls)[0]);
  for (const field of ['Intent: Spin-Out Lab', 'From: Ada Lovelace <ada@example.com>', 'Company or project: Analytical Engines',
    'Link: https://example.com/deck', 'Subject: Spin-Out Lab — Analytical Engines', 'difference engine', 'Reference: ']) {
    assert.ok(text.includes(field), `the email lacks "${field}"`);
  }
});

test('D680: nothing goes to GitHub', async () => {
  for (const body of [ENQUIRY, VALID, { ...VALID, kind: 'support' }]) {
    const { calls } = await submit(body);
    assert.ok(calls.length > 0, 'the stub saw the mail calls');
    for (const c of calls) {
      // The parsed host, not a substring: github.com and every subdomain (api., uploads., …).
      const host = new URL(c.url).hostname;
      assert.ok(host !== 'github.com' && !host.endsWith('.github.com'), `a request went to ${c.url}`);
      assert.ok(/^https:\/\/(oauth2|gmail)\.googleapis\.com\//.test(c.url), `an unexpected request to ${c.url}`);
    }
  }
  assert.doesNotMatch(ROUTE_SRC.replace(/\/\*[\s\S]*?\*\//g, ''), /api\.github\.com|GITHUB_/,
    'the route neither calls GitHub nor reads a GitHub setting');
});

test('D680: with email off, the submission is still stored and answered 200, and the log names no one', async () => {
  const { res, json, rows, calls, warnings: all } = await submit(ENQUIRY, { mail: false });
  const warnings = all.filter((w) => w.startsWith('contact:'));
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].notified_at, null, 'an unsent row is findable');
  assert.equal(calls.length, 0, 'no credentials, no request');
  assert.equal(warnings.length, 1, 'the missing email is logged');
  for (const personal of ['Ada', 'ada@example.com', 'Analytical', IP, 'example.com/deck']) {
    assert.ok(!warnings[0].includes(personal), `the warning carries "${personal}"`);
  }

  // A Gmail failure is the same: stored, answered, not stamped.
  const failed = await submit(ENQUIRY, { gmailOk: false });
  assert.equal(failed.res.status, 200);
  assert.equal(failed.rows.length, 1);
  assert.equal(failed.rows[0].notified_at, null);
  assert.equal(mailsSent(failed.calls).length, 1, 'the send was attempted');
});
