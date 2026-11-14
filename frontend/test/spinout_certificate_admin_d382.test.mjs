/**
 * D382 — the Spin-Out Lab certificate admin tab, against the admin artboard of
 * `design/canvases/out-of-scope/Graduation Certificate.dc.html`.
 *
 * The board is RENDERED (react-dom/server) with registry data shaped as
 * `GET /spinout-lab/certificates` returns it, so these assert on what an admin
 * reads: counts that come from rows, the canvas's Emailed / Downloaded and its
 * Reissue stated rather than drawn, and a failed read said as one.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_certificate_admin_d382.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import {
  CertificatesBoard, certificateRows, certificateActivity,
  NOT_EMAILED_REASON, NOT_DOWNLOADED_REASON, REISSUE_REASON,
} from '../src/pages/admin/AdminSpinoutCertificates.jsx';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const TAB = read('../src/pages/admin/AdminSpinoutCertificates.jsx');
const LAB = read('../src/pages/admin/AdminSpinoutLab.jsx');
const CANVAS = read('../../design/canvases/out-of-scope/Graduation Certificate.dc.html');

const DATA = {
  certificates: [
    { id: 2, user_id: 118, credential_id: 'AXL-SOL-C4-260802-0118', public_token: 'tok2', public_name: 'Bo Graduate',
      public_company: 'Bo Co', public_issued_on: '2026-08-02', status: 'revoked', revoked_at: '2026-08-05 09:00:00',
      revocation_reason: 'Company withdrew', public_share_enabled: 1, issued_at: '2026-08-02 11:00:00',
      issued_by_name: 'Admin One' },
    { id: 1, user_id: 117, credential_id: 'AXL-SOL-C4-260731-0117', public_token: 'tok1', public_name: 'Ada Graduate',
      public_company: 'Ada Co', public_issued_on: '2026-07-31', status: 'issued', revoked_at: null,
      revocation_reason: null, public_share_enabled: 0, issued_at: '2026-07-31 15:00:00', issued_by_name: null },
  ],
  awaiting: [{ user_id: 120, name: 'Di Waiting', conferred_at: '2026-08-09 10:00:00' }],
  eligible_total: 3,
  unavailable: {},
};
const noop = () => {};
const board = (data, extra = {}) => renderToStaticMarkup(React.createElement(CertificatesBoard, {
  data, onToggleBatch: noop, onIssue: noop, onRevoke: noop, onIssueAll: noop, onRefresh: noop, ...extra,
}));
const text = (data, extra) => renderedText(board(data, extra));
/** A KPI card's value: the text of its first inner block, read off the card's own element. */
const kpiValue = (html, id) => {
  const marker = `data-testid="${id}">`;
  const at = html.indexOf(marker);
  assert.ok(at > 0, `the ${id} card is gone`);
  return renderedText(html.slice(at + marker.length, html.indexOf('</div>', at)));
};

// ---------------------------------------------------------------------------

test('the canvas artboard draws what this tab answers', () => {
  for (const el of ['Issue all eligible', 'Activity log', "col('Emailed')", "col('Downloaded')", "'Reissue'", "'Resend'"]) {
    assert.ok(CANVAS.includes(el), `the canvas's admin artboard no longer draws ${el}`);
  }
});

