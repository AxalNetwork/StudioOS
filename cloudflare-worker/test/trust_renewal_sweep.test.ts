/**
 * Task #163 — the renewal sweep, and the one property it exists for.
 *
 * THE WHOLE DIFFICULTY IS NOT SENDING TWICE. `notify()` has no idempotency
 * of any kind; a nightly caller that simply asked "what expires soon?" would
 * write the same warning into the same inbox every night for thirty nights.
 * The claim table is the memory and `INSERT OR IGNORE` is the decision, so
 * the test that matters most is the boring one: run it twice, nothing goes
 * out the second time.
 *
 * The D1 stand-in below READS ITS BEHAVIOUR OFF THE SQL — the status
 * predicate, the horizon comparison, the conflict clause. That is not
 * ceremony: `trust_provenance_history.test.ts` shipped with a fake that
 * hardcoded `user_id ===`, and a mutation widening the real query to
 * `user_id >= ?` — a genuine cross-account leak — failed nothing.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/trust_renewal_sweep.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  renewalSweep, renewalThresholdFor, daysUntil, renewalDigest,
  renewalItemLine, obligationLabel, RENEWAL_THRESHOLDS, OBLIGATION_LABELS,
} from '../src/services/trust.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const NOW = new Date('2026-09-12T04:15:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

type Oblig = { id: number; user_id: number; obligation_key: string; status: string; expires_at: string | null };
type Nda = { id: number; party_a_user_id: number; party_b_user_id: number; status: string; valid_until: string | null };
type Claim = { user_id: number; subject_kind: string; subject_id: number; threshold_days: number; expires_at: string };

/**
 * This stand-in evaluates a CONJUNCTION — it pulls each `AND` clause out by
 * regex and applies them all. Handed a disjunction it would quietly report
 * the conjunctive answer, which is how `AND expires_at <= ? OR 1=1` first
 * slipped past the horizon test looking perfectly bounded. A fake that
 * cannot model a query must say so rather than guess.
 */
function refuseDisjunction(sql: string): void {
  const where = sql.slice(sql.search(/\bWHERE\b/i));
  if (/\bOR\b/i.test(where)) {
    throw new Error(`this stand-in only evaluates AND-chains; the query has an OR: ${where.trim()}`);
  }
}

/**
 * A D1 stand-in over three in-memory tables. Every predicate the sweep
 * depends on is parsed out of the statement it was handed, so changing the
 * query changes what this returns.
 */
