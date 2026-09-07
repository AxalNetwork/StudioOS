/**
 * A zone header's controls are LABELS. They stopped being paragraphs.
 *
 * WHAT SHIPPED, AND WHY IT WAS NOT A COPY MISTAKE. `zoneActionBuilder.js` and
 * `zoneFilterBuilder.js` each documented a third entry kind — `note:` — for an
 * op or a chip nothing performs yet. `ZoneActions` rendered such an entry as
 * `{item.label} — {item.note}`, and `ZoneToolbar` collected the filter notes
 * into sentences beneath the chip row. So the design's four-word filter strip
 * arrived on the customer's screen like this:
 *
 *     Comparables — no competitor can be filed as a comparable: the form
 *     offers direct or adjacent, and every writer coerces anything else to
 *     direct
 *
 * against a canvas that says, in full: `Comparables`. Every zone with a gap
 * grew an essay about its own gaps, in the row where the working controls live.
 *
 * REFUSING TO DRAW A DEAD CONTROL WAS RIGHT AND HAS NOT CHANGED. A button is a
 * promise that something will happen, and a filter that cannot run is worse
 * than a button that cannot: it returns an empty set, and an empty set reads as
 * an ANSWER. What changed is WHERE the refusal is explained. The reason now
 * lives on the table entry, under `unbuilt:`, which the person who can build
 * the op reads and the customer never sees.
 *
 * THE NUMBERS THIS PASS MOVED. 245 entries across eight tables carried a
 * `note:`; all 245 are now `unbuilt:` and render nothing. Not one canvas string
 * was dropped, which is why `profile_zone_actions` and `profile_zone_filters`
 * still prove every artboard's `ops:` and `filters:` array is accounted for,
 * in the artboard's own order.
 *
 * WHAT THIS FILE ADDS ON TOP OF THOSE TWO. They check provenance — that the
 * table matches the canvas. This checks SHAPE and REACH: that every label is
 * still a label rather than a sentence, and that nothing unbuilt survives the
 * builders into something a reader can see.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

import { FOUNDER_ZONE_ACTIONS, founderZoneActions } from '../src/workspaces/founderZoneActions.js';
import { INVESTOR_ZONE_ACTIONS, investorZoneActions } from '../src/workspaces/investorZoneActions.js';
import { PARTNER_ZONE_ACTIONS, partnerZoneActions } from '../src/workspaces/partnerZoneActions.js';
import { ADVISOR_ZONE_ACTIONS, advisorZoneActions } from '../src/workspaces/advisorZoneActions.js';
import { FOUNDER_ZONE_FILTERS, founderZoneFilters } from '../src/workspaces/founderZoneFilters.js';
import { INVESTOR_ZONE_FILTERS, investorZoneFilters } from '../src/workspaces/investorZoneFilters.js';
import { PARTNER_ZONE_FILTERS, partnerZoneFilters } from '../src/workspaces/partnerZoneFilters.js';
import { ADVISOR_ZONE_FILTERS, advisorZoneFilters } from '../src/workspaces/advisorZoneFilters.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const ACTION_TABLES = [
  ['founder', FOUNDER_ZONE_ACTIONS, founderZoneActions],
  ['investor', INVESTOR_ZONE_ACTIONS, investorZoneActions],
  ['partner', PARTNER_ZONE_ACTIONS, partnerZoneActions],
  ['advisor', ADVISOR_ZONE_ACTIONS, advisorZoneActions],
];
const FILTER_TABLES = [
  ['founder', FOUNDER_ZONE_FILTERS, founderZoneFilters],
  ['investor', INVESTOR_ZONE_FILTERS, investorZoneFilters],
  ['partner', PARTNER_ZONE_FILTERS, partnerZoneFilters],
  ['advisor', ADVISOR_ZONE_FILTERS, advisorZoneFilters],
];

/** Every label a filter row can render, canvas fallback included. */
function filterLabels(row) {
  const canvas = Array.isArray(row.canvas) ? row.canvas : [row.canvas];
  return row.label ? [row.label] : canvas;
}