test('the tab is reachable from the Spin-Out Lab console', () => {
  assert.match(LAB, /data-testid="tab-certificates"/);
  assert.match(codeOnly(LAB), /section === 'certificates' \? \(\s*<AdminSpinoutCertificates \/>/);
  assert.doesNotMatch(codeOnly(LAB), /function CertificateBackfillRow/, 'the old backfill row came back beside the tab');
});

test('the counts come from the rows the registry sent', () => {
  const html = board(DATA);
  assert.equal(kpiValue(html, 'cert-kpi-eligible'), '3');
  assert.equal(kpiValue(html, 'cert-kpi-issued'), '1', 'a revoked credential was counted as issued');
  const out = text(DATA);
  assert.ok(out.includes('3 founders have reached graduation · 1 awaiting a certificate'));
});

test('Emailed and Downloaded are stated, never counted', () => {
  const html = board(DATA);
  for (const id of ['cert-kpi-emailed', 'cert-kpi-downloaded']) {
    assert.equal(kpiValue(html, id), 'Not recorded', `${id} draws a number`);
  }
  const out = text(DATA);
  assert.ok(out.includes(NOT_EMAILED_REASON) && out.includes(NOT_DOWNLOADED_REASON));
  // Every row's two delivery cells: 3 rows × 2, plus the states card's 2.
  assert.ok(html.split(NOT_EMAILED_REASON).length - 1 >= 4, 'a row or the states card lost its Emailed reason');
  assert.ok(!/Resend/.test(out), 'a Resend control is drawn for an email nothing sends');
});

test('each row offers only what the worker will do', () => {
  const html = board(DATA);
  const row = (kind) => html.slice(html.indexOf(`data-testid="cert-row-${kind}"`), html.indexOf('</tr>', html.indexOf(`data-testid="cert-row-${kind}"`)));
  assert.match(row('awaiting'), /data-testid="cert-issue"/);
  assert.doesNotMatch(row('awaiting'), /cert-revoke/);
  assert.match(row('issued'), /data-testid="cert-revoke"/);
  assert.doesNotMatch(row('issued'), /cert-issue"/);
  // Sharing off: no public preview link, and the row says why.
  assert.doesNotMatch(row('issued'), /\/verify\//, 'a preview link points at a page the holder closed');
  assert.match(renderedText(row('issued')), /Public verification off/);
  // Revoked: no Issue, no Reissue button — the collision is stated.
  assert.doesNotMatch(row('revoked'), /<button/, 'a revoked row offers a button that would collide');
  assert.ok(renderedText(row('revoked')).includes(REISSUE_REASON));
});

test('an issued, shared credential previews its own public page', () => {
  const shared = { ...DATA, certificates: [{ ...DATA.certificates[1], public_share_enabled: 1 }] };
  assert.match(board(shared), /href="\/verify\/tok1"/);
});

test('Preview batch narrows the table to the graduates the batch would issue', () => {
  const html = board(DATA, { onlyAwaiting: true });
  const table = renderedText(html.slice(html.indexOf('data-testid="cert-table"'), html.indexOf('</table>')));
  assert.ok(table.includes('Di Waiting'));
  assert.ok(!table.includes('Ada Graduate'), 'the batch preview shows graduates it would not issue');
});

test('the activity log is the registry’s own events, attributed as recorded', () => {
  const events = certificateActivity(DATA.certificates);
  assert.deepEqual(events.map((e) => e.title), ['Credential revoked', 'Certificate issued', 'Certificate issued']);
  assert.match(events[0].detail, /Company withdrew/);
  assert.match(events.find((e) => e.key === 'i-1').detail, /issued automatically on graduation/);
  assert.match(events.find((e) => e.key === 'i-2').detail, /issued by Admin One/);
  const out = text(DATA);
  assert.ok(out.includes('Downloads, emails, badge awards and template edits are not recorded'));
  assert.ok(!/Badge awarded|Template updated|Certificate downloaded/.test(out), 'the log draws an event nothing records');
});

test('an unreadable graduate list is said as one, not as an empty queue', () => {
  const failed = { ...DATA, awaiting: null, eligible_total: null, unavailable: { awaiting: 'The graduate list could not be read.' } };
  const out = text(failed);
  assert.ok(out.includes('The graduate list could not be read'));
  assert.ok(out.includes('The graduate count could not be read'));
  assert.ok(!/0 awaiting/.test(out), 'a failed read printed an empty queue');
  // The states card's own row: the count is replaced by the failure, not by 0.
  assert.match(out, /Awaiting issue\s*The graduate list could not be read/,
    'the states card prints a number for a queue it could not read');
  assert.match(kpiValue(board(failed), 'cert-kpi-eligible'), /^\s*The graduate count could not be read/,
    'a failed read was called unrecorded, or given a number');
});

test('certificateRows puts the waiting graduates first and keeps absent names null', () => {
  const rows = certificateRows({ ...DATA, awaiting: [{ user_id: 5, name: null, conferred_at: null }] });
  assert.equal(rows[0].kind, 'awaiting');
  assert.equal(rows[0].name, null);
  assert.deepEqual(rows.map((r) => r.kind), ['awaiting', 'revoked', 'issued']);
});

test('Issue sends only the graduate; the worker builds the credential from their records', () => {
  const code = codeOnly(TAB);
  assert.match(code, /api\.spinoutCertificateIssue\(\{ user_id: row\.userId \}\)/);
  assert.doesNotMatch(code, /spinoutCertificateIssue\(\{[^}]*public_name/, 'the tab sends an admin-typed name');
  assert.match(code, /api\.spinoutCertificateRevoke\(Number\(row\.id\), reason\.trim\(\)\)/);
  // A refusal prints the worker's own sentence.
  assert.match(code, /setRowError\(\(m\) => \(\{ \.\.\.m, \[row\.key\]: e\?\.message/);
});
