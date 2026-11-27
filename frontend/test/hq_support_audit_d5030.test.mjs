/**
 * The HQ Support audit on the page (#5030–#5033), RENDERED.
 *
 *   D5030 — the kind pills and a filtered card read the server's whole-board
 *           counts, never the rows listed; a ticket row says where its queue
 *           came from (filed, or current standing because nothing was).
 *   D5031 — HQ's desk and the branch hosts are two reads; `mergeSupport` draws
 *           whichever has landed and never blanks HQ's queues for a branch.
 *   D5032 — the SLA panel names the policy version and how many branches apply it.
 *   D5033 — Send again and the SLA save each say: in flight, done, refused, unknown.
 *
 * The page loads in an effect, which `renderToStaticMarkup` never runs, so the
 * pure pieces are driven here and the page's wiring is read from its source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import {
  QueueCard, escalationCardProps, escalationKindChoices, EscalationKindFilter, ticketCardProps,
  standingNote, basisNoteOf, mergeSupport, BranchTicketsSection, supportBandText,
  RecordedOutcome, resendError, resendStep, SlaPolicyPanel, SlaPropagation,
  validateTierDraft, slaSaveError, slaSavedSummary, UNAVAILABLE,
} from '../src/pages/hq/HqSupportPage.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CODE = codeOnly(readFileSync(resolve(root, 'frontend/src/pages/hq/HqSupportPage.jsx'), 'utf8'));
const render = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));
const text = renderedText;

const esc = (uid, kind) => ({ uid, branch_code: 'fr', kind, subject: `${kind} ${uid}`, age_hours: 5, sla: 'ok' });

/** A board of 30 where the 3 renewals are past the 25 listed. */
function board() {
  const items = Array.from({ length: 25 }, (_, i) => esc(`m${i}`, i < 20 ? 'moderation' : 'seat_increase'));
  return {
    available: true, complete: true, count: 30, bands: { ok: 30, due_soon: 0, past: 0 },
    items,
    kinds: [
      { kind: 'moderation', count: 20, items: items.slice(0, 20) },
      { kind: 'seat_increase', count: 7, items: items.slice(20) },
      { kind: 'renewal', count: 3, items: [esc('r1', 'renewal'), esc('r2', 'renewal'), esc('r3', 'renewal')] },
      { kind: 'terms_change', count: 0, items: [] },
    ],
  };
}
const data = (escalations) => ({ read_at: '2026-11-08T10:00:00Z', escalations });

// ═══════════════════════════════════════════════════════════════ D5030 ══

test('D5030: the pills and the filtered card come from the server’s whole-board counts, not the 25 rows listed', () => {
  const e = board();
  const choices = escalationKindChoices(e);
  assert.deepEqual(choices.map((c) => [c.kind, c.count]), [['', 30], ['moderation', 20], ['seat_increase', 7], ['renewal', 3], ['terms_change', 0]]);
  const card = escalationCardProps(data(e), false, { kind: 'renewal', openUid: null, onToggle: () => {}, panelFor: () => null });
  assert.equal(card.count, 3, 'a kind past the listed rows was counted from them');
  assert.deepEqual(card.items.map((x) => x.key), ['r1', 'r2', 'r3'], 'the filtered card drew the listed rows instead of the kind’s own');
  assert.equal(card.bands, null, 'a filtered card showed the whole board’s bands as its own');
  const pills = text(render(EscalationKindFilter, { escalations: e, value: 'renewal', onChange: () => {} }));
  assert.match(pills, /Renewal 3/);
});

