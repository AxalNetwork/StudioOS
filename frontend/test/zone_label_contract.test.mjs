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

test('nothing unbuilt survives either builder into something a reader can act on', () => {
  // The end-to-end half. The two builders are asserted directly elsewhere; this
  // walks EVERY zone of all eight tables and checks the built output, so a table
  // that grew a new entry shape — or a builder that grew a new escape — fails
  // here rather than on the screen.
  //
  // THE TITLE USED TO END "into something a reader can SEE", and the change of
  // one word is the change of rule. An unbuilt control is drawn now, disabled,
  // with its reason on hover: 166 of them across the eight tables were
  // invisible, and every one was read as a missing feature — five reports in a
  // week about zones that had dropped nothing the artboard drew.
  //
  // What must not survive is anything a reader can ACT on. A dead control that
  // clicks is worse than an absent one, and a dead FILTER that selects is worse
  // than either: it returns an empty set, and an empty set reads as an answer.
  // So each item is either live or inert, and inert means no handler at all.
  let ops = 0;
  let unbuiltOpsDrawn = 0;
  for (const [name, table, build] of ACTION_TABLES) {
    for (const zone of Object.keys(table)) {
      const built = build(zone, { query: '', view: null });
      // NAMED, NOT COUNTED. The first draft asserted `deadOps > 0` over every
      // disabled item, and a mutation that made unbuilt ops invisible again
      // passed it — because `view: null` leaves every EXPORT disabled too, so
      // the counter was satisfied without a single unbuilt op on screen. The
      // labels come from the table now, so each one has to be found.
      for (const row of table[zone].filter((r) => r.unbuilt)) {
        const drawn = built.find((i) => i.label === row.label);
        assert.ok(drawn, `${name} · ${zone} · ${row.label} is unbuilt and is not drawn at all`);
        assert.equal(drawn.disabled, true, `${name} · ${zone} · ${row.label} is unbuilt and drawn live`);
        unbuiltOpsDrawn += 1;
      }
      for (const item of built) {
        assert.equal(item.note, undefined, `${name} · ${zone} · ${item.label} still carries prose`);
        if (item.disabled) {
          assert.equal(item.onClick, undefined,
            `${name} · ${zone} · ${item.label} is disabled and still clickable`);
          assert.ok(item.title, `${name} · ${zone} · ${item.label} is drawn dead and says nothing on hover`);
        } else {
          assert.ok(item.to || item.onClick,
            `${name} · ${zone} · ${item.label} renders live but does nothing`);
        }
        ops += 1;
      }
    }
  }
  assert.ok(ops > 0, 'no actions were built at all — the walk is not walking');
  assert.ok(unbuiltOpsDrawn >= 50,
    `only ${unbuiltOpsDrawn} unbuilt ops are drawn — the tables carry far more than that`);

  let chips = 0;
  let unbuiltChipsDrawn = 0;
  for (const [name, table, build] of FILTER_TABLES) {
    for (const zone of Object.keys(table)) {
      const built = build(zone, { value: '__none__' });
      // Same correction as the ops half. A `dynamic` entry is excluded because
      // it is REPLACED by the page's supplied names rather than drawn beside
      // them — with nothing supplied it contributes no chip at all, which is
      // right: a placeholder bearing the canvas's sample name would state a
      // segment this account has not got.
      for (const row of table[zone].filter((r) => r.unbuilt && !r.dynamic)) {
        const label = row.label || (Array.isArray(row.canvas) ? row.canvas[0] : row.canvas);
        const drawn = built.find((i) => i.label === label);
        assert.ok(drawn, `${name} · ${zone} · ${label} is unbuilt and is not drawn at all`);
        assert.equal(drawn.disabled, true, `${name} · ${zone} · ${label} is unbuilt and drawn live`);
        unbuiltChipsDrawn += 1;
      }
      for (const item of built) {
        assert.equal(item.note, undefined, `${name} · ${zone} · ${item.label} still carries prose`);
        if (item.disabled) {
          assert.equal(item.onSelect, undefined,
            `${name} · ${zone} · ${item.label} is a disabled chip that can still be selected`);
          assert.notEqual(item.active, true,
            `${name} · ${zone} · ${item.label} is a dead chip drawn as the current view`);
          assert.ok(item.title, `${name} · ${zone} · ${item.label} is drawn dead and says nothing on hover`);
        } else {
          assert.ok(item.onSelect, `${name} · ${zone} · ${item.label} is a live chip that cannot be selected`);
        }
        chips += 1;
      }
    }
  }
  assert.ok(chips > 0, 'no filters were built at all — the walk is not walking');
  assert.ok(unbuiltChipsDrawn >= 50,
    `only ${unbuiltChipsDrawn} unbuilt chips are drawn — the tables carry far more than that`);
});

