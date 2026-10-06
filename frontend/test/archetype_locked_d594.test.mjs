/**
 * D594 — the archetype card's locked state (canvas "Studio · Archetype
 * preview", board S12), issue #1234.
 *
 * A free account's archetype reads answer `archetype_access: { locked: true,
 * required_plan }` and carry no archetype. The card draws its title, a lock
 * and one line naming the plan from `required_plan`. It is not a link, it is
 * announced as disabled, and no archetype text reaches the markup. A paid
 * reply renders the archetype as before.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ArchetypeCard, assessmentNotStarted } from '../src/components/profile/ProfileFitSection.jsx';
import { archetypeLock, lockedLine, lockedPlanName } from '../src/lib/archetypeLock.js';
import { ARCHETYPES } from '../src/lib/assessmentMeta.js';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const html = (el) => renderToStaticMarkup(createElement(MemoryRouter, null, el));
const pageCode = codeOnly(readFileSync(fileURLToPath(new URL('../src/pages/ArchetypeCardPage.jsx', import.meta.url)), 'utf8'));

const FOUNDER_PLAN = { licence: 'founder', tier: 'growth', price_label: '$79 / month' };
const INVESTOR_PLAN = { licence: 'investor', tier: 'professional', price_label: '$149 / month' };
const lockedFit = (plan) => ({ data: { fit: [], axal_values: [], archetype_sex: 'f', archetype_access: { locked: true, required_plan: plan } }, error: '' });
const lockedResults = { data: { results: [{ updated_at: '2026-10-01', values: {} }], archetype_access: { locked: true, required_plan: FOUNDER_PLAN } }, error: '' };

// Every archetype's name and tagline, so a leak of any of them is caught.
const ARCHETYPE_TEXT = Object.values(ARCHETYPES).flatMap((a) => [a.label, a.tagline]).filter(Boolean);

test('a locked reply draws the title, a lock and the line naming its plan', () => {
  const markup = html(createElement(ArchetypeCard, { state: lockedResults, fitState: lockedFit(FOUNDER_PLAN), audience: 'founder', compact: true }));
  const text = renderedText(markup);
  assert.match(text, /Founder archetype/);
  assert.match(text, /Your archetype is part of the Growth plan\. Your answers are kept\./);
  assert.match(markup, /data-testid="archetype-locked"/);
  assert.match(markup, /lucide-lock/, 'the lock icon is drawn');
  const inv = renderedText(html(createElement(ArchetypeCard, { state: { data: null, error: '' }, fitState: lockedFit(INVESTOR_PLAN), audience: 'investor', compact: true })));
  assert.match(inv, /part of the Professional plan/, 'the plan comes from required_plan, not a literal');
});

test('the locked card is not a link, is announced as disabled, and holds no archetype text', () => {
  const markup = html(createElement(ArchetypeCard, { state: lockedResults, fitState: lockedFit(FOUNDER_PLAN), audience: 'founder', compact: true }));
  assert.doesNotMatch(markup, /<a\b/, 'a locked card must not be a link');
  assert.doesNotMatch(markup, /href=/);
  assert.match(markup, /aria-disabled="true"/);
  assert.doesNotMatch(markup, /View full card|Primary archetype|Preview/);
  for (const t of ARCHETYPE_TEXT) assert.ok(!markup.includes(t), `archetype text "${t}" reached a locked card`);
});

test('a locked reply wins even when it still carried an archetype, or the other read failed', () => {
  const leaky = lockedFit(FOUNDER_PLAN);
  leaky.data.archetype = { slug: 'fo_missionary', label: 'The Missionary', confidence: 0.8 };
  const markup = html(createElement(ArchetypeCard, { state: { data: null, error: 'x' }, fitState: leaky, compact: true }));
  assert.match(renderedText(markup), /part of the Growth plan/);
  assert.ok(!markup.includes('The Missionary'), 'a slug that slipped through must still not be drawn');
  const viaResults = html(createElement(ArchetypeCard, { state: lockedResults, fitState: { data: null, error: 'x' }, compact: true }));
  assert.match(renderedText(viaResults), /part of the Growth plan/, 'the results read alone is enough to lock');
});

test('a paid reply renders the archetype as today', () => {
  const fitState = { data: { archetype: { slug: 'fo_missionary', label: 'The Missionary', confidence: 0.82 }, archetype_sex: 'f', archetype_access: { locked: false } }, error: '' };
  const markup = html(createElement(ArchetypeCard, { state: { data: { results: [] }, error: '' }, fitState, audience: 'founder', compact: true }));
  assert.match(markup, /The Missionary/);
  assert.match(markup, /<a\b[^>]*href="\/studio\/archetype"/);
  assert.doesNotMatch(markup, /data-testid="archetype-locked"/);
});

test('archetypeLock, lockedPlanName and lockedLine', () => {
  assert.equal(archetypeLock(null, undefined, {}), null);
  assert.equal(archetypeLock({ archetype_access: { locked: false } }), null);
  assert.equal(archetypeLock({ archetype_access: { locked: 'true' } }), null, 'only a real true locks');
  assert.deepEqual(archetypeLock({ archetype_access: { locked: false } }, { archetype_access: { locked: true, required_plan: INVESTOR_PLAN } }), INVESTOR_PLAN);
  assert.deepEqual(archetypeLock({ archetype_access: { locked: true } }), {});
  assert.equal(lockedPlanName({ tier: 'growth' }), 'Growth');
  assert.equal(lockedPlanName({}), null);
  assert.equal(lockedLine({}), 'Your archetype is part of a paid plan. Your answers are kept.');
});

test('a locked account whose only answers are archetype questions is not "not started"', () => {
  const answered = (data) => ({ data, error: '' });
  const base = { radar: answered({ axes: [] }), values: answered({ vector: [] }) };
  assert.equal(assessmentNotStarted({ ...base, results: lockedResults, fit: lockedFit(FOUNDER_PLAN) }), false);
  assert.equal(assessmentNotStarted({ ...base, results: answered({ results: [] }), fit: answered({}) }), true);
});

test('the full card page draws the same locked state, with the upgrade and no archetype behind it', () => {
  // D602 retired the assessment fallback: the lock and the archetype both come
  // from the one conversational reply, and a locked reply feeds no archetype.
  assert.match(pageCode, /const lock = archetypeLock\(fitData\);/);
  assert.match(pageCode, /const latest = lock \? null : cardArchetype\(fitData\);/, 'a locked reply must not feed the archetype');
  assert.match(pageCode, /const failed = !lock && !latest/);
  assert.match(pageCode, /\{lock && \(/);
  assert.match(pageCode, /aria-disabled="true"/);
  assert.match(pageCode, /\{lockedLine\(lock\)\}/);
  assert.match(pageCode, /openPaywall\(lock\.tier \|\| 'growth', lockedLine\(lock\)\)/);
  assert.match(pageCode, /\{!loading && !failed && !lock && !latest && \(/);
  assert.doesNotMatch(pageCode, /blur/, 'never a blurred archetype behind the lock');
});