/**
 * THE SHAPE RULE, AND WHY EACH CLAUSE IS THE ONE IT IS.
 *
 * Measured against the tables as they stand: 288 distinct labels, the longest
 * `Attached to proposals` at 21 characters, and NOT ONE containing an em dash,
 * a colon or a full stop. The canvases were never the problem — the labels were
 * always short, and only the rendering made them sentences. So the cap is 24,
 * which clears the longest real label by three and cannot fit a clause.
 *
 * The em dash is banned because that is the exact joint the old renderer used
 * (`{label} — {note}`), so a re-introduction would show up here first. A full
 * stop is banned because it is what turns a name into a statement.
 *
 * A COLON IS ALLOWED, deliberately, and one artifact is why: Pipeline's canvas
 * specifies `Bulk: nudge unopened` and `WIP limit: 5 per stage`. Banning the
 * colon would forbid two controls the design requires by name. Both are still
 * inside the cap, which is the clause that actually does the work.
 */
const CAP = 24;
function assertLabelShaped(where, label) {
  assert.ok(typeof label === 'string' && label.length > 0, `${where} has no label`);
  assert.ok(label.length <= CAP,
    `${where}: "${label}" is ${label.length} characters — a label, not a sentence, belongs here`);
  assert.ok(!label.includes('—'),
    `${where}: "${label}" carries an em dash, the joint the old label-plus-reason renderer used`);
  assert.ok(!/\.\s|\.$/.test(label),
    `${where}: "${label}" reads as a statement rather than a name`);
}

test('every action label is a label, not a sentence', () => {
  let seen = 0;
  for (const [name, table] of ACTION_TABLES) {
    for (const [zone, rows] of Object.entries(table)) {
      for (const row of rows) {
        assertLabelShaped(`${name} · ${zone}`, row.label);
        seen += 1;
      }
    }
  }
  assert.ok(seen >= 200, `only ${seen} actions read — the tables are not being walked`);
});

test('every filter label is a label, not a sentence', () => {
  let seen = 0;
  for (const [name, table] of FILTER_TABLES) {
    for (const [zone, rows] of Object.entries(table)) {
      for (const row of rows) {
        for (const label of filterLabels(row)) {
          // `{n}` is substituted with the page's own count before render, and
          // dropped when the page has none — `All {n} months` is 5 characters
          // longer than what a reader ever sees.
          assertLabelShaped(`${name} · ${zone}`, label.replace(/\s*\{n\}/g, ''));
          seen += 1;
        }
      }
    }
  }
  assert.ok(seen >= 200, `only ${seen} filters read — the tables are not being walked`);
});

test('nothing unbuilt survives either builder into something a reader can see', () => {
  // The end-to-end half. The two builders are asserted directly elsewhere; this
  // walks EVERY zone of all eight tables and checks the built output, so a table
  // that grew a new entry shape — or a builder that grew a new escape — fails
  // here rather than on the screen.
  let ops = 0;
  for (const [name, table, build] of ACTION_TABLES) {
    for (const zone of Object.keys(table)) {
      for (const item of build(zone, { query: '', view: null })) {
        assert.equal(item.note, undefined, `${name} · ${zone} · ${item.label} still carries prose`);
        assert.ok(item.to || item.onClick || item.disabled,
          `${name} · ${zone} · ${item.label} renders but does nothing`);
        ops += 1;
      }
    }
  }
  assert.ok(ops > 0, 'no actions were built at all — the walk is not walking');

  let chips = 0;
  for (const [name, table, build] of FILTER_TABLES) {
    for (const zone of Object.keys(table)) {
      for (const item of build(zone, { value: '__none__' })) {
        assert.equal(item.note, undefined, `${name} · ${zone} · ${item.label} still carries prose`);
        assert.ok(item.onSelect, `${name} · ${zone} · ${item.label} is a chip that cannot be selected`);
        chips += 1;
      }
    }
  }
  assert.ok(chips > 0, 'no filters were built at all — the walk is not walking');
});

test('an unbuilt entry is dropped, not merely emptied', () => {
  // The difference matters to the toolbar: an entry that survived as `{label:
  // 'Comparables'}` with no handler would render as a chip that does nothing —
  // the "absent is not empty" failure `zoneFilterBuilder` exists to prevent,
  // arrived at from the other side. So the count is what is asserted.
  const zone = 'research/companies';
  const rows = FOUNDER_ZONE_FILTERS[zone];
  const dead = rows.filter((r) => r.unbuilt && !r.dynamic);
  assert.ok(dead.length >= 3, `${zone} no longer carries the unbuilt entries this pins`);
  const built = founderZoneFilters(zone, { value: 'all' });
  assert.equal(built.length, rows.length - dead.length,
    `${zone} builds ${built.length} chips from ${rows.length} rows with ${dead.length} unbuilt`);
  for (const row of dead) {
    for (const label of filterLabels(row)) {
      assert.ok(!built.some((i) => i.label === label), `${zone} still draws "${label}"`);
    }
  }
});

