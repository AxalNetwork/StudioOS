/**
 * D6125 (#6125) — a signed partner's renewal date reminds the venture's
 * founder in the app, 30 and 7 days before, once each; and the Overview's
 * "Needs your attention" lists a signed partner renewing within 30 days.
 *
 *   - One notification per threshold; a second run the same day sends none.
 *   - Paused, ended and unsigned partners send nothing; nor does a passed date.
 *   - A changed `renewal_on` re-arms both thresholds (the record is keyed to it).
 *   - Two thresholds due in one run send one notification and record both.
 *   - A claim lost to an overlapping run sends nothing.
 *
 * THE DATABASE IS THE BASELINE PLUS EVERY MIGRATION, as D1 runs them
 * (`loadSchema`), so the new column comes from its migration. Every name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_partner_renewals_6125.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { runGrowDaily, sendPartnerRenewalReminders, renewalSent } from '../src/services/growDaily.ts';
import { growAttention } from '../src/services/growAttention.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const FOUNDER = 10, OTHER = 20;
const A = 1, B = 2;
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-18T05:35:00Z');
const day = (offset: number) => new Date(NOW + offset * DAY).toISOString().slice(0, 10);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`INSERT INTO founders (id, name, email) VALUES (${FOUNDER}, 'Ana Wren', 'ana@example.test'), (${OTHER}, 'Bo Lind', 'bo@example.test')`);
  db.exec(`INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES
    (${FOUNDER}, 'founder', 'Ana Wren', 'ana@example.test', ${FOUNDER}, 1), (${OTHER}, 'founder', 'Bo Lind', 'bo@example.test', ${OTHER}, 1)`);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER}), (${B}, 'Quiet Fern', ${OTHER})`);
  return { db, env: { DB: d1Over(db) } as any };
}

function partner(db: DatabaseSync, id: number, opts: { renewal: string | null; stage?: string; project?: number; name?: string }) {
  db.prepare(`INSERT INTO growth_partners (id, uid, project_id, name, type, stage, renewal_on) VALUES (?, ?, ?, ?, 'reseller', ?, ?)`)
    .run(id, `gp_${id}`, opts.project ?? A, opts.name ?? `Partner ${id}`, opts.stage ?? 'signed', opts.renewal);
}

const inbox = (db: DatabaseSync) =>
  (db.prepare("SELECT user_id, title, body, link, payload FROM notifications_inbox WHERE type = 'grow_partner_renewal_reminder' ORDER BY id").all() as any[])
    .map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
const sentJson = (db: DatabaseSync, id: number) =>
  JSON.parse((db.prepare('SELECT renewal_reminders_sent_json AS j FROM growth_partners WHERE id = ?').get(id) as any).j ?? 'null');

test('D6125: 30 and 7 days before, once each, to the founder, in the app, linked to the partner', async () => {
  const { db, env } = fixture();
  partner(db, 1, { renewal: day(30), name: 'Northwind Resale' });
  const first = await runGrowDaily(env, NOW);
  assert.equal(first.renewals, 1);
  assert.deepEqual(inbox(db), [{
    user_id: FOUNDER, title: `Northwind Resale renews ${day(30)}`, body: 'The partnership renews in 30 days.',
    link: `/grow/partner-network/gp_1?project_id=${A}`,
    payload: { project_id: A, partner: 'gp_1', renewal_on: day(30), days_before: 30 },
  }]);
  assert.deepEqual(sentJson(db, 1), { on: day(30), sent: [30] });
  assert.equal((await runGrowDaily(env, NOW)).renewals, 0, 'a second run the same day sends nothing');
  for (let d = 1; d < 23; d += 1) assert.equal((await runGrowDaily(env, NOW + d * DAY)).renewals, 0, `day ${d}: between thresholds`);
  assert.equal((await runGrowDaily(env, NOW + 23 * DAY)).renewals, 1, '7 days before');
  assert.equal(inbox(db)[1].body, 'The partnership renews in 7 days.');
  assert.deepEqual(sentJson(db, 1), { on: day(30), sent: [30, 7] });
  for (let d = 24; d <= 40; d += 1) assert.equal((await runGrowDaily(env, NOW + d * DAY)).renewals, 0);
  assert.equal(inbox(db).length, 2, 'one notification per threshold');
  const n = (db.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get() as any).n;
  assert.equal(n, 0, 'in the app only');
});

test('D6125: paused, ended and unsigned partners, a passed date and no date send nothing', async () => {
  const { db, env } = fixture();
  partner(db, 1, { renewal: day(7), stage: 'paused' });
  partner(db, 2, { renewal: day(7), stage: 'ended' });
  partner(db, 3, { renewal: day(7), stage: 'terms' });
  partner(db, 4, { renewal: day(7), stage: 'talking' });
  partner(db, 5, { renewal: day(-1) });
  partner(db, 6, { renewal: null });
  assert.equal((await runGrowDaily(env, NOW)).renewals, 0);
  assert.deepEqual(inbox(db), []);
  for (const id of [1, 2, 3, 4, 5, 6]) assert.equal(sentJson(db, id), null);
  // A paused partner signed again before its date is reminded then.
  db.exec("UPDATE growth_partners SET stage = 'signed' WHERE id = 1");
  assert.equal((await runGrowDaily(env, NOW)).renewals, 1);
});

test('D6125: two thresholds due at once send one notification and record both', async () => {
  const { db, env } = fixture();
  partner(db, 1, { renewal: day(5) });
  assert.equal((await runGrowDaily(env, NOW)).renewals, 1);
  assert.equal(inbox(db)[0].payload.days_before, 7);
  assert.equal(inbox(db)[0].body, 'The partnership renews in 5 days.');
  assert.deepEqual(sentJson(db, 1), { on: day(5), sent: [30, 7] });
  assert.equal((await runGrowDaily(env, NOW + DAY)).renewals, 0);
});

test('D6125: changing the renewal date re-arms both thresholds', async () => {
  const { db, env } = fixture();
  partner(db, 1, { renewal: day(7) });
  await runGrowDaily(env, NOW);
  assert.equal(inbox(db).length, 1);
  // Renewed for a year: the old record is for a different date, so 30 and 7 count again.
  const next = day(7 + 365);
  db.prepare('UPDATE growth_partners SET renewal_on = ? WHERE id = 1').run(next);
  assert.deepEqual(renewalSent(JSON.stringify({ on: day(7), sent: [30, 7] }), next), []);
  assert.equal((await runGrowDaily(env, NOW)).renewals, 0, 'not due yet');
  assert.equal((await runGrowDaily(env, NOW + (7 + 335) * DAY)).renewals, 1, '30 days before the new date');
  assert.equal((await runGrowDaily(env, NOW + (7 + 358) * DAY)).renewals, 1, '7 days before the new date');
  assert.deepEqual(sentJson(db, 1), { on: next, sent: [30, 7] });
  assert.equal(inbox(db).length, 3);
});

test('D6125: a claim lost to an overlapping run sends nothing', async () => {
  const { db, env } = fixture();
  partner(db, 1, { renewal: day(30) });
  // Another run claims between this run's read and its claim.
  const real = env.DB;
  let raced = false;
  const racing = {
    prepare(sql: string) {
      const stmt = real.prepare(sql);
      if (!raced && sql.includes('UPDATE growth_partners SET renewal_reminders_sent_json')) {
        raced = true;
        db.prepare('UPDATE growth_partners SET renewal_reminders_sent_json = ? WHERE id = 1').run(JSON.stringify({ on: day(30), sent: [30] }));
      }
      return stmt;
    },
  };
  assert.equal(await sendPartnerRenewalReminders({ DB: racing } as any, NOW), 0);
  assert.deepEqual(inbox(db), []);
});

test('D6125: Needs your attention lists a signed partner renewing within 30 days, scoped to its venture', async () => {
  const { db, env } = fixture();
  const x = (pid = A) => ({ env, projectId: pid, now: NOW, href: (slug: string) => `/grow/${slug}?project_id=${pid}` }) as any;
  partner(db, 1, { renewal: day(31), name: 'Too Far' });
  partner(db, 2, { renewal: day(12), stage: 'paused' });
  partner(db, 3, { renewal: day(-2), name: 'Passed' });
  partner(db, 4, { renewal: day(3), project: B, name: 'Other Venture' });
  let r = await growAttention(x(), true);
  assert.deepEqual(r.signals.partner_renewals, { state: 'recorded', value: 0 });
  assert.equal(r.items.some((i) => i.key === 'partner_renewal'), false);
  partner(db, 5, { renewal: day(12), name: 'Northwind Resale' });
  r = await growAttention(x(), true);
  const item = r.items.find((i) => i.key === 'partner_renewal')!;
  assert.deepEqual({ label: item.label, why: item.why, href: item.href, area: item.area, actionLabel: item.actionLabel }, {
    label: "Prepare for Northwind Resale's renewal", why: `The partnership renews ${day(12)}, in 12 days.`,
    href: `/grow/partner-network/gp_5?project_id=${A}`, area: 'Partnerships', actionLabel: 'Review renewal',
  });
  partner(db, 6, { renewal: day(30), name: 'Second' });
  r = await growAttention(x(), true);
  const many = r.items.find((i) => i.key === 'partner_renewal')!;
  assert.equal(many.why, '2 signed partners renew within 30 days; Northwind Resale first, in 12 days.');
  assert.equal(many.href, `/grow/partner-network?project_id=${A}`);
  assert.equal((await growAttention(x(), false)).items.length, 0, 'read-only viewers get no action');
  db.exec('DROP TABLE partner_revenue; DROP TABLE growth_partner_deals; DROP TABLE growth_partners');
  r = await growAttention(x(), true);
  assert.equal(r.signals.partner_renewals.state, 'unreadable');
  assert.equal(r.state, 'partial');
});
