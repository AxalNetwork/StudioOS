// D6047 (#6047, Raise V2 build 3/5) — Raise's phone root, board RA-11 (RA11a) of
// `design/incoming/Raise v2 Page.dc.html` (D4863), drawn from the overview read (D663, D1610, D6045).
// Three founders: one with no data, one with a draft deck, one with an active round; then the staff
// read, an older read, the 390px rules and the canvas.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_phone_root_6047.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import PhoneCycleRoot from '../src/pages/cycles/PhoneCycleRoot.jsx';
import RaiseOverview from '../src/pages/cycles/RaiseOverview.jsx';
import { isRaiseV2Read, raisePhoneRows } from '../src/pages/cycles/raisePhoneModel.js';
import { renderedText } from './_renderedText.mjs';

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const Q = '?project_id=7';
const html = (raw, props = {}) => renderToStaticMarkup(h(MemoryRouter, null, h(PhoneCycleRoot, { cycle: 'raise', raw, search: Q, ...props })));
/** The markup from the element carrying `data-testid="<id>"` to the end of the page. */
const from = (out, id) => { const at = out.indexOf(`data-testid="${id}"`); return at < 0 ? '' : out.slice(out.lastIndexOf('<', at)); };
/** The opening tag carrying `data-testid="<id>"`. */
const tag = (out, id) => { const at = out.indexOf(`data-testid="${id}"`); return at < 0 ? '' : out.slice(out.lastIndexOf('<', at), out.indexOf('>', at) + 1); };
/** One row (a link) of the module status list, by its testid, up to its close. */
const rowOf = (out, key) => { const s = from(out, `phone-index-${key}`); return s.slice(0, s.indexOf('</a>') > 0 ? s.indexOf('</a>') : undefined); };
const at = (out, id) => out.indexOf(`data-testid="${id}"`);

const row = (key, title, detail, value, href = `/raise/${key}${Q}`) => ({ key, title, detail, value, href });
const card = (slug, name, extra = {}) => ({ slug, name, state: 'ok', series: [], caption: `What ${name} shows.`, ...extra });
const readinessCard = (items) => card('fundraising-readiness', 'Fundraising readiness', { series: [{ kind: 'hbar', items }] });
const empty = (slug, name) => card(slug, name, { state: 'empty', series: null, reason: 'Nothing here yet.' });
const pitch = (key, label, extra = {}) => ({ ...card('pitch-deck', 'Pitch deck', key === 'no_deck' ? { state: 'empty', series: null } : {}), pitch_state: { state: 'ok', key, label, version: null, live_links: 0, to_fix: null, unsaved_changes: false, ...extra } });
const none = (key, label) => ({ key, label, fact: null, as_of: null, state: 'not_connected' });

/** A founder with nothing recorded: the Worker's early rule, no area scored, nothing connected. */
function noData() {
  return {
    cycle: 'raise',
    stage: { state: 'ok', key: 'prepare', label: 'Prepare', rule: 'No narrative version saved' },
    primary_action: { state: 'ok', key: 'prepare_to_raise', label: 'Prepare to raise', href: '/raise/fundraising-readiness?project=7', rule: 'No narrative version saved' },
    focus: { rule: 'first_readiness', eyebrow: 'Raise · Next', headline: 'Score your readiness.', why: 'Nothing in Raise is recorded yet.', cta: { label: 'Score readiness', href: '/raise/fundraising-readiness?project=7&add=1' }, then: null },
    meter: { key: 'committed', label: 'Signed or received', count: null, target: null, target_reason: null, display: null, detail: null },
    index: [
      row('fundraising-readiness', 'Fundraising readiness', 'Readiness score', null),
      row('investor-narrative', 'Investor narrative', 'Saved versions', null),
      row('pitch-deck', 'Pitch deck', 'Views this week', null, `/raise/pitch${Q}`),
      row('data-room', 'Data room', 'Checklist coverage', null),
      row('capital-relationships', 'Capital relationships', 'In active conversation', null),
    ],
    figures: [],
    cards: [
      { ...card('fundraising-readiness', 'Fundraising readiness'), state: 'empty', series: null },
      empty('investor-narrative', 'Investor narrative'), pitch('no_deck', 'No deck'), empty('data-room', 'Data room'),
      empty('capital-relationships', 'Capital relationships'),
    ],
    next_steps: { state: 'ok', items: [] },
    connectors: [none('mercury', 'Mercury'), none('github', 'GitHub'), none('google', 'Google Workspace')],
  };
}

