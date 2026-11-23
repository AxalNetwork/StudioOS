/**
 * #6989 (D6989): the Spin-Out Lab sign-up says what it is, its stages are the order the code allows, and the starting
 * point chosen on the Lab page rides through sign-up (inside `next`) to the application, which preselects it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_apply_track_6989.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LAB_APPLY_HREF, LAB_APPLY_HREF_SIGNED_IN, LAB_TRACK_IDS, labApplyHref, trackFromSearch } from '../src/lib/spinoutLab.js';
import { LAB_TRACKS } from '../src/lib/spinoutLabArsenal.js';
import { LANE_COPY, MEMBERSHIP_STEPS, SPINOUT_LAB_SIGNUP, registerHeading } from '../src/lib/registerCopy.js';
import { sanitizeNextPath } from '../src/lib/pendingNext.js';
import { emptyAnswers, emptyBasics } from '../src/lib/applicationLifecycle.js';
import { ApplyStep } from '../src/pages/SpinoutLabApplyPage.jsx';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const REGISTER = read('../src/pages/RegisterPage.jsx');
const APPLY = read('../src/pages/SpinoutLabApplyPage.jsx');
const ROUTE = read('../../cloudflare-worker/src/routes/spinout_lab.ts');

test('6989: the three starting points are the Lab page\'s, and the Worker\'s', () => {
  assert.deepEqual([...LAB_TRACK_IDS], LAB_TRACKS.map((t) => t.id));
  assert.match(ROUTE, /LAB_TRACK_IDS = \['form', 'fit', 'line'\] as const/);
});

test('6989: the apply link carries the track inside next, and the plain link when none is known', () => {
  const out = labApplyHref('fit');
  assert.equal(out, '/register?lane=founder&product=spinout-lab&next=%2Fspinout-lab%2Fapply%3Ftrack%3Dfit');
  const params = new URLSearchParams(out.split('?')[1]);
  assert.equal(params.get('lane'), 'founder');
  assert.equal(params.get('product'), 'spinout-lab');
  // RegisterPage keeps `next` only when it is a same-origin path; this one is.
  const next = sanitizeNextPath(params.get('next'));
  assert.equal(next, '/spinout-lab/apply?track=fit');
  // On the application page, the starting point is read back from it.
  assert.equal(trackFromSearch(next.split('?')[1]), 'fit');
  assert.equal(labApplyHref('line', { signedIn: true }), '/spinout-lab/apply?track=line');
  for (const bad of [undefined, null, '', 'scale', 'FIT']) {
    assert.equal(labApplyHref(bad), LAB_APPLY_HREF);
    assert.equal(labApplyHref(bad, { signedIn: true }), LAB_APPLY_HREF_SIGNED_IN);
  }
  for (const s of ['', '?track=', '?track=scale', '?track=FORM', 'x=1']) assert.equal(trackFromSearch(s), null, s);
  assert.equal(trackFromSearch('?a=1&track=form'), 'form');
});

test('6989: with product=spinout-lab, the heading says what this page is', () => {
  assert.equal(registerHeading('founder', null, 'spinout-lab').title, 'Apply to Spin-Out Lab: start by creating your account.');
  assert.equal(registerHeading('founder', null, 'spinout-lab').desc, LANE_COPY.founder.desc);
  assert.equal(SPINOUT_LAB_SIGNUP.context, 'Programme: Spin-Out Lab');
  // Without the product, the founder heading of #6983 (X1) stays.
  assert.equal(registerHeading('founder', null).title, 'Create your founder account');
  assert.equal(registerHeading('founder', null, null).title, 'Create your founder account');
  assert.equal(registerHeading('founder', null, 'other').title, 'Create your founder account');
  // A ready plan still names itself first.
  assert.equal(registerHeading('founder', { state: 'ready', name: 'Pro' }, 'spinout-lab').title, 'Create your account to get Pro');
});

test('6989: the stages name the signed agreement, in the order the code allows', () => {
  assert.deepEqual([...SPINOUT_LAB_SIGNUP.stages], [
    'Create your account',
    'Confirm your email',
    'Complete your application',
    'Axal VC reviews your membership and sends an agreement',
    'Sign the agreement and your workspace opens',
  ]);
  // The application comes before the review: the route takes an explorer's application at once.
  assert.match(ROUTE, /holdsLicence\(user, 'founder'\) \|\| user\.role === 'exploring'/);
  // The same steps the plain membership line gives, none dropped.
  for (const word of [/account/, /[Cc]onfirm your email/, /reviews your membership and sends an agreement/, /[Ss]ign/, /workspace/]) {
    assert.match(MEMBERSHIP_STEPS, word);
    assert.ok(SPINOUT_LAB_SIGNUP.stages.some((s) => word.test(s)), String(word));
  }
});

test('6989: RegisterPage draws the Lab heading, the programme line and the stages, and the plain line otherwise', () => {
  assert.match(REGISTER, /registerHeading\(lane, planIntent \? selection : null, productIntent\)/);
  assert.match(REGISTER, /const forLab = productIntent === SPINOUT_LAB_PRODUCT;/);
  assert.match(REGISTER, /\{forLab && <p [^>]*data-testid="register-programme">\{SPINOUT_LAB_SIGNUP\.context\}<\/p>\}/);
  assert.match(REGISTER, /\{forLab \? \(\s*<ol [^>]*data-testid="register-lab-stages">\s*\{SPINOUT_LAB_SIGNUP\.stages\.map/);
  assert.match(REGISTER, /\) : \(\s*<p [^>]*data-testid="register-membership-steps">\{MEMBERSHIP_STEPS\}<\/p>/);
  assert.doesNotMatch(REGISTER, /28-day cohort/, 'the old box that repeated the programme is gone');
});

const step1 = (basics) => renderToStaticMarkup(React.createElement(ApplyStep, {
  step: 1, basics: { ...emptyBasics(), ...basics }, answers: emptyAnswers(), setBasics: () => {}, setAnswers: () => {},
}));
const pressed = (html, id) => new RegExp(`data-testid="apply-track-${id}" aria-pressed="true"`).test(html);

test('6989: the application preselects the carried starting point, and none when none was carried', () => {
  const html = step1({ track: 'fit' });
  assert.ok(pressed(html, 'fit'));
  assert.ok(!pressed(html, 'form') && !pressed(html, 'line'));
  for (const t of LAB_TRACKS) assert.match(html, new RegExp(`>${t.name}<`));
  const none = step1({ track: '' });
  assert.ok(LAB_TRACKS.every((t) => !pressed(none, t.id)), 'nothing is chosen for the applicant');
});

test('6989: the page reads ?track= once, keeps a draft\'s own choice, and sends the track only when chosen', () => {
  assert.match(APPLY, /useState\(\(\) => \(typeof window !== "undefined" \? trackFromSearch\(window\.location\.search\) : null\)\)/);
  assert.match(APPLY, /useState\(\(\) => \(\{ \.\.\.emptyBasics\(\), track: linkedTrack \|\| "" \}\)\)/);
  assert.match(APPLY, /setBasics\(\{ \.\.\.d\.basics, track: d\.basics\.track \|\| linkedTrack \|\| "" \}\)/);
  assert.match(APPLY, /\.\.\.\(basics\.track \? \{ track: basics\.track \} : \{\}\),/);
});
