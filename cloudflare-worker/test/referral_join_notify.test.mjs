/**
 * Task #10 — When attachReferral() stamps referral_invites.status='joined',
 * the inviter must receive a one-time "X just joined via your invite"
 * notification. Throttle: once per joined-recipient per inviter row.
 *
 * Tests `fireJoinedInviteNotifications` (the helper attachReferral calls
 * after the joined-stamp UPDATE). Extracted from network.ts via the same
 * string-extract + `new Function` pattern used by projects.test.mjs so we
 * exercise the EXACT source bytes that ship to Cloudflare.
 *
 *   1. first call fires one notify() per matching invite
 *   2. second call (same recipient) fires nothing — joined_notified_at
 *      idempotency guard
 *   3. notify() throwing does not bubble out of attachReferral's caller
 *
 * Run with:  node --test cloudflare-worker/test/referral_join_notify.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* In-memory D1 stub — supports the exact statements the helper runs. */
/* ------------------------------------------------------------------ */
function makeDB(initial) {
  const state = {
    users: [...(initial.users || [])],
    invites: [...(initial.invites || [])],
    log: [],
  };
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function prepare(rawSql) {
    const sql = norm(rawSql);
    let bindings = [];
    return {
      bind(...args) { bindings = args; return this; },
      async first() {
        state.log.push({ sql, bindings, kind: 'first' });
        if (/^SELECT id, email, COALESCE\(name, email\) AS name FROM users WHERE id = \?$/i.test(sql)) {
          const [id] = bindings;
          const u = state.users.find(x => x.id === id);
          return u ? { id: u.id, email: u.email, name: u.name || u.email } : null;
        }
        throw new Error(`Unhandled D1 .first(): ${sql}`);
      },
      async all() {
        state.log.push({ sql, bindings, kind: 'all' });
        if (/^SELECT id, sender_user_id FROM referral_invites WHERE LOWER\(recipient_email\) = LOWER\(\?\) AND status = 'joined' AND signed_up_user_id = \? AND joined_notified_at IS NULL LIMIT 50$/i.test(sql)) {
          const [email, signedUpId] = bindings;
          const matched = state.invites.filter(i =>
            String(i.recipient_email).toLowerCase() === String(email).toLowerCase() &&
            i.status === 'joined' &&
            i.signed_up_user_id === signedUpId &&
            i.joined_notified_at == null
          );
          return { results: matched.map(i => ({ id: i.id, sender_user_id: i.sender_user_id })) };
        }
        throw new Error(`Unhandled D1 .all(): ${sql}`);
      },
      async run() {
        state.log.push({ sql, bindings, kind: 'run' });
        if (/^UPDATE referral_invites SET joined_notified_at = CURRENT_TIMESTAMP WHERE id = \? AND joined_notified_at IS NULL$/i.test(sql)) {
          const [id] = bindings;
          const inv = state.invites.find(x => x.id === id);
          if (inv && inv.joined_notified_at == null) {
            inv.joined_notified_at = new Date().toISOString();
          }
          return { meta: { changes: inv ? 1 : 0 } };
        }
        if (/^ALTER TABLE referral_invites ADD COLUMN joined_notified_at TIMESTAMP$/i.test(sql)) {
          return { meta: { changes: 0 } };
        }
        throw new Error(`Unhandled D1 .run(): ${sql}`);
      },
    };
  }
  return { state, DB: { prepare } };
}

