/**
 * D680 (#1554) — `POST /api/public/demo-request` stores the request and emails
 * the team. It never files it to GitHub: the repository the route used to file
 * to is public, and the request carries the lead's name, email and message.
 *
 * Drives the real `public` Hono app with a real SQLite D1 and an execution
 * context that keeps every waitUntil promise, so the out-of-band work is
 * awaited before anything is asserted. fetch is stubbed for the Gmail calls
 * and records every request; GITHUB_TOKEN and GITHUB_REPO are set, so a call
 * to api.github.com would show.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/demo_request_d680.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './_d1_sqlite.mjs';
import publicRoutes, { DEMO_MAILBOX } from '../src/routes/public.ts';
import { CONTACT_MAILBOX, DEFAULT_CONTACT_MAILBOX } from '../src/routes/contact.ts';

const SCHEMA = `
  CREATE TABLE demo_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, name TEXT NOT NULL,
    email TEXT NOT NULL, company TEXT, message TEXT, github_issue_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;
const LEAD = { name: 'Ada Lovelace', email: 'ada@example.com', company: 'Analytical Engines', message: 'We would like a walkthrough.' };
const MAIL_ENV = { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' };
const GITHUB_ENV = { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'AxalNetwork/StudioOS' };

type Call = { url: string; body: string };

async function request(topic: string, opts: { mail?: boolean } = {}) {
  const { DB, db } = makeD1(SCHEMA);
  const env = { ENVIRONMENT: 'development', DB, ...GITHUB_ENV, ...(opts.mail === false ? {} : MAIL_ENV) };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException: () => {} };
  const calls: Call[] = [];
  const warnings: string[] = [];
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : String(init?.body ?? '') });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    if (url.startsWith('https://gmail.googleapis.com/')) return new Response('{"id":"m"}', { status: 200 });
    if (url.startsWith('https://api.github.com/')) return new Response(JSON.stringify({ html_url: 'https://github.com/x/y/issues/1' }), { status: 201 });
    return new Response('unexpected', { status: 599 });
  }) as unknown as typeof fetch;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try {
    const res = await publicRoutes.request('/demo-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic, ...LEAD }),
    }, env, ctx as any);
    const json = await res.json() as Record<string, unknown>;
    await Promise.all(pending);
    const rows = db.prepare('SELECT * FROM demo_requests').all() as Record<string, unknown>[];
    return { res, json, rows, calls, warnings };
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
/** A request to GitHub by its parsed host (github.com or any subdomain), not by a substring of the URL. */
const toGitHub = (url: string) => { const host = new URL(url).hostname; return host === 'github.com' || host.endsWith('.github.com'); };

test('a demo request is stored, emailed to the team, and never sent to GitHub', async () => {
  const { res, json, rows, calls } = await request('product');
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, LEAD.email);
  assert.equal(rows[0].github_issue_url, null);
  assert.equal(calls.filter((c) => toGitHub(c.url)).length, 0, 'no request reaches GitHub, even with a token set');
  const to = mailsSent(calls).map(recipient);
  assert.ok(to.includes(LEAD.email), 'the lead gets the confirmation');
  assert.ok(to.includes(DEFAULT_CONTACT_MAILBOX), 'the team gets the request');
});

test('each topic goes to the contact form\'s mailbox for it', async () => {
  assert.deepEqual(DEMO_MAILBOX, {
    product: DEFAULT_CONTACT_MAILBOX,
    investor: CONTACT_MAILBOX.invest,
    partnership: CONTACT_MAILBOX.advise,
  });
  for (const topic of ['investor', 'partnership']) {
    const { calls } = await request(topic);
    const team = mailsSent(calls).filter((m) => recipient(m) !== LEAD.email);
    assert.deepEqual(team.map(recipient), [DEMO_MAILBOX[topic]], `${topic} reaches its mailbox only`);
  }
});

test('without mail credentials the request is still stored and the log names no one', async () => {
  const { res, rows, calls, warnings } = await request('product', { mail: false });
  assert.equal(res.status, 200);
  assert.equal(rows.length, 1);
  assert.equal(calls.length, 0);
  const warning = warnings.find((w) => w.includes('demo_requests'));
  assert.ok(warning, 'an unsent team email is logged');
  assert.doesNotMatch(warning!, /ada|Lovelace|Analytical/i, 'the log carries the reference, not the lead');
});
