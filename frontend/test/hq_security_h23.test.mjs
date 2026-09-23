/**
 * D200 — H23's Security page, rendered where it can be and read where it cannot.
 *
 * WHAT IS RENDERED. The Sanctions card, the Backup / DR card, the ledger's bar
 * sentence and the DSR branch sentence are pure over their props, so their
 * states are RENDERED here rather than matched as source text. A guard that
 * reads the source cannot see a component that stopped drawing: a branch can
 * keep its text and stop running, and only the output notices.
 *
 * WHAT IS READ. The ledger table sits inside a page that loads in an effect,
 * which `renderToStaticMarkup` never runs, and `hq_governance_h7` requires the
 * table to stay inside its zone — so H23's one typographic rule for it, one
 * monospace face across the whole ledger, is a bounded scan of the table.
 *
 * Pinned elsewhere and deliberately not repeated: the five columns and their
 * order (hq_governance_h7), the Failed sign-ins expression and the
 * unreadable-before-loading order in both cards (hq_security).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  Sanctions, BackupDr, securityEventsBar, dsrBranchesSentence,
} from '../src/pages/hq/SecurityPage.jsx';

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(resolve(here, '../src/pages/hq/SecurityPage.jsx'), 'utf8');
const CODE = codeOnly(PAGE);
const render = (C, props) => renderToStaticMarkup(React.createElement(C, props));

const HOW = 'Screening runs on request from the Trust Center Sanctions tab. Nothing schedules it, so a count of zero is a measured zero.';
const DRILL = { available: false, reason: 'The restore drill writes its outcome nowhere the platform can read.' };

// ─────────────────────────────────────────────────────────── the ledger ──

test('the whole ledger is set in one monospace face, and no cell opts out of it', () => {
  const at = PAGE.indexOf('data-testid="hq-gov-feed"');
  assert.ok(at > 0, 'the ledger table lost its test id');
  const table = PAGE.slice(PAGE.lastIndexOf('<table', at), PAGE.indexOf('</table>', at));
  const tableClass = /^<table className="([^"]*)"/.exec(table);
  assert.ok(tableClass, 'the ledger table no longer carries a literal className');
  const inherited = /\bfont-mono\b/.test(tableClass[1]);

  const body = table.slice(table.indexOf('<tbody>'), table.indexOf('</tbody>'));
  assert.ok(body.length > 0, 'the ledger has no <tbody> — this scan would be vacuous');
  const cells = [...body.matchAll(/<td className=(\{`[^`]*`\}|"[^"]*")/g)].map((m) => m[1]);
  assert.equal(cells.length, 5, 'a ledger row no longer has H23\'s five cells');
  // Monospace is what a cell RENDERS: the table's face when it sets one, or
  // the cell's own. A cell may never set a proportional face over it.
  cells.forEach((c, i) => {
    assert.ok(inherited || /\bfont-mono\b/.test(c), `ledger cell ${i + 1} is not monospace`);
  });
  assert.doesNotMatch(body, /\bfont-(?:sans|serif)\b/, 'a ledger cell set a proportional face over the monospace ledger');
});

test('the bar has three states, and none of them is a count it did not measure', () => {
  assert.equal(securityEventsBar(false, null, false), 'security_events · …');

  const failed = securityEventsBar(false, null, true);
  assert.match(failed, /^security_events · unreadable · /, 'a failed overview read kept the waiting ellipsis');
  assert.doesNotMatch(failed, /…|\d/);

  assert.equal(securityEventsBar(true, { available: true, today: 7 }, false), 'security_events · append-only · 7 rows today');
  // A measured zero is a figure, and says so.
  assert.equal(securityEventsBar(true, { available: true, today: 0 }, false), 'security_events · append-only · 0 rows today');

  const unread = securityEventsBar(true, { available: false, reason: 'The security_events ledger could not be read (no such table).' }, false);
  assert.equal(unread, 'security_events · unreadable · The security_events ledger could not be read (no such table).');
  for (const se of [{ available: false }, undefined, null]) {
    const s = securityEventsBar(true, se, false);
    assert.match(s, /^security_events · unreadable · /, `a ${JSON.stringify(se)} block fell through to a count`);
    assert.doesNotMatch(s, /rows today|\d/);
  }
  assert.match(CODE, /data-testid="hq-security-events-bar">\s*\{securityEventsBar\(ready, se, data === UNAVAILABLE\)\}/,
    'the bar no longer reads its sentence from the one helper, with the failed-read state passed in');
});

// ──────────────────────────────────────────────── the two corrected cards ──

test('sanctions: a measured zero is four figures and the reason it is zero; an unreadable store is a sentence', () => {
  const zero = render(Sanctions, {
    block: { available: true, runs_total: 0, last_run_at: null, hits_total: 0, unreviewed_hits: 0, how: HOW, path: '/trust' },
  });
  assert.match(zero, /data-testid="hq-sanctions"/);
  for (const label of ['Screening runs', 'Last run', 'Hits', 'Unreviewed hits']) {
    assert.ok(zero.includes(label), `the ${label} figure is not drawn`);
  }
  assert.equal((zero.match(/>0</g) || []).length, 3, 'a measured zero did not render as the figure 0 on runs, hits and unreviewed');
  assert.ok(zero.includes('none has been asked for'), 'a zero does not say nobody asked for a screen');
  assert.ok(zero.includes('>never<'), 'a store with no run does not say the last run was never');
  assert.ok(zero.includes(HOW), 'the on-request sentence does not reach the card');
  assert.match(zero, /href="\/trust"/, 'the card does not point at the Trust Center, where screening runs');
  assert.ok(!zero.includes('Not recorded'), 'a measured zero was drawn as an absence');

  const hit = render(Sanctions, {
    block: { available: true, runs_total: 5, last_run_at: '2026-09-22T09:14:00Z', hits_total: 2, unreviewed_hits: 1, how: HOW, path: '/trust' },
  });
  assert.ok(hit.includes('2026-09-22 09:14'), 'the last run is not stamped');
  assert.ok(hit.includes('recorded, one row per run'));

  const unread = render(Sanctions, { block: { available: false, reason: 'sanctions_screenings could not be read (no such table).' } });
  assert.match(unread, /data-testid="hq-sanctions-unreadable"/);
  assert.ok(unread.includes('sanctions_screenings could not be read'), 'an unreadable store is not given its reason');
  assert.ok(!unread.includes('Screening runs'), 'an unreadable store drew its figures');
  assert.doesNotMatch(unread, />\d+</, 'an unreadable store drew a number');
});

test('backup / DR: the restore drill stays a stated absence however green the backup half is', () => {
  const green = render(BackupDr, {
    block: { backup: { available: true, kind: 'd1', at: '2026-09-23T02:10:00Z', source: 'gha', size_bytes: 4096 }, drill: DRILL },
  });
  assert.match(green, /data-testid="hq-backup-heartbeat"/);
  assert.ok(green.includes('2026-09-23 02:10'), 'the export is not stamped');
  assert.ok(green.includes('D1 export'));
  const drillAt = green.indexOf('data-testid="hq-restore-drill"');
  assert.ok(drillAt > 0, 'the restore drill is not drawn');
  const drill = green.slice(drillAt);
  assert.ok(drill.includes('Not recorded'), 'a green backup turned the drill green too');
  assert.ok(drill.includes(DRILL.reason), 'the drill is not given its reason');

  const unbound = render(BackupDr, {
    block: { backup: { available: false, reason: 'No BACKUPS R2 binding on this Worker.' }, drill: DRILL },
  });
  assert.match(unbound, /data-testid="hq-backup-unreadable"/);
  assert.ok(unbound.includes('No BACKUPS R2 binding'), 'an unbound bucket is not given its reason');
  assert.ok(!unbound.includes('hq-backup-heartbeat'), 'an unbound bucket drew an export');
  assert.ok(unbound.slice(unbound.indexOf('data-testid="hq-restore-drill"')).includes(DRILL.reason));
});

// ──────────────────────────────────────────────────── data subject requests ──

test('the DSR line says why there is one group, and an unscannable env is not zero branches', () => {
  const r = 'No branch RPC returns a branch\'s erasure requests.';
  assert.equal(dsrBranchesSentence({ bound: 0, reason: r }), 'No branch is bound; every open request is HQ-held.');
  assert.equal(dsrBranchesSentence({ bound: null, reason: r }), `Whether a branch is bound could not be read. ${r}`);
  assert.equal(dsrBranchesSentence({ bound: 1, reason: r }), `1 branch is bound. ${r}`);
  assert.equal(dsrBranchesSentence({ bound: 3, reason: r }), `3 branches are bound. ${r}`);
  assert.match(CODE, /data-testid="hq-dsr-branches">\s*\{dsrBranchesSentence\(dsrBranches\)\}/,
    'the DSR branch line no longer reads the one helper');
  // The groups row draws what the server grouped, never a group the page made up.
  assert.match(CODE, /const dsrGroups = ready \? data\.dsr\?\.by_branch \|\| \[\] : \[\];/);
  assert.match(CODE, /\{dsrGroups\.map\(\(g\) => \(\s*<span key=\{g\.branch\} className="font-mono">\{g\.branch\} · \{num\(g\.open\)\} open<\/span>/,
    'the DSR groups row no longer draws each server group with its open count');
});
