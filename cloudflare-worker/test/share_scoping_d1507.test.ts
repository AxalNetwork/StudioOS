/**
 * D1507 (#3758, deck v2 A14): every Grid element carries its gate onto a share
 * link. One test per gate, a check that fails on an element or a block kind
 * with no gate, and the read of the venture's consents. Synthetic blocks only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/share_scoping_d1507.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  BLOCK_KIND_GATES, DEFAULT_SHARE_INCLUDE, ELEMENT_GATES, NO_GATES, blockKept, gateOf, parseShareInclude, shareGatesFor,
  shareIncludeFromBody, shareSlides, type ShareGates, type ShareInclude,
} from '../src/services/decks/shareInclude.ts';
import { ELEMENTS } from '../src/services/decks/elementModels.ts';
import { BLOCK_KINDS, sanitizeBlocks } from '../src/services/decks/slideModel.ts';
import { d1Over } from './_d1_sqlite.mjs';

const grid = { c1: 1, c2: 6, r1: 1, r2: 3 };
const on = (extra: Partial<ShareInclude> = {}): ShareInclude => ({ ...DEFAULT_SHARE_INCLUDE, ...extra });
const gates = (quotes: string[] = [], logos: string[] = []): ShareGates => ({ quote_sessions: new Set(quotes), logo_permissions: new Set(logos) });
const bind = (source_key: string) => ({ source_key, grade: 'Verified', as_of: '2026-10-01', record_id: 9, snapshot: '42' });

test('every element of the one catalogue and every block kind has a gate; none is a stale row', () => {
  const ids = ELEMENTS.map((e) => e.id);
  assert.deepEqual(ids.filter((id) => !(id in ELEMENT_GATES)), [], 'an element with no share gate');
  assert.deepEqual(Object.keys(ELEMENT_GATES).filter((id) => !ids.includes(id)), [], 'a gate for no element');
  assert.deepEqual(BLOCK_KINDS.filter((k) => !(k in BLOCK_KIND_GATES)), [], 'a block kind with no share gate');
  // The elements the final canvas and dk-auto added are gated, not left open.
  assert.deepEqual(['team_grid', 'team_bios', 'logo_wall', 'interview_quote', 'cap_table'].map((id) => ELEMENT_GATES[id]),
    ['team_photos', 'team_photos', 'permission', 'consent', 'cap_table']);
  assert.equal(gateOf({ kind: 'text', element: 'not_an_element' }), null);
  assert.equal(blockKept({ kind: 'text', grid, text: 'x', element: 'not_an_element' }, on()), null, 'an unknown element is left out');
});

test('the two new switches are off by default, and an older link reads them as off', () => {
  assert.equal(DEFAULT_SHARE_INCLUDE.cap_table, false);
  assert.equal(DEFAULT_SHARE_INCLUDE.team_photos, false);
  assert.deepEqual(parseShareInclude('{"figures":true,"sources":true,"notes":false,"bands":false}'), { ...DEFAULT_SHARE_INCLUDE });
  assert.equal(shareIncludeFromBody({ cap_table: true })!.cap_table, true);
  assert.equal(shareIncludeFromBody({ team_photos: 'yes' }), null, 'a switch is a boolean');
  assert.equal(shareIncludeFromBody({ holders: true }), null, 'an unknown key is refused');
});

test('figures: charts, metrics, tables and the money elements need the figures switch', () => {
  const blocks = [
    { id: 'm', kind: 'metric', grid, label: 'ARR', value: '$1.2M' },
    { id: 'c', kind: 'chart', grid, chart_type: 'line', series: [] },
    { id: 't', kind: 'table', grid, header: true, rows: [[{ text: 'a' }]] },
    { id: 'u', kind: 'text', grid, text: 'Hiring 40%', element: 'use_of_funds' },
    { id: 'r', kind: 'text', grid, text: '$2M at $10M', element: 'round_terms' },
  ];
  for (const b of blocks) {
    assert.ok(blockKept(b, on()), `${b.id} kept with figures on`);
    assert.equal(blockKept(b, on({ figures: false })), null, `${b.id} left out with figures off`);
  }
  assert.ok(blockKept({ kind: 'text', grid, text: 'Plain words' }, on({ figures: false })), 'plain text has no gate');
});

test('notes: a speaker-notes element goes out only with notes on', () => {
  const b = { kind: 'text', grid, text: 'Say this', element: 'speaker_notes' };
  assert.equal(blockKept(b, on()), null);
  assert.ok(blockKept(b, on({ notes: true })));
});

test('team photos: the team grid and the team bios stay off a link until the founder includes them', () => {
  for (const b of [{ kind: 'image', grid, image_url: 'https://axal.vc/x.png', element: 'team_grid' }, { kind: 'text', grid, text: 'Ada, CEO', element: 'team_bios' }]) {
    assert.equal(blockKept(b, on()), null, `${b.element} off by default`);
    assert.ok(blockKept(b, on({ team_photos: true })), `${b.element} with team photos on`);
  }
});

test('cap table: off by default; with it on, totals only, never a holder\'s row', () => {
  const table = { kind: 'table', grid, element: 'cap_table', header: true, rows: [
    [{ text: 'Holder' }, { text: 'Shares' }],
    [{ text: 'Synthetic founder A' }, { text: '600,000' }],
    [{ text: 'Synthetic fund B' }, { text: '300,000' }],
    [{ text: 'Total' }, { text: '900,000' }],
  ] };
  assert.equal(blockKept(table, on()), null, 'off by default');
  const kept = blockKept(table, on({ cap_table: true }));
  assert.deepEqual(kept.rows.map((r: any) => r[0].text), ['Holder', 'Total']);
  assert.equal(JSON.stringify(kept).includes('Synthetic founder A'), false, 'no holder name leaves');
  const noTotal = { ...table, rows: table.rows.slice(0, 3) };
  assert.equal(blockKept(noTotal, on({ cap_table: true })), null, 'a cap table with no total row is left out, not sent with holders');
  assert.ok(blockKept({ kind: 'metric', grid, element: 'cap_table', label: 'Fully diluted', value: '900,000' }, on({ cap_table: true })), 'a total as a metric');
  assert.equal(blockKept({ kind: 'chart', grid, element: 'cap_table', chart_type: 'columns', series: [] }, on({ cap_table: true })), null, 'any other shape is left out');
});

test('consent: an interview quote goes out only when the Worker holds its session\'s recorded consent', () => {
  const b = { kind: 'text', grid, text: '"It saved us a week."', element: 'interview_quote', session_uid: 'sess-1' };
  assert.equal(blockKept(b, on()), null, 'no consents read');
  assert.equal(blockKept(b, on(), gates(['sess-2'])), null, 'another session\'s consent');
  assert.equal(blockKept({ ...b, session_uid: undefined }, on(), gates(['sess-1'])), null, 'a quote with no session');
  assert.ok(blockKept(b, on(), gates(['sess-1'])));
  assert.ok(blockKept(b, on({ figures: false, notes: false }), gates(['sess-1'])), 'consent is the gate, not a switch');
});

test('permission: a logo wall or a HubSpot logo goes out only with its permission recorded; today none is', () => {
  const wall = { kind: 'graphic', grid, graphic: 'logos', element: 'logo_wall', logo_key: 'acme' };
  assert.equal(blockKept(wall, on()), null);
  assert.equal(blockKept(wall, on(), gates([], ['other'])), null);
  assert.ok(blockKept(wall, on(), gates([], ['acme'])));
  const crm = { kind: 'image', grid, image_url: 'https://axal.vc/l.png', tag: 'logo', binding: bind('hubspot.company_logo'), logo_key: 'acme' };
  assert.equal(blockKept(crm, on()), null, 'a CRM logo needs permission even with no element named');
  assert.ok(blockKept(crm, on(), gates([], ['acme'])));
  assert.ok(blockKept({ kind: 'image', grid, image_url: 'https://axal.vc/own.png', tag: 'logo' }, on()), 'the venture\'s own logo upload has no gate');
});

test('bank data and internal scores never leave, however a block is bound; bands need the bands switch', () => {
  const everyway = (key: string) => [
    { kind: 'metric', grid, label: 'x', value: '1', binding: bind(key) },
    { kind: 'chart', grid, chart_type: 'line', series: [{ label: 'x', binding: bind(key) }] },
    { kind: 'table', grid, header: false, rows: [[{ text: 'a', binding: bind(key) }]] },
  ];
  for (const key of ['mercury.bank_balance', 'raise.vr_score']) {
    for (const b of everyway(key)) assert.equal(blockKept(b, on({ bands: true, cap_table: true, team_photos: true, notes: true })), null, `${b.kind} bound to ${key}`);
  }
  for (const b of everyway('validation.pmf_band')) {
    assert.equal(blockKept(b, on()), null, `${b.kind} band off`);
    assert.ok(blockKept(b, on({ bands: true })), `${b.kind} band on`);
  }
});

test('shareSlides sends each card\'s blocks through the gates, and never the references a gate checked', () => {
  const slides = [{ title: 'Proof', blocks: [
    { id: 'q', kind: 'text', grid, text: '"Fast."', element: 'interview_quote', session_uid: 'sess-1' },
    { id: 'm', kind: 'metric', grid: { c1: 7, c2: 12, r1: 1, r2: 3 }, label: 'ARR', value: '$1M', binding: bind('revenue.arr') },
    { id: 'g', kind: 'image', grid: { c1: 1, c2: 6, r1: 4, r2: 6 }, image_url: 'https://axal.vc/t.png', element: 'team_grid' },
  ] }];
  const sent = shareSlides(slides, on(), gates(['sess-1']));
  assert.deepEqual(sent[0].blocks.map((b: any) => b.id), ['q', 'm']);
  assert.equal('session_uid' in sent[0].blocks[0], false, 'the session uid stays with the venture');
  assert.deepEqual(sent[0].blocks[1].binding, { grade: 'Verified', as_of: '2026-10-01' }, 'a binding still goes out as grade and date');
  assert.deepEqual(shareSlides(slides, on({ figures: false }), NO_GATES)[0].blocks, [], 'no consents, no figures: nothing of these three');
});

test('a saved block keeps its element and its gate references when they are well formed', () => {
  const url = (u: any) => (typeof u === 'string' && u.startsWith('https://') ? u : null);
  const [ok, bad] = sanitizeBlocks([
    { id: 'a', kind: 'text', grid, text: 'q', element: 'interview_quote', session_uid: 'sess-1', logo_key: 'acme' },
    { id: 'b', kind: 'text', grid: { c1: 7, c2: 12, r1: 1, r2: 3 }, text: 'q', element: 'Not An Id!', session_uid: 'x y', logo_key: '<script>' },
  ], url);
  assert.deepEqual([ok.element, ok.session_uid, ok.logo_key], ['interview_quote', 'sess-1', 'acme']);
  assert.deepEqual(['element', 'session_uid', 'logo_key'].filter((k) => k in bad), []);
});

test('the consents the Worker reads: a session with consent recorded whose interview agreed to be quoted, this venture only', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE discovery_interviews (id INTEGER PRIMARY KEY, project_id INTEGER, quote_consent INTEGER);
    CREATE TABLE interview_sessions (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, interview_id INTEGER, consent_status TEXT, consent_at TEXT);
    INSERT INTO discovery_interviews VALUES (1, 1, 1), (2, 1, 0), (3, 2, 1), (4, 1, 1);
    INSERT INTO interview_sessions VALUES
      (1, 'ok', 1, 1, 'given', '2026-10-01'),
      (2, 'no-quote', 1, 2, 'given', '2026-10-01'),
      (3, 'other-venture', 2, 3, 'given', '2026-10-01'),
      (4, 'no-consent', 1, 4, 'pending', NULL),
      (5, 'no-date', 1, 1, 'given', NULL);`);
  const g = await shareGatesFor({ DB: d1Over(db) } as any, 1);
  assert.deepEqual([...g.quote_sessions], ['ok']);
  assert.equal(g.logo_permissions.size, 0, 'no permission store yet');
  const none = await shareGatesFor({ DB: d1Over(new DatabaseSync(':memory:')) } as any, 1);
  assert.equal(none.quote_sessions.size, 0, 'no interview tables: no consent');
});
