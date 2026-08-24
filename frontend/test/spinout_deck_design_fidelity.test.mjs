/**
 * Axal Spin-Out Demo Day deck — fidelity to the in-repo design source.
 *
 * The canonical design is `spin-out-lab-pipeline/project/AxalSlide.dc.html`,
 * authored on a 1280 × 720 artboard. The React renderer draws on the shared
 * 1920 × 1080 `<Slide16x9>` frame — exactly 1.5× — so design pixels map through
 * `u()` with no eyeballing. Cover, Problem and Traction are rebuilt against it
 * in flow layout; the remaining eight still use the PPTX-mirroring `inch()` /
 * `pt()` absolute placement.
 *
 * What this suite locks is what actually broke, or would break silently:
 *   - the palette is DERIVED from THEME, not a second hand-kept copy,
 *   - the 1.5× scale factor is exact (a wrong U silently shrinks every slide),
 *   - the cover's discovery strip reads the funnel, not a cumulative interview
 *     series under four hardcoded labels that named none of its numbers,
 *   - the Problem pain pill keeps BOTH the frequency and the raw count,
 *   - a number the funnel already shows is not printed a second time beside it,
 *   - the Traction KPI row prints only KPIs the data actually carries,
 *   - the revenue columns follow the design's own height formula,
 *   - nothing relies on `background-clip: text`, which the html2canvas PDF
 *     path does not implement.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test \
 *     frontend/test/spinout_deck_design_fidelity.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Deck, { SLIDES, SAMPLE_DATA } from '../src/decks/templates/axal_spinout_demoday_app.tsx';
import { THEME } from '../src/decks/spinout/deckData.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SRC = read('../src/decks/templates/axal_spinout_demoday_app.tsx');
const DESIGN = read('../../spin-out-lab-pipeline/project/AxalSlide.dc.html');

// Render one slide in isolation so an assertion about the cover cannot be
// satisfied by copy that happens to live on the team slide.
const slide = (id) => {
  const entry = SLIDES.find((s) => s.id === id);
  assert.ok(entry, `no slide with id ${id}`);
  return renderToStaticMarkup(React.createElement(entry.Component, { d: SAMPLE_DATA }));
};
const deck = () => renderToStaticMarkup(React.createElement(Deck, { data: {} }));
// renderToStaticMarkup escapes &, <, > and '. Fixture copy carries all of them
// ("Founder & CEO", "risk tooling isn't"), so compare against the escaped form.
const esc = (t) => String(t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;');

const COVER = slide('cover');
const PROBLEM = slide('problem');
const TRACTION = slide('traction');

/* ───────────────────────── palette + scale ───────────────────────────── */

