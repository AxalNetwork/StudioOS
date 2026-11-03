/**
 * D1588 (#3835, deck v2 F9): the deck and raise tools, through the real
 * `callTool` on the migrated schema, and through Eadwyn's routes.
 *
 *   · six tools, by these names, no chat or thread tool; reads need
 *     raise:read, writes raise:write, and every write only proposes;
 *   · EVERY WRITE TOOL RETURNS A PROPOSAL, NEVER A SAVED CHANGE: the deck
 *     version, its cards, the prospect and the sent mail are unchanged after
 *     each one, and its answer says `saved: false`;
 *   · an area is a grid block range, checked through `sanitizeBlocks`; a typed
 *     figure is refused; the card edit is the row DeckAsk's `cardEdit` lists;
 *   · a variant waits as the deck proposal and never replaces one waiting;
 *   · only the venture's own founders, never an admin;
 *   · Eadwyn's routes run the same tools in the member's own access.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/eadwyn_deck_tools_d1588.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { callTool, registeredTools } from '../src/mcp/server.ts';
import { SCOPES } from '../src/mcp/oauth.ts';
import { METERING_POLICY, OPERATION_INFO, toolOperation } from '../src/services/metering.ts';
import { DECK_PAGE } from '../src/services/decks/eadwynDeckTools.ts';
import { ASSIST_PAGE } from '../src/services/decks/assist.ts';
import { numberIn as moved } from '../src/services/decks/numbers.ts';
import { numberIn as reexported } from '../src/services/decks/newDeck.ts';
import { createJWT } from '../src/auth.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import eadwyn from '../src/routes/eadwyn.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

after(removeMigratedDatabases);
const FOUNDER = 2, ADMIN = 4, STRANGER = 5, PROJECT = 1, OTHER = 3, DECK = 50, PROSPECT = 70, THEIR_PROSPECT = 71;
const JWT_SECRET = 'synthetic-d1588-secret-0123456789abcdef';

const HEAD = { c1: 1, c2: 12, r1: 1, r2: 1 };
const BODY = { c1: 1, c2: 6, r1: 2, r2: 4 };
const SIDE = { c1: 7, c2: 12, r1: 2, r2: 4 };
const CARDS = [
  { uid: 'card-a', blocks: [
    { id: 'h1', kind: 'text', style: 'heading', grid: HEAD, text: 'Why now' },
    { id: 'p1', kind: 'text', style: 'paragraph', grid: BODY, text: 'Payments teams still reconcile by hand.' },
    { id: 'p2', kind: 'text', style: 'paragraph', grid: SIDE, text: 'Ledgers drift every close.' },
  ] },
  { uid: 'card-b', blocks: [{ id: 'h2', kind: 'text', style: 'heading', grid: HEAD, text: 'The team' }] },
];

function fixture() {
  const db = migratedDatabase();
  const user = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  user.run(FOUNDER, 'founder', 100, 'Synthetic founder', 'synthetic-2@example.invalid', 'studio');
  user.run(ADMIN, 'admin', null, 'Synthetic admin', 'synthetic-4@example.invalid', 'studio');
  user.run(STRANGER, 'founder', 200, 'Synthetic stranger', 'synthetic-5@example.invalid', 'studio');
  db.exec(`INSERT INTO projects(id, name, founder_id) VALUES (${PROJECT}, 'Synthetic venture', 100), (${OTHER}, 'Other venture', 200)`);
  db.prepare('INSERT INTO pitch_decks(id, project_id, version, title, slides, is_current) VALUES (?, ?, 1, ?, ?, 1)')
    .run(DECK, PROJECT, 'Synthetic deck', JSON.stringify(CARDS));
  db.exec(`INSERT INTO raise_prospects(id, uid, project_id, name, firm, stage) VALUES
             (${PROSPECT}, 'p-ada', ${PROJECT}, 'Synthetic Ada', 'Synthetic Fund', 'meeting'),
             (${THEIR_PROSPECT}, 'p-bo', ${OTHER}, 'Synthetic Bo', 'Other Fund', 'contacted')`);
  db.exec(`INSERT INTO raise_prospect_feedback(prospect_id, objection, answer, created_at) VALUES
             (${PROSPECT}, 'Is the market big enough?', 'We sell to every finance team that closes monthly.', '2026-10-01 09:00:00'),
             (${THEIR_PROSPECT}, 'Who else sells this?', NULL, '2026-10-02 09:00:00')`);
  db.exec(`INSERT INTO user_sessions (jti, user_id) VALUES ('jti-${FOUNDER}', ${FOUNDER}), ('jti-${STRANGER}', ${STRANGER})`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const deck = () => db.prepare('SELECT id, version, slides, is_current FROM pitch_decks ORDER BY id').all();
  const rails = () => db.prepare('SELECT uid, rail_page, rail_option, record_ref, kind, status, payload_json, created_at FROM ai_rail_proposals ORDER BY id').all() as any[];
  const proposals = () => db.prepare('SELECT * FROM pitch_deck_proposals ORDER BY id').all() as any[];
  const drafts = () => db.prepare('SELECT uid, user_id, person_ref, intent, subject, body FROM mail_drafts ORDER BY id').all() as any[];
  const records = () => JSON.stringify([deck(), db.prepare('SELECT * FROM raise_prospects ORDER BY id').all(), db.prepare('SELECT COUNT(*) AS n FROM mail_sent').get()]);
  return { db, env, deck, rails, proposals, drafts, records, close: () => db.close() };
}

const grant = (userId: number, companies: number[]) => ({
  userId, companies, clientId: 'client-1588', clientName: 'Test Assistant', redirectHost: null, redirectUri: null, grantedAt: Math.floor(Date.now() / 1000),
});
const tool = (name: string) => registeredTools().find((t) => t.name === name)!;
const body = (r: any) => JSON.parse(r.content[0].text);
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const saved = [console.warn, console.error, console.info];
  console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await f(); } finally { [console.warn, console.error, console.info] = saved; }
};
const ALL = ['raise:read', 'raise:write'];
const call = (f: any, name: string, args: Record<string, unknown>, o: { scope?: string[]; user?: number; companies?: number[] } = {}) =>
  quiet(() => callTool(f.env, grant(o.user ?? FOUNDER, o.companies ?? [PROJECT]), null, tool(name), { company: PROJECT, ...args }, o.scope ?? ALL));
const code = (r: any) => body(r).code ?? body(r).error_code ?? body(r).error;

const NAMES = ['decks.read_outline', 'decks.propose_area', 'decks.propose_variant', 'raise.prospect_brief', 'raise.qa_prep', 'raise.draft_follow_up'];
const WRITES = ['decks.propose_area', 'decks.propose_variant', 'raise.draft_follow_up'];

test('six tools by these names; reads need raise:read, writes raise:write and only propose; free, labelled; no chat or thread tool', () => {
  const mine = registeredTools().filter((t) => /^(decks|raise)\./.test(t.name));
  assert.deepEqual(mine.map((t) => t.name), NAMES);
  for (const t of mine) {
    const write = WRITES.includes(t.name);
    assert.equal(t.requiredScope, write ? 'raise:write' : 'raise:read', t.name);
    assert.equal(t.readOnly === false, write, t.name);
    // Mutation checked: drop `proposes` from one → its Eadwyn call is wrapped, not run (the route test below).
    assert.equal(t.proposes === true, write, t.name);
    assert.equal(t.company, true, t.name);
    assert.equal(METERING_POLICY.operations[toolOperation(t.name)]?.price_microusd, 0, t.name);
    assert.equal(OPERATION_INFO[toolOperation(t.name)]?.ai, false, t.name);
  }
  assert.ok(SCOPES.includes('raise:write' as any));
  assert.ok(!registeredTools().some((t) => /chat|thread|converse|message/i.test(t.name) && /^(decks|raise)\./.test(t.name)));
  assert.equal(DECK_PAGE, ASSIST_PAGE, 'card edits are filed under the deck’s own rail page');
  assert.equal(moved, reexported, 'one figure rule');
});

test('decks.read_outline: each card and its areas by grid block range, the text areas’ words', async () => {
  const f = fixture();
  try {
    const r = await call(f, 'decks.read_outline', {}, { scope: ['raise:read'] });
    assert.notEqual(r.isError, true, JSON.stringify(body(r)));
    const o = body(r);
    assert.deepEqual(o.deck, { id: DECK, version: 1, title: 'Synthetic deck' });
    assert.deepEqual(o.grid, { cols: 12, rows: 6 });
    assert.deepEqual(o.cards.map((c: any) => [c.card, c.uid, c.title]), [[1, 'card-a', 'Why now'], [2, 'card-b', 'The team']]);
    assert.deepEqual(o.cards[0].areas.map((a: any) => [a.block_id, a.kind, a.grid]), [['h1', 'text', HEAD], ['p1', 'text', BODY], ['p2', 'text', SIDE]]);
    assert.equal(o.deck_proposal_waiting, false);
  } finally { f.close(); }
});

test('decks.propose_area: one card edit DeckAsk lists, on a deck: option and record; the deck is unchanged', async () => {
  const f = fixture();
  const { cardEdit, DECK_ASK_OPTIONS } = await import('../../frontend/src/pages/raise/pitch/deckV2Model.js');
  try {
    const before = f.records();
    const r = await call(f, 'decks.propose_area', { card: 'card-a', area: BODY, text: 'Finance teams still reconcile payments by hand.' });
    assert.notEqual(r.isError, true, JSON.stringify(body(r)));
    const out = body(r);
    assert.equal(out.saved, false);
    assert.equal(f.records(), before, 'no deck version, card, prospect or mail changed');
    const [row] = f.rails();
    assert.equal(row.uid, out.proposal.uid);
    assert.deepEqual([row.rail_page, row.rail_option, row.record_ref, row.kind, row.status], [ASSIST_PAGE, 'deck:rewrite', `deck:${DECK}`, 'proposal', 'proposed']);
    assert.ok(DECK_ASK_OPTIONS.includes(row.rail_option));
    // The row DeckAsk's "Waiting for you" reads (`readEdits` → `cardEdit`).
    const edit = cardEdit({ ...row, payload: JSON.parse(row.payload_json) }, DECK);
    assert.deepEqual([edit.kind, edit.card, edit.card_uid, edit.before, edit.after],
      ['text', 0, 'card-a', 'Payments teams still reconcile by hand.', 'Finance teams still reconcile payments by hand.']);
    // By the card's number, and an action that is another deck option.
    const short = body(await call(f, 'decks.propose_area', { card: 1, area: SIDE, text: 'Ledgers drift.', action: 'shorten' }));
    assert.equal(short.proposal.option, 'deck:shorten');
  } finally { f.close(); }
});

test('decks.propose_area refuses: a figure, a range off the grid, an empty or crowded area, the same words, an unknown card', async () => {
  const f = fixture();
  try {
    const refusals: Array<[Record<string, unknown>, string]> = [
      // Mutation checked: drop the numberIn check → the figure is proposed.
      [{ card: 'card-a', area: BODY, text: 'We have 200 customers.' }, 'figure_in_text'],
      [{ card: 'card-a', area: BODY, text: 'Revenue doubled since spring.' }, 'figure_in_text'],
      // Mutation checked: skip gridOf → a range past column 12 is read.
      [{ card: 'card-a', area: { c1: 1, c2: 13, r1: 2, r2: 4 }, text: 'Words' }, 'area_invalid'],
      [{ card: 'card-a', area: { c1: 1, c2: 12, r1: 5, r2: 6 }, text: 'Words' }, 'area_empty'],
      // Mutation checked: take the first hit → the whole card's body is one area.
      [{ card: 'card-a', area: { c1: 1, c2: 12, r1: 2, r2: 4 }, text: 'Words' }, 'area_ambiguous'],
      [{ card: 'card-a', area: BODY, text: 'Payments teams still reconcile by hand.' }, 'no_change'],
      [{ card: 'card-z', area: BODY, text: 'Words' }, 'card_not_found'],
      [{ card: 9, area: BODY, text: 'Words' }, 'card_not_found'],
    ];
    for (const [args, want] of refusals) {
      const r = await call(f, 'decks.propose_area', args);
      assert.equal(r.isError, true, `${want}: ${JSON.stringify(args)}`);
      assert.equal(code(r), want, JSON.stringify(body(r)));
    }
    assert.equal(f.rails().length, 0, 'a refused proposal stores nothing');
    // raise:read alone cannot propose.
    const read = await call(f, 'decks.propose_area', { card: 'card-a', area: BODY, text: 'Words here' }, { scope: ['raise:read'] });
    assert.equal(read.isError, true);
    assert.match(JSON.stringify(body(read)), /raise:write/);
  } finally { f.close(); }
});

test('decks.propose_variant: one deck proposal with the edits and the order; never replaces one waiting; the deck is unchanged', async () => {
  const f = fixture();
  try {
    const before = f.records();
    const r = await call(f, 'decks.propose_variant', {
      edits: [{ card: 'card-a', area: HEAD, text: 'Why this is the moment' }], order: ['card-b', 'card-a'],
    });
    assert.notEqual(r.isError, true, JSON.stringify(body(r)));
    const out = body(r);
    assert.equal(out.saved, false);
    assert.equal(f.records(), before);
    const [p] = f.proposals();
    assert.equal(p.id, out.proposal.id);
    assert.equal(p.base_deck_id, DECK);
    const slides = JSON.parse(p.slides);
    assert.deepEqual(slides.map((c: any) => c.uid), ['card-b', 'card-a']);
    assert.equal(slides[1].blocks.find((b: any) => b.id === 'h1').text, 'Why this is the moment');
    assert.equal(slides[1].blocks.find((b: any) => b.id === 'p1').text, 'Payments teams still reconcile by hand.', 'other areas as they were');
    // Mutation checked: drop the waiting check → the founder's waiting proposal is replaced.
    const again = await call(f, 'decks.propose_variant', { order: ['card-a', 'card-b'], edits: [{ card: 'card-b', area: HEAD, text: 'Who builds it' }] });
    assert.equal(code(again), 'proposal_waiting');
    assert.deepEqual(f.proposals().map((x) => x.id), [p.id]);
    f.db.exec('DELETE FROM pitch_deck_proposals');
    for (const [args, want] of [
      [{ order: ['card-a'] }, 'order_invalid'],
      [{ order: ['card-a', 'card-a'] }, 'order_invalid'],
      [{ order: ['card-a', 'card-b'] }, 'nothing_proposed'],
      [{ edits: [{ card: 'card-b', area: HEAD, text: 'Team of three' }] }, 'figure_in_text'],
    ] as Array<[Record<string, unknown>, string]>) assert.equal(code(await call(f, 'decks.propose_variant', args)), want, JSON.stringify(args));
    assert.equal(f.proposals().length, 0);
  } finally { f.close(); }
});

test('raise.prospect_brief and raise.qa_prep read this venture’s records; another venture’s investor is not found', async () => {
  const f = fixture();
  try {
    const brief = body(await call(f, 'raise.prospect_brief', { prospect: PROSPECT }, { scope: ['raise:read'] }));
    assert.deepEqual([brief.prospect.id, brief.prospect.name, brief.prospect.stage], [PROSPECT, 'Synthetic Ada', 'meeting']);
    assert.ok(!JSON.stringify(brief).includes('@'), 'no email');
    // Mutation checked: read the prospect without its venture → the other venture's investor is briefed.
    assert.equal(code(await call(f, 'raise.prospect_brief', { prospect: THEIR_PROSPECT })), 'prospect_not_found');
    const qa = body(await call(f, 'raise.qa_prep', { prospect: PROSPECT }, { scope: ['raise:read'] }));
    assert.deepEqual(qa.questions.map((q: any) => [q.question, q.raised_by_them, q.answer]),
      [['Is the market big enough?', true, 'We sell to every finance team that closes monthly.']]);
    assert.equal(qa.unanswered, 0);
    assert.match(qa.basis, /No model ran/);
    assert.equal(code(await call(f, 'raise.qa_prep', { prospect: THEIR_PROSPECT })), 'prospect_not_found');
  } finally { f.close(); }
});

test('raise.draft_follow_up: a draft in Email for that investor, never sent; a figure is refused', async () => {
  const f = fixture();
  try {
    const before = f.records();
    const r = await call(f, 'raise.draft_follow_up', { prospect: PROSPECT, subject: 'Thank you for today', body: 'Thank you for the time. The deck link has the detail you asked about.' });
    const out = body(r);
    assert.deepEqual([out.saved, out.sent], [false, false]);
    assert.equal(f.records(), before, 'nothing sent, the investor unchanged');
    const [d] = f.drafts();
    assert.deepEqual([d.uid, d.user_id, d.person_ref, d.intent], [out.proposal.uid, FOUNDER, `prospect:${PROSPECT}`, 'follow_up']);
    assert.equal(code(await call(f, 'raise.draft_follow_up', { prospect: PROSPECT, subject: 'Next step', body: 'We grew 40% last quarter.' })), 'figure_in_text');
    assert.equal(code(await call(f, 'raise.draft_follow_up', { prospect: THEIR_PROSPECT, subject: 'Hi', body: 'Thank you.' })), 'prospect_not_found');
    assert.equal(f.drafts().length, 1);
  } finally { f.close(); }
});

test('every write tool returns a proposal, never a saved change', async () => {
  const f = fixture();
  try {
    const asks: Record<string, Record<string, unknown>> = {
      'decks.propose_area': { card: 'card-b', area: HEAD, text: 'Who builds it' },
      'decks.propose_variant': { order: ['card-b', 'card-a'] },
      'raise.draft_follow_up': { prospect: PROSPECT, subject: 'Following up', body: 'Thank you for the meeting.' },
    };
    assert.deepEqual(Object.keys(asks), registeredTools().filter((t) => t.readOnly === false && /^(decks|raise)\./.test(t.name)).map((t) => t.name));
    for (const [name, args] of Object.entries(asks)) {
      const before = f.records();
      const out = body(await call(f, name, args));
      assert.equal(out.saved, false, name);
      assert.ok(out.proposal && (out.proposal.uid || out.proposal.id), name);
      assert.equal(f.records(), before, `${name}: the deck, the investor and sent mail are unchanged`);
    }
  } finally { f.close(); }
});

test('only the venture’s founders: an admin with the company is refused; a company outside the grant is refused', async () => {
  const f = fixture();
  try {
    // Mutation checked: drop ownVenture → the admin reads the deck and proposes on it.
    for (const name of ['decks.read_outline', 'raise.prospect_brief']) {
      const r = await call(f, name, { prospect: PROSPECT }, { user: ADMIN });
      assert.equal(r.isError, true, name);
      assert.match(JSON.stringify(body(r)), /Only the venture’s founders/);
    }
    const out = await quiet(() => callTool(f.env, grant(FOUNDER, [PROJECT]), null, tool('decks.read_outline'), { company: OTHER }, ALL));
    assert.equal(out.isError, true);
    assert.equal(f.rails().length + f.proposals().length + f.drafts().length, 0);
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── Eadwyn's routes

const app = new Hono();
app.route('/', eadwyn);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
async function req(env: any, method: string, path: string, user: number, payload?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${await createJWT(env, user, `u${user}@example.invalid`, 'founder', undefined, `jti-${user}`)}` };
  if (payload !== undefined) headers['content-type'] = 'application/json';
  const res = await quiet(() => app.request(path, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) }, env));
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

test('Eadwyn: the six tools listed for the venture; a proposal runs as itself and answers its id; another venture is not found', async () => {
  const f = fixture();
  try {
    const list = await req(f.env, 'GET', `/deck-tools?project=${PROJECT}`, FOUNDER);
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.deepEqual(list.json.tools.map((t: any) => t.name), NAMES);
    const r = await req(f.env, 'POST', '/deck-tools/decks.propose_area', FOUNDER, { project: PROJECT, args: { card: 'card-a', area: BODY, text: 'Finance teams reconcile by hand.' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.result.outcome, 'proposal', JSON.stringify(r.json));
    const rows = f.rails();
    // Mutation checked: Eadwyn wraps it as a generic proposal → its option is deck:tools and DeckAsk never lists it.
    assert.deepEqual(rows.map((x) => [x.uid, x.rail_option]), [[r.json.result.proposal_uid, 'deck:rewrite']]);
    const read = await req(f.env, 'POST', '/deck-tools/raise.qa_prep', FOUNDER, { project: PROJECT, args: {} });
    assert.equal(read.json.result.outcome, 'data');
    assert.equal((await req(f.env, 'POST', '/deck-tools/mail_draft', FOUNDER, { project: PROJECT, args: {} })).status, 404, 'only the deck tools');
    assert.equal((await req(f.env, 'GET', `/deck-tools?project=${OTHER}`, FOUNDER)).status, 200, 'listed by scope; every call is checked');
    const theirs = await req(f.env, 'POST', '/deck-tools/decks.read_outline', FOUNDER, { project: OTHER, args: {} });
    assert.equal(theirs.json.result.outcome, 'refused');
    assert.equal((await req(f.env, 'POST', '/deck-tools/decks.read_outline', FOUNDER, { project: 999, args: {} })).status, 404);
  } finally { f.close(); }
});
