/**
 * What the market page promises about its own figures, and what it now keeps.
 *
 * `SpinoutLabMarketPage` makes three provenance claims that are unusual in this
 * product for being true: a code comment saying the design's "AI-assisted
 * estimates" was dropped "rather than lie about provenance", on-screen copy saying
 * "nothing on this page is auto-invented — empty means not researched yet", and a
 * per-card "Founder research" / "Founder model" stamp. Task #198 says a fill must
 * CHANGE those, not contradict them.
 *
 * THE FIRST STEP WAS NOT PROVENANCE, IT WAS PERSISTENCE. The drawer's twelve
 * inputs were `useState` and went when the tab did: a founder typed a population,
 * an ACV, a geography and a CAGR, pressed Recalculate, and came back to three
 * saved numbers with none of the reasoning. The page kept the conclusion and threw
 * away the derivation, which is a stranger thing for a page about derived figures
 * to do than anything the copy warns about. Migration 247 is the table its own
 * comment asked for, and this file is what stops the page drifting back:
 *
 *   · the drawer loads what was saved and does not re-invent it
 *   · a field the founder cleared stays cleared
 *   · every field the drawer shows is sent when it saves
 *   · the copy that said they were not saved is gone, and nothing on screen still
 *     claims it
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test \
 *     frontend/test/market_assumptions_persist.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(HERE, '..', p), 'utf8');

const PAGE = read('src/pages/SpinoutLabMarketPage.jsx');
const API = read('src/lib/api.js');
const CONFIG = read('src/ui/eadwynConfig.js');

/** The drawer's own fields, as `seedAssumptions` returns them. */
const FIELDS = [
  'category', 'geography', 'targetYear', 'methodology', 'population', 'acv',
  'tamOverride', 'samPct', 'winRate', 'runway', 'capacity', 'cagr',
  'growthDriver', 'maturity', 'segFilter',
];

