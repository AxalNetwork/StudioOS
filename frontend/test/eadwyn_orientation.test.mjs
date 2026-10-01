/**
 * Eadwyn says what it is before it asks anything — and calls itself Eadwyn.
 *
 * A newcomer arriving from onboarding met this panel empty with the assessment's
 * first question in it. Out of context that reads as one more form, on the
 * single surface whose whole purpose is to save them from forms.
 *
 * THE NAME IS A HARD CONSTRAINT, asserted here because copy drifts and nothing
 * else would catch it. "Eadwyn" — never "chatbox", never "chatbot", never
 * "Personal Advisor" in reader-facing text. Task #120 renamed the panel's title
 * for the same reason; a product that calls its own assistant a chatbot has
 * told the reader it is a widget.
 *
 * AND WHAT IT PROMISES MUST BE WHAT IT DOES. Copy is the one place this repo's
 * honesty rules have no `unbuilt` to fall back on: a sentence offering to do
 * something Eadwyn cannot is a dead control with no disabled state. Two
 * capabilities are named and no more.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { orientationMessage, orientationSteps, shouldOrient } from '../src/lib/eadwynOrientation.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PANEL = codeOnly(read('frontend/src/components/advisor/PersonalAdvisor.jsx'));
// COMMENTS STRIPPED FIRST. The module's own docblock explains the naming rule
// and therefore contains the banned words, and an apostrophe in its prose
// ("the assessment's first item") opens a pseudo-string that swallows the next
// several lines — so a raw scan read the explanation as copy and failed. Same
// trap `profile_zone_actions.test.mjs` warns about in its own header, which is
// what `_codeOnly.mjs` exists for.
const LIB = codeOnly(read('frontend/src/lib/eadwynOrientation.js'));

const ROLES = ['founder', 'investor', 'partner', 'advisor', 'admin', 'exploring'];
const fresh = { answered: 0, complete: false };

test('it is Eadwyn, on every licence, and never a chatbot', () => {
  for (const role of ROLES) {
    const text = orientationMessage({ role, progress: fresh, hasCompany: false, name: 'Ada' });
    assert.match(text, /\bEadwyn\b/, `the ${role} orientation never names Eadwyn`);
    for (const banned of [/chatbox/i, /chatbot/i, /chat box/i, /Personal Advisor/]) {
      assert.doesNotMatch(text, banned, `the ${role} orientation calls Eadwyn a ${banned}`);
    }
  }
  // And in the module's own reader-facing strings, not only in the assembled
  // message — a banned word in a step body would reach the screen the same way.
  const strings = [...LIB.matchAll(/'((?:[^'\\]|\\.){12,})'/g)].map((m) => m[1]);
  assert.ok(strings.length > 5, 'the copy is no longer in string literals this can read');
  for (const s of strings) assert.doesNotMatch(s, /chatbox|chatbot|Personal Advisor/i, `banned name in copy: "${s}"`);
});

test('every licence gets an orientation, including a first-time admin', () => {
  // The user's ask was explicit that admins are not exempt. An admin arriving
  // for the first time has the same problem as everyone else and, being the
  // person who sets the platform up, the least excuse for being left to guess.
  for (const role of ROLES) {
    const text = orientationMessage({ role, progress: fresh, hasCompany: false });
    assert.ok(text.length > 400, `the ${role} orientation is too thin to orient anyone`);
    assert.match(text, /Where to start:/, `the ${role} orientation does not say where to start`);
  }
  // THE SENTENCE AGREES WITH ITS OWN NOUN. Rendering found "as a admin" —
  // `admin` and `investor` both begin with a vowel, so two of the six licences
  // shipped a sentence that cannot agree with the word it just chose. Nothing
  // else would have caught it: every other assertion here passed.
  for (const role of ROLES) {
    const text = orientationMessage({ role, progress: fresh });
    assert.doesNotMatch(text, /\bas a [aeiou]/i, `the ${role} orientation reads "as a ${role}"`);
    assert.doesNotMatch(text, /\bas an [^aeiou\s]/i, `the ${role} orientation reads "as an ${role}"`);
  }
  // An unknown or missing role still gets one rather than nothing — a reader
  // whose role has not resolved is exactly a newcomer.
  const unknown = orientationMessage({ progress: fresh });
  assert.match(unknown, /\bEadwyn\b/);
  assert.match(unknown, /\bmember\b/, 'an unresolved role produces no word for the reader');
});

test('the profile comes first, and the reason it comes first is stated', () => {
  for (const role of ROLES) {
    const steps = orientationSteps({ role, progress: fresh, hasCompany: false });
    assert.equal(steps[0].key, 'assessment', `${role}'s first step is not the profile`);
    assert.equal(steps[1].key, 'account', `${role}'s second step is not the account basics`);
    // WHY, not just what. The profile is first because matching runs on it —
    // that is the fact that makes the order more than a preference.
    assert.match(steps[0].body, /match/i, `${role}'s profile step does not say what it unlocks`);
  }
});

test('the profile step is answered here, not at a route that redirects away', () => {
  // `/skills` and `/values` are both `<Navigate to="/studio" replace />` and the
  // gamified player was removed. Eadwyn's own profiling bank is the live one —
  // the questions `POST /api/advisor/start` already returns into this panel — so
  // the first step must carry no route at all.
  const APP = read('frontend/src/App.jsx');
  for (const dead of ['/skills', '/values']) {
    const i = APP.indexOf(`path="${dead}"`);
    assert.ok(i > 0, `${dead} left App.jsx — re-check where the assessment lives`);
    assert.match(APP.slice(i, i + 140), /Navigate to="\/studio" replace/,
      `${dead} is a real page again, so the assessment may now have a home of its own`);
  }
  const first = orientationSteps({ role: 'founder', progress: fresh })[0];
  assert.equal(first.route, undefined, 'the profile step points at a route; it is answered in the panel');
  assert.match(first.body, /no separate page/i, 'the step does not say the questions are answered here');
});

test('a company step only reaches a reader who could have one', () => {
  for (const role of ['founder', 'partner', 'admin']) {
    const keys = orientationSteps({ role, progress: fresh }).map((s) => s.key);
    assert.ok(keys.includes('company'), `${role} is not offered the company step`);
  }
  // An investor's fund and an advisor's practice are not companies in this
  // sense; offering the step would be a chore they cannot complete.
  for (const role of ['investor', 'advisor', 'exploring']) {
    const keys = orientationSteps({ role, progress: fresh }).map((s) => s.key);
    assert.ok(!keys.includes('company'), `${role} is offered a company step they cannot complete`);
  }
});

test('a step already finished is shown as finished, not hidden', () => {
  const done = orientationSteps({ role: 'founder', progress: { answered: 12, complete: true }, hasCompany: true });
  const byKey = Object.fromEntries(done.map((s) => [s.key, s]));
  assert.equal(byKey.assessment.done, true, 'a completed assessment still reads as outstanding');
  assert.equal(byKey.company.done, true, 'a linked company still reads as outstanding');
  assert.match(byKey.assessment.title, /recorded/, 'the finished profile keeps the unfinished wording');
  // Shown, not hidden: the list is a map of where the reader is. A shrinking
  // pile of chores loses the fact that the profile is what matching runs on.
  assert.equal(done.length, 3, 'finished steps were dropped from the list');
  assert.match(orientationMessage({ role: 'founder', progress: { answered: 12, complete: true }, hasCompany: true }),
    /— done\./, 'the message never marks a finished step');
  // Part-way through is its own state, and neither of the other two.
  const partway = orientationSteps({ role: 'founder', progress: { answered: 3, complete: false } })[0];
  assert.equal(partway.done, false);
  assert.match(partway.title, /Finish/, 'a half-answered assessment reads as not started');
});

test('it promises the two things Eadwyn does, and does not offer a third', () => {
  const text = orientationMessage({ role: 'founder', progress: fresh });
  assert.match(text, /fill in what I can/i, 'the fill-the-blanks capability is not offered');
  assert.match(text, /which one actually matters first/i, 'the prioritise capability is not offered');
  assert.match(text, /ask me what it is and I will walk you through it/i,
    'the walk-me-through offer is gone, and the user asked for it by name');
  // Nothing Eadwyn cannot do. These are the verbs a first draft reaches for and
  // none of them is built: the assistant does not send mail, book anything, or
  // move money.
  for (const overreach of [/\bI(?:'ll| will) email\b/i, /\bI(?:'ll| will) send\b/i, /\bbook (?:a|the)\b/i, /\bI(?:'ll| will) introduce you\b/i]) {
    assert.doesNotMatch(text, overreach, `the orientation offers something Eadwyn cannot do: ${overreach}`);
  }
});

test('it renders once, for an empty transcript only', () => {
  assert.equal(shouldOrient({ ready: true, messageCount: 0 }), true);
  assert.equal(shouldOrient({ ready: true, messageCount: 1 }), false, 'a reader with history is oriented again');
  // `ready: false` is the moment before /start answers, when an empty array
  // means "not loaded" rather than "nothing said".
  assert.equal(shouldOrient({ ready: false, messageCount: 0 }), false,
    'the orientation fires before the transcript has been read');
  assert.equal(shouldOrient({}), false);
});

test('the panel calls it on an empty transcript, and spends nothing to do it', () => {
  assert.match(PANEL, /shouldOrient\(\{ ready: true, messageCount: hydrated \}\)/,
    'the panel no longer gates the orientation on an empty transcript');
  assert.match(PANEL, /orientationMessage\(\{/, 'the panel no longer writes the orientation');
  // Counted from the history read, not from `messages` — this runs in the same
  // tick that set it, so the state has not landed.
  assert.match(PANEL, /hydrated = msgs\.length;/, 'the count comes from state that is not yet committed');
  // NO ROUTER CALL. The orientation must not be a generated turn: it would spend
  // a reader's own budget on a first touch, which is the one place this repo has
  // already decided not to.
  const at = PANEL.indexOf('orientationMessage({');
  const block = PANEL.slice(Math.max(0, at - 900), at + 400);
  assert.doesNotMatch(block, /api\.advisor\.(ask|answer)|aiRun|aiRouter/,
    'the orientation reaches the router, so a first touch now costs the reader money');
});
