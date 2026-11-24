/**
 * D6889 part 1 (#6889, canvas D6158 DX19, DX20 and DX23 A) — the closing
 * workspace shows the three records PR #6910 added on the Worker:
 *
 *   · the actor's name on each closing event in the Audit tab, and
 *     "Not recorded" when the read has none (never "Name not shown yet");
 *   · who confirmed the wire instructions by phone, on the transfer, and a
 *     Record transfer field that names an Admin (sent only on a
 *     phone-verified transfer, as an integer id; the Worker's refusal shows);
 *   · after close, each received line In Portfolio or not: an admin's read
 *     carries the position and links it, the founder's carries the label
 *     only, an investor's carries neither and nothing is drawn.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';
import {
  ok, auditRows, transferRows, phoneCell, transferBody, verifierOptions,
  portfolioRows, companyHref,
} from '../src/pages/investor/deals/closingWorkspaceModel.js';
import { NOT_RECORDED } from '../src/lib/absence.js';

const read = (rel) => readFileSync(rel, 'utf8');
const MODEL = codeOnly(read('frontend/src/pages/investor/deals/closingWorkspaceModel.js'));
const WS = codeOnly(read('frontend/src/pages/investor/deals/ClosingWorkspace.jsx'));
const ZONE = codeOnly(read('frontend/src/pages/investor/deals/ClosingZone.jsx'));

test('a closing event names its actor; an account gone or unnamed reads Not recorded', () => {
  const a = auditRows({
    events: ok([]),
    transfers: { state: 'ready', rows: [] },
    paper: { state: 'ready', rows: [] },
    closing: ok({ events: [
      { event: 'opened', created_at: '2026-11-01T09:00', actor_user_id: 4, actor_name: 'Name A' },
      { event: 'line_added', created_at: '2026-11-02T09:00', actor_user_id: 9, actor_name: null },
      { event: 'closed', created_at: '2026-11-03T09:00', actor_user_id: 5, actor_name: '   ' },
    ] }),
  });
  const byWhat = Object.fromEntries(a.rows.map((r) => [r.what, r]));
  assert.equal(byWhat['Closing opened'].who, 'Name A');
  assert.equal(byWhat['Line added'].who, null, 'a null name is not replaced by another');
  assert.equal(byWhat['Line added'].whoNote, NOT_RECORDED);
  assert.equal(byWhat['Closing closed'].who, null, 'a blank name is absent');
  const closingLoop = MODEL.slice(MODEL.indexOf('for (const ev of closing.value.events'));
  assert.ok(!closingLoop.slice(0, 400).includes('Name not shown yet'), 'a closing event no longer says Name not shown yet');
  assert.match(MODEL, /import \{ NOT_RECORDED, text \} from '..\/..\/..\/lib\/absence\.js'/);
  assert.ok(!/const NOT_RECORDED\s*=/.test(MODEL), 'NOT_RECORDED is imported, not redeclared');
});

test('a phone-verified transfer names who confirmed it; never the recorder in its place', () => {
  const t = transferRows(ok([
    { uid: 'a', amount_cents: 100, recorded_at: '2026-11-09', recorded_by_name: 'Name A', phone_verified: 1, phone_verified_by: 7, phone_verified_by_name: 'Name C' },
    { uid: 'b', amount_cents: 100, recorded_at: '2026-11-08', recorded_by_name: 'Name A', phone_verified: 1, phone_verified_by: null, phone_verified_by_name: null },
    { uid: 'c', amount_cents: 100, recorded_at: '2026-11-07', recorded_by_name: 'Name A', phone_verified: 0, phone_verified_by_name: 'Name C' },
  ]));
  const [a, b, c] = t.rows;
  assert.equal(a.phoneVerifiedBy, 'Name C');
  assert.deepEqual(phoneCell(a), { key: 'done', word: 'Yes', glyph: '✓', by: 'Name C' });
  assert.equal(b.phoneVerifiedBy, null);
  assert.equal(phoneCell(b).by, NOT_RECORDED, 'verified with no verifier recorded');
  assert.equal(phoneCell(b).word, 'Yes');
  assert.equal(c.phoneVerifiedBy, null, 'a transfer not verified by phone has no verifier');
  assert.deepEqual(phoneCell(c), { key: 'none', word: 'No', glyph: '–', by: null });
  assert.match(WS, /data-testid=\{`transfer-phone-\$\{t\.uid\}`\}/);
  assert.match(WS, /by \{phoneCell\(t\)\.by\}/);
});

test('Record transfer sends the verifier only on a phone-verified transfer, as an integer Admin id', () => {
  const base = { cents: 5000, reference: 'R-1', note: '', phoneVerified: true, phoneVerifiedBy: '7' };
  assert.deepEqual(transferBody(base), { amount_cents: 5000, reference: 'R-1', phone_verified: true, note: null, phone_verified_by: 7 });
  assert.ok(!('phone_verified_by' in transferBody({ ...base, phoneVerified: false })), 'not verified: no verifier');
  assert.ok(!('phone_verified_by' in transferBody({ ...base, phoneVerifiedBy: '' })), 'Not recorded sends nothing');
  assert.equal(transferBody({ ...base, phoneVerified: false }).phone_verified, false);
  // The verifier may be the recorder (owner answer 1 A); only Admins are offered (2 A).
  const opts = verifierOptions([
    { id: 3, name: 'Name B', role: 'admin', is_active: 1 },
    { id: 9, name: 'Name Z', role: 'partner', is_active: 1 },
    { id: 4, name: 'Name A', role: 'admin', is_active: 1 },
    { id: 5, name: 'Name D', role: 'admin', is_active: 0 },
  ], { id: 4 });
  assert.deepEqual(opts, [{ id: 4, label: 'You · Name A' }, { id: 3, label: 'Name B' }]);
  // The dialog: the field is an Admin's, read from the Admins list, off until verified by phone.
  assert.match(ZONE, /api\.listUsers\('admin'\)/);
  assert.match(ZONE, /transferBody\(\{ \.\.\.wireForm, cents \}\)/);
  assert.match(ZONE, /isAdminUser \? \(/);
  assert.match(ZONE, /disabled=\{!wireForm\.phoneVerified \|\| !Array\.isArray\(verifiers\)\}/);
  assert.match(ZONE, /<option value="">Not recorded<\/option>/);
  // Unticking phone-verified clears the verifier.
  assert.match(ZONE, /phoneVerifiedBy: e\.target\.checked \? wireForm\.phoneVerifiedBy : ''/);
  // The Worker's refusal (phone_verifier_invalid, …) shows as given.
  assert.match(ZONE, /error: cause\?\.message \|\| 'The transfer could not be recorded\.'/);
});

const LINES = [
  { uid: 'L1', investor_name: 'Investor A', route: 'direct', amount_cents: 60000000, status: 'received',
    evidence: [{ side: 'receiving', created_at: '2026-11-09T10:00', accepted_at: '2026-11-10T10:00' }] },
  { uid: 'L2', investor_name: null, route: null, amount_cents: 25000000, status: 'received', evidence: [] },
  { uid: 'L3', investor_name: 'Investor E', amount_cents: 1, status: 'withdrawn', evidence: [] },
];

test('after close, an admin reads each received line In Portfolio with its position, or not', () => {
  const admin = { status: 'closed', project_id: 12, lines: [
    { ...LINES[0], in_portfolio: true, portfolio_position_uid: 'pos-1' },
    { ...LINES[1], in_portfolio: false, portfolio_position_uid: null },
    { ...LINES[2], in_portfolio: false, portfolio_position_uid: null },
  ] };
  const p = portfolioRows(admin);
  assert.equal(p.state, 'ready');
  assert.deepEqual(p.rows.map((r) => r.uid), ['L1', 'L2'], 'a withdrawn line is not listed');
  assert.equal(p.inPortfolio, 1);
  assert.deepEqual(p.rows[0].status, { key: 'done', word: 'In Portfolio', glyph: '✓' });
  assert.equal(p.rows[0].positionUid, 'pos-1');
  assert.equal(p.rows[0].received, '2026-11-10', 'the receiving evidence, accepted');
  assert.equal(p.rows[1].status.word, 'Not in Portfolio');
  assert.equal(p.rows[1].positionUid, null);
  assert.equal(p.rows[1].name, NOT_RECORDED);
  assert.equal(p.rows[1].received, null);
  // The link goes to the venture's Portfolio page, found by project id; never guessed.
  assert.equal(companyHref({ items: [{ project_id: 11, project: { uid: 'x' } }, { project_id: 12, project: { uid: 'tide/1' } }] }, 12), '/portfolio/companies/tide%2F1');
  assert.equal(companyHref({ items: [{ project_id: 11, project: { uid: 'x' } }] }, 12), null);
  assert.match(WS, /isAdmin && r\.positionUid && href/);
  assert.match(WS, /api\.positionsList\(\)/);
});

test('the founder reads only In Portfolio; an investor and an open closing draw nothing', () => {
  const founder = { status: 'closed', lines: [{ ...LINES[0], in_portfolio: true }, { ...LINES[1], in_portfolio: false }] };
  const p = portfolioRows(founder);
  assert.equal(p.state, 'ready');
  assert.equal(p.rows[0].status.word, 'In Portfolio');
  assert.equal(p.rows[0].positionUid, null, 'the founder has no position to link');
  const investor = { status: 'closed', lines: [LINES[0]] };
  assert.equal(portfolioRows(investor).state, 'hidden', 'an investor’s read carries no in_portfolio');
  assert.equal(portfolioRows({ ...founder, status: 'open' }).state, 'hidden', 'only after close');
  assert.equal(portfolioRows(null).state, 'hidden');
  // A stray uid on a line that is not in Portfolio links nothing.
  assert.equal(portfolioRows({ status: 'closed', lines: [{ ...LINES[0], in_portfolio: false, portfolio_position_uid: 'pos-9' }] }).rows[0].positionUid, null);
  assert.match(WS, /portfolio\.state === 'ready' \? <PortfolioTable/);
  assert.match(WS, /const needsCompany = isAdmin && /);
});