test('D5030: a count the server could not make reads "not counted", and an older payload never counts from a cut list', () => {
  const e = board();
  const cut = { ...e, complete: false, count: null, kinds: e.kinds.map((k) => ({ ...k, count: null })) };
  assert.ok(escalationKindChoices(cut).every((c) => c.count === null));
  assert.match(text(render(EscalationKindFilter, { escalations: cut, value: '', onChange: () => {} })), /Renewal not counted/);
  const card = escalationCardProps(data(cut), false, { kind: 'renewal', openUid: null, onToggle: () => {}, panelFor: () => null });
  assert.equal(card.count, null);
  assert.match(text(render(QueueCard, card)), /Not counted/);
  // A Worker without `kinds`: 25 rows listed of 30 — the per-kind counts are unknown.
  const old = { ...e, kinds: undefined };
  assert.ok(escalationKindChoices(old).every((c) => c.count === null), 'a cut list was counted as the board');
  const oldCard = escalationCardProps(data(old), false, { kind: 'moderation', openUid: null, onToggle: () => {}, panelFor: () => null });
  assert.equal(oldCard.count, null);
  // ...and when the listed rows ARE the board, their counts stand.
  const whole = { ...old, count: 25 };
  assert.equal(escalationKindChoices(whole).find((c) => c.kind === 'moderation').count, 20);
});

test('D5030: a ticket row says where its queue came from, and the card counts those with no filing record', () => {
  const asFiled = {
    id: 7, title: 'Seat count', status: 'open', age_hours: 3, sla_band: 'ok', requester: 'T. Roussel',
    licence: { uid: 'lic_wl', licence_ref: 'AXL-002', brand_name: 'Studio Lyon' },
    basis: 'as_filed', filed: { persona: 'admin_product', role: 'admin', licence_uid: 'lic_wl', branch_code: null },
    current: { persona: 'hq_held', licence_uid: null, licence_ref: null }, standing_changed: true,
  };
  assert.equal(standingNote(asFiled), 'Filed as licence administrator (AXL-002) · now HQ-held user');
  assert.equal(standingNote({ ...asFiled, standing_changed: false }), null, 'an unchanged standing adds noise to every row');
  assert.match(standingNote({ ...asFiled, basis: 'current_standing', filed: null }), /Queued from current standing: the context it was filed in was not recorded/);
  const payload = {
    tickets: {
      available: true, complete: true, open: 2, snapshot_readable: true,
      buckets: { admin_product: { count: 2, oldest_age_hours: 3, bands: null, items: [asFiled], from_current_standing: 1 } },
    },
  };
  const out = text(render(QueueCard, ticketCardProps(payload, false, 'admin_product')));
  assert.match(out, /Filed as licence administrator \(AXL-002\) · now HQ-held user/);
  assert.match(out, /1 ticket was filed before the filing context was recorded, so it is queued from current standing/);
  assert.match(basisNoteOf({ from_current_standing: 0 }, false), /could not be read on this database/);
  assert.equal(basisNoteOf({ from_current_standing: 0 }, true), null);
  assert.equal(basisNoteOf({ from_current_standing: null }, true), null, 'a cut read claimed a count');
});

// ═══════════════════════════════════════════════════════════════ D5031 ══

const LOCAL = {
  recent_decisions: { available: true, items: [{ uid: 'latest' }] },
  scope: 'hq_local', read_at: '2026-11-08T10:00:01Z',
  total: { value: null, reason: 'Branch hosts are read separately' },
  escalations: { available: true, complete: true, count: 1, items: [esc('a', 'other')], kinds: [] },
  tickets: { available: true, open: 0 },
  sla_policy: { version: { available: true, value: 3 }, branch_copy: { held: false, propagation: null } },
};
const FULL = {
  recent_decisions: { available: true, items: [{ uid: 'earlier' }] },
  scope: 'all', read_at: '2026-11-08T10:00:00Z',
  total: { value: 4, oldest: null },
  escalations: { available: true, complete: true, count: 2, items: [esc('a', 'other'), esc('b', 'other')], kinds: [] },
  tickets: { available: true, open: 2 },
  branch_tickets: { lines: [{ code: 'fr', label: 'Axal VC France', state: 'ok', count: 2, items: [] }], coverage: { answered: 1, total: 1, unreadable: [] }, whose: 'w' },
  matrix: { available: true, rows: [] },
  sla_policy: { version: { available: true, value: 3 }, branch_copy: { held: false, propagation: { version: 3, current: 1, total: 1, complete: true, branches: [] } } },
};

