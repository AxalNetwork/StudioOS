/**
 * D1563 (#3810, deck v2 D2) — Start from › Import a document.
 *
 *   1. a 15-slide .pptx imports with ≥ 90% of its text editable and placed on
 *      whole cells, through D11's shared parser; a placeholder takes its
 *      layout's box; an off-grid box moves to the nearer lines; words that
 *      cannot be placed go to the card's notes, never lost;
 *   2. a DOCX becomes an outline and then a themed 12-card deck through the
 *      existing build, inside the p50 ≤ 60 s budget (here with a stubbed model);
 *   3. paste maps sections to catalogue cards, keeps the document's order, pads
 *      to the standard twelve and leaves out every line that names a number;
 *   4. refusals: the wrong file, an unreadable deck, an empty paste, a reader
 *      who may not write, the plan gate and HQ's `deck:pptx_import` switch.
 *
 * Every venture, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_imports_d1563.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckImports, { fileKind } from '../src/routes/deck_imports.ts';
import deckNew from '../src/routes/deck_new.ts';
import decks, { sanitizeSlides } from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { buildZip } from '../src/services/decks/pptx.ts';
import { readPptxSlides, layoutOfRels, paragraphsOf } from '../src/services/decks/pptxTemplate.ts';
import { cardsOfSlides } from '../src/services/decks/pptxCards.ts';
import { documentSections, outlineFromDocument } from '../src/services/decks/documentOutline.ts';
import { numberIn, standardOutline } from '../src/services/decks/newDeck.ts';
import { LAYOUT_IDS } from '../src/services/decks/slideModel.ts';
import { boxOf, CELL, FRAME } from '../src/services/decks/designSystem.ts';
import { isFramed } from '../src/services/ai/untrusted.ts';
import { contractErrors } from '../src/contracts/validate.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { loadSchema } from './_schema_once.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONTRACT = JSON.parse(readFileSync(resolve(ROOT, 'cloudflare-worker/src/contracts/deckDocumentImport.schema.json'), 'utf8'));
const enc = new TextEncoder();

// ── a deck, written here: stored zip parts, EMU on a 16:9 slide ──
const EMU = 12192000 / 1920;
const g = (c1: number, c2: number, r1: number, r2: number) => ({ c1, c2, r1, r2 });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const paras = (lines: string[]) => `<p:txBody><a:bodyPr/>${lines.map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`).join('')}</p:txBody>`;
const xfrm = (x: number, y: number, w: number, h: number) => `<a:xfrm><a:off x="${Math.round(x * EMU)}" y="${Math.round(y * EMU)}"/><a:ext cx="${Math.round(w * EMU)}" cy="${Math.round(h * EMU)}"/></a:xfrm>`;
/** A placeholder; with no box it inherits its layout's. */
const ph = (type: string, lines: string[], at?: { x: number; y: number; w: number; h: number }, idx?: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="p"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"${idx ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr>${at ? xfrm(at.x, at.y, at.w, at.h) : ''}</p:spPr>${paras(lines)}</p:sp>`;
/** A text box the slide draws itself. */
const tb = (lines: string[], x: number, y: number, w: number, h: number) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="3" name="t"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, w, h)}</p:spPr>${paras(lines)}</p:sp>`;
const on = (cell: { c1: number; c2: number; r1: number; r2: number }) => boxOf(cell);
const slideXml = (shapes: string) => `<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:nvGrpSpPr/>${shapes}</p:spTree></p:cSld></p:sld>`;
const rels = (layout: number) => `<?xml version="1.0"?><Relationships xmlns="r"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${layout}.xml"/></Relationships>`;
const pitch = CELL.width + FRAME.gutter;

