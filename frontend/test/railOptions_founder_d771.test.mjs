/**
 * D771 (#2097, PR 1): the founder's options inventory, held to the code.
 *
 * `frontend/src/lib/railOptions/founder.js` lists every option the founder's
 * boards offer that runs a model. D764 PR 3 (#2089) gives each one the models
 * that fit it, so an option missing here is an option that never gets its
 * models, and an option listed here that the code no longer has is a row for
 * nothing. Both directions are checked:
 * - every listed `[file, call]` is in its file;
 * - every model-running call and every band in the founder's files is listed.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/railOptions_founder_d771.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { CYCLES, CYCLE_ROUTE, cycleBands, cycleFills, cycleRouteSource } from './_cycleBands.mjs';
import {
  FOUNDER_HANDLERS, FOUNDER_KINDS, FOUNDER_OPTIONS, FOUNDER_QUIET_PAGES,
} from '../src/lib/railOptions/founder.js';
import { pageKeyFor } from '../src/lib/railPages.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const CANVAS = JSON.parse(read('design/incoming/airail-every-page-data/canvas.json'));
const RESEARCH = read('cloudflare-worker/src/routes/research.ts');
const FILLS = read('cloudflare-worker/src/services/fills/registry.ts');

/** The founder's page keys, from the canvas's `profiles.Founder` (D720 §5). */
const FOUNDER_PAGES = Object.entries(CANVAS.profiles.Founder).flatMap(([section, modules]) => [
  `Founder · ${section}`, ...modules.map((m) => `Founder · ${section} · ${m}`),
]);

/**
 * Every call that runs a model from a founder's board, as the page writes it.
 * The survey for #2097 traced each to a Worker route that runs one.
 */
const MODEL_CALLS = [
  'api.advisor.answer(', 'api.advisor.toolAuto(', 'api.advisor.explainUrl(', 'api.advisor.transcribe(',
  'sessions.create(', 'sessions.open(', 'api.finish(', 'api.process(',
  'api.transcribeInterview(', 'api.transcribe(', 'sessions.summarise(', 'api.summarise(', 'api.structure(', 'api.ask(',
  'api.deckPositioning(', 'api.deckAutofill(', 'api.deckApplyMethod(',
  '/api/deck-reviewer/upload', 'deckReviewer.paste(', 'deckReviewer.regenerate(',
  'shareUpdateApi.draftLines(',
  'api.brandAutofillLanding(', 'api.brandLogo(', 'api.brandSuggestPalette(', 'api.brandSuggestTaglines(',
  'api.research.ask(', 'api.research.upload(', 'api.research.reindex(',
  'api.competitors.analyze(', 'api.competitors.rerun(', 'api.competitors.refresh(',
  'api.competitors.addCandidate(', 'api.competitors.crawlCandidate(',
];

/**
 * The files that draw the founder's boards and their tools. Every file an
 * option lives in is one, and so are the ones the survey found drawing only
 * presses that run nothing, so a model call added to any of them must be
 * listed.
 */
const FOUNDER_FILES = [...new Set([
  ...FOUNDER_OPTIONS.flatMap((o) => o.at.map(([f]) => f)),
  'frontend/src/pages/founder/RecordingView.jsx',
  'frontend/src/pages/founder/InterviewReview.jsx',
  'frontend/src/pages/cycles/ValidateSections.jsx',
  'frontend/src/pages/founder/FounderNetworkRelationships.jsx',
  'frontend/src/pages/founder/FounderNetworkIntroductions.jsx',
  'frontend/src/pages/founder/FounderNetworkOrganizations.jsx',
  'frontend/src/pages/research/FundsZone.jsx',
  'frontend/src/pages/research/MarketDirectoryZone.jsx',
  'frontend/src/pages/FinancialsPage.jsx',
  'frontend/src/pages/raise/DataRoomPage.jsx',
  'frontend/src/pages/RaisePipelinePage.jsx',
])].sort();

const optionsAt = (file) => FOUNDER_OPTIONS.filter((o) => o.at.some(([f]) => f === file));
const listed = (file, call) => FOUNDER_OPTIONS.some((o) => o.at.some(([f, c]) => f === file && c === call));