/** A founder with a saved narrative and a working draft of the deck. */
function draftDeck() {
  const base = noData();
  return {
    ...base,
    stage: { state: 'ok', key: 'build_the_story', label: 'Build the story', rule: 'A narrative version is saved and the deck is not ready to send' },
    primary_action: { state: 'ok', key: 'build_pitch', label: 'Build pitch', href: `/raise/pitch${Q}`, rule: 'A narrative version is saved and the deck is not ready to send' },
    cards: [readinessCard([{ label: 'Investor narrative', value: 7 }, { label: 'Pitch deck', value: null }, { label: 'Team', value: null }]),
      card('investor-narrative', 'Investor narrative'), pitch('draft', 'Working draft only'), empty('data-room', 'Data room'), empty('capital-relationships', 'Capital relationships')],
    next_steps: { state: 'ok', items: [
      { item_key: 'deck', label: 'Pitch deck', text: 'The deck has no saved version', module_slug: 'pitch-deck', href: `/raise/pitch${Q}`, gain_points: null },
      { item_key: 'team', label: 'Team', text: 'A person assesses this', module_slug: 'fundraising-readiness', href: '/raise/fundraising-readiness', gain_points: 12 },
    ] },
  };
}

/** A founder running the round: investors in the pipeline, money signed against a target, sources connected. */
function activeRound() {
  const base = noData();
  return {
    ...base,
    stage: { state: 'ok', key: 'run_the_raise', label: 'Run the raise', rule: 'At least one investor is in the pipeline' },
    primary_action: { state: 'ok', key: 'add_investor', label: 'Add investor', href: '/raise/capital-relationships/new?project=7', rule: 'At least one investor is in the pipeline' },
    meter: { key: 'committed', label: 'Signed or received', count: 900000, target: 1500000, target_reason: null, display: '$900k of $1.5M', detail: null },
    index: [
      row('calls', 'Calls', 'Calls for Capital', '1 open'),
      row('fundraising-readiness', 'Fundraising readiness', 'Readiness score', '64 of 100'),
      row('pitch-deck', 'Pitch deck', 'Views this week', '0', `/raise/pitch${Q}`),
      row('capital-relationships', 'Capital relationships', 'In active conversation', '6'),
    ],
    cards: [readinessCard([{ label: 'Investor narrative', value: 9 }, { label: 'Data room', value: 6 }, { label: 'Team', value: 7 }]),
      card('investor-narrative', 'Investor narrative'), pitch('shared', 'Shared', { version: 6, live_links: 2 }), card('data-room', 'Data room'), card('capital-relationships', 'Capital relationships')],
    next_steps: { state: 'ok', items: [
      { item_key: 'traction', label: 'Traction proof', text: 'No revenue recorded for the last 3 months', module_slug: 'fundraising-readiness', href: '/grow/revenue-and-traction?project=7', gain_points: 3 },
      { item_key: 'data_room', label: 'Data room', text: '8 of 12 checklist items have a file', module_slug: 'data-room', href: '/raise/data-room?project=7', gain_points: 9 },
      { item_key: 'cap', label: 'Cap table', text: 'The round is not modelled', module_slug: 'cap-table', href: '/raise/cap-table?project=7', gain_points: 5 },
      { item_key: 'uof', label: 'Use of funds', text: 'No split saved', module_slug: 'use-of-funds', href: '/raise/use-of-funds?project=7', gain_points: 1 },
    ] },
    connectors: [
      { key: 'mercury', label: 'Mercury', fact: '18 months of runway · cash and net burn', as_of: '2026-11-09 14:05', state: 'connected' },
      { key: 'github', label: 'GitHub', fact: 'Contributors to 2 repositories', as_of: null, state: 'connected' },
      { key: 'google', label: 'Google Workspace', fact: null, as_of: null, state: 'unreadable' },
    ],
  };
}