const SENT = (topic: string) => `The ${topic} is told here in a full sentence the founder wrote for this slide.`;
/** Fifteen slides: on the grid, inheriting their layout's boxes, off the grid, and one that cannot hold all its words. */
const SLIDES: Array<{ layout: number; xml: string }> = [
  { layout: 1, xml: ph('ctrTitle', ['Northwind Labs'], on(g(1, 12, 2, 3))) + ph('subTitle', ['Follow-ups booked before the patient leaves'], on(g(1, 12, 4, 4))) },
  ...['problem', 'solution', 'product'].map((t) => ({ layout: 2, xml: ph('title', [`The ${t}`], on(g(1, 12, 1, 1))) + ph('body', [SENT(t), `A second line about the ${t}.`], on(g(1, 12, 2, 6)), '1') })),
  // Five slides whose placeholders carry no box: each takes its layout's (by index, then by type).
  ...['market', 'customers', 'pricing', 'go-to-market', 'competition'].map((t) => ({ layout: 2, xml: ph('title', [`The ${t}`]) + ph('body', [SENT(t), `More about the ${t}, as written.`], undefined, '1') })),
  // Four slides drawn a little off the lines (half a pitch): each box moves to the nearer lines.
  ...['team', 'advisors', 'roadmap', 'round'].map((t) => ({ layout: 2, xml: ph('title', [`The ${t}`], on(g(1, 12, 1, 1))) + tb([SENT(t)], 112 + 0.5 * pitch, 260, 900, 600) + tb([`Notes on the ${t}.`], 1180, 260, 600, 600) })),
  // One slide whose body box reaches over its title (nudged below it), a box over that body (its words join it)
  // and one over the title (to the notes).
  { layout: 2, xml: ph('title', ['Use of funds'], on(g(1, 12, 1, 1))) + tb([SENT('use of funds')], 112, 96, 1696, 884) + tb(['Joins the body'], 112, 240, 1696, 740) + tb(['Overlay'], 112, 96, 1696, 120) },
  // A footer and slide number are not content and are not counted.
  { layout: 2, xml: ph('title', ['Thank you'], on(g(1, 12, 1, 1))) + ph('body', [SENT('close')], on(g(1, 12, 2, 6))) + ph('ftr', ['Confidential'], on(g(1, 4, 6, 6))) + ph('sldNum', ['15'], on(g(11, 12, 6, 6))) },
];
assert.equal(SLIDES.length, 15);

function deck(slides = SLIDES) {
  const layout = (name: string, shapes: string) => `<?xml version="1.0"?><p:sldLayout xmlns:a="a" xmlns:p="p"><p:cSld name="${name}"><p:spTree><p:nvGrpSpPr/>${shapes}</p:spTree></p:cSld></p:sldLayout>`;
  const box = (type: string, cell: any, idx?: string) => { const r = on(cell); return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"${idx ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(r.x, r.y, r.w, r.h)}</p:spPr></p:sp>`; };
  return buildZip([
    { name: '[Content_Types].xml', data: enc.encode('<Types/>') },
    { name: 'ppt/presentation.xml', data: enc.encode('<p:presentation xmlns:p="p"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>') },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: enc.encode(`<p:sldMaster xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${box('title', g(1, 12, 1, 1))}${box('body', g(1, 12, 2, 6))}</p:spTree></p:cSld></p:sldMaster>`) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: enc.encode(layout('Title', box('ctrTitle', g(1, 12, 2, 3)) + box('subTitle', g(1, 12, 4, 4)))) },
    { name: 'ppt/slideLayouts/slideLayout2.xml', data: enc.encode(layout('Title and content', box('title', g(1, 12, 1, 1)) + box('body', g(1, 8, 2, 6), '1'))) },
    ...slides.flatMap((s, i) => [
      { name: `ppt/slides/slide${i + 1}.xml`, data: enc.encode(slideXml(s.xml)) },
      { name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: enc.encode(rels(s.layout)) },
    ]),
  ]);
}

test('1. a 15-slide .pptx imports with ≥ 90% of its text editable and placed on whole cells', async () => {
  // Mutation checked: the nearest-lines fallback removed (areaOn's `nearest`) → the four off-grid slides lose
  // their text boxes and the share falls to 0.77; the layout inheritance removed → the five slides with no
  // boxes lose every block and the share falls to 0.61; the nudge (clearOf) removed → the body that reaches over the
  // title goes to the notes; the merge removed → "Joins the body" goes to the notes and the merged count fails.
  const read = await readPptxSlides(deck());
  assert.equal(read.slides.length, 15);
  const { cards, counts } = cardsOfSlides(read);
  assert.equal(counts.slides, 15);
  assert.equal(counts.cards, 15);
  assert.ok(counts.placed_share != null && counts.placed_share >= 0.9, `placed share ${counts.placed_share}`);
  assert.equal(counts.not_placed, 1, 'only the overlay could not be placed');
  assert.ok(counts.moved >= 4, 'the off-grid boxes moved to the nearer lines');
  // Every block is an editable text block on whole cells, and none shares a cell with another: the slide model keeps them all.
  const kept = sanitizeSlides(cards);
  cards.forEach((card, i) => {
    assert.ok(card.blocks.length > 0, `card ${i + 1} holds blocks`);
    assert.equal(kept[i].blocks.length, card.blocks.length, `card ${i + 1}: the slide model keeps every block`);
    for (const b of kept[i].blocks) {
      assert.equal(b.kind, 'text');
      assert.ok(b.grid.c1 >= 1 && b.grid.c2 <= 12 && b.grid.r1 >= 1 && b.grid.r2 <= 6 && b.grid.c1 <= b.grid.c2 && b.grid.r1 <= b.grid.r2);
    }
  });
  // The title placeholder is the card's title and its heading; the body keeps its lines as a list.
  assert.equal(cards[1].title, 'The problem');
  assert.deepEqual(cards[1].blocks.map((b: any) => [b.style, b.grid]), [['heading', g(1, 12, 1, 1)], ['list', g(1, 12, 2, 6)]]);
  // An inherited placeholder takes its layout's box (by index): the body is columns 1–8, as the layout draws it.
  assert.deepEqual(cards[4].blocks.map((b: any) => [b.text.split('\n')[0], b.grid]), [['The market', g(1, 12, 1, 1)], [SENT('market'), g(1, 8, 2, 6)]]);
  // Words that could not be placed are in the notes, never lost; the footer and slide number are left out.
  assert.match(cards[13].notes, /Overlay/);
  assert.deepEqual(cards[13].blocks.map((b: any) => [b.style, b.text, b.grid]), [['heading', 'Use of funds', g(1, 12, 1, 1)], ['list', `${SENT('use of funds')}\nJoins the body`, g(1, 12, 2, 6)]]);
  assert.equal(counts.merged, 1);
  assert.ok(!JSON.stringify(cards[14]).includes('Confidential') && !cards[14].blocks.some((b: any) => b.text === '15'));
});