/* ------------------------------------------------------------------ */
/* Extract the helper out of network.ts and evaluate it standalone.    */
/* ------------------------------------------------------------------ */
async function loadHelper(notifyImpl) {
  const srcPath = resolve(__dirname, '../src/routes/network.ts');
  const src = await readFile(srcPath, 'utf8');
  const startMarker = 'async function fireJoinedInviteNotifications(';
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, 'fireJoinedInviteNotifications not found in network.ts');
  // Walk braces to find the matching closing `}`.
  const openIdx = src.indexOf('{', start);
  let depth = 0;
  let i = openIdx;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  let body = src.slice(start, i);
  // Strip TS type annotations from the function signature + locals.
  body = body
    .replace(/: Promise<void>/g, '')
    .replace(/: Env/g, '')
    .replace(/: number/g, '')
    .replace(/:\s*any\[\]\s*=/g, ' =')
    .replace(/:\s*any/g, '')
    .replace(/ as any/g, '');
  // Replace the dynamic notify import with our injected stub.
  body = body.replace(
    /const \{ notify \} = await import\('\.\.\/services\/notify'\);/,
    'const notify = __notifyStub;'
  );
  const wrapped = `return (async function(){ ${body}; return fireJoinedInviteNotifications; })();`;
  return await new Function('__notifyStub', wrapped)(notifyImpl);
}

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */
test('fires one notify per matching invite on first call', async () => {
  const calls = [];
  const fn = await loadHelper(async (_env, args) => { calls.push(args); });
  const { DB, state } = makeDB({
    users: [{ id: 99, email: 'new@example.com', name: 'Newby' }],
    invites: [
      { id: 1, sender_user_id: 7,  recipient_email: 'New@Example.com', status: 'joined', signed_up_user_id: 99, joined_notified_at: null },
      { id: 2, sender_user_id: 12, recipient_email: 'new@example.com', status: 'joined', signed_up_user_id: 99, joined_notified_at: null },
    ],
  });

  await fn({ DB }, 99);

  assert.equal(calls.length, 2, 'one notify per inviter');
  const ids = calls.map(c => c.userId).sort((a, b) => a - b);
  assert.deepEqual(ids, [7, 12]);
  for (const a of calls) {
    assert.equal(a.type, 'referral_invite_joined');
    assert.equal(a.category, 'proactive_nudges');
    assert.equal(a.link, '/referrals');
    assert.match(a.title, /Newby just joined/);
    assert.deepEqual(a.channels, ['in_app', 'email']);
    assert.equal(a.payload.joined_user_id, 99);
  }
  // Both invites stamped.
  assert.ok(state.invites.every(i => i.joined_notified_at != null));
});

test('idempotent — second call after stamp fires nothing', async () => {
  const calls = [];
  const fn = await loadHelper(async (_env, args) => { calls.push(args); });
  const { DB, state } = makeDB({
    users: [{ id: 5, email: 'a@b.co', name: 'A' }],
    invites: [
      { id: 1, sender_user_id: 8, recipient_email: 'a@b.co', status: 'joined', signed_up_user_id: 5, joined_notified_at: null },
    ],
  });

  await fn({ DB }, 5);
  assert.equal(calls.length, 1);

  // Re-run — invite is now stamped, so nothing should fire.
  await fn({ DB }, 5);
  assert.equal(calls.length, 1, 'second call must not re-notify');
  assert.equal(state.invites[0].joined_notified_at != null, true);
});

test('notify() throwing does not bubble (caller wraps in try/catch)', async () => {
  const fn = await loadHelper(async () => { throw new Error('webpush down'); });
  const { DB, state } = makeDB({
    users: [{ id: 3, email: 'x@y.com', name: 'X' }],
    invites: [
      { id: 1, sender_user_id: 4, recipient_email: 'x@y.com', status: 'joined', signed_up_user_id: 3, joined_notified_at: null },
    ],
  });
  // Helper itself swallows notify() throws — should resolve, not reject.
  await fn({ DB }, 3);
  // Stamp still applied so we don't retry forever on a flaky channel.
  assert.equal(state.invites[0].joined_notified_at != null, true);
});

test('skips when recipient user has no email row', async () => {
  const calls = [];
  const fn = await loadHelper(async (_e, a) => { calls.push(a); });
  const { DB } = makeDB({ users: [], invites: [] });
  await fn({ DB }, 999);
  assert.equal(calls.length, 0);
});

test('does not self-notify if invite somehow points sender at the new user', async () => {
  const calls = [];
  const fn = await loadHelper(async (_e, a) => { calls.push(a); });
  const { DB } = makeDB({
    users: [{ id: 42, email: 'self@me.io', name: 'Me' }],
    invites: [
      { id: 1, sender_user_id: 42, recipient_email: 'self@me.io', status: 'joined', signed_up_user_id: 42, joined_notified_at: null },
    ],
  });
  await fn({ DB }, 42);
  assert.equal(calls.length, 0);
});