test('the palette is derived from THEME, not a second hand-kept copy', () => {
  // deckData.js promises "the React template derives K from this object … so
  // preview and export cannot drift apart on palette". It did not: K carried
  // ink #171321 against the design's #1A202C, panel #F7F7F9 against #F8F8FA,
  // dbg #09080D against #17142E. Only the accent happened to agree.
  assert.match(SRC, /Object\.entries\(THEME\.color\)/, 'K must be built from THEME.color');
  assert.doesNotMatch(SRC, /^const K = \{$/m, 'K must not be re-declared as a literal palette');
  const html = deck().toLowerCase();
  for (const off of ['#171321', '#f7f7f9', '#eeeff3', '#09080d', '#17132d', '#e7e5ea']) {
    assert.ok(!html.includes(off), `off-design legacy colour ${off} is still being rendered`);
  }
  for (const key of ['ink', 'accent', 'dbg', 'panel', 'line']) {
    assert.ok(html.includes(`#${THEME.color[key]}`.toLowerCase()), `THEME.color.${key} never reaches the DOM`);
  }
});

test('THEME carries the design source\'s own hexes', () => {
  // If the design is re-exported with a different ramp this fails here rather
  // than as a vague "the deck looks off".
  const want = { ink: '1A202C', accent: '6B46C1', accentLt: '8B5CF6', dbg: '17142E', line: 'E2E8F0' };
  for (const [k, hex] of Object.entries(want)) {
    assert.equal(THEME.color[k], hex, `THEME.color.${k} drifted from the design`);
    assert.ok(DESIGN.toLowerCase().includes(`#${hex}`.toLowerCase()), `#${hex} is not in the design source`);
  }
});

test('the design→frame scale factor is exactly 1.5', () => {
  assert.match(SRC, /const U = 1\.5;/, 'U must be the 1280→1920 factor');
  assert.equal(1280 * 1.5, 1920);
  assert.equal(720 * 1.5, 1080);
  // Spot-check that u() is what actually reached the DOM: the design's Problem
  // padding is `56px 80px 52px`.
  assert.ok(PROBLEM.includes('padding:84px 120px 78px'), 'Problem padding is not the design padding × 1.5');
});

test('no slide depends on background-clip:text — the PDF path cannot render it', () => {
  // PitchDeckPrintPage rasterises [data-slide-frame] with html2canvas, which
  // has no implementation for it: a clipped gradient exports as a coloured bar
  // behind the letters, or as nothing at all when the fill is transparent.
  const html = deck().toLowerCase();
  assert.ok(!html.includes('background-clip'), 'background-clip cannot survive the PDF export');
  assert.ok(!html.includes('text-fill-color'), '-webkit-text-fill-color cannot survive the PDF export');
});

/* ───────────────────────────── cover ─────────────────────────────────── */

test('the cover carries the design\'s radial bloom over the 120° gradient', () => {
  // 1100 × 460 in the design, so 1650 × 690 on the frame.
  assert.match(COVER, /radial-gradient\(1650px 690px at 16% -12%/);
  assert.match(COVER, /linear-gradient\(120deg, #17142E, #241D4C 52%, #3B1D6E\)/);
});

test('"Discovery to date" reads the funnel, and says what each number is', () => {
  // It used to read the last four points of `cover.signalY` — a CUMULATIVE
  // interview count — under the hardcoded labels Customers / Advisors /
  // Co-founders / Investors. Four numbers, none of them those things.
  for (const [label, value] of SAMPLE_DATA.validation.stages.slice(0, 4)) {
    assert.ok(COVER.includes(label), `funnel stage "${label}" missing from the cover strip`);
    assert.ok(COVER.includes(`>${value}<`), `funnel count ${value} missing from the cover strip`);
  }
  for (const invented of ['Customers', 'Co-founders', 'Investors']) {
    assert.ok(!COVER.includes(`>${invented}<`), `the cover still labels a number "${invented}"`);
  }
  assert.doesNotMatch(SRC, /\['Customers', 'Advisors', 'Co-founders', 'Investors'\]/);
});

test('the cover renders every meta chip the data supplies', () => {
  for (const [k, v] of SAMPLE_DATA.cover.meta) {
    assert.ok(COVER.includes(k), `meta key ${k} missing`);
    assert.ok(COVER.includes(v), `meta value ${v} missing`);
  }
});

test('the cover keeps company and thesis inline-editable', () => {
  // The deck editor writes back by dotted path; a rebuild that renders plain
  // text silently makes the cover uneditable.
  assert.ok(COVER.includes('contentEditable'), 'cover has no editable node at all');
  const editable = renderToStaticMarkup(
    React.createElement(SLIDES[0].Component, { d: SAMPLE_DATA, editable: true }),
  );
  assert.match(editable, /contentEditable="true"/);
});

/* ──────────────────────────── problem ────────────────────────────────── */

test('each pain pill keeps BOTH the frequency and the raw count', () => {
  // The design has one "mentions" chip; the data has a percentage AND an
  // n-of-N. Rendering only one of them loses evidence off the slide.
  for (const [, pct, count] of SAMPLE_DATA.problem.pains) {
    assert.ok(PROBLEM.includes(`${pct}% · ${count}`), `pain pill lost a figure for ${pct}% / ${count}`);
  }
});

test('a figure the funnel already shows is not printed twice beside it', () => {
  // validation.cards ships "42 Interviews completed" and "9 Design-partner
  // LOIs" while the funnel beside them reads 42 → Interviewed and 9 → LOI.
  // Two prints of one number read as two findings — and it is what pushed the
  // evidence strip past the slide width.
  const funnelValues = SAMPLE_DATA.validation.stages.map(([, n]) => String(n));
  for (const [value, label] of SAMPLE_DATA.validation.cards) {
    if (funnelValues.includes(String(value))) {
      assert.ok(!PROBLEM.includes(label), `duplicate stat "${label}" survived the dedupe`);
    } else {
      assert.ok(PROBLEM.includes(label), `non-duplicate stat "${label}" was dropped`);
    }
  }
  // The conversion rate is not a funnel stage, so it always survives.
  assert.ok(PROBLEM.includes(SAMPLE_DATA.validation.conversion[0]));
  assert.ok(PROBLEM.includes(SAMPLE_DATA.validation.conversion[1]));
});

test('the evidence strip squeezes the stats, never the funnel stages', () => {
  // Funnel chips are sized by their own copy; the stat block is the single
  // flexible element. Reversing that ellipsises "Solution-fit ≥ 7" down to
  // "Sol…" — which is what a first pass at this actually rendered.
  const strip = PROBLEM.slice(PROBLEM.indexOf(SAMPLE_DATA.validation.funnelLabel));
  assert.match(strip, /flex:1 1 auto;min-width:0/, 'the stat block must be the flexible one');
  assert.ok(!/text-overflow:ellipsis/.test(strip), 'a funnel stage label must never be truncated');
  // And the strip clips rather than painting over the footer if data overflows.
  assert.ok(PROBLEM.includes('overflow:hidden'), 'the strip must clip, not overflow the slide');
});

test('the merged validation section is still read in place', () => {
  assert.ok(PROBLEM.includes(SAMPLE_DATA.validation.funnelLabel));
  for (const [label, value] of SAMPLE_DATA.validation.stages) {
    assert.ok(PROBLEM.includes(label), `funnel stage ${label} missing`);
    assert.ok(PROBLEM.includes(`>${value}<`), `funnel count ${value} missing`);
  }
});

test('the pull-quote monogram does not invent a person', () => {
  // `problem.quoteAttr` is a ROLE — "Head of Credit · mid-market direct
  // lender". Deriving initials from it prints a monogram for someone who does
  // not exist, on a slide whose whole claim is that the evidence is real.
  assert.ok(PROBLEM.includes(SAMPLE_DATA.problem.quoteAttr));
  assert.doesNotMatch(SRC, /initialsOf\(p\.quoteAttr/);
});

/* ──────────────────────────── traction ───────────────────────────────── */

test('the KPI row prints only KPIs the data actually carries', () => {
  // The design draws four — MRR, paying customers, average contract, MoM
  // growth. SpinoutDeckData['traction'] carries mrr, growth, the trend series
  // and the mix, and nothing else; the other two would have to be invented.
  assert.ok(TRACTION.includes(SAMPLE_DATA.traction.mrr));
  assert.ok(TRACTION.includes(SAMPLE_DATA.traction.growth));
  assert.ok(TRACTION.includes(SAMPLE_DATA.traction.growthNote));
  for (const invented of ['Paying customers', 'Avg. contract', 'Per month']) {
    assert.ok(!TRACTION.includes(invented), `Traction prints an unsourced KPI: ${invented}`);
  }
  // The span of the trend is derived from data already on the slide.
  assert.ok(TRACTION.includes('4 mo'), 'the tracked-months KPI is missing');
  assert.ok(TRACTION.includes('Apr – Jul'), 'the tracked-months range is missing');
});

test('a KPI with no value is dropped, not rendered blank', () => {
  const blank = renderToStaticMarkup(React.createElement(SLIDES.find((s) => s.id === 'traction').Component, {
    d: { ...SAMPLE_DATA, traction: { ...SAMPLE_DATA.traction, growth: '', mrr: '' } },
  }));
  assert.ok(!blank.includes('MoM growth'), 'an empty growth KPI still rendered its label');
  assert.ok(blank.includes('4 mo'), 'the surviving KPI should still render');
});

test('the revenue columns follow the design\'s own height formula', () => {
  // Design: h = 20 + (value / max) * 168, in design px → ×1.5 on the frame.
  const ys = SAMPLE_DATA.traction.trendY;
  const max = Math.max(...ys);
  for (const y of ys) {
    const h = 20 * 1.5 + (y / max) * 168 * 1.5;
    assert.ok(TRACTION.includes(`height:${h}px`), `column for ${y} is not ${h}px tall`);
  }
  // The newest month is the accent, so the eye lands on it without a legend.
  assert.ok(TRACTION.includes(`border-radius:15px 15px 6px 6px;background:${'#' + THEME.color.accent}`));
});

test('traction.title stays editable where the design puts its summary line', () => {
  assert.ok(TRACTION.includes(SAMPLE_DATA.traction.title));
  const editable = renderToStaticMarkup(React.createElement(SLIDES.find((s) => s.id === 'traction').Component, {
    d: SAMPLE_DATA, editable: true,
  }));
  assert.match(editable, /contentEditable="true"/);
});

/* ─────────────────────── deck-wide invariants ────────────────────────── */

test('the rebuilt slides did not change the frame contract', () => {
  // The preview thumbnail clips by slideIndex × 1080; a frame of any other
  // height silently shifts every preview after it.
  const html = deck();
  const frames = html.match(/width:1920px;height:1080px/g) || [];
  assert.equal(frames.length, 11, 'expected 11 frames at exactly 1920 × 1080');
});

test('the rebuilt slides render nothing when their sections are empty', () => {
  // A deck whose founder has logged no discovery and no revenue must degrade
  // to empty regions, not crash and not print placeholder numbers.
  const bare = { ...SAMPLE_DATA, cover: { ...SAMPLE_DATA.cover, meta: [] }, validation: {}, traction: {} };
  for (const id of ['cover', 'problem', 'traction']) {
    const entry = SLIDES.find((s) => s.id === id);
    assert.doesNotThrow(
      () => renderToStaticMarkup(React.createElement(entry.Component, { d: bare })),
      `${id} crashed on an empty section`,
    );
  }
  const emptyTraction = renderToStaticMarkup(
    React.createElement(SLIDES.find((s) => s.id === 'traction').Component, { d: bare }),
  );
  assert.ok(!emptyTraction.includes('Tracked'), 'an empty trend must not render a KPI card');
});

/* ══════════════════ the remaining eight slides ════════════════════════════
 * Cover, Problem and Traction were rebuilt first; these eight followed. Each
 * lands on a design section that assumes fields this deck's data model does
 * not carry, so what is locked below is mostly the choice made at each of
 * those gaps: render what exists, never invent the rest.
 */
const MARKET = slide('market');
const SOLUTION = slide('solution');
const COMPETITIVE = slide('competitive');
const DEMO = slide('product_demo');
const ROADMAP = slide('roadmap');
const TEAM = slide('team_network');
const ASK = slide('ask');
const DEAL = slide('review_the_deal');

test('every slide now lays out in flow, none on the inch() grid', () => {
  // The absolute path exists to mirror PPTX geometry and is what kept the
  // design's cards and gradients off these slides. One `inset: 0` container
  // per slide, then flow — the Footer is the single remaining absolute part.
  const html = deck();
  const frames = html.split('data-slide-frame').slice(1);
  assert.equal(frames.length, 11);
  for (const [i, f] of frames.entries()) {
    assert.ok(f.includes('position:absolute;inset:0'), `slide ${i} lost its flow container`);
  }
});

test('Market keeps TAM dominant and sources every figure from the rings', () => {
  for (const [label, value, desc] of SAMPLE_DATA.market.rings) {
    assert.ok(MARKET.includes(label), `ring ${label} missing`);
    assert.ok(MARKET.includes(value), `ring value ${value} missing`);
    assert.ok(MARKET.includes(esc(desc)), `ring description for ${label} missing`);
  }
  // The design's lower-left panel charts segment share; there is no segment
  // split in the data, so it carries the why-now claims instead.
  for (const [head] of SAMPLE_DATA.market.why) assert.ok(MARKET.includes(esc(head)), `why-now "${head}" missing`);
  assert.ok(MARKET.includes(esc(SAMPLE_DATA.market.assumptions)), 'the sizing assumptions must stay on the slide');
  assert.ok(MARKET.includes(`linear-gradient(135deg, ${'#' + THEME.color.accent}`), 'TAM card lost its gradient');
});

test('Solution renders each step and does not drop the outcome numbers', () => {
  for (const [, label, desc] of SAMPLE_DATA.solution.steps) {
    assert.ok(SOLUTION.includes(label), `step ${label} missing`);
    assert.ok(SOLUTION.includes(esc(desc)), `step description for ${label} missing`);
  }
  // The design's right panel is a Before/After pair, which this data has no
  // fields for — outcomes are the same claim as numbers.
  for (const [value, label] of SAMPLE_DATA.solution.outcomes) {
    assert.ok(SOLUTION.includes(value), `outcome ${value} missing`);
    assert.ok(SOLUTION.includes(label), `outcome label ${label} missing`);
  }
  for (const invented of ['Before', 'After', 'Unfair advantage']) {
    assert.ok(!SOLUTION.includes(`>${invented}<`), `Solution invents a "${invented}" block the data cannot fill`);
  }
});

test('Competitive runs four columns — there is no per-competitor share to chart', () => {
  for (const [name, cat, stage, gap] of SAMPLE_DATA.competitive.competitors) {
    for (const cell of [name, cat, gap]) assert.ok(COMPETITIVE.includes(esc(cell)), `cell "${cell}" missing`);
    if (stage && stage !== '—') assert.ok(COMPETITIVE.includes(stage), `stage ${stage} missing`);
  }
  assert.ok(!COMPETITIVE.includes('>Share<'), 'a share column would have no data behind it');
  for (const e of SAMPLE_DATA.competitive.edges) assert.ok(COMPETITIVE.includes(e), 'an edge is missing from the wedge card');
  assert.ok(COMPETITIVE.includes(SAMPLE_DATA.competitive.whitespace));
});

test('the competitor monogram skips connector tokens', () => {
  // "Excel + analysts" monogrammed as "E+" before initialsOf filtered tokens
  // that do not open with a letter or digit.
  assert.ok(COMPETITIVE.includes('>EA<'), 'expected the EA monogram for "Excel + analysts"');
  assert.ok(!COMPETITIVE.includes('>E+<'), 'the "+" is being read as a word');
});

test('Product demo shows the placeholder until a screenshot exists', () => {
  assert.ok(DEMO.includes(SAMPLE_DATA.productDemo.caption), 'placeholder caption missing');
  assert.ok(!DEMO.includes('<img'), 'no screenshot is set, so no image should render');
  const withShot = renderToStaticMarkup(React.createElement(
    SLIDES.find((s) => s.id === 'product_demo').Component,
    { d: { ...SAMPLE_DATA, productDemo: { ...SAMPLE_DATA.productDemo, screenshot: 'https://x/y.png', liveUrl: 'app.demo' } } },
  ));
  assert.ok(withShot.includes('<img'), 'an uploaded screenshot must replace the placeholder');
  assert.ok(withShot.includes('app.demo'), 'the live-product pill must render when a URL is set');
  assert.ok(!DEMO.includes('app.demo'), 'the pill must stay hidden when there is no URL');
});

test('Roadmap derives its completion figure from the tasks beside it', () => {
  const tasks = SAMPLE_DATA.roadmap.phases.flatMap(([, , ts]) => ts);
  const done = tasks.filter(([st]) => st === 'done').length;
  assert.ok(ROADMAP.includes(`${Math.round((done / tasks.length) * 100)}% complete`), 'header figure is not derived');
  for (const [, , ts] of SAMPLE_DATA.roadmap.phases) {
    for (const [, label] of ts) assert.ok(ROADMAP.includes(esc(label)), `task "${label}" missing`);
  }
});

test('Roadmap keeps the in-flight state visible, not collapsed into "not started"', () => {
  // The design's checkbox is binary. The data has three states, and which task
  // is being worked on right now is the only live signal on the slide.
  assert.ok(ROADMAP.includes('◆'), 'the active-task marker is missing');
  assert.ok(ROADMAP.includes('line-through'), 'completed tasks must read as struck through');
  const idle = renderToStaticMarkup(React.createElement(SLIDES.find((s) => s.id === 'roadmap').Component, {
    d: { ...SAMPLE_DATA, roadmap: { ...SAMPLE_DATA.roadmap, phases: [['NOW', 'Day 0', [['pending', 'Nothing started']]]] } },
  }));
  assert.ok(!idle.includes('◆'), 'nothing is active, so no active marker should render');
  assert.ok(idle.includes('0% complete'));
});

test('Team renders the roster and puts the advisor label over the advisors', () => {
  for (const f of SAMPLE_DATA.team.founders) {
    assert.ok(TEAM.includes(esc(f.name)) && TEAM.includes(esc(f.role)) && TEAM.includes(esc(f.bio)), `founder ${f.name} incomplete`);
  }
  for (const [, name, role] of SAMPLE_DATA.team.advisors) {
    assert.ok(TEAM.includes(name), `advisor ${name} missing`);
    assert.ok(TEAM.includes(esc(role)), `advisor role "${role}" missing`);
  }
  // The design's dark panel charts a skills assessment; there are no skills
  // scores in this data, so it carries the network the slide is titled after.
  for (const [, , name, sub] of SAMPLE_DATA.team.nodes) {
    assert.ok(TEAM.includes(name) && TEAM.includes(sub), `network node ${name} missing`);
  }
  assert.ok(!TEAM.includes('Skills coverage'), 'there is no skills data to chart');
});

test('Ask derives the cap-table donut from its own legend', () => {
  assert.ok(ASK.includes(SAMPLE_DATA.ask.kpis[0][0]), 'the raise is the hero figure');
  for (const [cat, pct] of SAMPLE_DATA.ask.funds) {
    assert.ok(ASK.includes(esc(cat)), `use-of-funds row ${cat} missing`);
    assert.ok(ASK.includes(`width:${pct}%`), `stacked bar segment for ${cat} is not ${pct}%`);
  }
  // conic-gradient stops computed from the same array the legend prints, so
  // the wedges cannot drift from the percentages beside them.
  let acc = 0;
  const total = SAMPLE_DATA.captable.segments.reduce((s, [, p]) => s + p, 0);
  for (const [, pct] of SAMPLE_DATA.captable.segments) {
    const from = (acc / total) * 100; acc += pct;
    assert.ok(ASK.includes(`${from}% ${(acc / total) * 100}%`), 'donut stop does not match the legend');
  }
});

test('Deal readiness treats "Not required" as resolved, not as a warning', () => {
  // Flagging it amber beside "On request" told investors the package was less
  // ready than it is, and counted a non-item against the total.
  const na = SAMPLE_DATA.deal.ready.filter(([, st]) => /not required/i.test(st));
  assert.ok(na.length, 'fixture should carry at least one not-required row');
  const inScope = SAMPLE_DATA.deal.ready.length - na.length;
  const ready = SAMPLE_DATA.deal.ready.filter(([, st]) => !/request|pending|not required/i.test(st)).length;
  assert.ok(DEAL.includes(`${ready} of ${inScope}`), `expected "${ready} of ${inScope}", excluding not-required rows`);
  for (const [, text] of SAMPLE_DATA.deal.steps) assert.ok(DEAL.includes(esc(text)), `next step "${text}" missing`);
  assert.ok(DEAL.includes(SAMPLE_DATA.deal.contact));
});

test('all eleven slides survive an entirely empty data object', () => {
  for (const s of SLIDES) {
    assert.doesNotThrow(
      () => renderToStaticMarkup(React.createElement(s.Component, { d: {} })),
      `${s.id} crashed with no data at all`,
    );
  }
});
