/**
 * D459 (#1017) — one SLA band rule for HQ Support.
 *
 * Pins: one module owns the due-soon window and one boundary operator, and the
 * ticket and escalation bands agree at every remaining time; a 24-hour limit
 * can be on time; the buckets outside H22's two queues send no bands nobody
 * counted, and an undated ticket is counted; the panel names both SLA tables;
 * the mapping sentence comes from the rule; and the taxonomy read binds the one
 * definition of open and folds a blank type into 'task'.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { bandForRemaining, dueSoonWindowHours, SLA_DUE_SOON_HOURS } from '../src/services/slaWindow.ts';
import { ticketSlaBand, ticketMappingText, readOpenTicketTaxonomy, HQ_TICKET_SLA_HOURS, SLA_TIERS } from '../src/services/supportSlaPolicy.ts';
import { slaBand, escalationSlaBand, SLA_HOURS, ESCALATION_KINDS } from '../src/rpc/hqOps.ts';
import { summariseTickets, QUEUE_PERSONAS, TICKET_PERSONAS } from '../src/services/supportQueues.ts';
import { slaPolicyBody } from '../src/routes/admin_hq_support.ts';
import * as approvals from '../src/services/approvalSources.ts';

const H = 3_600_000;

test('the window is min(24h, limit / 2)', () => {
  assert.equal(SLA_DUE_SOON_HOURS, 24);
  assert.equal(dueSoonWindowHours(24), 12);
  assert.equal(dueSoonWindowHours(48), 24);
  assert.equal(dueSoonWindowHours(96), 24);
});

test('one boundary operator: due soon includes the window edge, past starts after the limit', () => {
  assert.equal(bandForRemaining(12, 12), 'due_soon');
  assert.equal(bandForRemaining(12.0001, 12), 'ok');
  assert.equal(bandForRemaining(0, 12), 'due_soon', 'at the limit itself it is not yet past');
  assert.equal(bandForRemaining(-0.0001, 12), 'past');
});

test('a ticket and an escalation band the same at every remaining time, on the same limit', () => {
  const now = Date.UTC(2026, 9, 4, 12);
  for (const limit of [24, 48, 72, 96]) {
    for (let age = 0; age <= limit + 2; age += 0.5) {
      const dueAt = new Date(now + (limit - age) * H).toISOString();
      assert.equal(
        slaBand(dueAt, now, dueSoonWindowHours(limit)),
        ticketSlaBand(age, limit),
        `limit ${limit}h, age ${age}h`,
      );
    }
  }
});

test('a 24-hour moderation escalation is on time when raised, and due soon for its last 12 hours', () => {
  const now = Date.UTC(2026, 9, 4, 12);
  assert.equal(SLA_HOURS.moderation, 24);
  const raised = { kind: 'moderation', due_at: new Date(now + 24 * H).toISOString() };
  assert.equal(escalationSlaBand(raised, now), 'ok', 'before D459 this read due_soon from its first hour');
  assert.equal(escalationSlaBand({ ...raised, due_at: new Date(now + 12 * H).toISOString() }, now), 'due_soon');
  assert.equal(escalationSlaBand({ ...raised, due_at: new Date(now - 1).toISOString() }, now), 'past');
  // A 72-hour kind keeps the full 24-hour window.
  assert.equal(escalationSlaBand({ kind: 'content', due_at: new Date(now + 24 * H).toISOString() }, now), 'due_soon');
  assert.equal(escalationSlaBand({ kind: 'content', due_at: new Date(now + 25 * H).toISOString() }, now), 'ok');
});

test('approvals read the window from the same module', () => {
  assert.equal(approvals.SLA_DUE_SOON_HOURS, SLA_DUE_SOON_HOURS);
});

const row = (id: number, created_at: string | null, extra: Record<string, unknown> = {}) => ({
  id, title: `t${id}`, status: 'open', priority: 'medium', created_at: created_at as string,
  account_id: 10, requester_name: 'R', requester_email: null, requester_role: 'founder', requester_active: 1,
  licence_uid: null, licence_ref: null, licence_brand: null, ...extra,
});

test('bands only on the two queues: the three outside them send null, not zeros nobody counted', () => {
  const now = Date.UTC(2026, 9, 4, 12);
  const q = summariseTickets({
    complete: true,
    rows: [
      row(1, new Date(now - 2 * H).toISOString()),                                       // hq_held, on time
      row(2, 'not a date'),                                                              // hq_held, undated
      row(3, new Date(now - 5 * H).toISOString(), { requester_role: 'admin' }),          // hq_staff
      row(4, new Date(now - 5 * H).toISOString(), { account_id: null }),                 // not_on_record
    ],
  }, now);
  for (const p of TICKET_PERSONAS) {
    if (QUEUE_PERSONAS.includes(p)) assert.ok(q.buckets[p].bands, `${p} has bands`);
    else assert.equal(q.buckets[p].bands, null, `${p} sends bands nobody counted`);
  }
  assert.deepEqual(q.buckets.hq_held.bands, { ok: 1, due_soon: 0, past: 0, undated: 1 },
    'the undated ticket is counted, so the bands sum to the queue');
  assert.equal(q.buckets.hq_held.count, 2);
});

test('the panel names both SLA tables, each with its window', () => {
  // D482: the tiers are HQ's store; here, the seed migration 333 writes.
  const seed = SLA_TIERS.map((t) => ({ id: t, hours: HQ_TICKET_SLA_HOURS[t], description: t, updated_at: null, updated_by_name: null }));
  const body = slaPolicyBody({ available: true, tiers: seed, hours: { ...HQ_TICKET_SLA_HOURS } });
  assert.ok(body.tiers.available);
  assert.deepEqual((body.tiers as any).items.map((t: any) => [t.id, t.hours, t.due_soon_hours]),
    [['P1', HQ_TICKET_SLA_HOURS.P1, 12], ['P2', 48, 24], ['P3', 96, 24]]);
  assert.deepEqual(body.escalation_kinds.map((k: any) => k.kind), [...ESCALATION_KINDS]);
  assert.deepEqual(body.escalation_kinds.find((k: any) => k.kind === 'moderation'), { kind: 'moderation', hours: 24, due_soon_hours: 12 });
  // The ticket tiers are set at HQ now (D482); the escalation hours are still code's.
  assert.match(body.note, /Set here/);
  assert.match(body.note, /escalation hours are fixed in code/);
});

test('the mapping sentence is built from the rule', () => {
  assert.equal(ticketMappingText(), 'urgent → P1 · high → P2 · medium and low → P3');
});

test('taxonomy: binds the one definition of open, counts all eight categories, and keeps the uncategorised apart', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE tickets (id INTEGER PRIMARY KEY, category TEXT, status TEXT)`);
  const ins = db.prepare('INSERT INTO tickets (category, status) VALUES (?, ?)');
  for (const [cat, st] of [['billing', 'open'], ['billing', 'in_progress'], [null, 'open'], ['other', 'open'], ['billing', 'resolved'], ['contracts', 'closed']]) ins.run(cat, st);
  const env = { DB: { prepare: (sql: string) => ({ bind: (...b: unknown[]) => ({ all: async () => ({ results: db.prepare(sql).all(...(b as any[])) }) }) }) } } as any;
  const r = await readOpenTicketTaxonomy(env);
  assert.ok(r.available);
  const items = (r as any).items.map((x: any) => [x.category, x.open]);
  assert.deepEqual(items, [['fund_administration', 0], ['contracts', 0], ['access_permissions', 0], ['licence_seats', 0],
    ['billing', 2], ['data_reporting', 0], ['onboarding', 0], ['other', 1]],
    'the eight in canvas order, and only open and in-progress count');
  assert.equal((r as any).uncategorised, 1, 'a ticket with no category was folded into a category');
});
