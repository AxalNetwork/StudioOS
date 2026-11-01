/**
 * D1511 (#3762, deck v2 A18) — `test:drift` checks that a swapped surface's
 * route REPLIES WITH THE SHAPE ITS ADAPTER EXPECTS, not only that it exists.
 *
 * `frontend/src/pages/raise/pitch/deckV2Adapter.js` lists in `SWAPPED` the
 * v2 surfaces whose route is on main; each such method reads its route
 * through `through(() => client.method(…))`. For each one:
 *
 *  · `cloudflare-worker/src/contracts/<schema>` holds the reply's JSON Schema,
 *    tagged with the adapter method (`x-adapter`) and its issue (`x-issue`,
 *    the `SURFACES` row's). A swap without a schema, or a schema for no swap,
 *    fails here;
 *  · the real Worker (`src/index.ts`, every router mounted as production
 *    mounts it) answers each of the route's request forms over the migrated
 *    schema, and every 200 reply validates against the schema
 *    (`_json_schema.mjs`), whose objects are closed: a field added or
 *    dropped on either side fails until the schema says so.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/contracts_d1511.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SignJWT } from 'jose';
import worker from '../src/index.ts';
import { STRUCTURES } from '../src/services/decks/structures.ts';
import { LAYOUTS } from '../src/services/decks/slideModel.ts';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { validate } from './_json_schema.mjs';

after(() => removeMigratedDatabases());
const CONTRACTS_DIR = new URL('../src/contracts/', import.meta.url);
const ADAPTER = readFileSync(new URL('../../frontend/src/pages/raise/pitch/deckV2Adapter.js', import.meta.url), 'utf8');
const JWT_SECRET = 'synthetic-d1511-contracts-not-a-real-credential';
const ORIGIN = 'https://axal.vc';
const FOUNDER = 10;

/** The adapter's swapped methods and each method's issue, read from its source (the table a test there holds to the plan). */
const SWAPPED: string[] = JSON.parse((/export const SWAPPED = Object\.freeze\((\[[^\]]*\])\)/.exec(ADAPTER)?.[1] ?? '[]').replace(/'/g, '"'));
const ISSUE_OF = (name: string) => Number(new RegExp(`^\\s*${name}: \\{ issue: (\\d+),`, 'm').exec(ADAPTER)?.[1] ?? NaN);

/**
 * Each swapped method: its schema file, and the request forms its route
 * answers (`deck` is a seeded version id). A new swap adds one row here and
 * one schema file; the first test fails until both exist.
 */
type Ask = { path: string; body?: unknown };
/** The card a remix is asked for: Hero + 3 with a block in each area, as the editor holds it. */
const HERO = STRUCTURES.find((s) => s.id === 'hero_3')!;
const REMIX_CARD = {
  structure: HERO.id, areas: HERO.areas,
  blocks: HERO.areas.map((a, i) => (i === 0
    ? { id: `b-${a.id}`, kind: 'text', style: 'heading', grid: { c1: a.c1, c2: a.c2, r1: a.r1, r2: a.r2 }, text: 'Synthetic heading' }
    : { id: `b-${a.id}`, kind: 'text', style: 'paragraph', grid: { c1: a.c1, c2: a.c2, r1: a.r1, r2: a.r2 }, text: `Synthetic words ${i}` })),
};
/**
 * `reads`, when set, is the part of the reply the adapter method hands on (its schema's `x-reads`):
 * `consistency` answers `deckCheckApi.read(…).consistency`, a part of the check's reply.
 */
const CONTRACTS: Record<string, { schema: string; reads?: string; requests: (deck: number) => Ask[] }> = {
  consistency: { schema: 'deckConsistency.schema.json', reads: 'consistency', requests: (d) => [{ path: `/api/decks/${d}/check` }] },
  grid: { schema: 'deckGrid.schema.json', requests: (d) => [`/api/decks/${d}/grid`, `/api/decks/${d}/grid?aspect=16:9`, `/api/decks/${d}/grid?aspect=4:3`].map((path) => ({ path })) },
  stagePlan: { schema: 'deckStagePlan.schema.json', requests: (d) => [{ path: `/api/decks/${d}/stage-plan` }, { path: `/api/decks/${d}/stage-plan?stage=seed&investor_type=angel` }] },
  remix: { schema: 'deckRemix.schema.json', requests: (d) => [{ path: `/api/decks/${d}/remix`, body: { card: REMIX_CARD } }, { path: `/api/decks/${d}/remix`, body: { card: REMIX_CARD, remove: 'b-a2' } }] },
  elementModels: { schema: 'deckElementModels.schema.json', requests: (d) => [{ path: `/api/decks/${d}/element-models` }] },
  investorLinks: { schema: 'deckInvestorLinks.schema.json', requests: (d) => [{ path: `/api/decks/${d}/investor-links` }] },
  // Each deck's third seeded link (id 10·d + 3) is withdrawn; a second press answers the same row.
  withdrawInvestorLink: { schema: 'deckWithdrawInvestorLink.schema.json', requests: (d) => [1, 2].map(() => ({ path: `/api/decks/${d}/investor-links/${10 * d + 3}/withdraw`, body: {} })) },
};
const schemaOf = (file: string) => JSON.parse(readFileSync(new URL(file, CONTRACTS_DIR), 'utf8'));
/** The seeded deck versions every request form is asked on. */
const DECKS = [1, 2, 3, 4];

function world() {
  const db = migratedDatabase();
  db.prepare("INSERT INTO users (id, role, name, email, is_active, founder_id, subscription_tier) VALUES (?, 'founder', 'Synthetic Founder', 'synthetic-10@example.invalid', 1, 1001, 'studio')").run(FOUNDER);
  db.prepare("INSERT INTO projects (id, name, founder_id) VALUES (1, 'Synthetic venture', 1001)").run();
  const deck = db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current, theme_json) VALUES (?, 1, ?, ?, ?, ?, ?)');
  // A deck saved before v2 (areas derived from blocks), every structure at 16:9, and a deck with no card at 4:3.
  deck.run(1, 1, 'Pre-v2', JSON.stringify(LAYOUTS.map((l) => ({ layout: l.id, blocks: l.blocks }))), 0, null);
  deck.run(2, 2, 'Every structure', JSON.stringify(STRUCTURES.map((s) => ({
    structure: s.id, areas: s.areas,
    blocks: s.areas.map((a) => ({ id: `b-${a.id}`, kind: 'text', style: 'paragraph', grid: { c1: a.c1, c2: a.c2, r1: a.r1, r2: a.r2 }, text: `${s.label} ${a.id}: ${'words that a narrower cell cannot hold '.repeat(20)}`.trim() })),
  }))), 0, JSON.stringify({ kind: 'neutral_dark' }));
  deck.run(3, 3, 'Empty', '[]', 0, JSON.stringify({ kind: 'brand', aspect: '4:3' }));
  // A deck whose figures disagree (MRR stated twice, two values), so the consistency reply carries a finding.
  const mrr = (value: string) => ({ layout: 'metric_tiles', blocks: [{ id: 'm1', kind: 'metric', grid: { c1: 1, c2: 4, r1: 2, r2: 4 }, label: 'MRR', value, binding: { source_key: 'grow.mrr', grade: 'Stated' } }] });
  deck.run(4, 4, 'Disagreeing figures', JSON.stringify([mrr('$15,100'), mrr('$21,000')]), 1, null);
  // Investor links on every deck: a prospect's with an accepted NDA and views; a named investor's on a
  // variant, with no expiry and no cap; and one with a cap, to be withdrawn (D1565's three row shapes).
  // A deck pick for one element, so the element-models reply carries a pick and a non-default source.
  db.prepare("INSERT INTO deck_model_picks (scope, scope_id, key, model, set_by) VALUES ('deck', '1', 'title', '@cf/mistralai/mistral-small-3.1-24b-instruct', ?)").run(FOUNDER);
  db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, firm) VALUES (1, 'prospect-1', 1, 'Synthetic Investor', 'Synthetic Fund')").run();
  const link = db.prepare(`INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at, view_limit, view_count, prospect_id, investor_label, nda_required, variant_id, watermark_text, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const d of DECKS) {
    db.prepare("INSERT INTO deck_variants (id, uid, deck_id, project_id, name, created_by) VALUES (?, ?, ?, 1, 'Synthetic variant', ?)").run(d, `variant-${d}`, d, FOUNDER);
    link.run(10 * d + 1, d, `hash-${d}-1`, '2026-12-31 00:00:00', 5, 2, 1, null, 1, null, 'Synthetic Investor', FOUNDER);
    link.run(10 * d + 2, d, `hash-${d}-2`, '9999-12-31 00:00:00', null, 0, null, 'Synthetic angel', 0, d, null, FOUNDER);
    link.run(10 * d + 3, d, `hash-${d}-3`, '2026-12-31 00:00:00', 1, 1, null, 'Synthetic withdrawn', 0, null, null, FOUNDER);
    db.prepare("INSERT INTO deck_share_views (share_token_id, deck_id, read_seconds, created_at) VALUES (?, ?, 42, '2026-10-02 10:00:00')").run(10 * d + 1, d);
    db.prepare("INSERT INTO deck_share_conversions (share_token_id, deck_id, type, created_at) VALUES (?, ?, 'nda_signed', '2026-10-02 10:01:00')").run(10 * d + 1, d);
  }
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: memKV(), TOKENS: memKV(), OAUTH_KV: memKV() };
  return { db, env };
}
const ctx: any = { waitUntil() {}, passThroughOnException() {} };
async function get(env: any, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const init: RequestInit = body === undefined
    ? { headers: { Authorization: `Bearer ${jwt}` } }
    : { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('every swapped adapter method has a contract schema tagged with its method and issue, and every schema is a swapped method\'s', () => {
  assert.ok(SWAPPED.length >= 1, 'SWAPPED is read from deckV2Adapter.js');
  assert.deepEqual(Object.keys(CONTRACTS).sort(), [...SWAPPED].sort(), 'one contract per swapped method');
  const files = readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith('.schema.json')).sort();
  assert.deepEqual(files, Object.values(CONTRACTS).map((c) => c.schema).sort(), 'no schema without a swapped method');
  for (const name of SWAPPED) {
    const schema = schemaOf(CONTRACTS[name].schema);
    assert.equal(schema['x-adapter'], name, `${name}: x-adapter`);
    assert.equal(schema['x-issue'], ISSUE_OF(name), `${name}: x-issue is its SURFACES row's issue`);
    assert.match(schema['x-route'], /^(GET|POST|PUT|PATCH|DELETE) \/api\//, `${name}: x-route`);
    assert.equal(schema['x-reads'], CONTRACTS[name].reads, `${name}: x-reads names the part of the reply the method reads`);
  }
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('the real Worker\'s replies match each schema, for every request form and every seeded deck', async () => {
  const { db, env } = world();
  try {
    let checked = 0;
    let expected = 0;
    for (const name of SWAPPED) {
      const schema = schemaOf(CONTRACTS[name].schema);
      const reads = CONTRACTS[name].reads;
      for (const deck of DECKS) {
        const asks = CONTRACTS[name].requests(deck);
        expected += asks.length;
        for (const { path, body } of asks) {
          const r = await get(env, path, body);
          assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`);
          if (reads) assert.ok(reads in r.body, `${path} carries ${reads}`);
          assert.deepEqual(validate(schema, reads ? r.body[reads] : r.body), [], `${name} ${path}`);
          checked += 1;
        }
      }
    }
    assert.ok(expected >= DECKS.length * SWAPPED.length, 'every swapped method is asked on every seeded deck');
    assert.equal(checked, expected);
    const check = (await get(env, '/api/decks/4/check')).body.consistency;
    assert.deepEqual(check.findings.map((f: any) => [f.rule, f.cards]), [['one_value', [1, 2]]], 'a finding validates too');
    const remix = await get(env, '/api/decks/2/remix', { card: REMIX_CARD });
    assert.ok(remix.body.options.length >= 1, 'the remix offers layouts, and each validated');
    const title = (await get(env, '/api/decks/1/element-models')).body.elements.find((e: any) => e.element === 'title');
    assert.deepEqual([title.pick, title.resolved.source], ['@cf/mistralai/mistral-small-3.1-24b-instruct', 'deck_element'], 'a deck pick validates too');
    const links = (await get(env, '/api/decks/2/investor-links')).body.links;
    assert.deepEqual(links.map((l: any) => [l.id, l.status, l.nda.state]).sort(), [[21, 'live', 'accepted'], [22, 'live', 'not_required'], [23, 'withdrawn', 'not_required']],
      'the three row shapes, the withdrawn one included, each validated');
    // The forms differ where the schema says they may: ?aspect= adds the reflow, which here moves blocks.
    const plain = await get(env, '/api/decks/2/grid');
    const switched = await get(env, '/api/decks/2/grid?aspect=4:3');
    assert.equal('reflow' in plain.body, false);
    assert.equal(switched.body.reflow.to, '4:3');
    assert.ok(switched.body.reflow.count > 0, 'a reflow that moved blocks validates too');
    assert.equal((await get(env, '/api/decks/3/grid')).body.aspect, '4:3', 'a 4:3 deck validates too');
  } finally { db.close(); }
});

test('the two investor-link schemas hold one definition of a link', () => {
  assert.deepEqual(schemaOf('deckWithdrawInvestorLink.schema.json').$defs.link, schemaOf('deckInvestorLinks.schema.json').$defs.link);
});

test('a reply that drifts fails its schema: a dropped field, an added field, a wrong type or a half cell', async () => {
  const { db, env } = world();
  try {
    const schema = schemaOf(CONTRACTS.grid.schema);
    const ok = (await get(env, '/api/decks/2/grid?aspect=4:3')).body;
    const drift = (f: (x: any) => void) => { const x = structuredClone(ok); f(x); return validate(schema, x); };
    assert.match(drift((x) => { delete x.cards[0].areas[0].box; }).join('\n'), /cards\[0\]\.areas\[0\]: missing required "box"/);
    assert.match(drift((x) => { x.cards[0].layout = 'title'; }).join('\n'), /cards\[0\]: unexpected property "layout"/);
    assert.match(drift((x) => { x.aspect = '1:1'; }).join('\n'), /\$\.aspect: "1:1" is not one of/);
    assert.match(drift((x) => { x.structures[0].areas[0].c2 = 6.5; }).join('\n'), /structures\[0\]\.areas\[0\]\.c2: expected integer/);
    assert.match(drift((x) => { x.structures.pop(); }).join('\n'), /16 items, fewer than 17/);
    assert.match(drift((x) => { x.reflow.moved[0].kind = 'hidden'; }).join('\n'), /reflow\.moved\[0\]\.kind/);
    // The stage plan and the remix drift the same way.
    const plan = (await get(env, '/api/decks/2/stage-plan')).body;
    const planSchema = schemaOf(CONTRACTS.stagePlan.schema);
    const planDrift = (f: (x: any) => void) => { const x = structuredClone(plan); f(x); return validate(planSchema, x).join('\n'); };
    assert.match(planDrift((x) => { x.order[0].proof = 'maybe'; }), /order\[0\]\.proof/);
    assert.match(planDrift((x) => { delete x.objections; }), /missing required "objections"/);
    assert.match(planDrift((x) => { x.stage = 'series_c'; }), /\$\.stage/);
    const remix = (await get(env, '/api/decks/2/remix', { card: REMIX_CARD })).body;
    const remixSchema = schemaOf(CONTRACTS.remix.schema);
    const remixDrift = (f: (x: any) => void) => { const x = structuredClone(remix); f(x); return validate(remixSchema, x).join('\n'); };
    assert.match(remixDrift((x) => { delete x.options[0].line; }), /options\[0\]: missing required "line"/);
    assert.match(remixDrift((x) => { x.options[0].card.blocks[0].grid.c2 = 13; }), /grid\.c2: 13 > maximum 12/);
    assert.match(remixDrift((x) => { x.layouts = x.options; }), /unexpected property "layouts"/);
    const listed = (await get(env, '/api/decks/2/investor-links')).body;
    const linksSchema = schemaOf(CONTRACTS.investorLinks.schema);
    const linkDrift = (f: (x: any) => void) => { const x = structuredClone(listed); f(x); return validate(linksSchema, x).join('\n'); };
    assert.match(linkDrift((x) => { x.links[0].status = 'paused'; }), /links\[0\]\.status/);
    assert.match(linkDrift((x) => { x.links[0].token = 'raw'; }), /links\[0\]: unexpected property "token"/, 'a raw token in a row fails the contract');
  } finally { db.close(); }
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('the validator: each keyword it supports refuses what it should, and a keyword it does not know throws', () => {
  const s = {
    type: 'object', required: ['a'], additionalProperties: false, $defs: { n: { type: 'integer', minimum: 1, maximum: 3 } },
    properties: { a: { $ref: '#/$defs/n' }, b: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', pattern: '^x', minLength: 2, maxLength: 3 } }, c: { anyOf: [{ const: 1 }, { const: 'one' }] }, d: { oneOf: [{ type: 'number' }, { type: 'integer' }] }, e: { exclusiveMinimum: 0 }, f: { type: ['string', 'null'] }, g: { allOf: [{ type: 'number' }, { maximum: 2 }] }, h: { enum: ['p', 'q'] } },
  };
  assert.deepEqual(validate(s, { a: 2, b: ['xy'], c: 'one', d: 1.5, e: 1, f: null, g: 2, h: 'p' }), []);
  const bad = validate(s, { a: 4, b: ['y', 'xyzz', 'xa'], c: 2, d: 1, e: 0, f: 3, g: 5, h: 'r', z: 1 });
  for (const want of ['$.a: 4 > maximum 3', '$.b: 3 items, more than 2', '$.b[0]: "y" does not match ^x', '$.b[0]: shorter than 2', '$.b[1]: longer than 3', '$.c: matches none of anyOf', '$.d: matches 2 of oneOf, not exactly 1', '$.e: 0 ≤ exclusiveMinimum 0', '$.f: expected string or null, got number', '$.g: 5 > maximum 2', '$.h: "r" is not one of ["p","q"]', '$: unexpected property "z"']) {
    assert.ok(bad.includes(want), `${want} in ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(validate(s, {}), ['$: missing required "a"']);
  assert.deepEqual(validate({ type: 'integer' }, 1.5), ['$: expected integer, got number']);
  assert.throws(() => validate({ uniqueItems: true }, []), /unsupported keyword "uniqueItems"/);
  assert.throws(() => validate({ $ref: '#/$defs/missing' }, 1), /unresolvable \$ref/);
});
