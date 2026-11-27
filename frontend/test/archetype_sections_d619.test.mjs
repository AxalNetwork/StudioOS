/**
 * D619 (#1006) — the archetype card page's three sections, from the owner's
 * canvas (`design/canvases/integrated/Studio · Archetype card.dc.html`, A24–A30,
 * and the component they import, `Archetype Full Sections.dc.html`).
 *
 * What is pinned, and why:
 *   - the radar's self shape joins rated axes only, so an axis with no rating
 *     is a gap, never a point at 0;
 *   - evidence is dots by weight, the outer ring at the reply's
 *     `corroborated_at`; evidence only is a count and no dot;
 *   - Not recorded is said on the axis and in the table, never as 0;
 *   - the timeline's "Current" sits only on the archetype the card shows, and
 *     a history cut at the route's 200 does not call its oldest point the first;
 *   - every section draws loading, unreadable (with its own Try again) and
 *     ready, and the matches draw locked;
 *   - a match row carries a name, a role, the published archetype and D605's
 *     values line, and nothing else.
 *
 * Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/archetype_sections_d619.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

import {
  HISTORY_CAP, MATCH_MEMBERS_SHOWN, RADAR, SKILL_STATE_COPY, SKILL_STATE_LEGEND, TRIGGER_COPY,
  activityCount, dayLabel, matchGroups, memberRow, radarLayers, radarModel, radarRings, radarSpokes, timelineView,
} from '../src/lib/archetypeCardV2.js';
import {
  HistorySection, MatchesSection, PublishBanner, SkillsSection, STATE_PILL,
} from '../src/components/profile/ArchetypeSections.jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const count = (s, needle) => s.split(needle).length - 1;

// One axis of each state, in the Worker's axis order (D318's reply shape).
const AXES = [
  ['product', 'Product', 'corroborated', 4, 3.4, 9],
  ['engineering', 'Engineering', 'some_evidence', 3, 1.2, 3],
  ['design', 'Design', 'self_rated_only', 2, 0, 0],
  ['gtm_sales', 'GTM / Sales', 'not_recorded', null, 0, 0],
  ['marketing_brand', 'Marketing / Brand', 'evidence_only', null, 0.8, 2],
  ['finance_ops', 'Finance / Ops', 'self_rated_only', 3, 0, 0],
  ['legal_compliance', 'Legal / Compliance', 'not_recorded', null, 0, 0],
  ['capital_network', 'Capital / Network', 'some_evidence', 2, 2.1, 1],
].map(([axis, label, state, self, w, n]) => ({ axis, label, state, self_level: self, evidence_weight: w, lifetime_count: n }));
const REPORT = { corroborated_at: 3, axes: AXES };
const NONE = { corroborated_at: 3, axes: AXES.map((a) => ({ ...a, state: 'not_recorded', self_level: null, evidence_weight: 0, lifetime_count: 0 })) };
const mixed = () => radarModel(radarLayers(REPORT), REPORT.corroborated_at);

test('the radar frame: five rings and eight spokes, product at the top', () => {
  const rings = radarRings();
  assert.equal(rings.length, 5);
  assert.equal(rings[4].split(' ')[0], `${RADAR.cx},${RADAR.cy - RADAR.r}`, 'the outer ring starts at the top');
  assert.equal(rings[0].split(' ')[0], `${RADAR.cx},${RADAR.cy - RADAR.r / 5}`, 'level 1 is a fifth of the way out');
  const spokes = radarSpokes();
  assert.equal(spokes.length, 8);
  assert.deepEqual(spokes[2], { x2: RADAR.cx + RADAR.r, y2: RADAR.cy }, 'the third axis points right');
});

test('self is a shape over rated axes only: an unrated axis is a gap, a lone rated axis a mark', () => {
  const m = mixed();
  // capital → product → engineering → design is one run (it wraps past the
  // top); GTM, Marketing and Legal have no rating; Finance stands alone.
  assert.equal(m.selfPath, 'M130 130 L105.7 105.7 L130 61.2 L166.5 93.5 L164.4 130 Z');
  assert.deepEqual(m.selfMarks.map((x) => x.axis), ['finance_ops']);
  const allRated = radarModel(radarLayers({ axes: AXES.map((a) => ({ ...a, self_level: 5 })) }));
  assert.equal(allRated.selfPath, 'M130 44 L190.8 69.2 L216 130 L190.8 190.8 L130 216 L69.2 190.8 L44 130 L69.2 69.2 Z',
    'every axis rated is one closed shape, with no spoke to the centre');
  assert.deepEqual(allRated.selfMarks, []);
  const none = radarModel(radarLayers(NONE));
  assert.equal(none.selfPath, '', 'nothing rated draws no shape at all, not a dot at the centre');
  assert.deepEqual(none.selfMarks, []);
});

test('evidence is a dot by weight, the outer ring at corroborated_at, and evidence only is a count', () => {
  const m = mixed();
  assert.deepEqual(m.dots.map((d) => d.axis), ['product', 'engineering', 'capital_network'],
    'dots only where there is a rating and activity');
  assert.deepEqual(m.dots[0], { axis: 'product', cx: 130, cy: 44 }, 'past corroborated_at, the dot sits on the outer ring');
  assert.deepEqual(m.dots[1], { axis: 'engineering', cx: 154.3, cy: 105.7 }, '1.2 of 3 is 40% of the way out');
  const half = radarModel(radarLayers(REPORT), 6).dots.find((d) => d.axis === 'product');
  assert.equal(half.cy, Math.round((130 - RADAR.r * (3.4 / 6)) * 10) / 10, "the reply's corroborated_at sets the scale, not a constant");
  assert.deepEqual(m.evidenceOnly.map((e) => [e.axis, e.text]), [['marketing_brand', '2 activities']]);
  assert.ok(!m.dots.some((d) => d.axis === 'marketing_brand'), 'evidence only never draws a level');
});

test('Not recorded is said on the axis, and once in the middle when nothing is', () => {
  const m = mixed();
  assert.deepEqual(m.gaps.map((g) => g.axis), ['gtm_sales', 'legal_compliance']);
  assert.equal(m.allNotRecorded, false);
  const none = radarModel(radarLayers(NONE));
  assert.equal(none.allNotRecorded, true);
  assert.deepEqual(none.gaps, [], 'one middle label, not eight chips');
});

test('the table: a missing self or evidence is absent, never 0, and every axis is named in full', () => {
  const rows = mixed().rows;
  assert.deepEqual(rows.map((r) => [r.label, r.stateText, r.self, r.evidence]), [
    ['Product', 'Corroborated', '4 / 5', '9 activities'],
    ['Engineering', 'Some evidence', '3 / 5', '3 activities'],
    ['Design', 'Self-rated only', '2 / 5', null],
    ['GTM / Sales', 'Not recorded', null, null],
    ['Marketing / Brand', 'Evidence only', null, '2 activities'],
    ['Finance / Ops', 'Self-rated only', '3 / 5', null],
    ['Legal / Compliance', 'Not recorded', null, null],
    ['Capital / Network', 'Some evidence', '2 / 5', '1 activity'],
  ]);
  assert.equal(activityCount(1), '1 activity');
  const odd = radarModel(radarLayers({ axes: [{ ...AXES[0], state: 'decaying_signal' }] })).rows[0];
  assert.equal(odd.stateText, 'Decaying Signal', 'a state the client does not know is named, not called Not recorded');
  const labels = mixed().labels;
  assert.deepEqual(labels.map((l) => l.text), ['Product', 'Eng', 'Design', 'GTM', 'Brand', 'Finance', 'Legal', 'Capital']);
  assert.deepEqual(labels.map((l) => l.align), ['middle', 'start', 'start', 'start', 'middle', 'end', 'end', 'end']);
});

test('the legend names the five states in the canvas order, each with a pill', () => {
  assert.deepEqual(SKILL_STATE_LEGEND.map((l) => l.state), ['not_recorded', 'self_rated_only', 'some_evidence', 'corroborated', 'evidence_only']);
  for (const l of SKILL_STATE_LEGEND) {
    assert.ok(SKILL_STATE_COPY[l.state], l.state);
    assert.ok(STATE_PILL[l.state], `${l.state} has a pill`);
  }
});

const SNAP = (id, slug, at, trigger = 'answer', persona = 'founder') => ({ id, persona, displayed_slug: slug, computed_at: at, trigger });

test('the timeline: oldest first, one point per change, its trigger and date', () => {
  const items = [
    SNAP(6, 'fo_rocketeer', '2026-09-01T03:00:00Z', 'evidence'),
    SNAP(5, 'fo_rocketeer', '2026-08-20T03:00:00Z', 'scheduled'),
    SNAP(4, 'fo_missionary', '2026-08-01T03:00:00Z', 'engine_bump'),
    SNAP(3, 'fo_missionary', '2026-03-12 10:00:00', 'answer'),
    SNAP(2, 'inv_thesis_backer', '2026-03-13T03:00:00Z', 'answer', 'investor'),
  ];
  const v = timelineView(items, 'founder', 'fo_rocketeer');
  assert.deepEqual(v.points.map((p) => [p.slug, p.triggerText, p.first, p.current]), [
    ['fo_missionary', TRIGGER_COPY.answer, true, false],
    ['fo_rocketeer', TRIGGER_COPY.scheduled, false, true],
  ], "the other persona's snapshot is not a point, and only a change is");
  assert.equal(v.points[0].date, '12 Mar 2026');
  assert.equal(v.agrees, true);
  assert.deepEqual(TRIGGER_COPY, {
    answer: 'An answer', evidence: 'Platform activity', scheduled: 'A scheduled review', engine_bump: 'An engine update',
  }, "the Worker's four triggers (TRIGGERS in profileHistory.ts), in the canvas's words");
  const worker = read('cloudflare-worker/src/services/profileHistory.ts');
  assert.match(worker, /export const TRIGGERS = \['answer', 'evidence', 'scheduled', 'engine_bump'\] as const;/);
  const odd = timelineView([SNAP(1, 'fo_missionary', 'not a date', null)], 'founder', 'fo_missionary').points[0];
  assert.equal(odd.date, 'Date not recorded');
  assert.equal(odd.triggerText, 'Trigger not recorded');
});

test('"Current" sits only on the archetype the card shows', () => {
  const items = [SNAP(2, 'fo_missionary', '2026-08-01T03:00:00Z'), SNAP(1, 'fo_rocketeer', '2026-07-01T03:00:00Z')];
  const v = timelineView(items, 'founder', 'fo_rocketeer');
  assert.equal(v.agrees, false, 'the card reads best-fit/me, the history the snapshots; they can differ');
  assert.ok(v.points.every((p) => !p.current));
});

test('a history cut at the route\'s 200 does not call its oldest point the first', () => {
  const items = Array.from({ length: HISTORY_CAP }, (_, i) => SNAP(HISTORY_CAP - i, 'fo_missionary', `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`));
  const v = timelineView(items, 'founder', 'fo_missionary');
  assert.equal(v.capped, true);
  assert.equal(v.points[0].first, false);
  assert.match(read('cloudflare-worker/src/services/profileHistory.ts'), /persona\?: FitPersona \| null, limit = 200\)/,
    "HISTORY_CAP is loadHistory's own limit");
});

test('a date with no zone is read as UTC, wherever the reader is', () => {
  const tz = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(dayLabel('2026-03-12 23:30:00'), '12 Mar 2026');
    process.env.TZ = 'Asia/Tokyo';
    assert.equal(dayLabel('2026-03-12 23:30:00'), '12 Mar 2026');
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
  assert.equal(dayLabel(''), null);
});

test('a member row: name, role, the published archetype and the values line, and nothing else', () => {
  const r = memberRow({ user_id: 7, name: 'Ada Lovelace', role: 'investor', persona: 'investor', slug: 'inv_thesis_backer', label: 'Thesis-Driven Backer', values_fit: { band: 'far_apart', compared: 6 } });
  assert.deepEqual(r, { key: '7-investor', name: 'Ada Lovelace', initials: 'AL', role: 'Investor', archetype: 'Thesis-Driven Backer', values: 'Values: far apart' });
  const bare = memberRow({ user_id: 8, name: '  ', role: null, slug: 'fo_missionary', label: null, values_fit: null });
  assert.equal(bare.name, 'Name not recorded');
  assert.equal(bare.archetype, 'The Missionary', "the slug's own label when the row has none");
  assert.equal(bare.values, null, 'no comparison draws no line (the caller has not published)');
});

// ── Rendered states ──────────────────────────────────────────────────────────

const EVIDENCE_NOTE = 'Evidence counts what you have done on the platform. It is not an assessment of how good you are.';

test('Skills: loading is a skeleton with no figure, and a failed read says so with its own Try again', () => {
  const loading = html(h(SkillsSection, { state: 'loading' }));
  assert.match(loading, /data-testid="skills-loading"/);
  assert.match(loading, /aria-busy="true"/);
  assert.doesNotMatch(loading, /skills-table|\d+ \/ 5/);
  let retried = 0;
  const failed = html(h(SkillsSection, { state: 'unreadable', model: mixed(), onRetry: () => { retried += 1; } }));
  assert.match(failed, /Your skills could not be read\./);
  assert.match(failed, />Try again</);
  assert.doesNotMatch(failed, /skills-radar|skills-table/, 'a failed read is never an empty radar');
  assert.ok(loading.includes(EVIDENCE_NOTE) && failed.includes(EVIDENCE_NOTE));
});

test('Skills: one axis of each state draws the shape, the dots, the gaps, the count, the table and the legend', () => {
  const out = html(h(SkillsSection, { state: 'ready', model: mixed() }));
  assert.equal(count(out, 'data-testid="radar-self"'), 1);
  assert.equal(count(out, 'data-testid="radar-self-mark"'), 1);
  assert.equal(count(out, 'data-testid="radar-evidence-dot"'), 3);
  assert.equal(count(out, 'data-testid="radar-gap"'), 2);
  assert.match(out, /data-testid="radar-evidence-only"[^>]*>2 activities</);
  assert.equal(count(out, 'data-testid="skills-row"'), 8);
  assert.equal(count(out, '>—<'), 3 + 4, 'three axes with no rating and four with no activity read —');
  assert.doesNotMatch(out, />0 \/ 5<|>0 activities</);
  assert.match(out, /Self, 0 to 5/);
  assert.match(out, /Evidence, platform activity/);
  for (const l of SKILL_STATE_LEGEND) assert.ok(out.includes(l.text.replace(/'/g, '&#x27;')), l.state);
  assert.doesNotMatch(out, /skills-prompt/);
  assert.ok(out.includes(EVIDENCE_NOTE));
});

test('Skills: every axis Not recorded draws no shape, one middle label, and sends the member to Eadwyn', () => {
  const out = html(h(SkillsSection, { state: 'ready', model: radarModel(radarLayers(NONE)) }));
  assert.doesNotMatch(out, /data-testid="radar-self"|radar-self-mark|radar-evidence-dot/);
  assert.equal(count(out, 'data-testid="radar-all-not-recorded"'), 1);
  assert.equal(count(out, 'data-testid="radar-gap"'), 0);
  assert.equal(count(out, '>Not recorded<'), 1 + 8 + 1, 'the middle label, each row, and the legend');
  assert.match(out, /Answer a few skill questions with Eadwyn to fill this in\./);
  assert.match(out, /href="\/studio#studio-chat"[^>]*>Open Eadwyn</);
});

test('History: loading, unreadable, not classified, one point and five', () => {
  assert.match(html(h(HistorySection, { state: 'loading' })), /data-testid="history-loading"[^>]*aria-busy="true"|aria-busy="true"[^>]*data-testid="history-loading"/);
  const failed = html(h(HistorySection, { state: 'unreadable', onRetry: () => {} }));
  assert.match(failed, /Your history could not be read\./);
  assert.match(failed, />Try again</);
  assert.match(html(h(HistorySection, { state: 'unclassified' })), /Not recorded: Eadwyn has not classified you yet\./);

  const one = timelineView([SNAP(1, 'fo_missionary', '2026-03-12T03:00:00Z')], 'founder', 'fo_missionary');
  const single = html(h(HistorySection, { state: 'ready', view: one, cardLabel: 'The Missionary' }));
  assert.equal(count(single, 'data-testid="history-point"'), 1);
  assert.match(single, /This is your first archetype\. Changes appear here as your answers and activity build up\./);
  assert.match(single, /aria-current="true"/);
  assert.match(single, />Current</);
  assert.match(single, /Triggers: an answer, platform activity, a scheduled review, or an engine update\./);

  const slugs = ['fo_missionary', 'fo_rocketeer', 'fo_architect', 'fo_maverick', 'fo_missionary'];
  const five = timelineView(slugs.map((s, i) => SNAP(10 - i, s, `2026-0${i + 1}-02T03:00:00Z`)).reverse(), 'founder', 'fo_missionary');
  const out = html(h(HistorySection, { state: 'ready', view: five, cardLabel: 'The Missionary' }));
  assert.equal(count(out, 'data-testid="history-point"'), 5);
  assert.equal(count(out, '>Current<'), 1, 'only the last point is current');
  assert.doesNotMatch(out, /history-single|history-differs/);
});

test('History: a last point that is not the card\'s archetype says why, and a cut history says where it starts', () => {
  const v = timelineView([SNAP(1, 'fo_rocketeer', '2026-03-12T03:00:00Z')], 'founder', 'fo_missionary');
  const out = html(h(HistorySection, { state: 'ready', view: v, cardLabel: 'The Missionary' }));
  assert.doesNotMatch(out, />Current</);
  assert.match(out, /The card above shows The Missionary\./);
  const capped = timelineView(Array.from({ length: HISTORY_CAP }, (_, i) => SNAP(HISTORY_CAP - i, 'fo_missionary', '2026-05-01T00:00:00Z')), 'founder', 'fo_missionary');
  const cut = html(h(HistorySection, { state: 'ready', view: capped, cardLabel: 'The Missionary' }));
  assert.match(cut, /Changes before 1 May 2026 are not shown\./);
  assert.doesNotMatch(cut, /This is your first archetype/);
});

const MEMBERS = {
  locked: false,
  items: [
    { user_id: 11, name: 'Rae Okafor', role: 'founder', persona: 'founder', slug: 'fo_rocketeer', label: 'The Rocketeer', values_fit: { band: 'aligned', compared: 9 } },
    { user_id: 12, name: 'Sam Ito', role: 'founder', persona: 'founder', slug: 'fo_rocketeer', label: 'The Rocketeer', values_fit: { band: null, compared: 1 } },
    { user_id: 13, name: 'Lee Park', role: 'founder', persona: 'founder', slug: 'fo_rocketeer', label: 'The Rocketeer', values_fit: { band: 'mixed', compared: 7 } },
    { user_id: 14, name: 'Noor Haddad', role: 'founder', persona: 'founder', slug: 'fo_rocketeer', label: 'The Rocketeer', values_fit: { band: 'far_apart', compared: 7 } },
  ],
  values_fit_reason: null,
  more: false,
};
const PUBLISHED = { state: 'ready', published: true, saving: false, saveFailed: false };

test('Matches: every type shows, members under theirs, three then "and N more", and the values line', () => {
  const groups = matchGroups('fo_missionary', MEMBERS);
  const out = html(h(MatchesSection, { state: 'ready', groups, reply: MEMBERS, publish: PUBLISHED }));
  assert.equal(count(out, 'data-testid="match-type"'), groups.length);
  assert.equal(count(out, 'data-testid="match-member"'), MATCH_MEMBERS_SHOWN);
  assert.match(out, /data-testid="match-more"[^>]*>and 1 more</);
  assert.equal(count(out, 'No member has published this archetype yet.'), groups.length - 1);
  assert.match(out, />Values: aligned</);
  assert.match(out, />Values: not enough recorded</, 'a null band is not enough recorded, never aligned');
  assert.doesNotMatch(out, /coming soon/i, 'D605 built the values line the canvas drew as coming soon');
  assert.doesNotMatch(out, /user_id|compared|confidence/);
  assert.match(out, /Their scores, traits, skills, values and history stay private\./);
});

test('Matches: the caller unpublished sees why there is no values line; past 50, the reply says more', () => {
  const reply = { ...MEMBERS, items: MEMBERS.items.map((m) => ({ ...m, values_fit: null })), values_fit_reason: 'Publish your own archetype to see how your values compare.', more: true };
  const out = html(h(MatchesSection, {
    state: 'ready', groups: matchGroups('fo_missionary', reply), reply, publish: { ...PUBLISHED, published: false },
  }));
  assert.match(out, /data-testid="matches-values-reason"[^>]*>Publish your own archetype to see how your values compare\.</);
  assert.doesNotMatch(out, /data-testid="match-values"/);
  assert.match(out, /More members published these archetypes than the 50 read here\./);
  assert.match(out, /data-testid="publish-state"[^>]*>Not published</);
  assert.match(out, /data-testid="publish-toggle"[^>]*>.*Publish<\/button>/s);
});

test('Matches: locked by plan, unreadable, and loading', () => {
  const locked = html(h(MatchesSection, { state: 'locked' }));
  assert.match(locked, /Matches are not included in your plan\./);
  assert.match(locked, /href="\/pricing"[^>]*>See plans</);
  assert.doesNotMatch(locked, /match-type|publish-banner/);
  const failed = html(h(MatchesSection, {
    state: 'unreadable', groups: matchGroups('fo_missionary', null), publish: PUBLISHED, onRetry: () => {},
  }));
  assert.match(failed, /Matches could not be read\./);
  assert.doesNotMatch(failed, /match-type|No member has published|publish-banner/, 'a failed read is never an empty list');
  assert.match(html(h(MatchesSection, { state: 'loading' })), /data-testid="matches-loading"/);
});

test('the publish switch: published, unreadable, and a save that failed', () => {
  const on = html(h(PublishBanner, { publish: PUBLISHED }));
  assert.match(on, /Only members who publish their archetype appear here\. Publish yours so they can find you\./);
  assert.match(on, />Published</);
  assert.match(on, /Unpublish<\/button>/);
  assert.match(html(h(PublishBanner, { publish: { state: 'unreadable' } })), /Whether yours is published could not be read\./);
  assert.match(html(h(PublishBanner, { publish: { ...PUBLISHED, saveFailed: true } })), /Your choice was not saved\. Try again\./);
  assert.match(html(h(PublishBanner, { publish: { ...PUBLISHED, saving: true } })), /disabled=""[^>]*aria-busy="true"|aria-busy="true"[^>]*disabled=""/);
});

// ── The page ─────────────────────────────────────────────────────────────────

const page = codeOnly(read('frontend/src/pages/ArchetypeCardPage.jsx'));

test('the page reads each section\'s source, and each Try again re-reads its own', () => {
  assert.match(page, /api\.skills\.getMyEvidence\(\)/);
  assert.match(page, /api\.profileHistory\(persona\)/);
  assert.match(page, /api\.profilePublishedMembers\(slugKey\.split\(','\)\)/);
  assert.match(page, /api\.archetypePublished\(\)/);
  assert.match(page, /api\.setArchetypePublished\(next\)/);
  assert.match(page, /<SkillsSection state=\{skills\.state\} model=\{skillsModel\} onRetry=\{readSkills\} \/>/);
  assert.match(page, /<HistorySection state=\{history\.state\} view=\{historyView\} cardLabel=\{title\} onRetry=\{readHistory\} \/>/);
  assert.match(page, /onRetryPublish=\{readPublish\}/);
  assert.match(page, /onRetry=\{\(\) => readMembers\(\)\}/, 'a click event must not reach readMembers as its quiet flag');
  assert.match(page, /radarModel\(radarLayers\(skills\.data\), skills\.data\.corroborated_at\)/);
  assert.match(page, /timelineView\(history\.items, persona, slug\)/);
});

test('the page: the timeline is the shown persona, a publish change re-reads the matches, and a lock shows its line', () => {
  assert.match(page, /const persona = latest \? \(fitData\?\.archetype\?\.persona \|\| audience\) : null;/);
  assert.match(page, /readMembers\(true\);/);
  assert.match(page, /state=\{lock \? 'locked' : members\.state\}/);
  assert.match(page, /d\?\.locked \? \{ state: 'locked'/);
  assert.match(page, /\{!latest && !lock && !failed && <HistorySection state="unclassified" \/>\}/);
  assert.doesNotMatch(page, /meta\?\.matching/, "the article's static matching list is the Matches section now");
  assert.match(page, /\{!loading && \(\s*<div className="mt-9 flex flex-col gap-9" data-testid="archetype-sections">/);});

test('the page: a reply without its list or flag is unreadable, never an empty section', () => {
  assert.match(page, /Array\.isArray\(d\?\.axes\) && d\.axes\.length \? \{ state: 'ready', data: d \} : \{ state: 'unreadable', data: null \}/);
  assert.match(page, /Array\.isArray\(d\?\.items\) \? \{ state: 'ready', items: d\.items \} : \{ state: 'unreadable', items: null \}/);
  assert.match(page, /: Array\.isArray\(d\?\.items\) \? \{ state: 'ready', reply: d \}\s*: \{ state: 'unreadable', reply: null \}/);
  assert.match(page, /setPublish\(typeof d\?\.published === 'boolean'\s*\? \{ state: 'ready', published: d\.published/);
});

// ── The canvas ───────────────────────────────────────────────────────────────

test('the canvas is committed: the board, and the component its A24–A30 import', () => {
  const dir = 'design/canvases/integrated';
  const board = read(`${dir}/Studio · Archetype card.dc.html`);
  const comp = read(`${dir}/Archetype Full Sections.dc.html`);
  for (const id of ['A24', 'A25', 'A26', 'A27', 'A28', 'A29', 'A30']) assert.match(board, new RegExp(`>${id}<`), id);
  assert.ok(count(board, '<dc-import name="Archetype Full Sections"') >= 7);
  for (const s of ['Your skills, two ways', 'How your archetype has changed', 'Who you match with', EVIDENCE_NOTE,
    'Answer a few skill questions with Eadwyn to fill this in.', 'Matches are not included in your plan.',
    'No member has published this archetype yet.', 'Your skills could not be read.', 'Your history could not be read.', 'Matches could not be read.']) {
    assert.ok(comp.includes(s), s);
  }
  for (const f of [board, comp]) {
    assert.ok(f.startsWith('<!DOCTYPE html>\n<html><head>\n<meta charset="utf-8">'), 'the committed serialisation');
    assert.ok(f.endsWith('</body></html>\n'));
    assert.match(f, /data-dc-script=""/);
  }
  assert.match(comp, /<script src="archetype-full\.js"><\/script>/);
  assert.equal(existsSync(resolve(ROOT, `${dir}/archetype-full.js`)), false);
  assert.match(read('documentation/architecture/decisions/D619.md'), /archetype-full\.js/, 'D619 says the export left its data script out');
});