function fakeDb(seed: { obligations?: Oblig[]; ndas?: Nda[]; claims?: Claim[] } = {}, opts: {
  failObligations?: boolean; failNdas?: boolean; failClaims?: boolean;
} = {}) {
  const obligations = seed.obligations || [];
  const ndas = seed.ndas || [];
  const claims: Claim[] = seed.claims ? [...seed.claims] : [];
  const sqls: string[] = [];

  const env: any = {
    DB: {
      prepare(sql: string) {
        sqls.push(sql);
        let bound: any[] = [];
        const isOblig = /FROM legal_obligations/i.test(sql);
        const isNda = /FROM pairwise_ndas/i.test(sql);
        const ins = /INSERT\s+OR\s+(IGNORE|REPLACE)\s+INTO\s+renewal_notices/i.exec(sql);
        return {
          bind(...a: any[]) { bound = a; return this; },
          async run() {
            if (!ins) {
              // ensureTrustSchema's CREATEs land here; they are no-ops.
              if (/^\s*CREATE/i.test(sql)) return { meta: { changes: 0 } };
              throw new Error(`unexpected run() on: ${sql.slice(0, 80)}`);
            }
            if (opts.failClaims) throw new Error('D1_ERROR: claim write failed');
            const [user_id, subject_kind, subject_id, threshold_days, expires_at] = bound;
            // The UNIQUE index, evaluated on the columns the migration
            // actually names — including user_id, so a two-party NDA is not
            // collapsed into one claim.
            const clash = claims.some(c =>
              c.user_id === user_id && c.subject_kind === subject_kind
              && c.subject_id === subject_id && c.threshold_days === threshold_days
              && c.expires_at === expires_at);
            if (clash && ins[1].toUpperCase() === 'IGNORE') return { meta: { changes: 0 } };
            if (!clash) claims.push({ user_id, subject_kind, subject_id, threshold_days, expires_at });
            return { meta: { changes: 1 } };
          },
          async all() {
            if (isOblig) {
              if (opts.failObligations) throw new Error('D1_ERROR: obligation scan failed');
              refuseDisjunction(sql);
              // Predicates read off the SQL, not assumed.
              const status = (/status\s*=\s*'([a-z_]+)'/.exec(sql) || [])[1];
              const wantsNotNull = /expires_at IS NOT NULL/i.test(sql);
              const lower = /expires_at\s*(>=|>)\s*\?/.exec(sql);
              const upper = /expires_at\s*(<=|<)\s*\?/.exec(sql);
              const [lo, hi] = bound;
              return {
                results: obligations.filter(o => {
                  if (status && o.status !== status) return false;
                  if (wantsNotNull && o.expires_at == null) return false;
                  if (o.expires_at == null) return false;
                  if (lower && !(lower[1] === '>' ? o.expires_at > lo : o.expires_at >= lo)) return false;
                  if (upper && !(upper[1] === '<' ? o.expires_at < hi : o.expires_at <= hi)) return false;
                  return true;
                }),
              };
            }
            if (isNda) {
              if (opts.failNdas) throw new Error('D1_ERROR: nda scan failed');
              refuseDisjunction(sql);
              const status = (/status\s*=\s*'([a-z_]+)'/.exec(sql) || [])[1];
              const lower = /valid_until\s*(>=|>)\s*\?/.exec(sql);
              const upper = /valid_until\s*(<=|<)\s*\?/.exec(sql);
              const [lo, hi] = bound;
              return {
                results: ndas.filter(n => {
                  if (status && n.status !== status) return false;
                  if (n.valid_until == null) return false;
                  if (lower && !(lower[1] === '>' ? n.valid_until > lo : n.valid_until >= lo)) return false;
                  if (upper && !(upper[1] === '<' ? n.valid_until < hi : n.valid_until <= hi)) return false;
                  return true;
                }),
              };
            }
            throw new Error(`unexpected all() on: ${sql.slice(0, 80)}`);
          },
        };
      },
    },
  };
  const sent: any[] = [];
  const notify = async (_e: any, a: any) => { sent.push(a); return 1; };
  return { env, notify, sent, claims, sqls };
}

const oblig = (id: number, user_id: number, days: number, key = 'kyc_v1', status = 'satisfied'): Oblig =>
  ({ id, user_id, obligation_key: key, status, expires_at: inDays(days) });

// ---------------------------------------------------------------------------
// The thresholds

test('a deadline maps to the SMALLEST threshold it has crossed', () => {
  // Not the nearest. A sweep that misses a night would otherwise skip that
  // threshold forever, because the next run finds the item already past it.
  assert.equal(renewalThresholdFor(31), null);
  assert.equal(renewalThresholdFor(30), 30);
  assert.equal(renewalThresholdFor(20), 30);
  assert.equal(renewalThresholdFor(15), 30);
  assert.equal(renewalThresholdFor(14), 14);
  assert.equal(renewalThresholdFor(13), 14);   // the missed-14-run case
  assert.equal(renewalThresholdFor(8), 14);
  assert.equal(renewalThresholdFor(7), 7);
  assert.equal(renewalThresholdFor(1), 7);
  assert.equal(renewalThresholdFor(0), 7);
});

test('a past deadline and a junk one get no threshold at all', () => {
  // Past due is `expireDueArtifacts`'s business, not a warning's.
  assert.equal(renewalThresholdFor(-1), null);
  assert.equal(renewalThresholdFor(NaN), null);
  assert.equal(renewalThresholdFor(Infinity), null);
});

test('the thresholds are three, descending, and the first is the horizon', () => {
  assert.deepEqual([...RENEWAL_THRESHOLDS], [30, 14, 7]);
  // The sweep's SELECT window is built from RENEWAL_THRESHOLDS[0]; if that
  // stopped being the largest, rows would be filtered out before the
  // threshold logic ever saw them.
  assert.equal(Math.max(...RENEWAL_THRESHOLDS), RENEWAL_THRESHOLDS[0]);
});