test('a founder with no data: Prepare to raise first, Prepare current, next steps before the score, everything else Not recorded, never 0', () => {
  const out = html(noData());
  const t = renderedText(out);
  assert.match(out, /data-raise-phone="ra-11"/);
  // RA-03: the Worker's primary action, not D703's focus headline, so both widths offer one action.
  assert.match(tag(out, 'raise-phone-action'), /href="\/raise\/fundraising-readiness\?project=7"/);
  assert.match(t, /Prepare to raise/);
  assert.doesNotMatch(t, /Score your readiness\./, 'the focus headline is not drawn beside the primary action');
  assert.equal((out.match(/data-testid="raise-phone-action"/g) || []).length, 1, 'one primary action');
  // The action is the first thing after the eyebrow: reachable without scrolling.
  assert.ok(at(out, 'raise-phone-action') < at(out, 'raise-phone-journey'), 'action before the journey');
  // The journey: Prepare is the step the viewer is on, the rule is the Worker's.
  assert.match(tag(out, 'raise-phone-stage-prepare'), /aria-current="step"/);
  assert.equal((out.match(/aria-current="step"/g) || []).length, 1);
  assert.match(t, /Stage chosen from your records: No narrative version saved\./);
  // Next steps above the score; none open is said, not drawn as an empty list.
  assert.ok(at(out, 'raise-phone-next') < at(out, 'raise-phone-score'), 'next steps above the score');
  assert.match(t, /No readiness step is open right now\./);
  assert.match(tag(out, 'raise-phone-score'), /data-state="none"/);
  assert.match(t, /No area is assessed yet, so readiness has no coverage to show\./);
  // #8256: not served yet, so Not recorded.
  assert.match(renderedText(from(out, 'raise-phone-next-followups')), /^Follow-ups due and investor objections\s*Not recorded/);
  // The meter: nothing signed is Not recorded, never "$0".
  assert.match(renderedText(from(out, 'phone-meter-value')), /^Not recorded/);
  // RA-06: nothing connected is one message and one Connect.
  assert.match(tag(out, 'raise-phone-sources'), /data-state="none"/);
  assert.match(t, /Nothing is connected, so evidence is only what you add by hand\./);
  assert.match(out, /aria-label="Connect sources for fundraising evidence" href="\/account\/connectors"/);
  assert.equal(at(out, 'raise-phone-freshness'), -1, 'no freshness line with nothing connected');
  // The module status list: every row the Worker sent, each Not recorded, none 0; Pitch says No deck.
  assert.ok(at(out, 'raise-phone-sources') < at(out, 'phone-index'), 'the list comes last');
  for (const key of ['fundraising-readiness', 'investor-narrative', 'data-room', 'capital-relationships']) {
    assert.match(renderedText(rowOf(out, key)), /Not recorded/, `${key}: Not recorded`);
  }
  assert.match(renderedText(rowOf(out, 'pitch-deck')), /No deck/);
  assert.doesNotMatch(t, /\b0 of\b|\$0\b/);
});

test('a founder with a draft deck: Build pitch, Build the story current with Prepare Earlier, an unknown gain Not recorded, Team never a step', () => {
  const out = html(draftDeck());
  const t = renderedText(out);
  assert.match(tag(out, 'raise-phone-action'), /href="\/raise\/pitch\?project_id=7"/);
  assert.match(tag(out, 'raise-phone-action'), /data-action-key="build_pitch"/);
  assert.match(tag(out, 'raise-phone-stage-build_the_story'), /aria-current="step"/);
  assert.match(tag(out, 'raise-phone-stage-prepare'), /data-stage-status="earlier"/);
  assert.match(tag(out, 'raise-phone-stage-prepare_diligence'), /data-stage-status="next"/);
  // One step: the deck; Team is a person's to assess, never a step.
  assert.match(out, /data-testid="raise-phone-next-deck"/);
  assert.doesNotMatch(out, /data-testid="raise-phone-next-team"/);
  assert.match(renderedText(from(out, 'raise-phone-next-impact-unrecorded')), /^Readiness impact\s*Not recorded/);
  assert.doesNotMatch(t, /\+0 points/);
  assert.match(out, /aria-label="Open Pitch deck for Pitch deck"/);
  // The score: one of three areas assessed, the other two named, never scored 0.
  assert.match(t, /1 of 3 areas assessed/);
  assert.match(t, /Pitch deck and Team have no score yet, so they are not counted\./);
  assert.match(renderedText(from(out, 'raise-phone-attention')), /^Areas needing attention\s*Not recorded/, '#8257');
  // The module status list says the deck's state (RA-05), not "Views this week · Not recorded".
  assert.match(renderedText(rowOf(out, 'pitch-deck')), /Working draft only/);
  assert.doesNotMatch(renderedText(rowOf(out, 'pitch-deck')), /Views this week|Not recorded/);
});

