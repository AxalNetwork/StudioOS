/**
 * Network · Organizations — the `pn3` artboard, whose empty state IS the page.
 *
 * WHAT WAS HERE. Nothing, for a reason that was carefully written down three
 * times and was correct every time it was checked. `NetworkPage` catches a slug
 * it has no tab for and suppresses every body, so the route rendered one
 * paragraph: the roll-up needs an edge from a person to an organisation and
 * nothing records one. `partnerZoneFilters` said the zone "will never be here";
 * `partnerZoneActions` said a header row "would add nothing"; both guard files
 * carried it in an `excluded` list.
 *
 * WHAT CHANGED IS THE STORE, NOT THE ARGUMENT. Migration 224 put a company name
 * on every book contact and 226 said what that company is to the firm. The
 * artboard is about precisely that state — a company as text with no
 * organization record behind it — so the empty state comes first at full
 * weight, and the table under it is titled `Intended shape` and says on its own
 * meta line that it is rendered from contacts rather than from a roll-up.
 *
 * THE TWO COLUMNS THAT STAY `Not recorded` ARE THE POINT, and this file's job
 * is to keep them that way. `Headcount` because the book holds no such field
 * and "an estimate here would be the first invented number in the firm's own
 * record of who it knows"; `Engagement sourced` because an engagement is
 * recorded against a project and matching it to a company name typed on a
 * contact would be a guess printed as a fact about a client's work.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

/**
 * A docblock as one line, so a phrase that wrapped across `*`-prefixed lines is
 * still findable. "will never be here" breaks over two at this width, and a raw
 * `includes` misses it — a wrapping accident, not a lost record.
 * `research_canvas_strips.test.mjs` carries the same helper for the same reason.
 */
const flat = (doc) => doc.replace(/^\s*\*/gm, '').replace(/[`\s]+/g, ' ');

/** Each `<Tile …/>` bounded at its OWN `/>`, keyed by label. */
function tilesIn(code) {
  return Object.fromEntries(code.split(/<Tile\s/).slice(1).map((segment) => {
    const tile = segment.slice(0, segment.indexOf('/>'));
    return [tile.match(/label="([^"]+)"/)?.[1], tile];
  }));
}

const CANVAS = raw('design/incoming/Pages · Partner Network.dc.html');
const pageRaw = raw('frontend/src/pages/partner/OrganizationsZone.jsx');
const page = read('frontend/src/pages/partner/OrganizationsZone.jsx');
const workspace = read('frontend/src/workspaces/NetworkWorkspace.jsx');
const worker = raw('cloudflare-worker/src/routes/partnernet.ts');
const migration = raw('cloudflare-worker/sql/migrations/226_partner_book_relationship.sql');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const filtersRaw = raw('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');

const PN3 = CANVAS.slice(CANVAS.indexOf("{ id:'pn3'"));
assert.ok(PN3.includes("route:'/network/organizations'"), 'the pn3 artboard could not be found in the canvas');

test('the empty state is the primary composition, with all four of its parts', () => {
  // The artboard's blurb: "the empty state is the primary composition here and
  // the populated table below it is what the roll-up would look like once
  // built." So it is drawn FIRST — above the strip and above the instrument —
  // and every one of its four named parts is on the page.
  const empty = PN3.slice(PN3.indexOf('empty:{'), PN3.indexOf('cmpTitle:'));
  const h = empty.match(/h:'([^']+)'/)[1];
  const cta = empty.match(/cta:'([^']+)'/)[1];
  const cta2 = empty.match(/cta2:'([^']+)'/)[1];
  for (const part of [h, cta, cta2, 'Nothing to roll up yet']) {
    assert.ok(page.includes(part), `the empty state has lost: ${part}`);
  }
  // Its body and honest line are built from live counts, so only their fixed
  // halves are comparable — and both halves matter: the body says what the
  // roll-up WOULD do, and the last clause says why it does not.
  for (const fragment of [
    'grouping people by employer',
    'with no organization record behind it',
    'Headcount, sector and revenue columns are absent rather than',
  ]) {
    assert.ok(page.includes(fragment), `the empty state's copy has drifted: ${fragment}`);
    assert.ok(flat(PN3).includes(fragment), `that fragment is no longer the canvas's: ${fragment}`);
  }

  // ORDER, NOT MERE PRESENCE. Drawn under the table it would be a footnote on a
  // roll-up rather than the page's own subject.
  // ONCE, AND ABOVE THE STRIP. Counted rather than merely located: a second
  // copy further down would satisfy a first-index test while the composition
  // said the sentence twice, and the artboard's whole argument is that it is
  // said once, at the top, at full weight.
  assert.equal((page.match(/The roll-up is not built yet\./g) || []).length, 1,
    'the empty state’s heading appears more than once');
  const emptyAt = page.indexOf('The roll-up is not built yet.');
  const stripAt = page.indexOf('<Tile label="Companies in the book"');
  const tableAt = page.indexOf('<Instrument');
  assert.ok(emptyAt > 0 && stripAt > emptyAt && tableAt > stripAt,
    'the empty state is no longer the first thing on the page');
});