test('the renderers carry no path back to prose', () => {
  // Through `codeOnly`: all three files' docblocks quote the removed shape to
  // explain why it went, and a raw-source check fails on the explanation.
  const actions = codeOnly(read('frontend/src/workspaces/ZoneActions.jsx'));
  const toolbar = codeOnly(read('frontend/src/workspaces/ZoneToolbar.jsx'));
  const filters = codeOnly(read('frontend/src/workspaces/zoneFilterBuilder.js'));

  for (const [file, src] of [['ZoneActions', actions], ['ZoneToolbar', toolbar]]) {
    assert.doesNotMatch(src, /item\.note/, `${file} reads a note again`);
    assert.doesNotMatch(src, /—/, `${file} renders an em dash again`);
  }
  assert.doesNotMatch(toolbar, /groupFilterNotes|sentenceList/,
    'ZoneToolbar collects filter reasons into prose again');
  assert.doesNotMatch(filters, /export function (groupFilterNotes|sentenceList)/,
    'the prose-grouping helpers are back');
  assert.doesNotMatch(filters, /noteAlways/,
    'noteAlways is back — a standing sentence beside chips that all work');
});

/**
 * The decoded canvases, which are the reason this pass happened.
 *
 * These strings come from the artifacts themselves, not from the tables they
 * are compared against, so the assertion runs in the direction that catches a
 * drift: the design says what it says, and the table has to agree.
 *
 * Offers is the set pinned here because it is the one whose five zones were
 * reported as unchanged and whose ops are all present in the table today.
 * Pipeline (`5d310b19`) and Expertise (`83d319cd`) specify ops this repo has no
 * rows for at all — `PARTNER_ZONE_ACTIONS` has no `/pipeline` key, and its own
 * docblock says why: the earlier canvas "specifies NO zone-header actions …
 * left alone until the canvas gains an `ops:` array". Those canvases now have
 * one. Pinning them here before the rows exist would assert a schedule rather
 * than an invariant, which is the mistake `zone_actions.test.mjs` records
 * having made once already, so they are tracked as work and not as a test.
 */
const OFFERS_OPS = {
  'offers/catalog': ['New service', 'Pricing history', 'Export'],
  'offers/perk-deals': ['New perk', 'Extend', 'Export'],
  'offers/visibility': ['Adjust placements', 'Attribution rules', 'Export'],
  'offers/proof': ['Ask for consent', 'Preview public page', 'Export'],
  'offers/audience-fit': ['Edit fit rules', 'Pass reasons', 'Export'],
};

test('the Offers ops are the canvas\'s own, in the canvas\'s order', () => {
  for (const [zone, expected] of Object.entries(OFFERS_OPS)) {
    const rows = PARTNER_ZONE_ACTIONS[zone];
    assert.ok(rows, `${zone} left the partner action table`);
    assert.deepEqual(rows.map((r) => r.label), expected,
      `${zone} no longer lists the canvas's ops in the canvas's order`);
  }
});

test('every Offers zone still offers its export, and only its export', () => {
  // The visible consequence of the sweep on the five zones that were reported.
  // Two of the three ops per zone are unbuilt and now render nothing; `Export`
  // is real on all five — migrations 208 and 209 gave these zones their stores
  // — so each header keeps exactly one control, with the canvas's own label.
  for (const zone of Object.keys(OFFERS_OPS)) {
    const built = partnerZoneActions(zone, { query: '', view: null });
    assert.deepEqual(built.map((i) => i.label), ['Export'],
      `${zone} renders something other than its export`);
    // With no rows loaded it is disabled rather than absent: the store and the
    // writer both exist, so this is a transient state, not an unbuilt control.
    assert.equal(built[0].disabled, true, `${zone}'s export claims rows it has not loaded`);

    const loaded = partnerZoneActions(zone, {
      query: '', view: { scope: 's', header: ['A'], rows: [{ a: 1 }], cells: (r) => [r.a] },
    });
    assert.equal(loaded[0].disabled, undefined, `${zone}'s export stays dead once rows arrive`);
    assert.ok(loaded[0].onClick, `${zone}'s export does not write a file`);
  }
});
