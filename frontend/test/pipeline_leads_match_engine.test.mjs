/**
 * Pipeline · Leads — the `p1` artboard, the three sets, and a whole bucket that
 * had no chip row.
 *
 * THE ROUTE RENDERED THE SHARED MARKETPLACE BOARD. `NeedsBoardPage` — the same
 * component a founder and an admin see — listed open needs and stopped: no
 * score, no provenance, no pass, and no way to tell a need this firm had
 * already bid on from one nobody had opened. Every element of the artboard
 * beyond "a list of needs" was missing, and the bucket's five chip rows were
 * missing from `partnerZoneFilters.js` altogether.
 *
 * THE THREE SETS ARE THE ARTBOARD'S ARGUMENT AND THEY ARE ENFORCED. "A lead you
 * already bid is not a lead, and a lead you declined is not one either." A need
 * with a quote from this firm is a PROPOSAL; a need with a row in
 * `partner_lead_passes` is a PASS; everything else open is a LEAD. Each read
 * excludes the other two, so no status column can drift and no client can
 * appear in two of the three.
 *
 * A PASS IS NOT A LOSS. A lost bid is a bid — it lives on `quotes` with its
 * reason — and merging the two would move this firm's win rate in whichever
 * direction somebody guessed. Migration 233's header has the rest.
 *
 * THE SCORE IS THE FIRM'S OWN RULES, COUNTED. `partner_fit_rules` (209/229) has
 * been the register of what this firm takes and passes on since it was built,
 * and `/offers/fit-rules` answered `enforcement: 'none'` the whole time,
 * accurately: nothing read them. This zone is the reader, every receipt names
 * the rule it came from, and a firm with no rules gets `null` rather than a
 * number the product invented on its behalf.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/canvases/integrated/Pages · Partner Pipeline.dc.html');
const zone = read('frontend/src/pages/partner/pipeline/LeadsZone.jsx');
const worker = raw('cloudflare-worker/src/routes/partner_pipeline.ts');
const migration = raw('cloudflare-worker/sql/migrations/233_partner_lead_passes.sql');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const routes = read('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx');
const apiJs = read('frontend/src/lib/api.js');
const spec = raw('cloudflare-worker/src/routes/research.ts');

const P1 = CANVAS.slice(
  CANVAS.indexOf('<section class="ab" id="p1">'),
  CANVAS.indexOf('<section class="ab" id="p2">'),
);
assert.ok(P1.includes('/pipeline/leads'), 'the p1 artboard could not be found in the canvas');

/** The source between two markers, with BOTH ends proven to exist. */
function between(src, a, b) {
  const from = src.indexOf(a);
  assert.ok(from >= 0, `the opening marker is gone: ${a}`);
  const to = src.indexOf(b, from + a.length);
  assert.ok(to > from, `the closing marker is gone: ${b}`);
  return src.slice(from, to);
}

/** Prose flattened out of comment markers, line wraps and `\uXXXX` escapes. */
const flat = (s) => s
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/^\s*(?:--|\/\/)/gm, '')
  .replace(/\s+/g, ' ');