test('D5031: HQ’s desk is drawn as soon as the local read lands; the branch parts say they are being asked', () => {
  const { data: d, branchState } = mergeSupport(LOCAL, null);
  assert.equal(branchState, 'loading');
  assert.equal(d.escalations.count, 1, 'HQ’s queues waited for the branches');
  assert.equal(d.branch_tickets, undefined);
  assert.equal(d.recent_decisions.items[0].uid, 'latest');
  const section = render(BranchTicketsSection, { state: 'loading' });
  assert.match(text(section), /Asking each branch host… HQ’s own queues above do not wait for it/);
  assert.match(section, /role="status"/);
});

test('D5031: a failed branch read costs only the branch section; its retry does not blank HQ’s queues', () => {
  const out = text(render(BranchTicketsSection, { state: 'failed', onRetry: () => {} }));
  assert.match(out, /The branch hosts could not be read/);
  assert.match(out, /HQ’s own queues above are unaffected/);
  const m = mergeSupport(LOCAL, UNAVAILABLE);
  assert.equal(m.branchState, 'failed');
  assert.equal(m.data.escalations.count, 1, 'a failed branch read blanked HQ’s queues');
  assert.equal(mergeSupport(UNAVAILABLE, FULL).data.total.value, 4, 'a failed local read hid the full one');
  // The page: the retry re-reads branches without clearing the local read.
  const at = CODE.indexOf('const retryBranches = useCallback(');
  const fn = CODE.slice(at, CODE.indexOf('}, [fetchFull]);', at));
  assert.ok(fn.includes('fetchFull(false)'), 'the branch retry blanks the page');
  assert.ok(!fn.includes('setLocal'), 'the branch retry touches HQ’s queues');
  assert.ok(CODE.includes('const failed = local === UNAVAILABLE && full === UNAVAILABLE;'), 'one failed read blanks the whole page');
});

test('D5031: the newer read wins for HQ’s parts, and a stale total or a propagation for another version is never shown', () => {
  // Full older than local (a quiet refresh after a decision): local's queues, full's branches.
  const m = mergeSupport(LOCAL, FULL).data;
  assert.equal(m.escalations.count, 1, 'an older read’s queue replaced a newer one');
  assert.equal(m.branch_tickets.lines.length, 1);
  assert.equal(m.recent_decisions.items[0].uid, 'latest');
  const sameTimeFull = { ...FULL, read_at: LOCAL.read_at, readOrder: 7 };
  assert.equal(mergeSupport({ ...LOCAL, readOrder: 8 }, sameTimeFull).data.recent_decisions.items[0].uid, 'latest');
  assert.equal(mergeSupport({ ...LOCAL, readOrder: 6 }, sameTimeFull).data.recent_decisions.items[0].uid, 'earlier');
  assert.equal(m.total.value, null, 'the older full total was shown beside newer queues');
  assert.equal(m.sla_policy.branch_copy.propagation.current, 1, 'same version: coverage kept');
  const bumped = mergeSupport({ ...LOCAL, sla_policy: { ...LOCAL.sla_policy, version: { available: true, value: 4 } } }, FULL).data;
  assert.equal(bumped.sla_policy.branch_copy.propagation, null, 'coverage of v3 was shown as coverage of v4');
  // Full newer: it is the view.
  assert.equal(mergeSupport({ ...LOCAL, read_at: '2026-11-08T09:00:00Z' }, FULL).data.total.value, 4);
  assert.equal(supportBandText(mergeSupport(LOCAL, null).data, false), 'total not recorded');
});

// ═══════════════════════════════════════════════════════════════ D5032 ══

test('D5032: the panel names the policy version and how many branches apply it, and each one behind with its reason', () => {
  const prop = {
    version: 3, total: 3, current: 1, complete: false,
    branches: [
      { code: 'fr', label: 'Axal VC France', state: 'current', version: 3, reason: null },
      { code: 'de', label: 'Axal VC DACH', state: 'stale', version: 2, reason: 'bands with version 2' },
      { code: 'es', label: 'Axal VC Iberia', state: 'unreadable', version: null, reason: 'did not answer' },
    ],
  };
  const out = text(render(SlaPropagation, { version: { available: true, value: 3 }, propagation: prop }));
  assert.match(out, /Policy v3 · applied on 1 of 3 branches/);
  assert.match(out, /Axal VC DACH · stale \(v2\) — bands with version 2/);
  assert.match(out, /Axal VC Iberia · unreadable — did not answer/);
  assert.doesNotMatch(out, /Axal VC France ·/, 'a current branch is listed as behind');
  assert.match(text(render(SlaPropagation, { version: { available: true, value: 3 }, propagation: null, branchState: 'loading' })), /Policy v3 · asking branches…/);
  assert.match(text(render(SlaPropagation, { version: { available: true, value: null }, propagation: null })), /Policy not yet numbered/);
});