test('daysUntil floors, and refuses what it cannot parse', () => {
  assert.equal(daysUntil(inDays(7), NOW), 7);
  // 7 days and 23 hours is still "7 days left", not 8.
  assert.equal(daysUntil(new Date(NOW.getTime() + 7 * 86_400_000 + 82_800_000).toISOString(), NOW), 7);
  assert.equal(daysUntil(inDays(-3), NOW), -3);
  assert.equal(daysUntil('not a date', NOW), null);
  assert.equal(daysUntil('', NOW), null);
});

// ---------------------------------------------------------------------------
// THE POINT OF THE TASK

test('a second run the same night sends NOTHING', async () => {
  const db = fakeDb({ obligations: [oblig(1, 7, 10)] });
  const first = await renewalSweep(db.env, NOW, { notify: db.notify });
  assert.equal(first.notified, 1, 'the first run must actually warn');
  assert.equal(first.claimed, 1);

  const second = await renewalSweep(db.env, NOW, { notify: db.notify });
  assert.equal(second.claimed, 0, 'the second run claimed something');
  assert.equal(second.notified, 0, 'THE SAME WARNING WENT OUT TWICE');
  assert.equal(db.sent.length, 1);
});

test('30 then 14 then 7 each go out once, and a fourth pass is silent', async () => {
  const expires = inDays(30);
  const obligations: Oblig[] = [{ id: 1, user_id: 7, obligation_key: 'kyc_v1', status: 'satisfied', expires_at: expires }];
  const db = fakeDb({ obligations });
  const at = (d: Date) => renewalSweep(db.env, d, { notify: db.notify });

  const back = (days: number) => new Date(Date.parse(expires) - days * 86_400_000);
  assert.equal((await at(back(30))).notified, 1, '30-day warning');
  assert.equal((await at(back(29))).notified, 0, 'still inside the 30-day claim');
  assert.equal((await at(back(14))).notified, 1, '14-day warning');
  assert.equal((await at(back(9))).notified, 0, 'still inside the 14-day claim');
  assert.equal((await at(back(7))).notified, 1, '7-day warning');
  assert.equal((await at(back(3))).notified, 0, 'then silence');
  assert.equal((await at(back(1))).notified, 0, 'then silence');
  assert.equal(db.sent.length, 3, `expected exactly three notices, got ${db.sent.length}`);
});

test('a renewed deadline re-arms all three', async () => {
  // Without `expires_at` in the claim key an item warned once could never be
  // warned again for the rest of its life — the opposite of a renewal notice.
  const row: Oblig = { id: 1, user_id: 7, obligation_key: 'kyc_v1', status: 'satisfied', expires_at: inDays(7) };
  const db = fakeDb({ obligations: [row] });
  assert.equal((await renewalSweep(db.env, NOW, { notify: db.notify })).notified, 1);
  assert.equal((await renewalSweep(db.env, NOW, { notify: db.notify })).notified, 0);

  // BACK TO THE SAME THRESHOLD, deliberately. The first draft renewed into a
  // 30-day window after a 7-day warning, so the new claim differed by
  // `threshold_days` and sent whether or not `expires_at` was in the key —
  // it proved nothing about the field it existed to test. Re-arming at 7
  // days again is the case only `expires_at` can distinguish.
  row.expires_at = inDays(400);                              // renewed
  const later = new Date(NOW.getTime() + 393 * 86_400_000);  // 7 days out again
  assert.equal(daysUntil(row.expires_at, later), 7, 'the fixture is not back at the 7-day threshold');
  assert.equal((await renewalSweep(db.env, later, { notify: db.notify })).notified, 1,
    'the renewed term never warns — `expires_at` is not in the claim key');
});

// ---------------------------------------------------------------------------
// Who gets warned about what

