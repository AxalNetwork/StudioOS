/**
 * Network · Introductions — the `pn2` artboard, and the consent that was always
 * stored and never returned.
 *
 * WHAT WAS WRONG HERE, AND IT WAS NOT A MISSING STORE. `intro_propositions`
 * (migration 150) writes a MIRROR row for every proposition — `source =
 * 'reciprocal'`, owned by the counterpart — so both halves of the double opt-in
 * have been in the database since the feature shipped. The response returned
 * only the caller's own `status`. That single omission is why this page could
 * say "you accepted" and not "it happened", why `partnerZoneFilters` renamed the
 * canvas's `Gated` chip to `Awaiting you`, and why its `Made` chip was prose
 * reading "no connected state exists".
 *
 * ONE HALF OF THAT REASON WAS RIGHT AND IS WHY MIGRATION 225 EXISTS. Two
 * consents mean an introduction MAY happen; nothing recorded that it did.
 * `intro_terms.made_at` is that record, and `kind`/`fee_bps` are the other thing
 * the artboard asks for — "every row states whether it is a favour or a referral
 * with a fee attached".
 *
 * THE CANVAS IS THE FIXTURE, as in `network_relationship_book.test.mjs`: labels,
 * notes, columns and the five states are parsed out of `design/incoming/Pages ·
 * Partner Network.dc.html` rather than retyped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/canvases/integrated/Pages · Partner Network.dc.html');
const pageRaw = raw('frontend/src/pages/IntroductionsPanel.jsx');
const page = read('frontend/src/pages/IntroductionsPanel.jsx');
const worker = raw('cloudflare-worker/src/routes/introductions.ts');
const service = raw('cloudflare-worker/src/services/introductions.ts');
const migration = raw('cloudflare-worker/sql/migrations/225_intro_terms.sql');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');

const PN2 = CANVAS.slice(CANVAS.indexOf("{ id:'pn2'"), CANVAS.indexOf("{ id:'pn3'"));
assert.ok(PN2.length > 500, 'the pn2 artboard could not be found in the canvas');

/**
 * The list route's two queries, each on its own.
 *
 * THEY ARE NEARLY IDENTICAL, AND THAT IS THE TRAP. The fallback exists for dev
 * D1s missing the lazily-added identity columns, and it carries the same
 * correlated subqueries with different indentation — so a whole-file `match`
 * for one of them passes on the other's copy. Two mutations escaped that way:
 * deleting the mirror subquery from the full SELECT, and dropping the owner
 * predicate from its terms join.
 */
const FULL_SELECT = worker.slice(worker.indexOf('const PROPOSITION_SELECT'), worker.indexOf('function propositionDto'));
const FALLBACK = worker.slice(worker.indexOf('// Older/dev DBs may lack'), worker.indexOf('const credits = await getIntroCreditState'));

