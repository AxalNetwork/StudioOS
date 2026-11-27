/**
 * D157 — the SPA half: a plain admin can see their own privileged actions.
 *
 * The route is the deliverable only if something renders it; a route with no
 * reader is the defect this programme has now found ten times (#252, D142,
 * D149–D153, D155). `/monitoring` is `guard(['admin'])`, so it is the one
 * surface a plain admin already reaches that reads monitoring at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/MonitoringPage.jsx'));
const API = codeOnly(read('frontend/src/lib/api.js'));
const APP = read('frontend/src/App.jsx');

test('the page a plain admin reaches is the one that renders it', () => {
  const line = APP.split('\n').find((l) => l.includes('path="/monitoring"'));
  assert.ok(line, '/monitoring must be registered');
  assert.match(line, /guard\(\['admin'\]/,
    'a self-audit read on a super-admin-only page would answer nobody it was built for');
  assert.match(PAGE, /tab === 'my-actions' \? <MyActionsTab \/>/);
  assert.match(PAGE, /\{ id: 'my-actions', label: 'My actions' \}/);
  // The deep link must reach it, or the tab exists and cannot be linked to.
  assert.match(PAGE, /t === 'my-actions'/, "the ?tab= whitelist does not admit 'my-actions'");
});

test('it reads its own route and nothing else, and the route names the caller nowhere', () => {
  assert.match(API, /monitoringMyAudit: \(limit = 25, offset = 0\) =>/);
  assert.match(API, /\/monitoring\/analytics\/audit\/mine\?limit=/);
  // The identifier is the session's, server-side, so the method takes none.
  assert.doesNotMatch(API, /monitoringMyAudit:[^\n]*admin_user_id/,
    'a method that could name an admin is a method that could name somebody else');
});

test('an unreadable store renders its reason, never an empty feed', () => {
  // `admin_audit_log` is lazily bootstrapped, so its absence is a state this
  // read can genuinely meet — the #204 class, one surface up.
  assert.match(PAGE, /data-testid="my-actions-unreadable"/);
  assert.match(PAGE, /This is not a claim that you have taken no privileged actions\./);
  // The two states must be distinguishable, which is the whole point.
  assert.match(PAGE, /data-testid="my-actions-empty"/);
  assert.match(PAGE, /No privileged action has been recorded against this account\./);
  const unreadable = PAGE.indexOf('my-actions-unreadable');
  const empty = PAGE.indexOf('my-actions-empty');
  assert.ok(unreadable > 0 && empty > 0 && unreadable !== empty,
    'a failed read and an empty one must not render the same thing');
});

test('the feed states whose it is, from the payload rather than from the client', () => {
  assert.match(PAGE, /data-testid="my-actions-scope"/);
  assert.match(PAGE, /data\.scope\?\.admin_user_id/,
    'the scope must be echoed by the server, not assumed by the page');
  assert.match(PAGE, /not readable here, and never was for this tier/,
    'the page must say what it does NOT show — D132 closed that for a reason');
});

test('no figure is defaulted to zero', () => {
  // The page's own rule, and the one the honest-state components exist for.
  const tab = PAGE.slice(PAGE.indexOf('function MyActionsTab'), PAGE.indexOf('export default function MonitoringPage'));
  assert.ok(tab.length > 200, 'the MyActionsTab window is empty — re-aim this slice');
  assert.doesNotMatch(tab, /\|\|\s*0\b/, 'a defaulted zero is a claim nothing measured');
});