test('the accent CTA writes something real rather than sitting dead', () => {
  // A control that performs nothing is the failure `zoneActionBuilder`'s whole
  // vocabulary exists to refuse, and an accent-filled one is the loudest
  // version of it. `Build organization records` cannot create an organization
  // record — there is no such table — so it opens the board where the firm
  // records the one organization fact the book does hold.
  const cta = page.slice(page.indexOf('Build organization records') - 700, page.indexOf('Build organization records'));
  assert.match(cta, /onClick=\{\(\) => setBuilding\(true\)\}/, 'the accent CTA does nothing');
  assert.ok(page.includes('<BuildModal'), 'the board behind it is gone');
  assert.match(page, /await api\.partnerBookSetRelationship\(c\.uid, value\)/,
    'the board no longer writes a relationship');
  // Written across every contact at that company, because there is no
  // organization row to write it to.
  assert.match(page, /state\.items\.filter\(\(c\) => \(c\.organization \|\| ''\)\.trim\(\)\.toLowerCase\(\) === org\.key\)/,
    'the board no longer writes to every contact at the company');
});

test('the roll-up groups by trimmed, case-folded company text', () => {
  // "Verwood" and "verwood " are one company to a reader and two rows to a
  // naive group-by — which would then report "every row knows exactly one
  // person" as a finding about the firm's relationships when it was a finding
  // about whitespace.
  const fn = page.slice(page.indexOf('export function rollUp('), page.indexOf('export default function'));
  assert.match(fn, /const key = name\.toLowerCase\(\);/, 'the grouping key is case-sensitive again');
  assert.match(fn, /const name = \(c\.organization \|\| ''\)\.trim\(\);/, 'the grouping key is no longer trimmed');
  assert.match(fn, /if \(!name\) continue;/, 'a contact with no company is being grouped under an empty name');
});

test('a company whose contacts disagree reads Mixed, and is not tie-broken', () => {
  // The relationship is stored per contact because there is nowhere else to put
  // it, so two contacts at one company can disagree. Picking the newest or the
  // most common would be the page inventing a relationship the firm never
  // stated — the same refusal `Headcount` makes by staying absent.
  const fn = page.slice(page.indexOf('export function rollUp('), page.indexOf('export default function'));
  assert.match(fn, /kind: row\.kinds\.size === 1 \? \[\.\.\.row\.kinds\]\[0\] : \(row\.kinds\.size > 1 \? 'Mixed' : null\)/,
    'a disagreement is being resolved instead of reported');
  // And `Mixed` matches none of the three relationship chips: it is not a
  // client and not a prospect, and a chip that swept it into one would be the
  // tie-break moved into the filter.
  const at = page.indexOf('const NARROW = {');
  const narrow = page.slice(at, page.indexOf('\n};', at));
  assert.ok(!narrow.includes('Mixed'), 'a Mixed company is being swept into a relationship chip');
});