test('only the rows expireDueArtifacts would flip are ever warned about', async () => {
  // The predicate is copied from the expiry sweep on purpose. If the warning
  // and the expiry disagreed, someone would be warned about an item that
  // never lapses — or lapse with no warning.
  const db = fakeDb({
    obligations: [
      oblig(1, 7, 10, 'kyc_v1', 'satisfied'),   // warned
      oblig(2, 7, 10, 'kyb_v1', 'waived'),      // admin-cleared: never lapses
      oblig(3, 7, 10, 'tos_v1', 'pending'),     // not satisfied: nothing to lose
      oblig(4, 7, 10, 'privacy_v1', 'expired'), // already gone
      oblig(5, 7, 10, 'accreditation_v1', 'in_review'),
    ],
    ndas: [
      { id: 1, party_a_user_id: 7, party_b_user_id: 8, status: 'active', valid_until: inDays(10) },
      { id: 2, party_a_user_id: 7, party_b_user_id: 9, status: 'revoked', valid_until: inDays(10) },
      { id: 3, party_a_user_id: 7, party_b_user_id: 9, status: 'expired', valid_until: inDays(10) },
    ],
  });
  await renewalSweep(db.env, NOW, { notify: db.notify });
  const labels = db.sent.flatMap(s => s.payload.items.map((i: any) => i.label));
  assert.deepEqual(labels.sort(), ['Identity verification (KYC)', 'Mutual NDA', 'Mutual NDA'].sort());

  // And the premise, in the expiry sweep itself.
  const svc = read('cloudflare-worker/src/services/trust.ts');
  assert.match(svc, /UPDATE legal_obligations[\s\S]{0,200}?WHERE status = 'satisfied'/,
    'expireDueArtifacts no longer flips only satisfied obligations — the warning predicate must follow it');
  assert.match(svc, /UPDATE pairwise_ndas[\s\S]{0,200}?WHERE status = 'active'/,
    'expireDueArtifacts no longer flips only active NDAs — the warning predicate must follow it');
});

test('BOTH parties to an NDA are warned, and neither claim swallows the other', async () => {
  // One row, two people who lose cover. `user_id` is in the unique key for
  // exactly this — keyed on the subject alone, party A's claim would have
  // silently eaten party B's warning.
  const db = fakeDb({
    ndas: [{ id: 1, party_a_user_id: 7, party_b_user_id: 8, status: 'active', valid_until: inDays(10) }],
  });
  const r = await renewalSweep(db.env, NOW, { notify: db.notify });
  assert.equal(r.claimed, 2);
  assert.deepEqual(db.sent.map(s => s.userId).sort(), [7, 8]);
});

test('nothing outside the 30-day horizon is warned about', async () => {
  const db = fakeDb({ obligations: [oblig(1, 7, 31), oblig(2, 7, 400)] });
  const r = await renewalSweep(db.env, NOW, { notify: db.notify });
  assert.equal(r.scanned, 0, 'the SELECT is not bounding the horizon');
  assert.equal(db.sent.length, 0);
  // TWO GATES, and only one of them is load-bearing. `renewalThresholdFor`
  // is what decides — a row 31 days out gets no threshold and is dropped
  // even if the query hands it over. The SELECT's upper bound is there so
  // the sweep reads a night's worth of rows instead of the whole table, so
  // it is asserted against the SQL rather than inferred from the result.
  const svc = read('cloudflare-worker/src/services/trust.ts');
  const sweep = svc.slice(svc.indexOf('export async function renewalSweep'));
  assert.match(sweep, /AND expires_at <= \?/, 'the obligation scan no longer bounds its horizon');
  assert.match(sweep, /AND valid_until <= \?/, 'the NDA scan no longer bounds its horizon');
  assert.equal(renewalThresholdFor(31), null, 'the real gate stopped gating');
});

test('one person with four expiring items gets ONE notice', async () => {
  // The "bulk" in the task: batched per recipient. Four separate messages is
  // what makes people turn compliance mail off.
  const db = fakeDb({
    obligations: [
      oblig(1, 7, 3, 'kyc_v1'), oblig(2, 7, 5, 'kyb_v1'),
      oblig(3, 7, 12, 'investor_nda_v1'), oblig(4, 7, 28, 'accreditation_v1'),
    ],
  });
  const r = await renewalSweep(db.env, NOW, { notify: db.notify });
  assert.equal(r.claimed, 4);
  assert.equal(db.sent.length, 1, `four items produced ${db.sent.length} notices`);
  assert.equal(db.sent[0].payload.items.length, 4);
});

