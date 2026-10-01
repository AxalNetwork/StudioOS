/**
 * D203 — HQ · Platform → Switches, and the two Feature-flags stats that now
 * count the operator store.
 *
 * WHAT IS RENDERED. The switch card, its form, the switch list's two halves
 * and the Flags / Overrides builders are pure over their props, so their
 * states are RENDERED here rather than matched as source text — a branch can
 * keep its words and stop drawing, and only the output notices (D200's rule).
 * The pages themselves load in effects, which renderToStaticMarkup never
 * runs, so their wiring is read as source.
 *
 * THE PROPERTIES THIS FILE EXISTS FOR:
 *   - A form the server can only refuse is not drawn: an unreadable store gets
 *     a sentence, never a Throw button.
 *   - The act on offer is fixed by the stored half — a thrown switch offers a
 *     release, never a second throw.
 *   - A release while the deployment holds Eadwyn off says, before the click,
 *     that nobody gets Eadwyn back.
 *   - An unreadable store is never "never thrown", and Overrides is never 0
 *     when the store could not be read.
 *   - Platform keeps its no-handler rule: the control lives on its own page,
 *     reached by one literal link.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  SWITCH_TONE as LIB_TONE, operatorLine, setByLabel, stampMinutes,
} from '../src/lib/platformSwitches.js';
import {
  SwitchList, SWITCH_TONE as PAGE_TONE, UNAVAILABLE, flagsStat, overridesStat,
} from '../src/pages/hq/PlatformPage.jsx';
import { SwitchCard, SwitchForm } from '../src/pages/hq/PlatformSwitchesPage.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PLATFORM = codeOnly(raw('frontend/src/pages/hq/PlatformPage.jsx'));
const SWITCHES_SRC = raw('frontend/src/pages/hq/PlatformSwitchesPage.jsx');
const SWITCHES = codeOnly(SWITCHES_SRC);
const LIB = codeOnly(raw('frontend/src/lib/platformSwitches.js'));
const APP = codeOnly(raw('frontend/src/App.jsx'));
const API = codeOnly(raw('frontend/src/lib/api.js'));
const HELP = raw('frontend/src/pages/docs/sections/admin.js');

const render = (C, props) => renderToStaticMarkup(React.createElement(C, props));
const noop = () => {};

/** One operator switch as GET /switches sends it. */
const eadwyn = ({ state = 'off', deploy = 'off', operator } = {}) => ({
  key: 'eadwyn_off',
  label: 'Eadwyn off',
  state,
  set_by: 'operator',
  effect: 'Eadwyn answers every message with a notice that it is unavailable.',
  writable: true,
  deploy,
  operator: operator ?? {
    available: true, thrown: false, reason: null, set_by_user_id: null,
    set_by_name: null, set_at: null, read_at: '2026-09-23T12:00:00.000Z',
  },
});
const THROWN = {
  available: true, thrown: true, reason: 'Bad index — stopping it while we rebuild.',
  set_by_user_id: 801, set_by_name: 'The Holder', set_at: '2026-09-23 11:59:07',
  read_at: '2026-09-23T12:00:00.000Z',
};
const BLIND = { available: false, reason: 'The operator switch store has not been created on this database yet.' };
const card = (sw) => render(SwitchCard, { sw, propagationSeconds: 30, reasonMin: 10, onDone: noop });

// ───────────────────────────────────────────────────── the stored half ──