test('the route stopped rendering the shared marketplace board', () => {
  assert.ok(!/NeedsBoardPage/.test(routes.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the partner shell mounts the shared needs board again');
  assert.ok(/leads: \(\) => <PartnerLeads \/>,/.test(routes), 'the leads zone is not mounted');
  assert.ok(routes.includes("pipeline/LeadsZone"), 'the leads zone is not imported');
});

test('the strip is the artboard’s four tiles, and one of them is nullable', () => {
  const stats = between(CANVAS, 'l_stats: [', 'l_leads:');
  const labels = [...stats.matchAll(/label: ?'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Open leads', 'Strong fit', 'Warm path', 'Passed this quarter']);
  const tiles = [...zone.matchAll(/<LeadTile\b[\s\S]{0,500}?label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tiles, ['Open leads', 'Strong fit', 'Warm path', 'Passed'],
    'the strip is no longer the artboard’s four tiles in its order');

  const strip = between(zone, '<LeadTile', '{d?.scoring');
  assert.ok(flat(strip).includes('none of them already bid'), 'the artboard’s Open leads note is gone');
  assert.ok(flat(strip).includes('all with a reason on record'), 'the artboard’s Passed note is gone');
  // NULL, NOT ZERO. "No strong fits" and "no rules to judge fit with" are
  // different answers, and only one of them is about the leads.
  assert.match(strip, /nr=\{d\?\.strong_fit_count == null\}/,
    'Strong fit shows a number where nothing can be scored');
  assert.ok(flat(strip).includes('no rule to score against yet'),
    'the Strong fit tile stopped saying why it is absent');
  // `Warm path` IS TRUE AND IT IS THE FINDING: every lead came the same way.
  assert.ok(flat(strip).includes('all via the marketplace — no other source is recorded'),
    'the Warm path tile claims a channel this firm has no record of');
});

test('a lead with no rules behind it is unscored, and an exclusion is not a low score', () => {
  const fn = between(worker, 'function scoreLead(', '/**\n * `GET /leads`');
  // AN EXCLUSION ENDS THE READ. "We do not do native mobile" is not twenty out
  // of a hundred, and putting it on the same axis would rank a lead the firm
  // has ruled out above one it merely fits badly.
  assert.ok(/return \{\s*score: null,\s*receipts: \[\{ label: `\$\{r\.value\} · excluded`/.test(fn),
    'an excluded lead now carries a number');
  assert.ok(/excluded_by: r\.statement \|\|/.test(fn),
    'an exclusion no longer quotes the firm’s own sentence');
  // NO RULES MEANS NO SCORE, not fifty.
  assert.ok(/if \(hits \+ misses === 0\) \{[\s\S]{0,120}score: null,/.test(fn),
    'a lead with nothing to measure against now gets a number anyway');
  assert.ok(flat(fn).includes('Nothing this firm has written down applies to this lead'),
    'the unscored reason is gone');
  // THE DENOMINATOR IS WHAT WAS MEASURED, so a `gap` receipt cannot drag a
  // score down for a fact the client simply did not state.
  assert.ok(/Math\.round\(\(hits \/ \(hits \+ misses\)\) \* 100\)/.test(fn),
    'the score is no longer hits over what it was measured against');
  assert.ok(!/gaps/.test(fn.slice(fn.indexOf('const hits'))),
    'a gap is being counted into the score it was excluded from');

  // AND THE PAGE DRAWS BOTH ABSENCES DIFFERENTLY.
  const card = between(zone, 'function LeadCard(', 'export default function');
  assert.ok(/row\.excluded_by\s*\n?\s*\?\s*<Pill tone="neutral">Excluded<\/Pill>/.test(card),
    'an excluded lead is drawn as a score');
  assert.ok(/row\.score == null\s*\n?\s*\?\s*<NotRecorded \/>/.test(card),
    'an unscored lead is drawn as a number');
});

test('every receipt names the rule it came from', () => {
  // The artboard's own phrase for why a score is worth showing at all.
  assert.ok(flat(P1).includes('the receipt behind every score'),
    'the artboard stopped asking for receipts');
  const card = between(zone, 'function LeadCard(', 'export default function');
  assert.ok(/row\.receipts\.map\(/.test(card), 'the card stopped drawing the receipts');
  const fn = between(worker, 'function scoreLead(', '/**\n * `GET /leads`');
  for (const phrase of ['· match', 'No listed capability named', 'At or above your floor',
    'Below your floor', 'Budget not stated by the client']) {
    assert.ok(fn.includes(phrase), `the receipt "${phrase}" is gone`);
  }
  // DOLLARS AGAINST CENTS, AND ONLY WHERE THE COMPARISON NEEDS IT.
  // `founder_needs.budget_*` is REAL dollars and `partner_fit_rules
  // .floor_cents` is cents, so the SCORE converts — without it every lead reads
  // a hundred times under the floor. The DISPLAY must not: `moneyDollars`
  // formats dollars, and a `* 100` there prints $3.2M over a $32,000 budget.
  // Two comparisons, two units, one conversion, and this pins which is which.
  assert.ok(/Math\.round\(Number\(stated\) \* 100\)/.test(fn),
    'the budget comparison lost its dollars-to-cents conversion');
  assert.ok(/moneyDollars\(row\.budget_max\)/.test(card),
    'the budget on the card is being converted to cents before a dollars formatter');
  // THE MATCHING IS A SUBSTRING SEARCH AND SAYS SO. A cleverer matcher that
  // could not show its reason would be worse here, not better.
  assert.ok(flat(worker).includes('DELIBERATELY DUMB, AND SAID SO ON THE PAGE'),
    'the matcher stopped declaring what it is');
  const limits = zone.slice(zone.indexOf('<StatedLimit'));
  assert.ok(flat(limits).includes('a plain search for your own words in the client’s'),
    'the page stopped saying how the matching works');
});

test('the three sets are disjoint, at the read and at the write', () => {
  const list = between(worker, "partnerPipeline.get('/leads'", 'Record a pass');
  // A NEED THIS FIRM QUOTED ON IS A PROPOSAL, excluded in SQL rather than by a
  // flag somebody keeps in step.
  assert.ok(/NOT EXISTS \(\s*SELECT 1 FROM quotes q WHERE q\.need_id = n\.id AND q\.partner_id = \?\s*\)/.test(list),
    'a need this firm already bid on can appear as a lead');
  assert.ok(/\.filter\(\(n: any\) => !passedIds\.has\(Number\(n\.id\)\)\)/.test(list),
    'a passed need can appear as a lead');
  assert.ok(/WHERE n\.status = 'open'/.test(list), 'a closed need can appear as a lead');

  // AND THE WRITE REFUSES THE OVERLAP TOO, so one client cannot be both a
  // proposal and a pass even for an instant.
  const put = between(worker, "partnerPipeline.post('/leads/:needId/pass'", 'Un-pass');
  assert.ok(/SELECT 1 AS ok FROM quotes WHERE need_id = \? AND partner_id = \?/.test(put),
    'a need this firm bid on can be passed as well');
  assert.ok(/, 409\);/.test(put), 'the already-bid case no longer refuses');
  assert.ok(flat(put).includes('so it is a proposal rather than a lead'),
    'the refusal stopped saying which set the need is in');

  // ON THE PAGE, IN THE INSTRUMENT'S OWN NOTE — not in a docblock. `codeOnly`
  // strips a block comment at column 0, which is exactly where a docblock sits,
  // so asserting the sentence against the stripped source would pass on a file
  // that only ever said it to other developers.
  assert.ok(flat(between(zone, '<Instrument', '/>')).includes('A lead you already bid on is not a lead'),
    'the page stopped stating the rule the read enforces');
});

test('a pass carries a reason, can be taken back, and never becomes a loss', () => {
  assert.ok(/CREATE TABLE IF NOT EXISTS partner_lead_passes/.test(migration));
  assert.ok(/reason TEXT NOT NULL CHECK \(reason IN \(/.test(migration),
    'a pass can be recorded with no reason, or with any word at all');
  assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_lead_passes_need\s+ON partner_lead_passes\(partner_id, need_id\)/.test(migration),
    'one firm can pass one need twice');
  assert.ok(!/^\s*(BEGIN|COMMIT)\b/im.test(migration), 'the migration carries a transaction statement');
  // READ OFF THE DDL, NOT THE FILE. The header explains why there is no
  // `reversed_at` column, so a whole-file ban is satisfied by its own reason.
  const ddl = migration.replace(/^\s*--.*$/gm, '');
  assert.ok(!/reversed_at|is_reversed/.test(ddl),
    'un-passing keeps a row that says nothing a reader needs — the lead is passed or it is open');

  // UN-PASSING IS A DELETE. A lead is either passed or open.
  const del = between(worker, "partnerPipeline.delete('/leads/:needId/pass'", 'Negotiations');
  assert.ok(/DELETE FROM partner_lead_passes WHERE partner_id = \? AND need_id = \?/.test(del),
    'un-passing no longer removes the pass');

  // THE ARTBOARD'S OWN SENTENCE, on the artboard and on the page.
  assert.ok(flat(CANVAS).includes('a pass is a bid you chose not to make'),
    'the artboard stopped distinguishing a pass from a loss');
  const inst = between(zone, '<Instrument', '/>');
  assert.ok(flat(inst).includes('a pass is a bid you chose not to make'),
    'the page stopped distinguishing a pass from a loss');
  assert.ok(inst.includes('title="Passed · with reasons"'), 'the artboard’s table title is gone');
  assert.ok(inst.includes('meta="Only here · the record that stops re-litigation"'),
    'the artboard’s subtitle for that table is gone');
  assert.deepEqual(
    [...between(inst, 'head={[', ']}').matchAll(/'([^']+)'/g)].map((m) => m[1]),
    ['Lead', 'Reason', 'Note'],
    'the passed table drifted from the artboard’s three columns',
  );
  assert.ok(inst.includes('cols="1.1fr .8fr 1.6fr"'), 'the passed table lost the artboard’s grid');
});

test('the whole Pipeline bucket has its chip rows, and the guard can now read them', () => {
  // THE FINDING THIS FILE EXISTS FOR AS MUCH AS THE ARTBOARD. Five artboards
  // specified chip rows and `partnerZoneFilters.js` carried none of them.
  for (const zoneKey of ['pipeline/leads', 'pipeline/proposals', 'pipeline/negotiations',
    'pipeline/retainers', 'pipeline/analytics']) {
    assert.ok(filters.includes(`'${zoneKey}': [`), `${zoneKey} has no chip row`);
  }
  const guard = raw('frontend/test/profile_zone_filters.test.mjs');
  const alternation = guard.match(/canvas: \/\^Pages · Partner \(([^)]*)\)/);
  assert.ok(alternation && alternation[1].split('|').includes('Pipeline'),
    'the partner filter guard does not read the Pipeline canvas, so its labels are unchecked');
  // The canvas states its chips in a THIRD shape, and the guard learned it.
  assert.ok(guard.includes('sc-for list="\\{\\{\\s*(\\w+_views)\\s*\\}\\}"')
    || /sc-for list="\\\{\\\{/.test(guard),
    'the guard lost the section-markup reader that makes the Pipeline labels checkable');

  const row = between(filters, "'pipeline/leads': [", '],');
  assert.deepEqual([...row.matchAll(/canvas: '([^']+)'/g)].map((m) => m[1]),
    ['Open', 'Strong fit', 'Warm intros', 'Passed', 'All sources']);
  // `Warm intros` IS PROSE, and the reason is the same one the strip states:
  // every lead is a marketplace need, so the chip would select the whole list.
  assert.ok(/canvas: 'Warm intros',\s*\n\s*unbuilt:/.test(row),
    'Warm intros became a live chip over a distinction the reader cannot see');
});

test('the capability-weights op links to where the rules are actually written', () => {
  const vm = [...P1.matchAll(/class="vm"[^>]*>([^<]*)</g)].map((m) => m[1].trim());
  assert.deepEqual(vm, ['Edit capability weights']);
  const row = between(actions, "'pipeline/leads': [", '],');
  assert.ok(/to: '\/offers\/audience-fit'/.test(row),
    'the op no longer points at the zone where fit rules are edited');
  assert.ok(!/unbuilt/.test(row), 'the op went back to being prose');
  // THE STALE REASON IS RECORDED RATHER THAN DELETED, and it is not asserted as
  // current anywhere.
  // READ THE RAW FILE HERE. What is being asserted IS a comment — the record of
  // a reason that went stale — and `codeOnly` strips exactly those lines.
  const actionsRaw = flat(raw('frontend/src/workspaces/partnerZoneActions.js'));
  assert.ok(actionsRaw.includes('no capability register is stored, and no weight against one'),
    'the reason this op used to carry was deleted rather than recorded');
  assert.ok(actionsRaw.includes('The register was built for a different zone'),
    'the record of what changed is gone');
});

test('the AI band is the artboard’s, and the surface is allow-listed', () => {
  assert.ok(P1.includes('Proposal · drafted on accept'));
  assert.ok(P1.includes('Open the draft'));
  const band = between(zone, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="pipeline/leads"'));
  assert.ok(band.includes('label="Proposal · drafted on accept"'));
  assert.ok(band.includes('accept="Open the draft"'));

  assert.ok(spec.includes("'pipeline/leads': {"), 'the draft surface is not allow-listed');
  const surface = between(spec, "'pipeline/leads': {", "'delivery/health': {");
  // THE SHAPE CLAIM MUST COME FROM THE FIRM'S OWN RECORD. A model that
  // recommends a retainer because retainers are fashionable is worse than one
  // that recommends nothing.
  assert.ok(flat(surface).includes('only when this firm’s own won work supports it'),
    'the draft may now recommend a shape the record does not support');
  assert.ok(flat(surface).includes('say which is missing rather than estimating it'),
    'the draft may now estimate a rate or a budget');
  assert.ok(flat(surface).includes('is not a lead to draft for'),
    'the draft may now write a proposal for a lead the firm’s own rules exclude');
});

test('both writers are reachable and the read is scoped to the caller’s firm', () => {
  assert.ok(/listPartnerLeads: \(\) => request\('\/partner\/pipeline\/leads'\)/.test(apiJs));
  assert.ok(/passPartnerLead: \(needId, data\) =>/.test(apiJs));
  assert.ok(/unpassPartnerLead: \(needId\) =>/.test(apiJs));
  assert.ok(worker.includes("partnerPipeline.get('/leads'"));
  assert.ok(worker.includes("partnerPipeline.post('/leads/:needId/pass'"));
  assert.ok(worker.includes("partnerPipeline.delete('/leads/:needId/pass'"));
  // NO METHOD TAKES A FIRM ID. Every read is scoped server-side off the
  // caller's own `partners` row, the way the rest of this block is.
  const block = between(apiJs, 'listPartnerLeads:', 'listPartnerNegotiations:');
  assert.ok(!/partnerId|partner_id/.test(block),
    'a leads method takes a whose-record argument');
  const list = between(worker, "partnerPipeline.get('/leads'", 'Record a pass');
  assert.ok(/const \{ partnerId \} = await actingPartner\(c\);/.test(list),
    'the leads read is no longer scoped to the caller’s firm');
});