test('a founder with an active round: Add investor, the round\'s meter as sent, three steps by gain, sources with their last read', () => {
  const out = html(activeRound(), { onRetry() {} });
  const t = renderedText(out);
  assert.match(tag(out, 'raise-phone-action'), /href="\/raise\/capital-relationships\/new\?project=7"/);
  assert.match(t, /Add investor/);
  assert.match(tag(out, 'raise-phone-stage-run_the_raise'), /aria-current="step"/);
  // At most three, biggest known gain first.
  const order = ['data_room', 'cap', 'traction'].map((k) => at(out, `raise-phone-next-${k}`));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'Data room, Cap table, Traction proof');
  assert.equal(at(out, 'raise-phone-next-uof'), -1, 'the fourth is not drawn');
  assert.match(t, /1 of 3\s*Data room/);
  assert.match(renderedText(from(out, 'raise-phone-next-impact')), /^Readiness impact \+9 points/);
  // Next steps above the score; the meter is the Worker's display, never formatted here.
  assert.ok(at(out, 'raise-phone-next') < at(out, 'raise-phone-score'));
  assert.match(out, /data-testid="phone-meter-value">\$900k of \$1\.5M</);
  assert.match(t, /3 of 3 areas assessed\s*Every area has a score\./);
  // RA-06's line: connected sources with their last read (or Not recorded), a failed one Unavailable with Try again.
  assert.match(renderedText(from(out, 'raise-phone-source-mercury')), /^Mercury · Read 2026-11-09 14:05/);
  assert.match(renderedText(from(out, 'raise-phone-source-github')), /^GitHub · Last read · Not recorded/);
  assert.match(renderedText(from(out, 'raise-phone-source-google')), /^Google Workspace\s*Unavailable/);
  assert.doesNotMatch(renderedText(from(out, 'raise-phone-source-google')).split('Manage')[0], /Read 20/, 'an unreadable source is given no date');
  assert.match(out, /aria-label="Try reading Google Workspace again"/);
  assert.match(renderedText(from(out, 'raise-phone-freshness')), /^Fresh or stale\s*Not recorded/, '#8258');
  // A measured 0 is a value; the Pitch row says Shared.
  assert.match(renderedText(rowOf(out, 'capital-relationships')), /6/);
  assert.match(renderedText(rowOf(out, 'pitch-deck')), /Shared/);
  assert.match(renderedText(rowOf(out, 'calls')), /1 open/);
});

test('a stage or action that could not be worked out is said, never guessed; an unreadable list is Unavailable, not empty', () => {
  const raw = { ...activeRound(), stage: { state: 'unreadable', reason: 'The pipeline could not be read.' }, primary_action: { state: 'unreadable', reason: 'the pipeline could not be read.' },
    next_steps: { state: 'unreadable' }, connectors: { state: 'unreadable' } };
  const out = html(raw);
  const t = renderedText(out);
  assert.equal(at(out, 'raise-phone-action'), -1);
  assert.match(t, /No primary action is offered: the pipeline could not be read\./);
  assert.equal((out.match(/aria-current="step"/g) || []).length, 0);
  assert.match(t, /The stage is Unavailable\. The pipeline could not be read\./);
  assert.match(tag(out, 'raise-phone-next'), /data-state="unavailable"/);
  assert.match(tag(out, 'raise-phone-sources'), /data-state="unavailable"/);
  assert.doesNotMatch(t, /No readiness step is open|Nothing is connected/);
});