test('the operator half says what is stored, and an unreadable store is never "never thrown"', () => {
  assert.equal(operatorLine({ key: 'stripe_tax' }), null, 'a switch with no operator half grew one');
  assert.equal(operatorLine(eadwyn()), 'Never thrown by HQ.');
  assert.equal(
    operatorLine(eadwyn({ operator: THROWN })),
    'Thrown by The Holder at 2026-09-23 11:59 UTC — Bad index — stopping it while we rebuild.',
  );
  assert.match(operatorLine(eadwyn({ operator: { ...THROWN, thrown: false, reason: 'Rebuilt.' } })), /^Released by The Holder/);
  assert.match(operatorLine(eadwyn({ operator: { ...THROWN, set_by_name: null } })), /by account #801 at/,
    'an account that cannot be named is not shown by its id');
  assert.match(operatorLine(eadwyn({ operator: { ...THROWN, set_by_name: null, set_by_user_id: null } })),
    /by an account that was not recorded/);
  const blind = operatorLine(eadwyn({ state: 'unreadable', operator: BLIND }));
  assert.match(blind, /^Unreadable — /);
  assert.ok(!/Never thrown/.test(blind), 'an unreadable store read as a switch nobody threw');
  // SQLite's clock, shown as UTC to the minute — never parsed into the reader's zone.
  assert.equal(stampMinutes('2026-09-23 11:59:07'), '2026-09-23 11:59');
  assert.equal(stampMinutes(null), null);
});

test('what sets a switch is said in words both pages share', () => {
  assert.equal(setByLabel('deploy'), 'set at deploy');
  assert.equal(setByLabel('runtime'), 'set at runtime');
  assert.equal(setByLabel('operator'), 'thrown by HQ or at deploy');
});

test('the switch tones are declared once, and Platform re-exports rather than redeclares them', () => {
  assert.equal(PAGE_TONE, LIB_TONE, 'Platform draws switches in a second copy of the tones');
  assert.ok(!PLATFORM.includes('export const SWITCH_TONE'), 'Platform declares its own SWITCH_TONE again');
  assert.equal(LIB.split('export const SWITCH_TONE').length - 1, 1);
  assert.ok(SWITCHES.includes("from '../../lib/platformSwitches'"), 'the Switches page does not use the shared tones');
});

// ──────────────────────────────────────────────────── the switch card ──

test('a switch nobody threw offers a throw, with both halves drawn', () => {
  const out = card(eadwyn());
  assert.ok(out.includes('data-testid="hq-switch-form"'), 'a readable switch drew no form');
  assert.ok(out.includes('>Throw: Eadwyn off'), 'the act on offer is not a throw');
  assert.ok(!out.includes('Release: '), 'a switch nobody threw offered a release');
  assert.ok(out.includes('Does not hold it.'), 'the deploy half is not drawn');
  assert.ok(out.includes('Never thrown by HQ.'), 'the operator half is not drawn');
  assert.ok(out.includes('While on: Eadwyn answers every message'), 'the effect is not said');
});

test('a thrown switch offers a release, never a second throw, and says who threw it and why', () => {
  const out = card(eadwyn({ state: 'on', operator: THROWN }));
  assert.ok(out.includes('>Release: Eadwyn off'));
  assert.ok(!out.includes('Throw: '), 'a thrown switch offered a second throw');
  assert.ok(out.includes('Thrown by The Holder at 2026-09-23 11:59 UTC'));
  assert.ok(out.includes(`uppercase ${LIB_TONE.on}"`), 'the on state does not carry its tone');
  assert.ok(out.includes(`within 30 seconds`), 'the release does not say when it takes effect');
});

test('a release while the deployment holds Eadwyn off says nobody gets Eadwyn back', () => {
  const out = card(eadwyn({ state: 'on', deploy: 'on', operator: THROWN }));
  assert.ok(out.includes('Holds it on. Only a deployment turns this half off.'));
  assert.ok(out.includes('releases HQ&#x27;s switch only'), 'the release reads as if it restores Eadwyn');
  assert.ok(out.includes('nobody gets Eadwyn back until the deployment changes'));
  // And a throw under a deploy kill is not sold as switching anything off today.
  const throwing = card(eadwyn({ state: 'on', deploy: 'on' }));
  assert.ok(throwing.includes('already holds Eadwyn off'),
    'a throw under a deploy kill claims an effect it will not have');
});