test('1a. a real deck from attached_assets: its many small text boxes land on whole cells', async () => {
  // Mutation checked: a thin box no longer collapsing to the one cell it starts in → the share falls to 0.6.
  const { counts } = cardsOfSlides(await readPptxSlides(new Uint8Array(readFileSync(resolve(ROOT, 'attached_assets/Axal_VC_Pitch_Deck_1786037617849.pptx')))));
  assert.ok(counts.cards > 0 && counts.placed_share != null && counts.placed_share >= 0.9, `placed share ${counts.placed_share}`);
});

test('1b. the shared parser: paragraphs, entities and the layout a slide names', () => {
  assert.deepEqual(paragraphsOf('<a:p><a:r><a:t>Fish &amp; chips</a:t></a:r><a:br/><a:r><a:t>daily</a:t></a:r></a:p><a:p/><a:p><a:r><a:t> Two </a:t></a:r></a:p>'), ['Fish & chips daily', 'Two']);
  assert.equal(layoutOfRels(rels(7)), 'ppt/slideLayouts/slideLayout7.xml');
  assert.equal(layoutOfRels('<Relationships><Relationship Type="x/image" Target="../media/a.png"/></Relationships>'), null);
});

test('3. a document as an outline: sections to cards in its own order, padded to twelve, no number kept', () => {
  // Mutation checked: the heading's number check removed → "Raising 2M" stays a title; the padding removed → 5 rows, not 12;
  // whole-word matching replaced by a substring test → "task" reads as the round's "ask" and the order fails.
  const md = [
    '# Northwind Labs', 'Northwind books follow-ups before the patient leaves.',
    '## Why now', 'Clinics moved their calendars online, so booking can happen at the desk.',
    '## The problem', 'Clinics lose patients between visits because nobody calls them back. Front desks spend 30% of the day on the phone.',
    '## Our team', 'Founders who ran clinic software for years.',
    '## Raising 2M', 'We are seeking a seed round to grow the sales team.',
    '## A task list', 'Things the desk does by hand.',
  ].join('\n\n');
  const doc = outlineFromDocument(md);
  assert.deepEqual(doc.rows.map((r) => r.card), ['title', 'why_now', 'problem', 'solution', 'traction', 'validation', 'product', 'market', 'unit_economics', 'team', 'round', 'use_of_funds']);
  assert.equal(doc.rows.length, 12);
  assert.equal(doc.rows[0].title, 'Northwind Labs');
  assert.equal(doc.rows[2].message, 'Clinics lose patients between visits because nobody calls them back.');
  const round = doc.rows.find((r) => r.card === 'round')!;
  assert.equal(round.title, 'The round', 'a heading that names a number gives way to the catalogue’s words');
  assert.equal(round.message, 'We are seeking a seed round to grow the sales team.');
  for (const r of doc.rows) assert.equal(numberIn(`${r.title} ${r.purpose} ${r.message ?? ''}`), null, `${r.card} names no number`);
  assert.deepEqual(doc.counts, { sections: 6, matched: 5, unmatched: 1, padded: 7, figures_left_out: 1 });
  // Pasted text with no markdown: a short line is the heading of the paragraph after it.
  assert.deepEqual(documentSections('Northwind Labs\n\nProblem\n\nClinics lose patients.\n\nTeam\n\nTwo founders.'), ['Northwind Labs', 'Problem\nClinics lose patients.', 'Team\nTwo founders.']);
  // A long document never makes more cards than the catalogue holds, each once.
  const all = outlineFromDocument(['problem', 'solution', 'market', 'team', 'competition', 'roadmap', 'cap table', 'use of funds'].map((h) => `## ${h}\n\nWords about the ${h}.`).join('\n\n'));
  assert.equal(new Set(all.rows.map((r) => r.card)).size, all.rows.length);
  assert.ok(all.rows.length > 12 && all.rows.length <= 16);
});