// ═══════════════════════════════════════════════════════════════ D5033 ══

const rec = { uid: 'esc_1', branch_code: 'fr', subject: 'seat increase', status: 'answered', answered_at: '2026-11-08T10:05:00Z', pushed: { ok: false, reason: 'No branch Worker is bound.' } };

test('D5033: Send again is disabled and says so while its request is in flight', () => {
  const sending = resendStep(rec, 'start');
  const out = render(RecordedOutcome, { rec: sending, onResend: () => {} });
  assert.match(out, /disabled=""/);
  assert.match(out, /aria-busy="true"/);
  assert.match(text(out), /Sending…/);
  const idle = render(RecordedOutcome, { rec, onResend: () => {} });
  assert.doesNotMatch(idle, /disabled=""/);
  assert.match(text(idle), /Send again/);
  // The page ignores a second click while one is in flight.
  const at = CODE.indexOf('const onResend = useCallback(');
  const fn = CODE.slice(at, CODE.indexOf('}, []);', at));
  assert.ok(fn.includes('resending.current.has(uid)'), 'the in-flight guard is missing');
});

test('D5033: a resend that reached the branch updates the delivery line in place, without a reload', () => {
  const done = resendStep(resendStep(rec, 'start'), 'answer', { pushed: { ok: true } });
  assert.equal(done.resend.state, 'delivered');
  const out = text(render(RecordedOutcome, { rec: done, onResend: () => {} }));
  assert.match(out, /fr received it\. Sent again/);
  assert.doesNotMatch(out, /Not on fr/);
  // A push the branch still refused is the new reason, not an error.
  const refused = resendStep(rec, 'answer', { pushed: { ok: false, reason: 'Branch on an older deploy.' } });
  assert.match(text(render(RecordedOutcome, { rec: refused, onResend: () => {} })), /Not on fr: Branch on an older deploy\./);
});

test('D5033: a failed resend is said inline as an alert, in words, with the button left as the retry', () => {
  const failed = resendStep(rec, 'error', { status: 400, message: 'There is no stored decision to send again. Record one first.' });
  const out = render(RecordedOutcome, { rec: failed, onResend: () => {} });
  assert.match(out, /role="alert"/);
  assert.match(text(out), /Failed: Not sent: There is no stored decision to send again\. Record one first\./);
  assert.match(text(out), /Send again/, 'the retry disappeared');
  const lost = resendStep(rec, 'error', { message: 'timeout' });
  assert.equal(lost.resend.state, 'unknown');
  assert.match(text(render(RecordedOutcome, { rec: lost, onResend: () => {} })), /Unknown: Whether fr received it is not known: no answer came back\. HQ’s recorded decision is unchanged\./);
  assert.equal(resendError({ status: 502 }, 'fr').state, 'unknown', 'a 5xx was reported as a failure');
  assert.equal(resendError({ status: 404 }, 'fr').state, 'failed');
});