test('an unreadable store draws no form, only the reason there is none', () => {
  const out = card(eadwyn({ state: 'unreadable', operator: BLIND }));
  assert.ok(!/<form|<button|<input/.test(out), 'a form the server can only refuse was drawn');
  assert.ok(out.includes('data-testid="hq-switch-no-form"'));
  assert.ok(out.includes('No control is drawn'));
  assert.ok(out.includes('Unreadable — The operator switch store has not been created on this database yet.'));
  assert.ok(out.includes(`uppercase ${LIB_TONE.unreadable}"`), 'an unreadable switch borrowed a tone that vouches for it');
});

test('a stale reading says so beside the halves it drew', () => {
  const out = card(eadwyn({
    state: 'on',
    operator: { ...THROWN, stale_reason: 'The operator switch store did not answer.' },
  }));
  assert.ok(out.includes('The operator switch store did not answer.'), 'a stale reading was drawn as current');
});

// ────────────────────────────────────────────────────────── the form ──

test('the form needs a reason and an acknowledgement before it can submit', () => {
  const out = render(SwitchForm, { sw: eadwyn(), action: 'throw', propagationSeconds: 30, reasonMin: 10, onDone: noop });
  assert.match(out, /<button type="submit" disabled=""[^>]*data-testid="hq-switch-submit"/,
    'the submit is live before a reason and an acknowledgement are given');
  assert.ok(out.includes('type="checkbox"'), 'there is nothing to acknowledge');
  assert.ok(out.includes('At least 10 characters of reason.'));
  assert.ok(out.includes('recorded with my name and this reason'));
  // The rule the button follows, bounded to the button: the server's floor,
  // the acknowledgement, and a request not already in flight.
  const at = SWITCHES.indexOf('data-testid="hq-switch-submit"');
  const btn = SWITCHES.slice(SWITCHES.lastIndexOf('<button', at), at);
  assert.ok(btn.includes('disabled={busy || !ack || reason.trim().length < reasonMin}'),
    'the submit no longer waits for all three');
});

test('the form sends the reason it shows and turns the TOTP refusal into what to do', () => {
  assert.ok(SWITCHES.includes('api.hqSetPlatformSwitch(sw.key, action, reason.trim())'));
  assert.ok(SWITCHES.includes("msg === 'TOTP required'"), 'the TOTP refusal reaches the operator as a code');
  assert.ok(SWITCHES.includes('authenticator app'));
});

// ─────────────────────────────────────── Platform: the list and the stats ──

test('the Platform list draws both halves of a switch HQ can throw, and still nothing to press', () => {
  const out = render(SwitchList, { switches: { available: true, items: [
    eadwyn({ state: 'on', operator: THROWN }),
    { key: 'stripe_tax', label: 'Stripe Tax', state: 'off', set_by: 'deploy', effect: 'Tax is calculated by Stripe.' },
  ] } });
  assert.ok(out.includes('thrown by HQ or at deploy'));
  assert.ok(out.includes('data-testid="hq-switch-halves-eadwyn_off"'), 'the writable switch lost its halves');
  assert.ok(out.includes('Deployment: does not hold it · HQ: Thrown by The Holder'));
  assert.ok(!out.includes('hq-switch-halves-stripe_tax'), 'a deploy switch was drawn with an operator half');
  assert.ok(!/<button|<form|<input|<select/.test(out), 'the Platform switch list grew a control');
});