test('Headcount and Engagement sourced are drawn, and are never filled', () => {
  const head = JSON.parse(`[${PN3.match(/head:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(head, ['Organization', 'Relationship', 'People known', 'Engagement sourced', 'Headcount']);
  assert.ok(page.includes(`head={${JSON.stringify(head).replace(/"/g, "'").replace(/,/g, ', ')}}`),
    'the instrument head is no longer the artboard’s five columns in its order');
  assert.ok(page.includes(`cols="${PN3.match(/cols:'([^']+)'/)[1]}"`),
    'the instrument no longer uses the artboard’s column widths');

  // The last two cells of every row are `{ nr: true }` and carry no value.
  const cells = page.slice(page.indexOf('cells: ['), page.indexOf('note={`Every row here'));
  const tail = cells.slice(cells.indexOf("{ text: String(o.people)"));
  assert.equal((tail.match(/\{ nr: true \}/g) || []).length, 2,
    'a column the book cannot fill has been given a value, or has stopped being drawn');
  // Nothing on this page reaches for an engagement or a headcount to fill them.
  assert.ok(!/api\.(listEngagements|engagements|partnerEngagements)/.test(page),
    'the page is reaching for engagements to fill a column it says it cannot');
  assert.ok(!/headcount|employees|company_size/i.test(page.replace(/Headcount, sector|'Headcount'|Headcount reads/g, '')),
    'the page has found a headcount somewhere');
});

test('the four tiles are the artboard’s, and one note is deliberately not', () => {
  const adds = PN3.slice(PN3.indexOf('adds:['), PN3.indexOf('instTitle:'));
  const labels = [...adds.matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Companies in the book', 'Clients', 'Organization records', 'Headcount, sector']);
  // EACH TILE BOUNDED AT ITS OWN `/>`, so a note cannot be found on a
  // neighbouring tile and a slice cannot run past the strip. An earlier version
  // bounded it on `{rows.length === 0`, which appears in the handlers above the
  // strip — the slice ran backwards and every tile "was missing".
  const tiles = tilesIn(page);
  for (const label of labels) assert.ok(tiles[label], `the strip has lost the ${label} tile`);
  for (const [label, note] of [
    ['Companies in the book', 'as text on contacts, not records'],
    ['Organization records', 'nothing to aggregate over yet'],
    ['Headcount, sector', 'the book holds neither — never estimated'],
  ]) {
    assert.ok(tiles[label].includes(note), `${label}'s note left the artboard: "${note}"`);
  }
  // `Organization records` IS A LITERAL ZERO and is the page's subject, so it
  // must not become a count of something else that happens to be non-zero.
  assert.match(tiles['Organization records'], /value=\{0\}/,
    'the Organization records tile is counting something');
  assert.match(tiles['Headcount, sector'], /\bnr\b/, 'the Headcount tile is drawing a number');
  assert.ok(!/value=/.test(tiles['Headcount, sector']), 'the Headcount tile has been given a value');

  // AND THE ONE NOTE THAT IS DELIBERATELY NOT THE CANVAS'S. `Clients` reads
  // "each with a live engagement" on the artboard — a claim about engagements,
  // which is exactly what the Engagement sourced column refuses to make two
  // rows below. Printing it would have the tile assert what the table declines
  // to.
  assert.ok(adds.includes('each with a live engagement'), 'the canvas note this diverges from has moved');
  assert.ok(!tiles.Clients.includes('each with a live engagement'),
    'the Clients tile is claiming an engagement the page cannot see');
  assert.ok(pageRaw.includes('each with a live engagement'),
    'the docblock no longer records which canvas note was declined, and why');
});

test('the tiles count the whole roll-up, never the rows a chip left showing', () => {
  const tiles = page.slice(page.indexOf('const clients = rows.filter('), page.indexOf('const setRelationship'));
  assert.ok(tiles.length > 0, 'the tile counts are gone');
  assert.ok(!/\bvisible\b/.test(tiles), 'a tile count is reading the chip-narrowed list');
});

test('the store is the writer’s, and the column refuses anything else', () => {
  assert.match(migration, /ADD COLUMN relationship TEXT/, 'the relationship column is gone');
  assert.match(migration, /CHECK \(relationship IS NULL OR relationship IN \('client', 'prospect', 'referral_source'\)\)/,
    'the relationship column accepts any text again');
  // NULLABLE WITH NO DEFAULT. A contact added before this column has no
  // relationship recorded, not "prospect" — defaulting would make the Prospects
  // chip count every legacy row as a value nobody chose.
  assert.ok(!/relationship TEXT[^\n]*DEFAULT/.test(migration), 'the relationship column has been given a default');
  // The route validates against the same list the column CHECKs, so a value the
  // route lets through cannot be one the store refuses.
  assert.match(worker, /const RELATIONSHIPS = \['client', 'prospect', 'referral_source'\];/,
    'the route’s accepted values are no longer spelled out');
  // BOUNDED AT ITS OWN END, not at the end of the file. `PATCH
  // /book/:uid/owner` sits below this route and carries an identical owner
  // predicate, so a slice that ran to EOF was satisfied by the neighbour's
  // scope while this one had none — the mutation that escaped.
  const at = worker.indexOf("partnernet.patch('/book/:uid/relationship'");
  assert.ok(at > 0, 'the relationship route is gone');
  const after = worker.slice(at + 20);
  const next = after.search(/\npartnernet\.(get|post|patch|delete)\(|\nasync function /);
  assert.ok(next > 0, 'the relationship route is not followed by another declaration');
  const patch = worker.slice(at, at + 20 + next);
  assert.match(patch, /!RELATIONSHIPS\.includes\(value\)/, 'the write no longer validates the relationship');
  assert.match(patch, /WHERE uid = \? AND owner_user_id = \?/, 'the write is no longer scoped to the caller’s book');
  assert.match(patch, /const value = body\?\.relationship == null \? null : String\(body\.relationship\);/,
    'the write no longer accepts a clear, so a wrong value cannot be corrected');
});

test('the zone is mounted for a partner, and the gap card is kept for a licence with no store', () => {
  assert.match(workspace, /if \(role === 'partner' && slug === 'organizations'\)/,
    'the partner Organizations zone is no longer dispatched');
  assert.match(workspace, /<PartnerNetworkOrganizations/, 'the zone body is not mounted');
  // ADVISOR IS STILL OUT, and for the reason it always was: 403'd from
  // `/api/contacts`, with no book of its own to group.
  assert.match(workspace, /const ORG_BACKED = new Set\(\['founder', 'investor', 'partner'\]\)/,
    'the set of licences with an Organizations body has changed');
  assert.ok(!/ORG_BACKED = new Set\(\[[^\]]*'advisor'/.test(workspace),
    'an advisor has been told this zone is covered');
});

test('the four chips and the ops row are live, and the "never" note was rewritten', () => {
  const canvasChips = JSON.parse(`[${PN3.match(/filters: fil\(\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasChips, ['All', 'Clients', 'Prospects', 'Referral sources']);
  const at = filters.indexOf("'network/organizations': [");
  const row = filters.slice(at, filters.indexOf(']', at));
  for (const chip of canvasChips) {
    assert.match(row, new RegExp(`canvas: '${chip}', key: '[a-z]+'`), `${chip} is not a live chip`);
  }
  // THE OLD NOTE IS QUOTED, NOT DELETED. It was a correct reading of the page
  // that then existed, and a reversal that erases what it reversed leaves the
  // next reader to rediscover the argument.
  const doc = flat(filtersRaw);
  assert.ok(doc.includes('will never be here'),
    'the docblock no longer records what it reversed');
  assert.ok(doc.includes('"Never" was the word to distrust'),
    'the docblock no longer says why the old note read as a rule');

  const oat = actions.indexOf("'network/organizations': [");
  const ops = actions.slice(oat, actions.indexOf('],', oat));
  const canvasOps = JSON.parse(`[${PN3.match(/ops:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasOps, ['Build records', 'Import', 'Export']);
  assert.match(ops, /\{ label: 'Build records', kind: 'handler', handler: 'buildRecords' \}/,
    'Build records is no longer performed by the page');
  assert.match(ops, /\{ label: 'Import', unbuilt: '/, 'Import has been given a control');
  assert.match(ops, /\{ label: 'Export', kind: 'export' \}/, 'the export is gone');
});

test('the AI band is the artboard’s, on its own surface', () => {
  const label = PN3.match(/aiLabel:'([^']*)'/)[1];
  const accept = PN3.match(/aiAccept:'([^']*)'/)[1];
  const foot = PN3.match(/aiFoot:'([^']*)'/)[1];
  const band = page.slice(page.indexOf('<ZoneDraft'), page.indexOf('/>', page.indexOf('<ZoneDraft')));
  assert.ok(band.includes('surface="network/organizations"'), 'the band is on the wrong surface');
  assert.ok(band.includes(`label="${label}"`), `the band's label left the artboard: ${label}`);
  assert.ok(band.includes(`accept="${accept}"`), `the band's accept left the artboard: ${accept}`);
  assert.ok(band.includes(`foot="${foot}"`), `the band's footnote left the artboard: ${foot}`);
});