// ── the routes ──

const scratch = mkdtempSync(join(tmpdir(), 'deck-imports-1563-'));
const seedPath = join(scratch, 'schema.sqlite');
const seed = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
loadSchema(seed); seed.close();
after(() => rmSync(scratch, { recursive: true, force: true }));
const JWT_SECRET = 'synthetic-1563-only-not-a-real-credential'.repeat(2);
let n = 0;

const DOCX_MARKDOWN = [
  '# Northwind Labs', 'Northwind books follow-ups before the patient leaves.',
  '## The problem', 'Clinics lose patients between visits because nobody calls them back.',
  '## The solution', 'An assistant at the front desk books the next visit in the room.',
  '## Traction', 'Clinics in the pilot kept using it after the trial ended.',
  '## The team', 'Founders who ran clinic software for years.',
].join('\n\n');

async function fixture() {
  __resetForTest();
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid, tier] of [[1, 'admin', null, 'studio'], [2, 'founder', 100, 'studio'], [3, 'founder', 300, 'free'], [4, 'founder', 400, 'studio']] as const) {
    insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, tier);
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Synthetic free venture',300)");
  db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,5000000)').run();
  for (const key of ['founder:free', 'founder:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,1)').run(key);
  const prompts: string[] = [];
  const converted: string[] = [];
  const AI = withGuard({
    run: async (_model: string, input: any) => {
      const prompt = (input?.messages || []).map((m: any) => (typeof m?.content === 'string' ? m.content : '')).join('\n');
      prompts.push(prompt);
      return { response: JSON.stringify({ cards: [] }), usage: { prompt_tokens: 60, completion_tokens: 40 } };
    },
    toMarkdown: async (docs: any[]) => docs.map((d) => { converted.push(String(d.blob?.type || '')); return { name: d.name, data: DOCX_MARKDOWN, tokens: 10 }; }),
  });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckImports).route('/api/decks', deckNew).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  return { db, env, app, prompts, converted, close: () => { globalThis.fetch = real; db.close(); } };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const form = body instanceof FormData;
  const res = await f.app.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, ...(form ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
  }, f.env);
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const upload = (bytes: Uint8Array, name: string, type = 'application/octet-stream', extra: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.append('file', new File([bytes], name, { type }));
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
};

test('1c. the .pptx route stores the cards as the venture’s proposal, and Accept all keeps every one', async () => {
  // Mutation checked: the proposal written with the outline path's empty slides → the 15-card count fails.
  const f = await fixture();
  try {
    const r = await call(f, 2, 'POST', '/api/decks/imports?project_id=1', upload(deck(), 'Northwind.pptx'));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.kind, 'cards');
    assert.deepEqual(contractErrors(CONTRACT, r.body), [], 'the reply matches the importDocument contract (D1511)');
    assert.equal(r.body.proposal.slides.length, 15);
    assert.ok(r.body.counts.placed_share >= 0.9);
    assert.equal(f.prompts.length, 0, 'a .pptx runs no model');
    const kept = await call(f, 2, 'POST', `/api/decks/proposals/${r.body.proposal.id}/keep-slides`, { all: true, save: true, base_hash: r.body.proposal_hash });
    assert.equal(kept.status, 200);
    assert.equal(kept.body.deck.slides.length, 15);
    assert.equal(kept.body.deck.slides[1].blocks[0].text, 'The problem');
  } finally { f.close(); }
});