test('Flags counts the switches HQ can throw; Overrides counts the ones it has', () => {
  const sw = (items) => ({ available: true, items });
  const deploy = { key: 'stripe_tax', state: 'off', set_by: 'deploy' };

  assert.deepEqual(flagsStat(null, null), { value: '…', note: 'reading' });
  assert.deepEqual(overridesStat(null, null), { value: '…', note: 'reading' });
  for (const builder of [flagsStat, overridesStat]) {
    const failed = builder(UNAVAILABLE, null);
    assert.equal(failed.note, 'not a count of zero', 'a failed summary read as a figure');
    const blindRegistry = builder({}, { available: false, reason: 'The platform switches could not be read.' });
    assert.equal(blindRegistry.note, 'not a count of zero');
  }

  const flags = flagsStat({}, sw([eadwyn(), deploy]));
  assert.equal(flags.value, '1');
  assert.match(flags.note, /of 2 switches in all/);

  const none = overridesStat({}, sw([eadwyn(), deploy]));
  assert.equal(none.value, '0');
  assert.equal(none.note, 'none thrown by HQ');
  assert.equal(none.tone, undefined);

  const one = overridesStat({}, sw([eadwyn({ state: 'on', operator: THROWN }), deploy]));
  assert.equal(one.value, '1');
  assert.ok(one.tone && one.tone.includes('amber'), 'a thrown kill is not drawn in amber');

  // THE PROPERTY THE STAT EXISTS FOR: a store that could not be read is not
  // a store with nothing thrown in it.
  const blind = overridesStat({}, sw([eadwyn({ state: 'unreadable', operator: BLIND }), deploy]));
  assert.notEqual(blind.value, '0', 'an unreadable store read as no override thrown');
  assert.equal(blind.note, 'not a count of zero');
  // Flags still stands on an unreadable store: it counts the registry, not the rows.
  assert.equal(flagsStat({}, sw([eadwyn({ state: 'unreadable', operator: BLIND })])).value, '1');
});

// ──────────────────────────────────────────────────────────── wiring ──

test('the Switches page is routed as HQ-only and reached from Platform by one literal link', () => {
  assert.ok(APP.includes(
    '<Route path="/admin/platform/switches" element={guard([\'admin\'], hqOnly(<HqPlatformSwitchesPage />))} />',
  ), 'the Switches route is missing or not HQ-only');
  assert.ok(APP.includes("lazy(() => import('./pages/hq/PlatformSwitchesPage'))"));
  // Literal, so the reachability walk counts it (admin_route_reachability).
  assert.equal(PLATFORM.split('to="/admin/platform/switches"').length - 1, 1,
    'Platform does not link to Switches exactly once');
  const zone = PLATFORM.slice(PLATFORM.indexOf('<Zone title="Feature flags"'));
  assert.ok(zone.includes('to="/admin/platform/switches"'), 'the link is not in the Feature flags zone');
  // The page that holds the form is the only one with a handler; Platform
  // keeps its rule (hq_content_platform_h6 pins the whole file).
  assert.ok(SWITCHES.includes('onSubmit={submit}'));
});

test('the read and the write each have their api method, with the key encoded', () => {
  assert.ok(API.includes("hqPlatformSwitches: () => request('/admin/platform/switches')"));
  assert.ok(API.includes('request(`/admin/platform/switches/${encodeURIComponent(key)}`'),
    'the switch key reaches the URL unencoded');
  assert.ok(API.includes("method: 'POST'") && API.includes('JSON.stringify({ action, reason })'));
});

test("the page and the help article speak in Eadwyn's voice", () => {
  const helpArticle = HELP.slice(HELP.indexOf("id: 'feature-flags'"), HELP.indexOf("id: 'events-ops'"));
  assert.ok(helpArticle.length > 200, 'the feature-flags article could not be bounded');
  // Prose only: identifiers and comments are not copy a user reads.
  const strings = (src) => [...src.matchAll(/'([^'\n]{12,})'|"([^"\n]{12,})"|`([^`]{12,})`/g)]
    .map((m) => m[1] || m[2] || m[3]);
  for (const [name, src] of [['Switches page', SWITCHES_SRC], ['help article', helpArticle]]) {
    for (const s of strings(src)) {
      assert.doesNotMatch(s, /\badvis(or|ors|ory)\b|\badvice\b|\brecommendation|\bfiduciary\b/i,
        `${name} says "${s.slice(0, 60)}…"`);
    }
  }
  assert.ok(helpArticle.includes('HQ → Platform → Switches'), 'the help article does not say where the switch is');
  assert.ok(!/There is no feature-flag console\. Nothing in the product/.test(helpArticle),
    'the help article still says nothing in the product throws a switch');
});
