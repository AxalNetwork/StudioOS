/**
 * D1577 (#3824, deck v2 E4) — co-editing a deck.
 *
 *   1. mergeArea: an area applies onto the server's card; any other area keeps the
 *      server's copy; an area that changed since it was read is a conflict.
 *   2. Two editors on different areas of one card never lose an edit (the route);
 *      two on the same area: the second is 409 `area_conflict` and nothing is written.
 *   3. An area save retries when another save moved the card's rev between its read and its write.
 *   4. Restoring one slide leaves the others untouched; a card the current version
 *      dropped goes back at its old place; an unknown card is 404 and an unchanged one 409.
 *   5. Presence and soft locks: a held area is refused with "Wait or ask [Name]",
 *      one member's own tabs never lock each other out, a lock lapses, cursors are throttled.
 *   6. DeckPresence fans state out from sockets' attachments, and refuses a claim on a held area.
 *   7. Without the binding both presence routes answer 503 `presence_off`; a non-member is 403 first.
 *   8. Bound (the owner approved the cost): DECK_PRESENCE in all three tables, and the read matches its contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import decks, { ensureSchema } from '../src/routes/decks.ts';
import deckDraft from '../src/routes/deck_draft.ts';
import deckCoedit, { AREA_RETRIES, PRESENCE_OFF } from '../src/routes/deck_coedit.ts';
import { AREA_TITLE, CURSOR_MIN_MS, LOCK_TTL_MS, colourOf, editorView, lockHolder, mergeArea, restoreOneCard, stable, step } from '../src/services/decks/coedit.ts';
import { DeckPresence } from '../src/durable-objects/deck-presence.ts';
import { contractErrors } from '../src/contracts/validate.ts';
import { loadSchema } from './_schema_once.mjs';

const SECRET = 'synthetic-deck-coedit-d1577-secret-'.repeat(2);
const FOUNDER = 1, OTHER = 2, P = 10, V1 = 100, V2 = 101;

const row = (id: string) => Math.min(5, Number(id.replace(/\D/g, '')) || 1);
const text = (id: string, t: string) => ({ id, kind: 'text', grid: { c1: 1, c2: 12, r1: row(id), r2: row(id) }, style: 'paragraph', text: t });
const CARD = { title: 'Traction', blocks: [text('b1', 'First area'), text('b2', 'Second area')] };

async function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: true });
  db.exec('PRAGMA foreign_keys = OFF');
  loadSchema(db);
  const v1 = [{ uid: 'c1', title: 'One (v1)' }, { uid: 'c2', title: 'Two (v1)' }, { uid: 'c3', title: 'Three (v1)' }];
  const v2 = [{ uid: 'c1', title: 'One (v2)' }, { uid: 'c3', title: 'Three (v2)' }, { uid: 'c2', title: 'Two (v2)' }];
  const q = (v: unknown) => JSON.stringify(v).replace(/'/g, "''");
  db.exec(`INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES
      (${FOUNDER}, 'founder', 'Synthetic founder', 'coedit1577@example.test', 1001, 1),
      (${OTHER}, 'founder', 'Other founder', 'other1577@example.test', 1002, 1);
    INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Coedit fixture', 1001);
    INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES
      (${V1}, ${P}, 1, '${q(v1)}', 'Coedit deck', 0, ${FOUNDER}),
      (${V2}, ${P}, 2, '${q(v2)}', 'Coedit deck', 1, ${FOUNDER});`);
  db.exec('PRAGMA foreign_keys = ON');
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  await ensureSchema(env);
  const app = new Hono<any>();
  app.route('/api/decks', deckDraft);
  app.route('/api/decks', deckCoedit);
  app.route('/api/decks', decks);
  const tokenOf = (id: number) => new SignJWT({ user_id: id, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  async function call(method: string, path: string, { as = FOUNDER as number, body, ifMatch, headers: extra = {} }: { as?: number; body?: unknown; ifMatch?: string; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${await tokenOf(as)}`, ...extra };
    if (ifMatch != null) headers['if-match'] = ifMatch;
    const res = await withThrownResponses(() => app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  }
  const area = (a: string, base: unknown, next: unknown, as = FOUNDER) =>
    call('PATCH', `/api/decks/${V2}/cards/c1/areas/${a}`, { as, body: { base, next } });
  const stored = () => JSON.parse((db.prepare('SELECT json FROM pitch_deck_cards WHERE deck_id = ? AND card_uid = ?').get(V2, 'c1') as any).json);
  const rev = () => Number((db.prepare('SELECT rev FROM pitch_deck_cards WHERE deck_id = ? AND card_uid = ?').get(V2, 'c1') as any).rev);
  const versions = () => db.prepare('SELECT id, version, slides, is_current FROM pitch_decks WHERE project_id = ? ORDER BY version').all(P).map((r: any) => ({ ...r, slides: JSON.parse(r.slides) }));
  return { db, env, call, area, stored, rev, versions };
}

test('mergeArea: one area onto the server\'s card; other areas keep the server\'s copy; a moved area is a conflict', () => {
  // Mutations checked: comparing `base` with `next` instead of the server's area, or replacing the whole card, fails here.
  const server = { title: 'Traction', blocks: [text('b1', 'First area, edited by B'), text('b2', 'Second area')] };
  const a = mergeArea(server, 'b2', text('b2', 'Second area'), text('b2', 'Second area, edited by A'));
  assert.ok(a.ok);
  assert.deepEqual(a.ok && a.card.blocks.map((b: any) => b.text), ['First area, edited by B', 'Second area, edited by A'], 'B\'s edit to b1 survives A\'s save of b2');
  assert.equal(a.ok && a.changed, true);
  const stale = mergeArea(server, 'b1', text('b1', 'First area'), text('b1', 'First area, edited by A'));
  assert.deepEqual(stale, { ok: false, code: 'area_conflict', server: text('b1', 'First area, edited by B') });
  const title = mergeArea(server, AREA_TITLE, 'Traction', 'Traction, by month');
  assert.ok(title.ok && title.card.title === 'Traction, by month' && title.card.blocks === server.blocks);
  assert.equal(mergeArea(server, AREA_TITLE, 'Old title', 'New').ok, false, 'a title read before another member changed it');
  const removed = mergeArea(server, 'b2', text('b2', 'Second area'), null);
  assert.deepEqual(removed.ok && removed.card.blocks.map((b: any) => b.id), ['b1']);
  const added = mergeArea(server, 'b3', null, text('b3', 'New area'));
  assert.deepEqual(added.ok && added.card.blocks.map((b: any) => b.id), ['b1', 'b2', 'b3']);
  assert.equal(mergeArea(server, 'b3', null, text('b3', 'Again')).ok, true);
  assert.equal(mergeArea(added.ok ? added.card : null, 'b3', null, text('b3', 'Again')).ok, false, 'two members adding the same block id');
  assert.equal(mergeArea(server, 'b2', text('b2', 'Second area'), text('b9', 'renamed')).ok, false, 'a block keeps its id');
  assert.equal(mergeArea(server, '../b1', null, null).ok, false);
  const same = mergeArea(server, 'b2', text('b2', 'Second area'), { text: 'Second area', style: 'paragraph', grid: { r2: 2, r1: 2, c2: 12, c1: 1 }, kind: 'text', id: 'b2' });
  assert.equal(same.ok && same.changed, false, 'key order is not a change (stable JSON)');
  assert.equal(stable({ b: 1, a: [1, { d: 2, c: undefined }] }), '{"a":[1,{"d":2}],"b":1}');
});

test('two editors on different areas of one card never lose an edit; the same area is refused and writes nothing', async () => {
  const f = await world();
  const first = await f.call('PATCH', `/api/decks/${V2}/cards/c1`, { body: { card: CARD, ord: 0 }, ifMatch: '0' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  // Both members read the card at rev 1.
  const a = await f.area('b1', text('b1', 'First area'), text('b1', 'First area, by A'));
  assert.deepEqual([a.status, a.body.saved, a.body.rev], [200, true, 2], JSON.stringify(a.body));
  const b = await f.area('b2', text('b2', 'Second area'), text('b2', 'Second area, by B'));
  assert.deepEqual([b.status, b.body.rev], [200, 3], 'B read rev 1, A saved since: B\'s area still lands');
  assert.deepEqual(f.stored().blocks.map((x: any) => x.text), ['First area, by A', 'Second area, by B'], 'neither edit is lost');
  const t = await f.area(AREA_TITLE, 'Traction', 'Traction by month');
  assert.equal(t.status, 200);
  assert.equal(f.stored().title, 'Traction by month');
  const before = f.rev();
  const clash = await f.area('b1', text('b1', 'First area'), text('b1', 'First area, by B'));
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, 'area_conflict');
  assert.deepEqual(clash.body.server, text('b1', 'First area, by A'), 'the server\'s copy, so the editor can merge by hand');
  assert.equal(f.rev(), before, 'nothing was written');
  assert.equal(f.stored().blocks[0].text, 'First area, by A');
  const noop = await f.area('b2', text('b2', 'Second area, by B'), text('b2', 'Second area, by B'));
  assert.deepEqual([noop.status, noop.body.saved, f.rev()], [200, false, before]);
  // A whole-card save with A9's If-Match still refuses a stale rev: area saves did not weaken it.
  const stale = await f.call('PATCH', `/api/decks/${V2}/cards/c1`, { body: { card: CARD }, ifMatch: '1' });
  assert.equal(stale.status, 409);
  const other = await f.area('b2', text('b2', 'Second area, by B'), text('b2', 'Not mine'), OTHER);
  assert.equal(other.status, 403, 'only the deck\'s writers save an area');
  const bad = await f.call('PATCH', `/api/decks/${V2}/cards/c1/areas/b1`, { body: {} });
  assert.deepEqual([bad.status, bad.body.error], [400, 'area_required']);
  const none = await f.call('PATCH', `/api/decks/${V2}/cards/c9/areas/b1`, { body: { base: null, next: text('b1', 'x') } });
  assert.deepEqual([none.status, none.body.error], [409, 'no_working_copy']);
});

test('an area save re-reads and retries when another save moved the card\'s rev between its read and its write', async () => {
  // Mutation checked: returning the first failed UPDATE as a conflict (no retry) fails here.
  const f = await world();
  await f.call('PATCH', `/api/decks/${V2}/cards/c1`, { body: { card: CARD, ord: 0 }, ifMatch: '0' });
  const real = f.env.DB;
  let raced = false;
  f.env.DB = {
    ...real,
    prepare(sql: string) {
      const stmt = real.prepare(sql);
      if (raced || !/UPDATE pitch_deck_cards SET json = \?4, rev = rev \+ 1/.test(sql)) return stmt;
      return { bind: (...args: unknown[]) => ({ run: async () => {
        raced = true;
        // Another member saves b2 first.
        await real.prepare("UPDATE pitch_deck_cards SET json = ?1, rev = rev + 1 WHERE deck_id = ?2 AND card_uid = 'c1'")
          .bind(JSON.stringify({ ...CARD, uid: 'c1', blocks: [text('b1', 'First area'), text('b2', 'Second area, by B')] }), V2).run();
        return stmt.bind(...args).run();
      } }) };
    },
  };
  const a = await f.area('b1', text('b1', 'First area'), text('b1', 'First area, by A'));
  assert.equal(raced, true);
  assert.deepEqual([a.status, a.body.rev], [200, 3], JSON.stringify(a.body));
  assert.deepEqual(f.stored().blocks.map((x: any) => x.text), ['First area, by A', 'Second area, by B']);
  assert.ok(AREA_RETRIES >= 2);
});

test('restoring one slide leaves the others untouched, as a new version', async () => {
  const f = await world();
  const r = await f.call('POST', `/api/decks/${V1}/restore-card`, { body: { card_uid: 'c2' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.restored, { card_uid: 'c2', from_version: 1, placed: 'replaced', index: 2 });
  const vs = f.versions();
  assert.deepEqual(vs.map((v: any) => [v.version, v.is_current]), [[1, 0], [2, 0], [3, 1]]);
  const [, v2, v3] = vs;
  assert.deepEqual(v3.slides.map((s: any) => [s.uid, s.title]), [['c1', 'One (v2)'], ['c3', 'Three (v2)'], ['c2', 'Two (v1)']], 'only c2 came back; order and the others are v2\'s');
  assert.deepEqual(v2.slides.map((s: any) => s.title), ['One (v2)', 'Three (v2)', 'Two (v2)'], 'the version restored from is not changed');
  const again = await f.call('POST', `/api/decks/${V1}/restore-card`, { body: { card_uid: 'c2' } });
  assert.deepEqual([again.status, again.body.error], [409, 'card_unchanged']);
  const missing = await f.call('POST', `/api/decks/${V1}/restore-card`, { body: { card_uid: 'c9' } });
  assert.deepEqual([missing.status, missing.body.error], [404, 'card_not_in_version']);
  const bad = await f.call('POST', `/api/decks/${V1}/restore-card`, { body: {} });
  assert.deepEqual([bad.status, bad.body.error], [400, 'invalid_card_uid']);
  const other = await f.call('POST', `/api/decks/${V1}/restore-card`, { as: OTHER, body: { card_uid: 'c1' } });
  assert.equal(other.status, 403);
  assert.equal(f.versions().length, 3, 'a refused restore writes no version');
});

test('restoreOneCard: a dropped card goes back at its old place; nothing else moves', () => {
  const older = [{ uid: 'a', t: 1 }, { uid: 'b', t: 1 }, { uid: 'c', t: 1 }];
  const now = [{ uid: 'a', t: 2 }, { uid: 'c', t: 2 }];
  const r = restoreOneCard(now, older, 'b');
  assert.deepEqual(r, { ok: true, slides: [{ uid: 'a', t: 2 }, { uid: 'b', t: 1 }, { uid: 'c', t: 2 }], placed: 'reinserted', index: 1 });
  const end = restoreOneCard([{ uid: 'a', t: 2 }], older, 'c');
  assert.deepEqual(end.ok && end.slides.map((s: any) => s.uid), ['a', 'c'], 'clamped to the end when the deck is now shorter');
  assert.deepEqual(restoreOneCard(now, older, 'z'), { ok: false, code: 'card_not_in_version' });
  assert.deepEqual(restoreOneCard(older, older, 'b'), { ok: false, code: 'unchanged' });
});

const ed = (userId: number, over: Partial<Editor> = {}): Editor => ({
  userId, name: `Member ${userId}`, colour: colourOf(userId), tab: `t${userId}-${over.tab ?? 'a'}`,
  card: null, area: null, areaAt: 0, cursor: null, cursorAt: 0, ...over,
});

test('soft locks: a held area is refused with "Wait or ask [Name]"; own tabs never lock out; a lock lapses', () => {
  // Mutations checked: dropping the userId check, or the TTL, fails here.
  const now = 1_000_000;
  const holder = ed(1, { card: 'c1', area: 'b1', areaAt: now - 1000 });
  const other = ed(2);
  const r = step([holder, other], other, { type: 'area', card: 'c1', area: 'b1' }, now);
  assert.equal(r.kind, 'locked');
  assert.equal(r.kind === 'locked' && r.message, 'Member 1 is editing this area. Wait or ask Member 1.');
  assert.equal(r.kind === 'locked' && r.editor.area, null, 'the refused editor holds no lock there');
  const free = step([holder, other], other, { type: 'area', card: 'c1', area: 'b2' }, now);
  assert.equal(free.kind === 'broadcast' && free.editor.area, 'b2', 'another area of the same card is free');
  const sameMember = ed(1, { tab: 'b' });
  assert.equal(step([holder, sameMember], sameMember, { type: 'area', card: 'c1', area: 'b1' }, now).kind, 'broadcast', 'one member\'s own tabs');
  assert.equal(lockHolder([holder, other], other, 'c1', 'b1', now - 1000 + LOCK_TTL_MS), null, 'lapsed');
  const kept = step([holder], holder, { type: 'edit' }, now + 5000);
  assert.equal(kept.kind === 'broadcast' && kept.editor.areaAt, now + 5000, 'an edit keeps the lock');
  const left = step([holder], holder, { type: 'area', card: 'c1', area: null }, now);
  assert.equal(left.kind === 'broadcast' && left.editor.area, null);
  assert.equal(editorView(holder, now + LOCK_TTL_MS).area, null, 'a lapsed lock is not drawn');
  assert.deepEqual(Object.keys(editorView(holder, now)).sort(), ['area', 'card', 'colour', 'cursor', 'name', 'user_id'], 'never an address or a role');
});

test('cursors: at most one frame per CURSOR_MIN_MS, clamped to the card, and junk is ignored', () => {
  const now = 50_000;
  const me = ed(3, { cursorAt: now - 50 });
  assert.equal(step([me], me, { type: 'cursor', x: 0.5, y: 0.5, card: 'c1' }, now).kind, 'ignore');
  const ok = step([me], me, { type: 'cursor', x: 1.4, y: -2, card: 'c1' }, now + CURSOR_MIN_MS);
  assert.deepEqual(ok.kind === 'broadcast' && [ok.editor.cursor, ok.editor.card], [{ x: 1, y: 0 }, 'c1']);
  assert.equal(step([me], me, { type: 'nonsense' }, now).kind, 'ignore');
  assert.equal(step([me], me, null, now).kind, 'ignore');
  assert.equal(colourOf(3), colourOf(3));
  assert.notEqual(colourOf(1), colourOf(2));
});

function fakeSocket(att: Editor) {
  const sent: any[] = [];
  let a: Editor = att;
  return {
    sent,
    get att() { return a; },
    ws: { send: (s: string) => sent.push(JSON.parse(s)), serializeAttachment: (x: Editor) => { a = x; }, deserializeAttachment: () => a, close() {} } as any,
  };
}

test('DeckPresence: state lives in the sockets\' attachments; a claim on a held area is refused and the room hears it', async () => {
  const holder = fakeSocket(ed(1, { card: 'c1', area: 'b1', areaAt: Date.now() }));
  const other = fakeSocket(ed(2));
  const sockets = [holder, other];
  const state: any = { getWebSockets: () => sockets.map((s) => s.ws) };
  const room = new DeckPresence(state, {} as any);
  await room.webSocketMessage(other.ws, JSON.stringify({ type: 'area', card: 'c1', area: 'b1' }));
  const locked = other.sent.find((m) => m.type === 'locked');
  assert.ok(locked, JSON.stringify(other.sent));
  assert.equal(locked.message, 'Member 1 is editing this area. Wait or ask Member 1.');
  assert.equal(locked.holder.colour, colourOf(1));
  await room.webSocketMessage(other.ws, JSON.stringify({ type: 'area', card: 'c1', area: 'b2' }));
  const last = holder.sent.at(-1);
  assert.equal(last.type, 'presence');
  assert.deepEqual(last.editors.map((e: any) => [e.user_id, e.area]), [[1, 'b1'], [2, 'b2']]);
  const before = holder.sent.length;
  await room.webSocketMessage(other.ws, 'x'.repeat(600));
  await room.webSocketMessage(other.ws, '{not json');
  assert.equal(holder.sent.length, before, 'oversized or malformed frames are dropped');
  await room.webSocketClose(other.ws, 1000);
  assert.deepEqual(holder.sent.at(-1).editors.map((e: any) => e.user_id), [1], 'a closed socket leaves the room and takes its lock');
});

test('without the binding, presence answers 503 presence_off; a non-member is refused first', async () => {
  const f = await world();
  const r = await f.call('GET', `/api/decks/${V2}/presence`);
  assert.deepEqual([r.status, r.body.error, r.body.message], [503, 'presence_off', PRESENCE_OFF]);
  const ws = await f.call('GET', `/api/decks/${V2}/presence/ws`, { headers: { upgrade: 'websocket' } });
  assert.deepEqual([ws.status, ws.body.error], [503, 'presence_off']);
  const plain = await f.call('GET', `/api/decks/${V2}/presence/ws`);
  assert.equal(plain.status, 426);
  const other = await f.call('GET', `/api/decks/${V2}/presence`, { as: OTHER });
  assert.equal(other.status, 403);
});

test('bound (the owner approved the cost, decision L): DECK_PRESENCE in all three tables with its migration tag', () => {
  // Mutation checked: dropping the binding or the migration from any one table fails here.
  const toml = readFileSync('wrangler.toml', 'utf8');
  for (const pre of ['', 'env.production.', 'env.preview.']) {
    assert.ok(toml.includes(`[[${pre}durable_objects.bindings]]\nname       = "DECK_PRESENCE"\nclass_name = "DeckPresence"`), `${pre || 'top-level'} binding`);
    assert.ok(toml.includes(`[[${pre}migrations]]\ntag = "v3-deck-presence"\nnew_sqlite_classes = ["DeckPresence"]`), `${pre || 'top-level'} migration`);
  }
  assert.ok(readFileSync('cloudflare-worker/src/index.ts', 'utf8').includes("export { DeckPresence } from './durable-objects/deck-presence';"));
});

test('bound: the presence read is the room\'s state, matching its contract, keyed per venture', async () => {
  const f = await world();
  const asked: string[] = [];
  const holder = fakeSocket(ed(FOUNDER, { card: 'c1', area: 'b1', areaAt: Date.now(), cursor: { x: 0.2, y: 0.4 } }));
  const room = new DeckPresence({ getWebSockets: () => [holder.ws] } as any, {} as any);
  f.env.DECK_PRESENCE = {
    idFromName: (n: string) => { asked.push(n); return n; },
    get: () => ({ fetch: (input: RequestInfo) => room.fetch(typeof input === 'string' ? new Request(input) : input) }),
  };
  const r = await f.call('GET', `/api/decks/${V1}/presence`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(asked, [`deck:${P}`], 'every version of the venture\'s deck shares one room');
  assert.deepEqual(r.body, { deck_id: V1, editors: [{ user_id: FOUNDER, name: `Member ${FOUNDER}`, colour: colourOf(FOUNDER), card: 'c1', area: 'b1', cursor: { x: 0.2, y: 0.4 } }] });
  const schema = JSON.parse(readFileSync('cloudflare-worker/src/contracts/deckPresence.schema.json', 'utf8'));
  assert.deepEqual(contractErrors(schema, r.body), []);
  assert.notDeepEqual(contractErrors(schema, { ...r.body, editors: [{ ...r.body.editors[0], email: 'x@example.test' }] }), [], 'an address is not in the contract');
  const other = await f.call('GET', `/api/decks/${V1}/presence`, { as: OTHER });
  assert.equal(other.status, 403);
});
