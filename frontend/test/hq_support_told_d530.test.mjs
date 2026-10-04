/**
 * D530 — once HQ authorises a support session on a branch account, the
 * Support form says what the branch reported about its security notice.
 *
 * The branch's `openSupportSession` returns `target_notified` (D441): `true`
 * when the notice was stored in the person's inbox there, `false` when it
 * could not be stored and the session was authorised anyway. HQ's route now
 * passes that on, and `null` when the branch sent nothing usable
 * (cloudflare-worker/test/branch_support_session_d259.test.ts drives that half
 * through the bundled Worker). This file holds the form's half: the three
 * sentences, the line that draws them, and the wiring from the answer to the
 * line. Only `true` is ever "Told", so a missing or malformed field can never
 * read as delivery.
 *
 * Rendered where rendering can see it (the outcome line for every value),
 * read as source where it cannot (the submit handler, which only runs once the
 * form is open and the route has answered).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_support_told_d530.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { supportNoticeOutcome, SupportNoticeOutcome } from '../src/pages/hq/HqTeamTable.jsx';

const TEAM = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/hq/HqTeamTable.jsx'), 'utf8'));

/** `MoveHit`'s own body, bounded by the next top-level function. */
function moveHit() {
  const a = TEAM.indexOf('export function MoveHit(');
  assert.ok(a >= 0, 'MoveHit is gone');
  const b = TEAM.indexOf('\nfunction ', a + 1);
  return TEAM.slice(a, b > a ? b : TEAM.length);
}

const line = (told) => renderToStaticMarkup(React.createElement(SupportNoticeOutcome, { told }));
const NOT_REPORTED = [undefined, null, 'yes', 'true', 'false', 1, 0, {}, []];

test('D530: true is Told, and says the notice was stored without claiming the email arrived', () => {
  const o = supportNoticeOutcome(true);
  assert.equal(o.state, 'told');
  assert.match(o.text, /^Told: /);
  assert.match(o.text, /security notice was stored in their inbox there\./);
  assert.match(o.text, /Whether the email copy arrived is not reported\./);
  assert.doesNotMatch(o.text, /email (?:was )?(?:sent|delivered|received)/i);
});

test('D530: false is Not told, and says the session is authorised all the same', () => {
  const o = supportNoticeOutcome(false);
  assert.equal(o.state, 'not_told');
  assert.match(o.text, /^Not told: /);
  assert.match(o.text, /could not be stored, so it sent them nothing\./);
  assert.match(o.text, /The session is authorised all the same\./);
});

test('D530: anything but a boolean is Not recorded with its reason, and never Told', () => {
  for (const v of NOT_REPORTED) {
    const o = supportNoticeOutcome(v);
    assert.equal(o.state, 'not_recorded', `${JSON.stringify(v)} was not read as "not recorded"`);
    assert.match(o.text, /^Not recorded: the branch did not report whether its security notice was stored\./);
    assert.match(o.text, /A branch built before D441 does not report it\./, 'the reason is missing');
    assert.doesNotMatch(o.text, /^(?:Not )?[Tt]old/);
  }
});

test('D530: the line draws each outcome, and only Not told is drawn in the warning colour', () => {
  const told = line(true);
  assert.match(told, /data-testid="hq-team-support-told"/);
  assert.match(told, /data-state="told"/);
  assert.match(told, />Told: the branch reports that its security notice was stored/);
  assert.doesNotMatch(told, /text-rose-700/);

  const notTold = line(false);
  assert.match(notTold, /data-state="not_told"/);
  assert.match(notTold, />Not told: the branch reports that its security notice could not be stored/);
  assert.match(notTold, /text-rose-700/);

  for (const v of NOT_REPORTED) {
    const html = line(v);
    assert.match(html, /data-state="not_recorded"/, `${JSON.stringify(v)} did not draw "not recorded"`);
    assert.match(html, />Not recorded: /);
    assert.doesNotMatch(html, />(?:Not )?[Tt]old: /);
    assert.doesNotMatch(html, /text-rose-700/);
  }
});

test('D530: the form keeps the route\'s target_notified as answered and draws the line once the session is authorised', () => {
  const body = moveHit();
  // Starts as nothing reported, never as told.
  assert.match(body, /const \[supportTold, setSupportTold\] = useState\(undefined\);/);
  // Set from the route's own answer, in the same success branch as the URL.
  const submit = body.slice(body.indexOf('api.hqSupportSession('), body.indexOf('} catch (ex) {', body.indexOf('api.hqSupportSession(')));
  assert.match(submit, /setSupportUrl\(res\.open_url\);\s*setSupportTold\(res\?\.target_notified\);/,
    'the form does not keep target_notified from the answer that opened the session');
  assert.doesNotMatch(body, /setSupportTold\((?!res\?\.target_notified\))/, 'something else writes supportTold');
  // Drawn only after the session is authorised, from that state and nothing else.
  assert.match(body, /\{supportUrl && <SupportNoticeOutcome told=\{supportTold\} \/>\}/);
  assert.equal(body.split('<SupportNoticeOutcome').length - 1, 1, 'the outcome line is drawn more than once');
});
