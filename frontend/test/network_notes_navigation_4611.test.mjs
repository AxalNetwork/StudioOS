/**
 * #4611 findings 7, 10 and 11 — complete navigation, honest read states, and
 * the decline note the requester was promised.
 *
 * Finding 11's round trip runs over the real model: one participant's decline
 * note, projected by the same `logRows` the requester's table renders from.
 * `grep decision_note frontend/src` returned NOTHING before this issue — the
 * field was stored, served to both sides, and drawn nowhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decisionLine, logRows, STATUS_LABEL } from '../src/pages/relationships/relationshipsModel.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const DESK = read('../src/pages/relationships/IntroductionsDesk.jsx');
const INVESTOR = read('../src/pages/investor/InvestorNetworkWorkspace.jsx');
const COMPOSE = read('../src/pages/email/RecordCompose.jsx');

const ASKER = 41;
const TEAMMATE = 42;
// The request as the Worker serves it to the ASKER: `interactionView` returns
// `decision_note` to both people on a request, which it always has.
const DECLINED = {
  uid: 'r1', created_at: '2026-11-01 09:00:00', status: 'declined',
  decided_at: '2026-11-04 16:20:00',
  decision_note: 'She has just left that fund, so the intro would not land. Ask me again in a quarter.',
  requester_user_id: ASKER, teammate_user_id: TEAMMATE,
  requester: { id: ASKER, name: 'Omar Reyes' }, teammate: { id: TEAMMATE, name: 'Lena Hart' },
  person: { name: 'Ada Vance', company: 'Verwood' },
  outcome: { value: null, label: 'Not recorded', note: null },
  follow_up: null,
};

test('a decline note submitted by the teammate is readable by the requester, with its decision context', () => {
  // The requester's own log read: the declined request is in `sent`.
  const rows = logRows({ sent: [DECLINED], received: [] }, []);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.status, STATUS_LABEL.declined);
  // THE NOTE REACHES THE ROW. This is the assertion whose absence was the bug.
  assert.ok(row.decision, 'the requester’s log row carries no decision note');
  assert.match(row.decision.note, /just left that fund/);
  // WITH ITS CONTEXT: a bare note is a sentence with no subject.
  assert.equal(row.decision.context, 'Declined on 2026-11-04');
});

test('the same note is readable by the teammate who wrote it, and by nobody else', () => {
  // The teammate reads the same request from their side (`received`), and sees
  // what they wrote — suppressing it there would be a second version of the
  // same defect.
  const theirs = logRows({ sent: [], received: [DECLINED] }, [])[0];
  assert.equal(theirs.decision.note, DECLINED.decision_note);
  // A third party is never in either list: every Worker read names the caller
  // in its WHERE clause, so there is no row for this function to project.
  assert.deepEqual(logRows({ sent: [], received: [] }, []), []);
});

test('an acceptance note is shown too, and a request answered without one invents nothing', () => {
  const accepted = { ...DECLINED, status: 'accepted', decision_note: 'Happy to — I will send it tomorrow.' };
  assert.equal(decisionLine(accepted).context, 'Accepted on 2026-11-04');
  assert.match(decisionLine(accepted).note, /send it tomorrow/);
  // No note is not "no reason given": the teammate answered without typing one,
  // and a sentence invented for that would be exactly what the honesty rule
  // forbids.
  for (const empty of [null, undefined, '', '   ']) {
    assert.equal(decisionLine({ ...DECLINED, decision_note: empty }), null, String(empty));
  }
  assert.equal(logRows({ sent: [{ ...DECLINED, decision_note: null }], received: [] }, [])[0].decision, null);
  // A decided_at nobody recorded leaves the verdict alone rather than printing
  // "Declined on ".
  assert.equal(decisionLine({ ...DECLINED, decided_at: null }).context, 'Declined');
});

test('the desk draws the note, and its field cap matches the Worker\'s', () => {
  assert.match(DESK, /data-testid=\{`\$\{testId\}-decision-note-\$\{x\.uid\}`\}/);
  assert.match(DESK, /\{x\.decision\.context\}/);
  assert.match(DESK, /\{x\.decision\.note\}/);
  // The textarea said 500 while `decideIntro` accepts 1,000, so a 600-character
  // note was clipped by the browser before it was ever sent.
  assert.match(DESK, /maxLength=\{NOTE_MAX\}/);
  assert.doesNotMatch(DESK, /maxLength=\{500\}/);
  assert.match(read('../../cloudflare-worker/src/services/relationships.ts'),
    /textOf\(noteIn, 1000, 'decision_note_too_long'/);
  // And the label that made the promise is still the promise.
  assert.match(DESK, /A note they will read \(optional\)/);
});

test('the investor Introductions zone has complete navigation; the overview keeps its preview', () => {
  // Finding 7: `slice(0, 4)` applied on BOTH surfaces, so the fifth
  // proposition was unreachable in the one place a member can act on one.
  assert.match(INVESTOR, /const PROPOSITION_PREVIEW = 4;/);
  assert.match(INVESTOR, /const cap = inZone \? shown : PROPOSITION_PREVIEW;/);
  assert.match(INVESTOR, /const inZone = zone === 'introductions';/);
  assert.match(INVESTOR, /data-testid="introductions-more"/);
  assert.match(INVESTOR, /data-testid="introductions-more-link"/);
  // Accepted and declined records are not filtered out of the zone: only the
  // `stalled` view narrows, and it narrows by status on purpose.
  assert.match(INVESTOR, /deskView === 'stalled'/);
  // The same bug one section down.
  assert.match(INVESTOR, /const ORGANIZATION_PREVIEW = 6;/);
  assert.match(INVESTOR, /data-testid="organizations-more"/);
});

test('the heading\'s counts name their scopes, and the export is the whole filtered set', () => {
  // It said `${propositionRows.length} shown` over four cards: "30 shown"
  // above 4. Three numbers, three meanings, now each labelled.
  assert.match(INVESTOR, /function propositionScopes\(\{ pending, shown, filtered, total, filteredView \}\)/);
  assert.match(INVESTOR, /shown >= filtered \? `\$\{shown\} shown` : `\$\{shown\} of \$\{filtered\} shown`/);
  // Code only: the comment above the helper quotes the old string by name.
  const code = INVESTOR.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  assert.doesNotMatch(code, /\$\{propositionRows\.length\} shown/);
  // The export carried the four cards while the heading claimed thirty. Every
  // sibling zone on this page already exported its full array.
  assert.match(INVESTOR, /rows: deskRows, cells: \(p\) => \[p\.target\?\.name/);
});

test('a failed mailbox read is not a missing mailbox', () => {
  // Finding 10's other half. `account == null` meant both, so an outage was
  // presented as a setup step: "Connect a mailbox to send" to someone whose
  // mailbox is connected.
  assert.match(COMPOSE, /mailboxes = account \? 'connected' : 'none'/);
  assert.match(COMPOSE, /data-testid="record-compose-connect"/);
  assert.match(COMPOSE, /data-testid="record-compose-mailboxes-unreadable"/);
  assert.match(COMPOSE, /That is a failed read, not a missing mailbox/);
  // Guidance has somewhere to go, which is what makes it guidance.
  assert.match(COMPOSE, /to="\/email\/settings"/);
  // Both callers say which state it is rather than letting the composer guess.
  assert.match(DESK, /mailboxes=\{account \? 'connected' : 'none'\}/);
  assert.match(read('../src/pages/email/RecordEmailSheet.jsx'), /mailboxes=\{sending \? 'connected' : 'none'\}/);
});
