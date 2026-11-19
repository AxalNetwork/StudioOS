/**
 * D4864 (#4864, GR-12, GR-19) — Grow's overview figures carry a typed `reason_code` and a `freshness`,
 * so the page never parses the prose reason.
 *
 *   - a measured 0 is a value (no reason code), never "no record";
 *   - MRR and Customers with nothing recorded are `not_connected` when the founder has no active Stripe
 *     integration, and `no_record` when Stripe is connected;
 *   - NRR and Headcount with nothing recorded are `no_record`;
 *   - a failed read is `unavailable`;
 *   - a figure as of a month before the last closed month is `stale`; one as of the last closed month or
 *     later is `current`.
 *
 * THE DATABASE IS THE BASELINE PLUS EVERY NUMBERED MIGRATION ABOVE THE CUTOFF. Every name is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_figure_states_4864.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { figureFreshness, growFigures } from '../src/services/growCycle.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const FOUNDER = 10, COMPANY = 5, A = 1;
const NOW = Date.parse('2026-11-18T12:00:00Z');

const BUILT = join(mkdtempSync(join(tmpdir(), 'grow-states-')), 'built.db');
function fixture({ stripe = false, company = true } = {}) {
  if (!existsSync(BUILT)) {
    const db = new DatabaseSync(BUILT, { enableDoubleQuotedStringLiterals: true });
    loadSchema(db);
    db.close();
  }
  const copy = join(mkdtempSync(join(tmpdir(), 'grow-states-')), 'test.db');
  copyFileSync(BUILT, copy);
  const db = new DatabaseSync(copy, { enableDoubleQuotedStringLiterals: true });
  const env = { ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  db.exec(`INSERT INTO founders (id, name, email) VALUES (${FOUNDER}, 'Ana Wren', 'ana@example.test')`);
  db.exec(`INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES (${FOUNDER}, 'founder', 'Ana Wren', 'ana@example.test', ${FOUNDER}, 1)`);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (${COMPANY}, 'cp_harbour', 'Harbour Lantern')`);
  db.exec(`INSERT INTO projects (id, name, founder_id, company_id) VALUES (${A}, 'Harbour Lantern', ${FOUNDER}, ${company ? COMPANY : 'NULL'})`);
  if (stripe) {
    db.exec(`INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, credentials_enc)
      VALUES (3, 'int_stripe_10', ${FOUNDER}, 'stripe', 'active', 'oauth2', 'x')`);
  }
  return { db, env, x: { env, projectId: A, now: NOW, href: (s: string) => `/grow/${s}?project=${A}` } };
}
const byKey = (figs: any[]) => Object.fromEntries(figs.map((f) => [f.key, f]));

test('nothing recorded and no Stripe: MRR and Customers are not_connected; NRR and Headcount are no_record', async () => {
  const { x } = fixture();
  const f = byKey(await growFigures(x as any));
  assert.equal(f.mrr.reason_code, 'not_connected');
  assert.equal(f.customers.reason_code, 'not_connected');
  assert.match(f.mrr.reason, /^Not recorded: Stripe is not connected/);
  assert.equal(f.nrr.reason_code, 'no_record');
  assert.equal(f.headcount.reason_code, 'no_record');
  for (const k of ['mrr', 'customers', 'nrr', 'headcount']) {
    assert.equal(f[k].value, null, `${k} is never 0 for missing`);
    assert.equal(f[k].freshness, null);
  }
});

test('with Stripe connected, a missing Stripe figure is no_record, not not_connected', async () => {
  const { x } = fixture({ stripe: true });
  const f = byKey(await growFigures(x as any));
  assert.equal(f.mrr.reason_code, 'no_record');
  assert.match(f.mrr.reason, /Stripe is connected but has not recorded MRR yet/);
  assert.equal(f.customers.reason_code, 'no_record');
});

test('a measured zero is a value with no reason code; an old snapshot is stale and a recent one current', async () => {
  const { db, x } = fixture();
  db.exec(`INSERT INTO project_metrics (project_id, snapshot_date, mrr, paying_accounts, source) VALUES (${A}, '2026-09-30', 0, NULL, 'manual')`);
  db.exec(`INSERT INTO project_metrics (project_id, snapshot_date, mrr, paying_accounts, source) VALUES (${A}, '2026-11-02', NULL, 0, 'manual')`);
  const f = byKey(await growFigures(x as any));
  assert.equal(f.mrr.value, 0);
  assert.equal(f.mrr.reason_code, null);
  assert.equal(f.mrr.freshness, 'stale', 'September, with October closed and unrecorded, is stale in November');
  assert.equal(f.customers.value, 0);
  assert.equal(f.customers.reason_code, null);
  assert.equal(f.customers.freshness, 'current');
});

test('a failed figure read is unavailable', async () => {
  const { x } = fixture();
  const broken = { ...x, env: { ...x.env, DB: { prepare(sql: string) { if (/project_metrics/.test(sql)) throw new Error('down'); return (x.env as any).DB.prepare(sql); } } } };
  const f = byKey(await growFigures(broken as any));
  assert.equal(f.mrr.state, 'unreadable');
  assert.equal(f.mrr.reason_code, 'unavailable');
  assert.equal(f.customers.reason_code, 'unavailable');
});

test('freshness follows the calendar: before the last closed month is stale', () => {
  assert.equal(figureFreshness('2026-10-31', NOW), 'current');
  assert.equal(figureFreshness('2026-11-18', NOW), 'current');
  assert.equal(figureFreshness('2026-09-30', NOW), 'stale');
  assert.equal(figureFreshness('2025-12-31', Date.parse('2026-01-05T00:00:00Z')), 'current', 'December is closed in January');
  assert.equal(figureFreshness('2025-11-30', Date.parse('2026-01-05T00:00:00Z')), 'stale');
  assert.equal(figureFreshness(null, NOW), null);
  assert.equal(figureFreshness('not a date', NOW), null);
});