test("two people never appear in each other's notice", async () => {
  const db = fakeDb({
    obligations: [oblig(1, 7, 5, 'kyc_v1'), oblig(2, 8, 5, 'kyb_v1')],
  });
  await renewalSweep(db.env, NOW, { notify: db.notify });
  assert.equal(db.sent.length, 2);
  const forSeven = db.sent.find(s => s.userId === 7);
  const forEight = db.sent.find(s => s.userId === 8);
  assert.equal(forSeven.payload.items.length, 1);
  assert.equal(forEight.payload.items.length, 1);
  assert.match(forSeven.body, /Identity verification/);
  assert.doesNotMatch(forSeven.body, /Entity verification/,
    "another account's obligation leaked into this notice");
});

// ---------------------------------------------------------------------------
// What the notice says

test('the notice routes through the digest, not around it', async () => {
  // An omitted or critical category bypasses quiet hours AND the digest
  // buffer (notify.ts). A 30-day-out deadline must never wake anyone.
  const db = fakeDb({ obligations: [oblig(1, 7, 10)] });
  await renewalSweep(db.env, NOW, { notify: db.notify });
  const sent = db.sent[0];
  assert.equal(sent.category, 'compliance');
  const { CRITICAL_CATEGORIES } = await import('../src/services/notify.ts');
  assert.ok(!CRITICAL_CATEGORIES.has(sent.category),
    'the renewal notice is critical — it now bypasses the digest it exists to be part of');
  assert.equal(sent.link, '/trust');
  assert.equal(sent.type, 'renewal_due');
});

test('every line is a state, never a bare date', async () => {
  // `expires 3/14/2027` reads the same whether it is two years out or next
  // Tuesday — the defect `expiryNote` was written to fix on /trust.
  assert.equal(renewalItemLine({ label: 'Founder NDA', daysLeft: 1 }), 'Founder NDA — expires in 1 day');
  assert.equal(renewalItemLine({ label: 'Founder NDA', daysLeft: 9 }), 'Founder NDA — expires in 9 days');
  assert.equal(renewalItemLine({ label: 'Founder NDA', daysLeft: 0 }), 'Founder NDA — expires today');
  const db = fakeDb({ obligations: [oblig(1, 7, 10)] });
  await renewalSweep(db.env, NOW, { notify: db.notify });
  assert.doesNotMatch(db.sent[0].body, /\d{4}-\d{2}-\d{2}/, 'a raw timestamp is being shown to a reader');
});

test('the count in the title is the count in the body', () => {
  // One derivation, used by both. A notice saying "2 items" over a list of
  // three is the Trust Center tally defect delivered by email.
  for (const n of [1, 2, 5]) {
    const items = Array.from({ length: n }, (_, i) => ({
      userId: 7, kind: 'obligation' as const, subjectId: i, expiresAt: inDays(i + 2),
      daysLeft: i + 2, threshold: 7, label: `Item ${i}`,
    }));
    const { title, body } = renewalDigest(items);
    const bullets = body.split('\n').filter(l => l.startsWith('•')).length;
    assert.equal(bullets, n);
    if (n > 1) assert.match(title, new RegExp(`^${n} items expire soon`));
    else assert.match(title, /^Item 0 expires in 2 days$/);
  }
});

test('the soonest deadline leads, whatever order the rows arrive in', () => {
  const mk = (label: string, daysLeft: number) => ({
    userId: 7, kind: 'obligation' as const, subjectId: daysLeft,
    expiresAt: inDays(daysLeft), daysLeft, threshold: 7, label,
  });
  const { title, body } = renewalDigest([mk('Late', 25), mk('Soon', 2), mk('Middle', 9)]);
  assert.match(title, /the first in 2 days/);
  const order = body.split('\n').filter(l => l.startsWith('•')).map(l => l.slice(2).split(' —')[0]);
  assert.deepEqual(order, ['Soon', 'Middle', 'Late']);
});

test('an obligation key nobody has labelled still reads as something', () => {
  assert.equal(obligationLabel('kyc_v1'), 'Identity verification (KYC)');
  assert.equal(obligationLabel('some_future_v9'), 'some_future_v9');
  assert.equal(obligationLabel(''), 'Obligation');
});