test('every option names a founder page, a kind, a handler and a key unique on its page', () => {
  assert.ok(FOUNDER_OPTIONS.length >= 40, `expected the founder's options; found ${FOUNDER_OPTIONS.length}`);
  assert.deepEqual([...FOUNDER_KINDS].sort(), [...new Set(Object.values(CANVAS.task_kind))].sort(),
    'the kinds are not the canvas\'s fourteen');
  const seen = new Set();
  for (const o of FOUNDER_OPTIONS) {
    const id = `${o.page} / ${o.key}`;
    assert.ok(FOUNDER_PAGES.includes(o.page), `${id}: not a page of the canvas's Founder profile`);
    assert.match(o.key, /^[a-z]+:[a-z0-9_/-]+$/, `${id}: the key is not <verb>:<object>`);
    assert.ok(!seen.has(id), `${id}: the key is used twice on its page`);
    seen.add(id);
    assert.ok(typeof o.label === 'string' && o.label.trim(), `${id}: no label`);
    assert.ok(FOUNDER_KINDS.includes(o.kind), `${id}: ${o.kind} is not one of the canvas's kinds`);
    assert.ok(FOUNDER_HANDLERS.includes(o.handler), `${id}: ${o.handler} is not a handler`);
    assert.ok(Array.isArray(o.at) && o.at.length, `${id}: says nowhere where it lives`);
  }
});

test('every listed option is in its file', () => {
  for (const o of FOUNDER_OPTIONS) {
    for (const [file, call] of o.at) {
      assert.ok(read(file).includes(call), `${o.page} / ${o.key}: ${file} no longer has ${call}`);
    }
  }
});

test('every model call in the founder\'s files is listed', () => {
  for (const file of FOUNDER_FILES) {
    const src = codeOnly(read(file));
    for (const call of MODEL_CALLS) {
      if (!src.includes(call)) continue;
      assert.ok(listed(file, call), `${file} calls ${call}, and no founder option lists it`);
    }
  }
});

test('every band on the founder\'s boards is listed, under the Worker\'s own name', () => {
  // The cycle pages draw their bands from `CYCLE_DEFS`: a draft is `draft:<surface>`, a fill `fill:<kind>`.
  const src = cycleRouteSource();
  const fromTables = CYCLES.flatMap((cycle) => [
    ...cycleBands(src, cycle).map(([, surface]) => `draft:${surface}`),
    ...Object.values(cycleFills(src, cycle)).map((kind) => `fill:${kind}`),
  ]);
  assert.ok(fromTables.length >= 13, `expected the cycles' bands; found ${fromTables.length}`);
  const fromCycle = optionsAt(CYCLE_ROUTE).filter((o) => /^(draft|fill):/.test(o.key)).map((o) => o.key);
  assert.deepEqual([...fromCycle].sort(), [...fromTables].sort(),
    'CycleRoute\'s bands and the founder options listed on it have diverged');

  // Everywhere else a band is a literal `<ZoneDraft surface="…">`.
  for (const file of FOUNDER_FILES.filter((f) => f !== CYCLE_ROUTE)) {
    const mounted = codeOnly(read(file)).split('<ZoneDraft').slice(1)
      .map((seg) => seg.slice(0, seg.indexOf('/>')).match(/surface="([a-z/-]+)"/)?.[1])
      .filter(Boolean);
    for (const surface of mounted) {
      assert.ok(optionsAt(file).some((o) => o.key === `draft:${surface}`),
        `${file} mounts the ${surface} band, and no founder option lists it`);
    }
  }

  // A band's key names something the Worker serves.
  const surfaces = new Set([...RESEARCH.matchAll(/^ {2}'([a-z-]+\/[a-z/-]+)': \{$/gm)].map((m) => m[1]));
  const kinds = new Set([...FILLS.matchAll(/^ {2}kind: '([a-z_]+)',$/gm)].map((m) => m[1]));
  for (const o of FOUNDER_OPTIONS) {
    const [verb, object] = o.key.split(':');
    if (verb === 'fill') assert.ok(kinds.has(object), `${o.key}: no such fill kind in the Worker`);
    if (verb === 'draft' && object.includes('/')) {
      assert.ok(surfaces.has(object), `${o.key}: no such draft surface in the Worker`);
    }
  }
});

test('every founder page has an option or a reason it has none, never both', () => {
  const quiet = Object.keys(FOUNDER_QUIET_PAGES);
  for (const page of quiet) {
    assert.ok(FOUNDER_PAGES.includes(page), `${page}: not a page of the canvas's Founder profile`);
    assert.ok(FOUNDER_QUIET_PAGES[page].trim(), `${page}: no reason given`);
  }
  for (const page of FOUNDER_PAGES) {
    const runs = FOUNDER_OPTIONS.filter((o) => o.page === page && o.handler !== 'none');
    if (quiet.includes(page)) assert.equal(runs.length, 0, `${page} is quiet and lists ${runs.map((o) => o.key)}`);
    else assert.ok(runs.length, `${page} has no option and no reason`);
  }
});

/**
 * The sections whose options call `useRailOption` (D768, #2092), one D771 PR
 * each: the founder's options there are on the rail. A section joins this
 * list in the PR that wires it.
 */
const WIRED = ['Studio', 'Validate', 'Build', 'Raise', 'Grow'];
const sectionOf = (page) => page.split(' · ')[1];
const routeOf = (route) => {
  const [path, query] = route.split('?');
  return { path, search: query ? `?${query}` : '' };
};
/**
 * A fill band names itself through `FillProposals`' `railOption`, which
 * `CycleRoute` builds as `fill:<kind>` (D768), on every cycle or on the ones
 * its condition names.
 */
const fillNamed = (section) => {
  const src = cycleRouteSource();
  const passed = src.match(/railOption=\{([^}]*`fill:\$\{fillKind\}`[^}]*)\}/)?.[1];
  if (!passed) return false;
  const only = [...passed.matchAll(/cycle === '([a-z]+)'/g)].map((m) => m[1]);
  return only.length === 0 || only.includes(section.toLowerCase());
};
/**
 * A cycle page's draft band names itself through `ZoneDraft`'s `railOption`,
 * which `CycleRoute` builds as `draft:<surface>` for every band in its table.
 */