test('a staff read: Read only, no primary action, no link that writes, and module rows from the cards, not "Unreadable" for all', () => {
  // The Worker sends a staff read no focus, meter or index (cycle_raise.ts).
  const { focus, meter, index, ...rest } = activeRound();
  const raw = { ...rest, read_only: true, mode: 'summary', primary_action: null };
  const out = html(raw);
  const t = renderedText(out);
  assert.match(t, /Read only · HQ summary\./);
  assert.equal(at(out, 'raise-phone-action'), -1);
  // Read only wins even over an action in the read.
  assert.equal(at(html({ ...raw, primary_action: activeRound().primary_action }), 'raise-phone-action'), -1, 'no action for a read-only viewer');
  assert.doesNotMatch(out, /aria-label="Open [^"]+ for /, 'no next-step action');
  assert.doesNotMatch(out, /\/account\/connectors/, 'no Connect or Manage');
  assert.match(t, /Read only\. The founder takes these steps\./);
  assert.match(renderedText(rowOf(out, 'data-room')), /Has records/);
  assert.match(renderedText(rowOf(out, 'pitch-deck')), /Shared/);
  assert.match(rowOf(out, 'pitch-deck'), /href="\/raise\/pitch\?project_id=7"/);
  assert.doesNotMatch(t, /Unreadable/);
  // Each card's own state: an empty one is Not recorded, an unreadable one Unreadable.
  const rows = raisePhoneRows({ cards: [empty('data-room', 'Data room'), card('cap-table', 'Cap table', { state: 'unreadable' })] }, [], Q);
  assert.deepEqual(rows.map((r) => [r.key, r.value]), [['data-room', null], ['cap-table', 'Unreadable']]);
});

test('an older read without D6045\'s fields keeps D703\'s focus root; loading, refused and unreadable stay shared', () => {
  const older = { focus: { rule: 'next', eyebrow: 'Raise · Next', headline: 'Send the round call.', why: 'Why', cta: { label: 'Call for Capital', href: `/raise/call${Q}` }, then: null }, meter: null, index: [], cards: [] };
  assert.equal(isRaiseV2Read(older), false);
  assert.equal(isRaiseV2Read(noData()), true);
  const out = html(older);
  assert.doesNotMatch(out, /data-raise-phone/);
  assert.match(out, /data-testid="phone-focus-cta"/);
  assert.match(html(null, { status: 'loading' }), /aria-busy="true"/);
  assert.match(renderedText(html(null, { status: 'refused', message: 'This venture could not be found.' })), /This venture could not be found\./);
  assert.match(html(null, { status: 'unreadable' }), /The Raise overview/);
  // Validate keeps its root even if a read carried a stage.
  assert.doesNotMatch(renderToStaticMarkup(h(MemoryRouter, null, h(PhoneCycleRoot, { cycle: 'validate', raw: { ...older, stage: { state: 'ok', key: 'prepare' } } }))), /data-raise-phone/);
});

test('RaiseOverview draws the RA-11 root below 1024px', () => {
  const out = renderToStaticMarkup(h(MemoryRouter, null, h(RaiseOverview, { phone: true, raw: draftDeck(), status: 'ready', search: Q })));
  assert.match(out, /data-raise-phone="ra-11"/);
  assert.doesNotMatch(out, /data-raise-overview="v2"/, 'not the desktop page');
});

test('390px: one column, nothing wider than the screen, nothing that will not wrap, every tap 44px or more', () => {
  const src = read('frontend/src/pages/cycles/RaisePhoneRoot.jsx');
  assert.doesNotMatch(src, /whitespace-nowrap|overflow-x-(auto|scroll)|\bw-\[\d{3,}px\]|min-w-\[\d{3,}px\]|grid-cols-\[/);
  assert.match(src, /grid-cols-4 gap-1/, 'the journey is four columns of one quarter each');
  assert.match(src, /min-w-0 flex-col gap-0\.5 rounded-\[9px\]/, 'each stage may shrink');
  assert.match(src, /break-words/, 'a long stage name wraps');
  for (const m of src.matchAll(/const (BTN|BTN_P|LINK) = '([^']+)'/g)) assert.match(m[2], /min-h-\[44px\]/, `${m[1]} is a 44px target`);
  assert.match(src, /min-h-\[52px\] w-full/, 'the primary action is the full width');
});

test('the canvas: RA-11 is the board drawn, with the primary action before next actions', () => {
  const page = read('design/incoming/Raise v2 Page.dc.html');
  const ra11a = page.slice(page.indexOf('RA11a: () =>'), page.indexOf('RA11b: () =>'));
  assert.ok(ra11a.indexOf('Prepare to raise') > 0 && ra11a.indexOf('Prepare to raise') < ra11a.indexOf('Next actions'));
  assert.match(read('design/incoming/Raise v2 · Boards.dc.html'), /'RA-11', 'Mobile 390'/);
  assert.match(read('documentation/architecture/decisions/D6047.md'), /^## D6047 — .+ \(#6047\)$/m);
});