test('the worker and the page call each obligation the same thing', () => {
  // No shared module exists across the frontend/worker line in this repo, so
  // the label map genuinely exists twice. Compared rather than trusted —
  // the same treatment the trust score and the envelope-event labels get.
  const page = read('frontend/src/pages/TrustCenterPage.jsx');
  const block = page.slice(page.indexOf('const OBLIGATION_META = {'), page.indexOf('};', page.indexOf('const OBLIGATION_META = {')));
  assert.ok(block.length > 200, 'could not read OBLIGATION_META');
  const pageLabels: Record<string, string> = {};
  for (const m of block.matchAll(/^\s{2}([a-z0-9_]+):\s*\{\s*label:\s*'([^']+)'/gm)) pageLabels[m[1]] = m[2];
  assert.ok(Object.keys(pageLabels).length >= 8, `parsed only ${Object.keys(pageLabels).length} labels`);
  for (const [key, label] of Object.entries(pageLabels)) {
    assert.equal(OBLIGATION_LABELS[key], label,
      `/trust calls ${key} "${label}" and the renewal notice calls it "${OBLIGATION_LABELS[key]}"`);
  }
});

// ---------------------------------------------------------------------------
// Failure

test('one unreadable table does not cost the other its warnings', async () => {
  const db = fakeDb(
    { obligations: [oblig(1, 7, 5)], ndas: [{ id: 1, party_a_user_id: 8, party_b_user_id: 9, status: 'active', valid_until: inDays(5) }] },
    { failObligations: true },
  );
  const r = await renewalSweep(db.env, NOW, { notify: db.notify });
  assert.equal(r.notified, 2, 'the NDA warnings were lost with the obligation scan');
  assert.deepEqual(db.sent.map(s => s.userId).sort(), [8, 9]);
});

test('a claim that cannot be written sends nothing, rather than sending unclaimed', async () => {
  // The claim is what makes it safe to send. If it fails, staying silent is
  // the only option that cannot become a nightly repeat.
  const db = fakeDb({ obligations: [oblig(1, 7, 5)] }, { failClaims: true });
  const r = await renewalSweep(db.env, NOW, { notify: db.notify });
  assert.equal(r.claimed, 0);
  assert.equal(r.notified, 0);
  assert.equal(db.sent.length, 0);
});

test('a notifier that throws loses one notice, not the sweep', async () => {
  const db = fakeDb({ obligations: [oblig(1, 7, 5), oblig(2, 8, 5)] });
  let first = true;
  const flaky = async (_e: any, a: any) => {
    if (first) { first = false; throw new Error('mail is down'); }
    db.sent.push(a); return 1;
  };
  const r = await renewalSweep(db.env, NOW, { notify: flaky });
  assert.equal(r.claimed, 2);
  assert.equal(r.notified, 1, 'one send failed and took the other with it');
});

test('the sweep is wired into the cron ahead of the expiry it warns about', () => {
  // Ordering matters on the day an item is due: run after 04:35 and the row
  // is already 'expired', so the last warning is the one nobody gets.
  const index = read('cloudflare-worker/src/index.ts');
  assert.match(index, /renewalSweep\(env, now\)/, 'the sweep is never called');

  // BOTH TIMES ARE PARSED OUT OF THE FILE. The first draft of this ended on
  // `assert.equal(15 < 35, true)` — a comparison of two literals, which is
  // true whatever the cron actually says and proves nothing at all.
  const gate = (fn: string) => {
    const at = index.indexOf(fn);
    assert.ok(at > 0, `${fn} is not called from the scheduled handler`);
    // Walk back to the `if (now.getUTCHours() === H && ... === M)` guarding it.
    const guards = [...index.slice(0, at).matchAll(
      /getUTCHours\(\) === (\d+) && now\.getUTCMinutes\(\) === (\d+)/g)];
    const last = guards[guards.length - 1];
    assert.ok(last, `no cron gate precedes ${fn}`);
    return { hour: Number(last[1]), minute: Number(last[2]) };
  };
  const warn = gate('renewalSweep(env, now)');
  const expire = gate('expireTrustArtifacts(env)');
  assert.equal(warn.hour, 4, `the renewal sweep runs at ${warn.hour}:${warn.minute}, not in the 04:00 hour`);
  assert.equal(expire.hour, 4);
  assert.ok(
    warn.hour * 60 + warn.minute < expire.hour * 60 + expire.minute,
    `the renewal sweep runs at ${warn.hour}:${warn.minute}, at or after the expiry at `
    + `${expire.hour}:${expire.minute} — on the day an item is due the row would already be expired`,
  );
});