const cycleDraft = (o) => o.key.startsWith('draft:') && o.at.some(([file]) => file === CYCLE_ROUTE);
const draftNamed = () => /<ZoneDraft key=\{`\$\{slug\}-\$\{draft\.surface\}`\} \{\.\.\.draft\}[^>]*railOption=\{`draft:\$\{draft\.surface\}`\}/.test(cycleRouteSource())
  && /useRailOption\(railOption && \(busy === 'run' \|\| \(item && !item\.accepted\)\) \? railOption : null, run\)/.test(codeOnly(read('frontend/src/workspaces/ZoneDraft.jsx')));
const railKeys = (src) => [...src.matchAll(/useRailOption\(([^;]*?)\);/g)]
  .flatMap((m) => [...m[1].matchAll(/'([a-z]+:[a-z0-9_/-]+)'/g)].map((k) => k[1]));

test('every option names the address it is pressed on', () => {
  for (const o of FOUNDER_OPTIONS) {
    assert.match(o.route || '', /^\/[a-z0-9/_?=&-]*$/, `${o.page} / ${o.key}: no route`);
  }
});

test('on a wired section, each option is on its page and names itself to the rail', () => {
  assert.ok(WIRED.every((w) => Object.keys(CANVAS.profiles.Founder).includes(w)), 'a wired section is not the canvas\'s');
  for (const o of FOUNDER_OPTIONS.filter((x) => WIRED.includes(sectionOf(x.page)))) {
    const { path, search } = routeOf(o.route);
    assert.equal(pageKeyFor(path, 'founder', { search }), o.page,
      `${o.key}: D768's page map puts ${o.route} on another page`);
    if (o.handler === 'none') continue;
    const named = o.key.startsWith('fill:') ? fillNamed(sectionOf(o.page))
      : cycleDraft(o) ? draftNamed()
      : (o.rail || [...new Set(o.at.map(([file]) => file))]).every((file) => railKeys(codeOnly(read(file))).includes(o.key));
    assert.ok(named, `${o.page} / ${o.key}: no useRailOption('${o.key}', …) where it lives`);
  }
  // And the other way: every option a wired file names is listed there.
  const wired = FOUNDER_OPTIONS.filter((x) => WIRED.includes(sectionOf(x.page)));
  const files = new Set(wired.flatMap((x) => [...x.at.map(([f]) => f), ...(x.rail || [])]));
  for (const file of files) {
    for (const key of railKeys(codeOnly(read(file)))) {
      assert.ok(wired.some((o) => o.key === key && (o.rail || o.at.map(([f]) => f)).includes(file)),
        `${file} names ${key} to the rail, and no founder option lists it there`);
    }
  }
});