test('the drawer loads what was saved and saves what it shows', () => {
  // BOTH HALVES OR NEITHER IS ANY USE. A load with no save re-seeds from the
  // project every time; a save with no load writes a row nothing ever reads,
  // which is the orphan-table shape this repo has hit twice.
  assert.match(PAGE, /api\.getMarketAssumptions\(p\.id\)/,
    'the page no longer loads its saved assumptions');
  assert.match(PAGE, /api\.saveMarketAssumptions\(project\.id, \{/,
    'the page no longer saves the assumptions behind its figures');
  assert.match(API, /getMarketAssumptions: \(id\) =>/);
  assert.match(API, /saveMarketAssumptions: \(id, assumptions\) =>/);

  // EVERY FIELD THE DRAWER SHOWS TRAVELS. A field left out of the save is one a
  // founder edits and loses, with nothing on screen to say which.
  const at = PAGE.indexOf('api.saveMarketAssumptions(project.id, {');
  const payload = PAGE.slice(at, PAGE.indexOf('});', at));
  // THE PAYLOAD'S OWN KEYS, READ ONCE. A bare `includes(field)` would pass on a
  // longer name that merely contains this one (`acv` inside `acvBenchmark`), and
  // a regex compiled per field is what `detect-non-literal-regexp` objects to —
  // so one literal pattern collects the keys and each field is looked up.
  const sent = new Set([...payload.matchAll(/\b([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]));
  for (const field of FIELDS) {
    assert.ok(sent.has(field), `${field} is edited on the drawer and never saved`);
  }
});

test('a saved value wins, and a cleared one stays cleared', () => {
  // `??`-shaped, not `||`-shaped. A founder who deleted a geography gets it back
  // from the project default under `||`, which is the page overruling a deliberate
  // edit — and '0' is a figure somebody typed, not an absent one.
  const src = codeOnly(PAGE);
  const at = src.indexOf('function seedAssumptions(');
  assert.ok(at > 0, 'seedAssumptions is gone');
  const fn = src.slice(at, src.indexOf('\n}', at));
  assert.match(fn, /function seedAssumptions\(p, saved\)/,
    'seedAssumptions no longer takes what was saved');
  assert.match(fn, /const s = \(key, fallback = ''\) => \{/);
  assert.match(fn, /v == null \|\| v === '' \? fallback : String\(v\)/,
    'a saved value is coerced in a way that can drop a legitimate 0');
  // The two computed fallbacks are still the fallbacks — a project sized before
  // 247 has only the saved ratios to show what the founder chose.
  assert.match(fn, /samPct: s\('samPct', tam > 0 && sam > 0/);
  assert.match(fn, /winRate: s\('winRate', sam > 0 && som > 0/);
  // And no field seeds from an invented market figure.
  for (const field of ['population', 'acv', 'cagr', 'tamOverride', 'runway', 'capacity']) {
    assert.ok(fn.includes(`${field}: s('${field}')`),
      `${field} seeds from something other than the store`);
  }
});

test('nothing on screen still says these fields are not saved', () => {
  // The page used to tell the founder the truth — "only TAM/SAM/SOM are saved to
  // your startup record yet" — and that sentence is now false. A stale honest
  // note is worse than none: it teaches a founder to expect their work to be
  // dropped, so they stop typing it.
  assert.doesNotMatch(PAGE, /only TAM\/SAM\/SOM are saved/i);
  assert.doesNotMatch(PAGE, /assumption fields are page-local session state/i);
  assert.doesNotMatch(PAGE, /local-only until backend columns exist/i);
  assert.match(PAGE, /Saved with your startup when you recalculate/,
    'the drawer no longer says when its figures are saved');
  // "Auto-saves" is STILL not claimed, and for a narrower reason than before:
  // nothing is written as you type.
  assert.doesNotMatch(PAGE, /Auto-saves<|>Auto-saves/, 'the page now claims to auto-save');
});

test('a failed assumptions save is visible, not swallowed', () => {
  // `saveError` is drawn INSIDE the drawer, so closing it on a failure files the
  // one message that says what was lost behind a panel nobody will reopen. The
  // figures still saved — that half is a separate request and succeeded — which is
  // exactly why the message has to say so precisely.
  const src = codeOnly(PAGE);
  assert.match(src, /let assumptionsSaved = true;/);
  assert.match(src, /assumptionsSaved = false;/);
  assert.match(src, /if \(assumptionsSaved\) setEditOpen\(false\);/,
    'the drawer closes over an unsaved-assumptions error');
  assert.match(PAGE, /Your sizing saved\. The assumptions behind it did not/);
  // And the failure is reported rather than only shown.
  assert.match(src, /reportError\('SpinoutLabMarketPage:assumptions', e\)/);
});

test('a figure Eadwyn supplied is marked, and one the founder replaced is not', () => {
  // THE READ HALF OF #198, and the reason `fill_provenance` exists rather than a
  // column pair. The page makes three provenance claims that are true and unusual
  // for being so; the third — a per-card "Founder research" stamp — goes quietly
  // wrong the first time Eadwyn fills a field unless the field says so where it
  // sits. Nothing is marked for a figure the founder typed, which is the common
  // case and the point: the ABSENCE of a stamp is the claim that they did it.
  assert.match(PAGE, /function FilledMark\(\{ fill \}\)/);
  assert.match(PAGE, /if \(!fill\) return null;/,
    'a founder-typed figure gets a stamp claiming Eadwyn supplied it');
  assert.match(PAGE, /'Eadwyn · edited' : 'Eadwyn · sourced'/,
    'a corrected fill and an untouched one read the same');
  assert.match(PAGE, /setFilled\(saved\?\.filled \|\| \{\}\)/,
    'the page never reads which figures were filled');

  // Marked on exactly the fields the market fill can supply, and no others.
  for (const field of ['population', 'acv', 'cagr']) {
    assert.ok(PAGE.includes(`<FilledMark fill={filled.${field}} />`),
      `${field} can be filled by Eadwyn and is never marked as such`);
  }
  for (const field of ['samPct', 'winRate', 'tamOverride']) {
    assert.ok(!PAGE.includes(`<FilledMark fill={filled.${field}} />`),
      `${field} is the founder's own judgement and must not carry an Eadwyn stamp`);
  }

  // AND THE SERVER WITHHOLDS A FIGURE THE FOUNDER HAS SINCE OVERWRITTEN, which is
  // where the comparison actually happens — `filledColumns` reads the provenance
  // row against what the row holds now. A card still reading "Eadwyn" over their
  // own number is the same lie pointed the other way.
  const route = read('../cloudflare-worker/src/routes/projects.ts');
  const at = route.indexOf("projects.get('/:projectId/market-assumptions'");
  assert.ok(at > 0, 'the market-assumptions GET is gone');
  const body = route.slice(at, route.indexOf('\n});', at));
  assert.match(body, /for \(const \[column, fill\] of filledColumns\(fills, row\)\)/,
    'the route returns every provenance row rather than only the ones that still hold');
  assert.match(body, /proposed_value: fill\.proposed_value,/,
    'what Eadwyn proposed before the founder changed it is not sent');
  assert.match(body, /citation: fill\.citation,/, 'the source is not sent');
});

test('the market rail can be turned off, and says what off means — D17', () => {
  // D17 refused a mode switch until a page branched on it. The market page
  // branches now, so the switch is real — and `manualNote` is what OFF means in
  // the founder's own terms rather than as the absence of something.
  const at = CONFIG.indexOf('\n  market: {');
  assert.ok(at > 0, 'the market surface is gone from eadwynConfig');
  const entry = CONFIG.slice(at, CONFIG.indexOf('\n  },', at));
  assert.match(entry, /mode: \{/);
  assert.match(entry, /kind: 'choice'/);
  assert.match(entry, /manualNote: 'Nothing runs and nothing is spent\./);

  // AND IT PROMISES WHAT THE REGISTRY ACTUALLY DOES, for BOTH kinds this surface
  // now offers. A note that over-promised here would be the page's fourth
  // provenance claim and the first false one — so it has to carry the citation
  // rule and both refusals, which are the two things a founder would otherwise
  // reasonably expect it to do.
  assert.match(entry, /only when Eadwyn can cite it/,
    'the note no longer says a proposal needs a source');
  assert.match(entry, /It never proposes your TAM/,
    'the note no longer says the page derives TAM from the founder’s own assumptions');
  assert.match(entry, /adds to your competitor list rather than starting one/,
    'the note no longer says Eadwyn cannot start a competitor analysis');

  // Both kinds are named, because a note that describes one of two capabilities
  // reads as the complete list of what the switch does.
  assert.match(entry, /sizing inputs/);
  assert.match(entry, /competitors/);
});
