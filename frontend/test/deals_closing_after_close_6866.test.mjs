/**
 * D6866 part 2 (#6866, canvas D6158 DX23 A and DX27 A) — the after-close
 * view of the closing workspace.
 *
 *   · after close, four figures: lines received (withdrawn named, not
 *     counted), the total recorded in transfers, executed paper and the
 *     reporting duties owed on this closing's lines (an Admin's read of the
 *     venture's desk, filtered by the duty's own closing_line_uid); a read
 *     that failed says Unavailable, never 0;
 *   · the founder's cap-table decision as a word and a glyph with its date,
 *     and "date not recorded" when the read carries none.
 * DX27 A on a phone (My vote and Vote) is D6151 part 3's `CommitPhone.jsx`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  ok, LOADING, UNREADABLE, afterCloseFigures, captableCard, transferRows, paperRows,
} from '../src/pages/investor/deals/closingWorkspaceModel.js';
import { AfterCloseFigures, CaptableCard } from '../src/pages/investor/deals/ClosingWorkspace.jsx';

const h = React.createElement;
const WS = codeOnly(readFileSync('frontend/src/pages/investor/deals/ClosingWorkspace.jsx', 'utf8'));

const CLOSED = {
  status: 'closed', project_id: 7, currency: 'USD',
  captable: { state: 'accepted', decided_at: '2026-12-02T10:00:00' },
  lines: [
    { uid: 'la', status: 'received', investor_name: 'Investor A', amount_cents: 60000000 },
    { uid: 'lb', status: 'received', investor_name: 'Investor B', amount_cents: 40000000 },
    { uid: 'le', status: 'withdrawn', investor_name: 'Investor E', amount_cents: 10000000 },
  ],
};
const TRANSFERS = transferRows(ok([
  { uid: 't1', amount_cents: 60000000, recorded_at: '2026-11-09' },
  { uid: 't2', amount_cents: 40000000, recorded_at: '2026-11-11' },
]));
const PAPER = paperRows(ok([
  { id: 1, deal_id: 4, status: 'completed', completed_at: '2026-11-10' },
  { id: 2, deal_id: 4, status: 'completed', completed_at: '2026-11-11' },
  { id: 3, deal_id: 4, status: 'voided' },
  { id: 4, deal_id: 9, status: 'completed' },
]), 4);
const DESK = ok({ duties: [
  { uid: 'd1', closing_line_uid: 'la', source: { kind: 'signed_envelope' } },
  { uid: 'd2', closing_line_uid: 'lb', source: { kind: 'signed_envelope' } },
  { uid: 'd3', closing_line_uid: 'other-closing-line', source: { kind: 'signed_envelope' } },
] });
const byKey = (f) => Object.fromEntries(f.figures.map((x) => [x.key, x]));

test('after close: lines received, the recorded total, executed paper and this closing’s duties', () => {
  assert.equal(afterCloseFigures({ closing: { ...CLOSED, status: 'open' }, transfers: TRANSFERS, paper: PAPER, duties: DESK }).state, 'hidden');
  assert.equal(afterCloseFigures({ closing: null }).state, 'hidden');
  const f = byKey(afterCloseFigures({ closing: CLOSED, transfers: TRANSFERS, paper: PAPER, duties: DESK }));
  assert.deepEqual(Object.keys(f), ['lines', 'total', 'paper', 'duties']);
  assert.equal(f.lines.value, '2 of 2', 'a withdrawn line is not counted');
  assert.equal(f.lines.note, 'Investor E withdrawn, not counted');
  assert.equal(f.total.cents, 100000000);
  assert.equal(f.total.note, '2 transfers recorded, all time');
  assert.equal(f.paper.value, '2', 'executed means completed on this deal only');
  assert.equal(f.duties.value, '2', 'a duty on another closing’s line is not counted');
  assert.equal(f.duties.note, 'created from the signed paper');
  const mixed = byKey(afterCloseFigures({ closing: CLOSED, transfers: TRANSFERS, paper: PAPER, duties: ok({ duties: [
    { closing_line_uid: 'la', source: { kind: 'signed_envelope' } }, { closing_line_uid: 'lb', source: { kind: 'closing_template' } },
    { closing_line_uid: 'la', source: { kind: 'closing_template' } },
  ] }) }));
  assert.equal(mixed.duties.value, '3');
  assert.equal(mixed.duties.note, '1 from the signed paper, 2 from the closing template');
  const none = byKey(afterCloseFigures({ closing: { ...CLOSED, lines: CLOSED.lines.slice(0, 2) }, transfers: TRANSFERS, paper: PAPER, duties: ok({ duties: [] }) }));
  assert.equal(none.duties.value, '0');
  assert.equal(none.duties.note, 'None recorded on this closing’s lines');
  assert.equal(none.lines.note, 'No line withdrawn');
});

test('after close: a failed read is Unavailable, a pending one Reading, never 0; no desk read, no duties figure', () => {
  const f = byKey(afterCloseFigures({ closing: CLOSED, transfers: { state: 'unreadable' }, paper: { state: 'loading' }, duties: UNREADABLE }));
  assert.equal(f.total.unavailable, true);
  assert.equal(f.total.cents, undefined);
  assert.equal(f.paper.loading, true);
  assert.equal(f.duties.unavailable, true);
  assert.equal(byKey(afterCloseFigures({ closing: CLOSED, transfers: TRANSFERS, paper: PAPER, duties: LOADING })).duties.loading, true);
  const noDesk = afterCloseFigures({ closing: CLOSED, transfers: TRANSFERS, paper: PAPER, duties: null });
  assert.deepEqual(noDesk.figures.map((x) => x.key), ['lines', 'total', 'paper']);
  const out = renderToStaticMarkup(h(AfterCloseFigures, { figures: afterCloseFigures({ closing: CLOSED, transfers: { state: 'unreadable' }, paper: PAPER, duties: UNREADABLE }).figures, currency: 'USD', onRetry() {} }));
  assert.match(out, /data-testid="after-close-total"[^]*?Unavailable[^]*?Try again/);
  assert.match(out, /data-testid="after-close-duties"[^]*?Unavailable/);
  assert.ok(!/after-close-total[^]*?>0</.test(out.split('after-close-paper')[0]), 'an unreadable total never reads 0');
  const good = renderToStaticMarkup(h(AfterCloseFigures, { figures: afterCloseFigures({ closing: CLOSED, transfers: TRANSFERS, paper: PAPER, duties: DESK }).figures, currency: 'USD', onRetry() {} }));
  assert.match(good, /\$1,000,000/);
  assert.match(good, /grid-cols-2[^"]*lg:grid-cols-4/, 'two by two on a phone, four across on a desk');
});

test('the cap-table card says who decided and when, and never invents a date', () => {
  assert.deepEqual(captableCard(CLOSED), { status: { key: 'done', word: 'Accepted', glyph: '✓' }, sentence: 'Accepted by the founder on 2026-12-02.', date: '2026-12-02' });
  const d = captableCard({ captable: { state: 'dismissed', decided_at: '2026-12-03' } });
  assert.equal(d.sentence, 'Dismissed by the founder on 2026-12-03.');
  assert.equal(d.status.word, 'Dismissed');
  assert.equal(captableCard({ captable: { state: 'accepted', decided_at: null } }).sentence, 'Accepted by the founder · date not recorded.');
  assert.equal(captableCard({ captable: { state: 'proposed' } }).sentence, 'Proposed · Waiting on the founder.');
  assert.equal(captableCard({}).status.word, 'Not recorded');
  const out = renderToStaticMarkup(h(CaptableCard, { card: captableCard(CLOSED) }));
  assert.match(out, /Cap-table proposal/);
  assert.match(out, /aria-hidden="true"[^>]*>✓<\/i>Accepted/);
});

test('the workspace asks the reporting desk only as an Admin, only after close, and draws the figures there', () => {
  assert.match(WS, /import \{ reportingApi \} from '..\/..\/..\/lib\/api\/reporting'/);
  assert.match(WS, /const needsDuties = isAdmin && closingRec\?\.status === 'closed' && closingRec\?\.project_id != null/);
  assert.match(WS, /if \(!needsDuties\) return undefined;/);
  assert.match(WS, /reportingApi\.desk\(projectId\)/);
  assert.match(WS, /duties: isAdmin \? duties : null/);
  const closed = WS.slice(WS.indexOf("rules.state === 'closed'"), WS.indexOf('id="close-rules-list"'));
  assert.match(closed, /<AfterCloseFigures/);
  assert.match(closed, /<CaptableCard card=\{captableCard\(closingRec\)\}/);
  assert.match(closed, /<PortfolioTable/);
});