/** The `CREATE TABLE` body of migration 225, without its header prose. */
const CREATE = migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS intro_terms ('));

test('the counterpart’s consent is returned, and only the consent', () => {
  // The mirror row, by the pair rather than by `source`: a proposition curated
  // by an admin has no reciprocal row, and keying on `source = 'reciprocal'`
  // would miss a mirror written any other way. Asserted on the full SELECT's own
  // slice — the fallback carries the same text and satisfied a whole-file match.
  assert.match(FULL_SELECT, /SELECT m\.status FROM intro_propositions m\s*\n\s*WHERE m\.user_id = p\.target_user_id AND m\.target_user_id = p\.user_id/,
    'the counterpart’s consent is no longer read');
  assert.match(worker, /counterpart_status: r\.counterpart_status \?\? null,/,
    'the counterpart’s consent is no longer returned');
  assert.match(worker, /counterpart_responded_at: r\.counterpart_responded_at \?\? null,/,
    'the counterpart’s consent has lost its date, so the record cannot be dated');

  // AND NOTHING ELSE OF THEIRS. Their score and their breakdown are the
  // matching engine's reasoning about them, addressed to them.
  assert.ok(!/m\.score|m\.breakdown_json/.test(FULL_SELECT),
    'the counterpart’s own match reasoning is being returned alongside their consent');
});

test('the degraded query returns the same shape as the full one', () => {
  // The list route falls back to a narrower SELECT on older dev D1s. A fallback
  // that dropped the counterpart's consent would make every row read as
  // un-answered on exactly the databases where it is hardest to notice.
  assert.ok(FALLBACK.length > 200, 'the fallback query could not be located');
  for (const field of ['counterpart_status', 'counterpart_responded_at', 'terms_kind', 'terms_made_at']) {
    assert.ok(FALLBACK.includes(field), `the degraded query drops ${field}`);
  }
  assert.match(FALLBACK, /SELECT m\.status FROM intro_propositions m/, 'the degraded query drops the mirror read');
});

test('the five states are the artboard’s, and each is read from a stored fact', () => {
  const states = JSON.parse(`[${CANVAS.match(/const STATES = \[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(states, ['Requested', 'One side', 'Both agreed', 'Made', 'Outcome']);
  assert.ok(page.includes(`export const STATES = ${JSON.stringify(states).replace(/"/g, "'").replace(/,/g, ', ')};`),
    'the pipeline’s five steps are no longer the artboard’s');

  const fn = page.slice(page.indexOf('export function stateOf('), page.indexOf('const STATE_TONE'));
  // `Made` IS `made_at`, NOT `accepted`. Two consents mean it may happen;
  // reading the second consent as the event is the inference migration 225
  // exists to avoid, and the reason the old `Made` chip was honest prose.
  assert.match(fn, /if \(p\.terms\?\.made_at\) return 'Made';/,
    'Made is being inferred from something other than the record that it happened');
  assert.match(fn, /if \(mine && theirs\) return 'Both agreed';/, 'Both agreed no longer requires both');
  assert.match(fn, /if \(mine \|\| theirs\) return 'One side';/, 'One side no longer means exactly one');
  assert.match(fn, /return 'Requested';/, 'Requested is gone');
  // Both terminal states are checked BEFORE the consent pair, so a declined
  // introduction cannot read as `One side` on the strength of the other
  // person's earlier yes. FOUND FIRST, THEN ORDERED: a missing branch gives
  // `indexOf` -1, and -1 is less than every real index — so the ordering test
  // alone passes when the branch is deleted, which is the mutation that
  // escaped.
  const declinedAt = fn.indexOf("return 'Declined'");
  const bothAt = fn.indexOf("return 'Both agreed'");
  assert.ok(declinedAt >= 0, 'a declined introduction has no state of its own');
  assert.ok(bothAt >= 0, 'Both agreed is gone');
  assert.ok(declinedAt < bothAt, 'a decline is being overtaken by a consent recorded before it');
});

test('an expired proposition is drawn, and is not counted as being at a gate', () => {
  // `status` CHECKs four values and the list route expires stale rows on every
  // read, so expiry is a state this store produces whether or not the
  // artboard's sample data contains one. It cannot be advanced by any consent,
  // which is what a gate means.
  assert.match(migration.length ? page : page, /return 'Lapsed';/, 'an expired proposition has no state');
  assert.match(page, /const isGated = \(state\) => state === 'Requested' \|\| state === 'One side';/,
    'the gate no longer means "a consent could still open this"');
  // Bounded at the object's own close: `standing()` further down names `Lapsed`
  // to say what a lapsed row reads as, and a slice that ran past this would
  // find it there and pass on prose.
  const at = page.indexOf('const NARROW = {');
  const narrow = page.slice(at, page.indexOf('\n};', at));
  assert.ok(narrow.includes('gated:') && narrow.includes('declined:'), 'the chip predicates could not be located');
  assert.ok(!narrow.includes('Lapsed'), 'a lapsed introduction is being swept into a chip');
});

test('a declined introduction stays visible, because it is terminal', () => {
  // The artboard says it: "a decline is a normal outcome, and deleting it would
  // only invite the same ask again."
  assert.match(PN2, /terminal, not re-asked/, 'the canvas’s own note on declines has moved');
  assert.match(page, /Terminal\. Not re-asked\./, 'a declined introduction no longer says it is terminal');
  assert.ok(!/filter\(\([a-z]\) => [a-z]\.status !== 'declined'\)/.test(page),
    'declined introductions are being filtered out of the list');
});

test('the four tiles are the artboard’s, label and note', () => {
  const adds = PN2.slice(PN2.indexOf('adds:['), PN2.indexOf('steps:'));
  const labels = [...adds.matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  const notes = [...adds.matchAll(/note:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Made', 'At a gate', 'Declined', 'With economics'],
    'the canvas strip has changed shape; re-read it before moving this guard');
  const strip = page.slice(page.indexOf('<Tile label="Made"'), page.indexOf('<StepRow'));
  assert.ok(strip.length > 100, 'the strip could not be located');
  for (const label of labels) assert.ok(strip.includes(`label="${label}"`), `the strip has lost the ${label} tile`);
  for (const note of notes) assert.ok(strip.includes(note), `a tile note left the artboard: "${note}"`);
});

test('the tiles count every introduction, never the rows a chip left showing', () => {
  const tiles = page.slice(page.indexOf('const made = props_.filter('), page.indexOf('const choose ='));
  assert.ok(tiles.length > 0, 'the tile counts are gone');
  assert.ok(!/\bvisible\b/.test(tiles), 'a tile count is reading the chip-narrowed list');
  assert.match(tiles, /const withFee = props_\.filter\(\(p\) => p\.terms\?\.kind === 'referral'\);/,
    'the With economics tile no longer counts the rows that state a fee');
});

test('the instrument draws the artboard’s columns, in its order and at its widths', () => {
  const head = JSON.parse(`[${PN2.match(/head:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  const cols = PN2.match(/cols:'([^']+)'/)[1];
  assert.deepEqual(head, ['Introduction', 'State', 'Kind', 'Consent record', 'Where it stands']);
  assert.ok(page.includes(`head={${JSON.stringify(head).replace(/"/g, "'").replace(/,/g, ', ')}}`),
    'the instrument head is no longer the artboard’s five columns in its order');
  assert.ok(page.includes(`cols="${cols}"`), 'the instrument no longer uses the artboard’s column widths');
  assert.ok(page.includes(PN2.match(/instMeta:'([^']+)'/)[1]),
    'the instrument’s meta line has left the artboard');
});

test('the consent record names the missing half rather than leaving it blank', () => {
  // The artboard's own cell: "Dev agreed Aug 27 · Verwood not recorded". Two
  // clauses, one per side — which is the difference between showing a gate and
  // showing an empty column.
  const fn = page.slice(page.indexOf('export function consentRecord('), page.indexOf('/** `Where it stands`'));
  assert.match(fn, /return `\$\{mine\} · \$\{theirs\}`;/, 'the consent record is no longer two clauses');
  assert.match(fn, /not recorded/, 'an unanswered consent no longer says so');
  // NO MIRROR ROW IS A THIRD THING. A hand-curated proposition has no
  // counterpart row, so the other side has never been asked; rendering that as
  // "not recorded" would report an unanswered question nobody put.
  assert.match(fn, /p\.counterpart_status == null/,
    'a proposition with no counterpart row is being reported as unanswered');
  assert.match(fn, /has not been asked/, 'the never-asked case has lost its own words');
});

test('a referral must state its fee, in the store and in the form', () => {
  // The same refusal `research_benchmarks` makes of a peer figure with no
  // sample size: a row that may say "referral" with the fee blank makes `With
  // economics` count rows that state none.
  // ASSERTED ON THE `CREATE TABLE` BODY, NOT THE FILE. The migration's header
  // quotes its own CHECKs while explaining them, so a whole-file match is
  // satisfied by the prose that describes a constraint someone has just
  // deleted — which is the mutation that escaped.
  assert.match(CREATE, /CHECK \(kind = 'favour' OR fee_bps IS NOT NULL\)/,
    'a referral may now be stored with no fee');
  assert.match(CREATE, /CHECK \(kind = 'referral' OR fee_bps IS NULL\)/,
    'a favour may now carry a fee');
  assert.match(CREATE, /CHECK \(fee_bps IS NULL OR \(fee_bps > 0 AND fee_bps <= 10000\)\)/,
    'the fee is no longer bounded');
  // Basis points, integer — a rate rather than an amount, so there is no money
  // column here for `check-money-cents` to have an opinion about.
  assert.match(CREATE, /fee_bps\s+INTEGER,/, 'the fee is no longer stored in basis points');
  assert.ok(!/_cents|price_usd|amount_usd/.test(CREATE), 'a money column has appeared in this table');

  const route = worker.slice(worker.indexOf("introductions.put('/propositions/:uid/terms'"));
  assert.match(route, /return c\.json\(\{ error: 'fee_bps_required' \}, 400\);/,
    'the route no longer refuses a referral with no fee');
  assert.match(page, /const feeOk = kind !== 'referral' \|\| \(Number\.isInteger\(bps\) && bps > 0 && bps <= 10000\);/,
    'the form no longer blocks a referral with no fee');
});

test('terms are one side’s record, on one side’s row', () => {
  const route = worker.slice(worker.indexOf("introductions.put('/propositions/:uid/terms'"));
  // The proposition must be the caller's own — 404 rather than 403, so the
  // endpoint cannot be used to discover whether two other people were matched.
  assert.match(route, /SELECT uid FROM intro_propositions WHERE uid = \? AND user_id = \?/,
    'terms may now be written against someone else’s proposition');
  assert.match(route, /return c\.json\(\{ error: 'not_found' \}, 404\);/,
    'a proposition that is not the caller’s no longer answers as missing');
  // And the read joins by owner, so one side's fee cannot appear on the other's
  // screen as though both had agreed it.
  // BOTH QUERIES, EACH ON ITS OWN SLICE. They carry the same join text, so a
  // whole-file match passes when one of them loses the owner predicate.
  for (const [name, sql] of [['the full query', FULL_SELECT], ['the degraded query', FALLBACK]]) {
    assert.match(sql, /LEFT JOIN intro_terms t ON t\.proposition_uid = p\.uid AND t\.owner_user_id = p\.user_id/,
      `${name}'s terms join is no longer scoped to the row’s own owner`);
  }
  assert.match(CREATE, /UNIQUE \(owner_user_id, proposition_uid\)/, 'one side may now keep two records');
});

test('the self-healing schema is not laxer than the migration', () => {
  // `ensureIntroNetworkSchema` mirrors these tables so a dev or preview D1
  // self-heals before a migration lands. A mirrored table without the CHECKs
  // would accept rows the migrated one refuses, which is worse than no table:
  // the same code would pass on one database and fail on another.
  const stmts = service.slice(service.indexOf('export async function ensureIntroNetworkSchema'), service.indexOf('migratedDbs.add'));
  // The open paren is load-bearing: without it, a table renamed to
  // `intro_terms_unused` still satisfies the check by prefix, and the page
  // 500s on every un-migrated database while this passes.
  assert.ok(stmts.includes('CREATE TABLE IF NOT EXISTS intro_terms ('), 'intro_terms does not self-heal');
  for (const check of [
    "CHECK (kind IN ('favour','referral'))",
    "CHECK (kind = 'favour' OR fee_bps IS NOT NULL)",
    "CHECK (kind = 'referral' OR fee_bps IS NULL)",
    'CHECK (fee_bps IS NULL OR (fee_bps > 0 AND fee_bps <= 10000))',
    'UNIQUE (owner_user_id, proposition_uid)',
  ]) {
    assert.ok(stmts.includes(check), `the self-healed table is missing: ${check}`);
  }
});

test('the four chips and the ops row are live, and their old reasons are gone', () => {
  const row = filters.slice(filters.indexOf("'network/introductions': ["), filters.indexOf(']', filters.indexOf("'network/introductions': [")));
  const canvasChips = JSON.parse(`[${PN2.match(/filters: fil\(\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasChips, ['All', 'Gated', 'Made', 'Declined']);
  for (const chip of canvasChips) {
    assert.match(row, new RegExp(`canvas: '${chip}', key: '[a-z]+'`), `${chip} is not a live chip`);
  }
  // `Gated` MEANS THE CANVAS'S WORD AGAIN. The `label:` override renamed it
  // `Awaiting you` precisely because only one side's consent was visible.
  assert.ok(!row.includes('Awaiting you'), 'the Gated chip is still relabelled for a one-sided consent');
  assert.ok(!filters.includes('NO_CONNECTED_STATE'), 'the retired reason is still referenced');

  const ops = actions.slice(actions.indexOf("'network/introductions': ["), actions.indexOf('],', actions.indexOf("'network/introductions': [")));
  assert.match(ops, /\{ label: 'Consent log', kind: 'handler', handler: 'consentLog' \}/,
    'Consent log is no longer performed by the page');
  assert.ok(!ops.includes('consent is recorded per introduction, not as a log'),
    'the retired reason for Consent log is still on the row');
  // `New introduction` STAYS PROSE, and the reason now names the obstacle
  // rather than the flow: there is no write path and nothing to compose from.
  assert.match(ops, /\{ label: 'New introduction', unbuilt: '/, 'New introduction has been given a control');
  assert.ok(!worker.includes("introductions.post('/propositions',"),
    'a compose route exists, so New introduction should no longer be prose');
});

test('the AI band is the artboard’s, and it drafts nothing on mount', () => {
  const label = PN2.match(/aiLabel:'([^']*)'/)[1];
  const accept = PN2.match(/aiAccept:'([^']*)'/)[1];
  const foot = PN2.match(/aiFoot:'([^']*)'/)[1];
  const band = page.slice(page.indexOf('<ZoneDraft'), page.indexOf('/>', page.indexOf('<ZoneDraft')));
  assert.ok(band.includes('surface="network/introductions"'), 'the band is on the wrong surface');
  assert.ok(band.includes(`label="${label}"`), `the band's label left the artboard: ${label}`);
  assert.ok(band.includes(`accept="${accept}"`), `the band's accept left the artboard: ${accept}`);
  assert.ok(band.includes(`foot="${foot}"`), `the band's footnote left the artboard: ${foot}`);
});

test('the card stack’s unique capabilities survived the table', () => {
  // The list became the artboard's pipeline, which is the right primary read —
  // but the cards carried the matching engine's reasoning, and a reader about
  // to spend a credit needs it. Dropping capability to match a composition is
  // not matching a composition.
  // MOUNTS, NOT IDENTIFIERS. `CreditSummary` is defined near the top of this
  // file and its definition survives every deletion of the element that renders
  // it — so checking the bare name passes over a page that no longer draws the
  // credit balance at all. Each entry here is either an element or a string a
  // reader can see.
  for (const kept of ['<MatchDetail', 'Why this match', 'View profile', 'complementary_skills',
    'shared_values', '<CreditSummary', 'Accept · 1 credit', '<ConsentLog', '<TermsModal',
    'Decline']) {
    assert.ok(page.includes(kept), `the rewrite lost: ${kept}`);
  }
  // And the duplicate control went: the panel's own status chip row selected the
  // same thing the zone row does, and two controls onto one state disagree.
  assert.ok(!page.includes('STATUS_FILTERS'), 'the panel still holds a second status filter row');
  assert.ok(pageRaw.includes('STATUS_META'), 'the docblock no longer records what the card stack took with it');
});