test('D5033: the SLA form checks P1 ≤ P2 ≤ P3 and the bounds before anything is sent', () => {
  const ok = { P1: { hours: '24', description: 'a' }, P2: { hours: '48', description: 'b' }, P3: { hours: '96', description: 'c' } };
  assert.deepEqual(validateTierDraft(ok), []);
  assert.deepEqual(validateTierDraft({ ...ok, P1: { hours: '50', description: 'a' } }), ['P1 must not wait longer than P2.']);
  assert.deepEqual(validateTierDraft({ ...ok, P3: { hours: '40', description: 'c' } }), ['P2 must not wait longer than P3.']);
  assert.deepEqual(validateTierDraft({ ...ok, P2: { hours: '0', description: 'b' } }), ['P2 hours must be a whole number from 1 to 720.']);
  assert.deepEqual(validateTierDraft({ ...ok, P3: { hours: '721', description: 'c' } }), ['P3 hours must be a whole number from 1 to 720.']);
  assert.deepEqual(validateTierDraft({ ...ok, P1: { hours: '2.5', description: 'a' } }), ['P1 hours must be a whole number from 1 to 720.']);
  assert.deepEqual(validateTierDraft({ ...ok, P1: { hours: '24', description: '   ' } }), ['P1 needs a description of 1 to 200 characters.']);
  // The page validates before it calls the route.
  const at = CODE.indexOf('const save = async () => {');
  const fn = CODE.slice(at, CODE.indexOf('};', CODE.indexOf('catch (e)', at)));
  assert.ok(fn.indexOf('validateTierDraft(draft)') < fn.indexOf('api.hqSupportSetSlaTiers('), 'the save is sent before it is checked');
  assert.ok(fn.includes('if (found.length) return;'), 'a draft with problems is still sent');
});

test('D5033: a save is confirmed with its version and branch coverage, and never shown as applied on less', () => {
  const all = slaSavedSummary({ changed: ['P1'], distribution: { version: 4, total: 2, applied: 2, complete: true, branches: [] } });
  assert.equal(all.headline, 'Saved as policy v4. Applied on all 2 branches.');
  const part = slaSavedSummary({
    changed: ['P1'],
    distribution: { version: 4, total: 2, applied: 1, complete: false, branches: [
      { code: 'fr', label: 'France', state: 'applied', reason: null },
      { code: 'de', label: 'DACH', state: 'unknown', reason: 'did not answer within 5s' },
    ] },
  });
  assert.equal(part.headline, 'Saved as policy v4. Applied on 1 of 2 branches; not yet on the rest.');
  assert.deepEqual(part.lines.map((l) => [l.code, l.state]), [['de', 'unknown']]);
  assert.match(slaSavedSummary({ changed: [], distribution: null }).headline, /Nothing changed, so no new version was made/);
  assert.match(slaSavedSummary({ changed: ['P2'], distribution: { version: 1, total: 0, applied: 0, complete: false, branches: [] } }).headline, /No branch is deployed/);
});

test('D5033: a refused save says why; an unanswered one says the outcome is unknown and asks for a reload', () => {
  assert.deepEqual(slaSaveError({ status: 400, message: 'P1 must not wait longer than P2, nor P2 longer than P3' }), {
    phase: 'rejected', text: 'Not saved: P1 must not wait longer than P2, nor P2 longer than P3',
  });
  assert.equal(slaSaveError({ status: 503, code: 'sla_tiers_unreadable', message: 'x' }).phase, 'rejected', 'a refusal before the write was called unknown');
  const lost = slaSaveError({ message: 'timeout' });
  assert.equal(lost.phase, 'unknown');
  assert.match(lost.text, /not known.*Reload the policy before saving again, and do not treat these hours as applied/);
  assert.equal(slaSaveError({ status: 500 }).phase, 'unknown');
});

test('D5033: the panel’s save states are rendered as alerts and status, not colour alone', () => {
  const policy = {
    tiers: { available: true, items: [{ id: 'P1', hours: 24, description: 'a' }, { id: 'P2', hours: 48, description: 'b' }, { id: 'P3', hours: 96, description: 'c' }] },
    version: { available: true, value: 2 },
    branch_copy: { held: false, propagation: { version: 2, total: 1, current: 1, complete: true, branches: [] } },
    escalation_kinds: [],
  };
  const out = text(render(SlaPolicyPanel, { slaPolicy: policy, taxonomy: { available: true, items: [], uncategorised: 0 } }));
  assert.match(out, /Policy v2 · applied on 1 of 1 branch/);
  assert.doesNotMatch(out, /Branch copy held/);
  assert.ok(CODE.includes('role="status" className="mt-2 rounded-md border border-emerald-200'), 'the saved confirmation is not announced');
  assert.ok(/data-testid="hq-support-sla-problems"/.test(CODE) && /role="alert" className="grid gap-0.5/.test(CODE), 'validation problems are not an alert');
  assert.ok(CODE.includes("{saving ? 'Saving and sending to branches…' : 'Save tiers'}"));
});