test('an unbuilt entry is drawn inert, and the count is exact', () => {
  // WAS "dropped, not merely emptied", and asserted `built.length === rows.length
  // - dead.length`. The worry behind it was right and is now the wrong half of a
  // pair: "an entry that survived as `{label: 'Comparables'}` with no handler
  // would render as a chip that does nothing — the 'absent is not empty' failure
  // `zoneFilterBuilder` exists to prevent, arrived at from the other side."
  //
  // A chip that does nothing AND SAYS NOTHING is the failure. A chip that is
  // visibly disabled, cannot be selected, and explains itself on hover is not:
  // there is no click, so there is no empty set to misread. The count is still
  // exact — every row produces exactly one chip — and the dead ones are pinned
  // as dead rather than as absent.
  const zone = 'research/companies';
  const rows = FOUNDER_ZONE_FILTERS[zone];
  const dead = rows.filter((r) => r.unbuilt && !r.dynamic);
  assert.ok(dead.length >= 3, `${zone} no longer carries the unbuilt entries this pins`);
  const built = founderZoneFilters(zone, { value: 'all' });
  assert.equal(built.length, rows.length,
    `${zone} builds ${built.length} chips from ${rows.length} rows — every row draws exactly one`);
  for (const row of dead) {
    for (const label of filterLabels(row)) {
      const chip = built.find((i) => i.label === label);
      assert.ok(chip, `${zone} stopped drawing "${label}" — it is invisible again`);
      assert.equal(chip.disabled, true, `${zone} · ${label} is drawn as a live chip`);
      assert.equal(chip.onSelect, undefined, `${zone} · ${label} can be selected`);
      assert.ok(chip.title, `${zone} · ${label} says nothing on hover`);
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

test('every Offers zone draws its whole artboard row, and its export says which state it is in', () => {
  // WAS "still offers its export, AND ONLY ITS EXPORT", with
  // `deepEqual(labels, ['Export · nothing yet'])`. That was exact and correct
  // while the two unbuilt ops per zone rendered nothing. They are drawn now,
  // disabled with their reason on hover, so the header is the artboard's whole
  // three-op row — which is what these five zones were reported as missing.
  //
  // The export's own contract is unchanged and is still the point of this test:
  // it is the one control here that is BUILT, and the difference between "no
  // store" and "no rows yet" has to survive both being grey.
  for (const zone of Object.keys(OFFERS_OPS)) {
    const built = partnerZoneActions(zone, { query: '', view: null });
    const exportItem = built.find((i) => String(i.label).startsWith('Export'));
    assert.ok(exportItem, `${zone} no longer offers its export`);

    // THE LABEL CARRIES THE STATE, and the plain `Export` it used to show is
    // what made eight working exports get reported as missing features: with no
    // rows the button greys out, and its only explanation was a hover `title`.
    // An account with no rows is the steady state for a new firm, not a
    // transient one, so "disabled with no visible reason" is what most partners
    // actually saw. The unbuilt ops beside it keep the canvas label and put
    // their reason in the hover — a deliberate asymmetry: one is waiting on
    // data and changes while you watch, the other is waiting on a store.
    assert.equal(exportItem.label, 'Export · nothing yet',
      `${zone}'s export no longer says on screen why it is disabled`);
    assert.equal(exportItem.disabled, true, `${zone}'s export claims rows it has not loaded`);
    for (const other of built.filter((i) => i !== exportItem)) {
      assert.equal(other.disabled, true, `${zone} · ${other.label} is drawn live with no store behind it`);
      assert.equal(other.onClick, undefined, `${zone} · ${other.label} is clickable with nothing to perform`);
      assert.ok(other.title, `${zone} · ${other.label} is drawn dead and says nothing on hover`);
      assert.doesNotMatch(other.label, /·/,
        `${zone} · ${other.label} borrowed the export's suffix — an unbuilt op is not waiting on rows`);
    }

    const loaded = partnerZoneActions(zone, {
      query: '', view: { scope: 's', header: ['A'], rows: [{ a: 1 }], cells: (r) => [r.a] },
    });
    // The same control in its other state — one `·` suffix swapped for another,
    // which is the whole point: two states of one thing, not two controls.
    const loadedExport = loaded.find((i) => String(i.label).startsWith('Export'));
    assert.equal(loadedExport.label, 'Export · this view',
      `${zone}'s export does not say which rows it covers once they arrive`);
    assert.equal(loadedExport.disabled, undefined, `${zone}'s export stays dead once rows arrive`);
    assert.ok(loadedExport.onClick, `${zone}'s export does not write a file`);
    // And the unbuilt ops do NOT come alive with the rows: rows were never what
    // they were waiting for.
    for (const other of loaded.filter((i) => i !== loadedExport)) {
      assert.equal(other.disabled, true,
        `${zone} · ${other.label} came alive when rows arrived, but it has no store`);
    }
  }
});
