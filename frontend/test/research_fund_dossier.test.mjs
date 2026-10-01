/**
 * `/research/funds/:uid` — the reading room for one researched fund.
 *
 * The list stays a shortlist. This page is where a blank cheque stays blank,
 * a pass without a reason says so, and the brief (D312) is drafted from this
 * one row, on the press, and appended to the note. It does not score the fund
 * and it does not email them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const page = read('frontend/src/pages/research/FundDossier.jsx');
const app = read('frontend/src/App.jsx');
const list = read('frontend/src/pages/research/FundsZone.jsx');
const api = read('frontend/src/lib/api.js');

test('the dossier route is founder and admin, and the list links to it', () => {
  assert.match(app, /path="\/research\/funds\/:uid"/);
  assert.match(app, /<FundDossier role=\{researchRole\} \/>/);
  const route = app.slice(app.indexOf('path="/research/funds/:uid"'), app.indexOf('path="/research/funds/:uid"') + 240);
  assert.match(route, /labRoles\(\['admin', 'founder'\]\)/);
  assert.match(list, /to=\{`\/research\/funds\/\$\{encodeURIComponent\(f\.uid\)\}`\}/);
  assert.match(api, /fundGet: \(uid\) => request\(`\/research\/funds\/\$\{encodeURIComponent\(uid\)\}`\)/);
});

test('the page states what it will not do', () => {
  // D312 — the brief is a model draft now, so "drafts an approach" would be
  // false. What stays true, and is pinned: no score, no ranking, nothing sent.
  assert.match(page, /Nothing here scores a fund for you, ranks your list, or writes to the fund\./);
  assert.match(page, /Passed with no reason recorded — worth adding one before you rediscover them\./);
  assert.match(page, /A blank stays blank — it is never written as 0\./);
  assert.match(page, /Accept writes your note\. It does not email them\./);
  assert.match(page, /Record a thesis or a note first — there is nothing to draft from\./);
  assert.match(page, /It will not name a partner, cite an AUM, or assume an introduction\./);
  // The brief goes through the one draft band every zone uses, scoped to this
  // fund, never a second AI path; and the local band that saved its own
  // explanatory sentence as the note is gone.
  assert.doesNotMatch(page, /aiWorkspace|fundSheet/);
  const band = page.slice(page.indexOf('<ZoneDraft'), page.indexOf('/>', page.indexOf('<ZoneDraft')));
  assert.match(band, /surface="research\/funds"/);
  assert.match(band, /scopeKey=\{fund\.uid\}/);
  assert.match(band, /\bscoped\b/);
  assert.match(band, /onAccepted=\{load\}/, 'the note on the page would be stale after Accept wrote it');
  assert.doesNotMatch(page, /draftRestatement|Draft restates only what is on this page/);
  assert.doesNotMatch(page, /\/example\\.com\/i/,
    'a host check must parse the URL; a substring match treats example.com.evil as the sample host');
  assert.match(page, /host === 'example.com'/);
});

test('a blank cheque field parses to null and never to zero', () => {
  assert.match(page, /if \(!raw\) return \{ cents: null \}/);
  assert.doesNotMatch(page, /cents: 0|cents: raw \? |cheque_min_cents \|\| 0|cheque_max_cents \?\? 0/);
  assert.match(page, /placeholder="blank"/);
});

test('stage, path and status stay three selects', () => {
  assert.match(page, /<option value="">Stage not assessed<\/option>/);
  assert.match(page, /Stage not assessed/);
  assert.match(page, /fund\.stage_fit === 'right' \? 'ok' : fund\.stage_fit === 'wrong' \? 'warn' : 'neutral'/);
  assert.match(page, /aria-label=\{`Stage fit for \$\{fund\.name\}`\}/);
  assert.match(page, /aria-label=\{`Route in for \$\{fund\.name\}`\}/);
  assert.match(page, /aria-label=\{`Status for \$\{fund\.name\}`\}/);
});