test('2. a DOCX becomes a themed 12-card deck through the existing build, within p50 ≤ 60 s', async () => {
  // Mutation checked: the build message's untrusted frame removed (newDeck.buildMessage) → isFramed fails;
  // outlineFromDocument's padding removed → the deck has 5 cards, not 12.
  const f = await fixture();
  try {
    const times: number[] = [];
    let built: any = null;
    for (let i = 0; i < 3; i += 1) {
      const t0 = performance.now();
      const r = await call(f, 2, 'POST', '/api/decks/imports?project_id=1', upload(enc.encode('PK synthetic docx'), 'Northwind plan.docx'));
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.kind, 'outline');
      assert.equal(r.body.source, 'docx');
      assert.deepEqual(contractErrors(CONTRACT, r.body), [], 'the reply matches the importDocument contract (D1511)');
      assert.equal(r.body.outline.rows.length, 12);
      const b = await call(f, 2, 'POST', '/api/decks/generate', { project_id: 1, proposal_id: r.body.proposal.id, base_hash: r.body.proposal_hash });
      assert.equal(b.status, 201, JSON.stringify(b.body));
      times.push(performance.now() - t0);
      built = b.body;
    }
    assert.ok(f.converted.every((t) => t === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'the router converts it as a DOCX');
    const slides = built.proposal.slides;
    assert.equal(slides.length, 12);
    for (const s of slides) {
      assert.ok(LAYOUT_IDS.includes(s.layout), `${s.title}: one of the twelve layouts`);
      assert.ok(Array.isArray(s.blocks) && s.blocks.length > 0);
    }
    assert.deepEqual(slides.map((s: any) => s.spec_id), standardOutline('standard').map((r) => `new:${r.card}`));
    // The document's words reach the build run only as rows inside one untrusted block.
    const run = f.prompts.find((p) => p.includes('Clinics lose patients'))!;
    assert.ok(run && isFramed(run, 'record_text'));
    const p50 = times.sort((a, z) => a - z)[1];
    assert.ok(p50 <= 60_000, `p50 ${p50} ms`);
  } finally { f.close(); }
});

test('3b. paste through the route: an outline proposal, then the venture’s one unkept proposal is replaced', async () => {
  const f = await fixture();
  try {
    const r = await call(f, 2, 'POST', '/api/decks/imports?project_id=1', { text: 'Northwind Labs\n\nProblem\n\nClinics lose patients between visits.', audience: 'angel' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.kind, r.body.source, r.body.proposal.outline.audience, r.body.outline.rows.length], ['outline', 'paste', 'angel', 12]);
    assert.deepEqual(contractErrors(CONTRACT, r.body), []);
    assert.notDeepEqual(contractErrors(CONTRACT, { ...r.body, kind: 'deck' }), [], 'an unknown kind fails the contract');
    const again = await call(f, 2, 'POST', '/api/decks/imports?project_id=1', { text: 'Team\n\nFounders who ran clinics.' });
    assert.equal(again.status, 201);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_proposals WHERE project_id = 1').get() as any).n, 1, 'one unkept proposal per venture (D767)');
    assert.equal(f.converted.length, 0, 'a paste reads nothing remote');
  } finally { f.close(); }
});

test('4. refusals: the wrong file, an unreadable deck, an empty paste, another venture, the plan and the switch', async () => {
  // Mutation checked: the flag gate removed → the switched-off .pptx imports (201); the write check removed → user 4 gets 201.
  const f = await fixture();
  try {
    const at = '/api/decks/imports?project_id=1';
    const code = (r: any) => [r.status, r.body.error ?? r.body.code];
    assert.deepEqual(code(await call(f, 2, 'POST', at, upload(enc.encode('x'), 'notes.key'))), [415, 'file_type']);
    assert.deepEqual(code(await call(f, 2, 'POST', at, upload(enc.encode('not a zip'), 'deck.pptx'))), [422, 'not_a_pptx']);
    assert.deepEqual(code(await call(f, 2, 'POST', at, { text: '   ' })), [400, 'text_required']);
    assert.deepEqual(code(await call(f, 2, 'POST', at, { text: 'Team', audience: 'everyone' })), [400, 'audience must be one of angel, pre_seed_fund, seed_fund, series_a_fund, strategic, grant, other']);
    assert.equal((await call(f, 4, 'POST', at, { text: 'Team\n\nFounders.' })).status, 403, 'only the venture’s writers import');
    assert.equal((await call(f, 3, 'POST', '/api/decks/imports?project_id=3', { text: 'Team\n\nFounders.' })).status, 402, 'New deck’s plan');
    f.db.prepare("INSERT INTO feature_flags (key, scope, scope_id, enabled, updated_by) VALUES ('deck:pptx_import', 'global', '', 0, 1)").run();
    assert.deepEqual(code(await call(f, 2, 'POST', at, upload(deck(), 'deck.pptx'))), [404, 'not_switched_on']);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_proposals').get() as any).n, 0, 'a refusal stores nothing');
    assert.deepEqual([fileKind('A.DOCX', null), fileKind(null, 'application/pdf'), fileKind('a.txt', 'application/pdf')], ['docx', 'pdf', null]);
  } finally { f.close(); }
});
