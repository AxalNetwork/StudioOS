/**
 * D1544 (#3784, deck builder v2 B8) — edits of a deck image, each a child
 * image the founder keeps or reverts (`services/decks/imageEdits.ts`).
 *
 *   POST /api/decks/images/:uid/edit/quote   { op, instruction?, mask?, aspect? }
 *        → { ai: true, op, model, model_label, hold_microusd, draw_microusd, checks_microusd,
 *            references, balance } | { ai: false, reason, message }
 *   POST /api/decks/images/:uid/edit         (the same body) → { image, parent_uid, op, cost }
 *   POST /api/decks/images/:uid/revert       → { parent, discarded }
 *
 * D1534 (#3778 phase 2): the AI image tools, whose result is a child image too
 * (`services/decks/imageTools.ts`, migration 766):
 *   GET  /api/decks/images/tools                  → { tools: [{ tool, on, model, model_label, usd_per_image, message }] }
 *   POST /api/decks/images/:uid/tools/:tool/quote → { ai: true, tool, model, model_label, hold_microusd, balance }
 *                                                 | { ai: false, reason, message }
 *   POST /api/decks/images/:uid/tools/:tool       → { image, parent_uid, tool, cost }
 * `:tool` is 'remove_background' or 'upscale'. Off (the switch, or no model) is
 * 503 `image_tool_off` and calls nothing; a ledger refusal is 402 and holds nothing.
 *
 * `:uid` is the image being edited (the parent) for a quote or an edit, and
 * the child for a revert. Every press needs write access to the image's
 * venture, as every deck image write does.
 *
 * IN THIS ORDER, each refusing before the next costs anything:
 *   1. the request (`editAskOf`): the op, an edit's instruction, an erase's
 *      mask, an expand's frame;
 *   2. the parent (`editRefusal`): never an image showing a person, never a
 *      discarded one; the instruction never asks for a person, a figure or a
 *      chart;
 *   3. storage: no R2, or no Images binding to resize the parent, is 503;
 *   4. one quote for the edit and its three post-draw checks
 *      (`drawPressQuote`), with the parent (and the mask) as the references
 *      the hold prices; the balance covers the whole figure, or 402;
 *   5. the run (DK5, or DK4 for a vary of a drawn image when DK5 cannot run),
 *      the checks (`postDrawCheck`), then the child row and its bytes in R2.
 *
 * NOTHING REACHES A CARD. The child is a proposal like any drawn image; the
 * founder keeps it (`POST /api/decks/images/:uid/keep`) and saves the version.
 * Reverting discards the child and answers the parent, which no edit changes.
 *
 * Mounted in index.ts BEFORE `decks`, beside `deck_images`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { drawPressQuote, postDrawCheck, type PostDrawDeps } from '../services/ai/postDraw';
import { IMAGE_SPECS, type Aspect } from '../services/ai/shapes';
import { EXTENSION, IMAGE_BYTES_ESTIMATE, IMAGE_OPTION, IMAGE_PAGE, MIMES, balanceRefusal, imageModelLabel, sniffMime, ventureNames } from '../services/decks/images';
import { artDirectionOfTheme, seedFor } from '../services/decks/artDirection';
import {
  EditRefusal, asReference, editAskOf, editReferences, editRefusal, editRunOptions, redrawRunOptions, type EditAsk,
} from '../services/decks/imageEdits';
import { imageSize, sha256Hex, stripMetadata, type ImageMime } from '../services/decks/imageBytes';
import { assertStorageRoom, noteStorageLanded } from '../services/storageRoom';
import { isImageTool, runImageTool, toolQuoteMicro, toolState, toolStates, TOOL_WORDS, type ToolDeps } from '../services/decks/imageTools';
import { gatewayImageModelFor } from '../services/ai/catalogue';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { auditDeckWrite, getDeckRow, projectOwned, themeOfRow } from './decks';
import { imageUrl, TAKEN_DOWN_SENTENCE } from './deck_images';

const deckImageEdits = new Hono<{ Bindings: Env }>();

const UID = /^[0-9a-f-]{36}$/;
const NO_STORAGE = 'Images cannot be stored here yet. Nothing was run and nothing was charged.';

/** A test may stub the router's run and quote (`PostDrawDeps`); production uses the router's own. */
let deps: (PostDrawDeps & { run: typeof run }) | undefined;
export function __setEditDepsForTest(d: (PostDrawDeps & { run: typeof run }) | undefined): void { deps = d; }

/** One image row by its uid, with the caller's write access to its venture checked. */
async function imageOf(c: any, user: User): Promise<any | Response> {
  const uid = String(c.req.param('uid') || '');
  if (!UID.test(uid)) return c.json({ error: 'not found' }, 404);
  const row = await c.env.DB.prepare('SELECT * FROM deck_images WHERE uid = ?').bind(uid).first();
  if (!row) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c, user, Number(row.project_id), { write: true }); } catch { return c.json({ error: 'not found' }, 404); }
  // #4375: an image HQ took down is not edited, cut out or upscaled: its bytes are gone.
  if (row.taken_down_at) return refuse(c, 410, { code: 'image_taken_down', message: TAKEN_DOWN_SENTENCE });
  return row;
}

function view(c: any, r: any) {
  return {
    uid: r.uid, url: imageUrl(c.req.url, r.uid), state: r.state, use: r.use, source: r.source, card: r.card ?? null, card_uid: r.card_uid ?? null,
    style: r.style ?? null, aspect: r.aspect ?? null, alt: r.alt ?? '', width: r.width ?? null, height: r.height ?? null,
    model: r.model ?? null, model_label: imageModelLabel(r.model), usage_log_id: r.ai_usage_log_id ?? null, charged_microusd: r.charged_microusd ?? null,
    parent_uid: r.parent_uid ?? null, edit_op: r.edit_op ?? null, image_tool: r.image_tool ?? null, created_at: r.created_at,
  };
}

const refusal = (c: any, e: EditRefusal) => refuse(c, e.status, { code: e.code, message: e.message });

/** The deck's art direction, from the version the parent was made for (or none). */
async function artOf(env: Env, deckId: number | null) {
  if (!deckId) return {};
  try { return artDirectionOfTheme(themeOfRow(await getDeckRow(env, deckId))); } catch { return {}; }
}

type Planned = { parent: any; ask: EditAsk; opts: RunOptions; redraw: boolean };

/**
 * The checked edit and the one run it makes, or the response that refuses it.
 * Shared by the quote and the edit, so both read the same input.
 */
async function planned(c: any, user: User): Promise<Planned | Response> {
  const parent = await imageOf(c, user);
  if (parent instanceof Response) return parent;
  const ask = editAskOf(await c.req.json().catch(() => ({})));
  if (ask instanceof EditRefusal) return refusal(c, ask);
  const refused = editRefusal(parent, ask, Number(parent.project_id), await ventureNames(c.env, Number(parent.project_id)));
  if (refused) return refusal(c, refused);
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: NO_STORAGE });
  const art = await artOf(c.env, parent.deck_id == null ? null : Number(parent.deck_id));
  const base = {
    userId: Number(user.id) || 0, surface: AI_SURFACE.raisePitch,
    rail: { ...railFor(c, { page: IMAGE_PAGE, option: IMAGE_OPTION }, `deck:${parent.deck_id ?? 'none'}`), option: IMAGE_OPTION },
  };
  // A seed in the deck's family, one past the parent's position, so a vary is a new composition.
  const seed = seedFor(art, Number(parent.id) || 0);
  const obj = await c.env.FILES.get(parent.r2_key).catch(() => null);
  if (!obj) return refuse(c, 404, { code: 'image_missing', message: 'That image\'s file is not stored any more. Nothing was run.' });
  const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
  const mime = (MIMES as readonly string[]).includes(parent.mime) ? parent.mime as ImageMime : sniffMime(bytes) as ImageMime | null;
  if (!mime) return refuse(c, 422, { code: 'image_unreadable', message: 'That image cannot be read. Nothing was run.' });
  let reference;
  try { reference = await asReference(c.env, bytes, mime); } catch (e) {
    // A vary of a drawn image redraws its own description without a reference when the parent cannot be resized.
    if (e instanceof EditRefusal && ask.op === 'vary' && parent.source === 'generated' && parent.prompt) {
      return { parent, ask, opts: redrawRunOptions(base, String(parent.prompt), (parent.aspect as Aspect) ?? null, art, (seed ?? Number(parent.id) ?? 0) + 1), redraw: true };
    }
    if (e instanceof EditRefusal) return refusal(c, e);
    throw e;
  }
  return { parent, ask, opts: editRunOptions(base, ask, editReferences(reference, ask), art, seed), redraw: false };
}

/** The quote for a planned edit; a vary of a drawn image whose DK5 cannot run falls back to a DK4 redraw. */
async function quoteOf(c: any, p: Planned) {
  let q = await drawPressQuote(c.env, p.opts, deps);
  if (!q.ok && p.ask.op === 'vary' && !p.redraw && p.parent.source === 'generated' && p.parent.prompt && q.refusal === 'model_not_offered') {
    const art = await artOf(c.env, p.parent.deck_id == null ? null : Number(p.parent.deck_id));
    const redraw = redrawRunOptions(p.opts, String(p.parent.prompt), (p.parent.aspect as Aspect) ?? null, art, (Number(p.parent.id) || 0) + 1);
    const again = await drawPressQuote(c.env, redraw, deps);
    if (again.ok) { p.opts = redraw; p.redraw = true; q = again; }
  }
  return q;
}

const notRunMessage = (refusal: string, error: string) => (refusal === 'model_not_offered'
  ? 'Editing images is not available on your plan yet. Nothing was run.'
  : error || 'The edit cannot run right now. Nothing was run.');

deckImageEdits.post('/images/:uid/edit/quote', async (c) => {
  const user = await requireAuth(c);
  const p = await planned(c, user);
  if (p instanceof Response) return p;
  const q = await quoteOf(c, p);
  if (!q.ok) return c.json({ ai: false, reason: q.refusal, message: notRunMessage(q.refusal, q.error) });
  const short = await balanceRefusal(c.env, Number(user.id), q.hold_microusd);
  return c.json({
    ai: true, op: p.ask.op, model: q.model, model_label: imageModelLabel(q.model), redraw: p.redraw,
    hold_microusd: q.hold_microusd, draw_microusd: q.draw_microusd, checks_microusd: q.checks_microusd,
    references: (p.opts.draw?.references ?? []).map((r) => ({ width: r.width, height: r.height })),
    balance: short ? { ok: false, code: short.code, message: short.message } : { ok: true },
  });
});

deckImageEdits.post('/images/:uid/edit', async (c) => {
  const user = await requireAuth(c);
  const p = await planned(c, user);
  if (p instanceof Response) return p;
  const userId = Number(user.id);
  const q = await quoteOf(c, p);
  if (!q.ok) {
    const stop = refuseRun(c, { refusal: q.refusal, error: q.error });
    return stop ?? refuse(c, 503, { code: q.refusal || 'model_unavailable', message: notRunMessage(q.refusal, q.error) });
  }
  // A model that takes fewer references than the edit sends cannot make it (`drawRequest`); the quote named the model.
  const spec = IMAGE_SPECS[q.model];
  if (!p.redraw && (!spec || spec.maxReferences < (p.opts.draw?.references?.length ?? 0))) {
    return refuse(c, 503, { code: 'model_unavailable', message: notRunMessage('model_not_offered', '') });
  }
  const short = await balanceRefusal(c.env, userId, q.hold_microusd);
  if (short) return refuse(c, 402, { code: short.code, message: short.message });
  const projectId = Number(p.parent.project_id);
  let ticket;
  try { ticket = await assertStorageRoom(c.env, { projectId }, IMAGE_BYTES_ESTIMATE, user); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const runner = deps?.run ?? run;
  const r = await runner(c.env, { ...p.opts, model: q.model });
  if (!r.ok || !r.image) {
    const stop = refuseRun(c, r);
    return stop ?? refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not make the edit. Nothing was saved.' });
  }
  const mime = (MIMES as readonly string[]).includes(r.image.mime) ? r.image.mime as ImageMime : sniffMime(r.image.bytes) as ImageMime | null;
  if (!mime) return refuse(c, 503, { code: 'image_unreadable', message: 'The edit came back in a format the deck cannot show. It was charged; nothing was saved.' });
  const drawn = stripMetadata(r.image.bytes, mime);
  let bin = '';
  for (let i = 0; i < drawn.length; i += 0x8000) bin += String.fromCharCode(...drawn.subarray(i, i + 0x8000));
  const checked = await postDrawCheck(c.env, `data:${mime};base64,${btoa(bin)}`, { userId, surface: p.opts.surface, rail: p.opts.rail }, deps);
  if (!checked.ok) return refuse(c, 422, { code: checked.code, message: checked.message });
  const size = imageSize(drawn, mime);
  const sha = await sha256Hex(drawn);
  const taken = await c.env.DB.prepare('SELECT 1 FROM deck_images WHERE project_id = ? AND sha256 = ?').bind(projectId, sha).first();
  const uid = crypto.randomUUID();
  const key = `deck-images/${projectId}/${uid}.${EXTENSION[mime]}`;
  try {
    await c.env.FILES!.put(key, drawn, { httpMetadata: { contentType: mime }, customMetadata: { projectId: String(projectId), userId: String(userId), parent: String(p.parent.uid) } });
  } catch {
    return refuse(c, 503, { code: 'image_unsaved', message: 'The edit was made but could not be stored. It was charged for the run; try again in a moment.' });
  }
  const charged = r.usageLogId
    ? Number((await c.env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(r.usageLogId, userId).first<any>().catch(() => null))?.charged_microusd ?? NaN)
    : NaN;
  const model = r.usage?.model ?? q.model;
  await c.env.DB.prepare(`INSERT INTO deck_images (uid, project_id, deck_id, card, card_uid, r2_key, mime, size_bytes, width, height, sha256, source, prompt, style, aspect, use,
      overlay, alt, state, model, ai_usage_log_id, charged_microusd, created_by, parent_uid, edit_op)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?)`)
    .bind(uid, projectId, p.parent.deck_id ?? null, p.parent.card ?? null, p.parent.card_uid ?? null, key, mime, drawn.byteLength, size?.width ?? r.image.width, size?.height ?? r.image.height,
      taken ? null : sha, p.opts.text ?? null, p.parent.style ?? null, p.ask.aspect ?? p.parent.aspect ?? null, p.parent.use, p.parent.overlay ?? null,
      checked.alt ?? p.parent.alt ?? null, model, r.usageLogId ?? null, Number.isFinite(charged) ? charged : null, userId, p.parent.uid, p.ask.op).run();
  await noteStorageLanded(c.env, ticket);
  const where = p.parent.card == null ? 'The deck' : `Card ${Number(p.parent.card) + 1}`;
  await auditDeckWrite(c, user, projectId, 'deck_image_edited', `${where}: an image ${p.ask.op === 'vary' ? 'varied' : `${p.ask.op === 'edit' ? 'edited' : p.ask.op === 'erase' ? 'erased in part' : 'expanded'}`}`);
  const row = await c.env.DB.prepare('SELECT * FROM deck_images WHERE uid = ?').bind(uid).first();
  return c.json({
    image: view(c, row), parent_uid: p.parent.uid, op: p.ask.op, redraw: p.redraw,
    cost: { hold_microusd: q.hold_microusd, charged_microusd: Number.isFinite(charged) ? charged : null, usage_log_id: r.usageLogId ?? null },
  });
});

deckImageEdits.post('/images/:uid/revert', async (c) => {
  const user = await requireAuth(c);
  const child = await imageOf(c, user);
  if (child instanceof Response) return child;
  if (!child.parent_uid) return refuse(c, 422, { code: 'not_an_edit', message: 'That image is not an edit, so there is nothing to go back to.' });
  const parent = await c.env.DB.prepare('SELECT * FROM deck_images WHERE uid = ? AND project_id = ?').bind(child.parent_uid, child.project_id).first<any>();
  if (!parent) return refuse(c, 404, { code: 'parent_missing', message: 'The image this edit was made from is not stored any more.' });
  await c.env.DB.prepare("UPDATE deck_images SET state = 'discarded' WHERE uid = ? AND parent_uid = ?").bind(child.uid, parent.uid).run();
  await auditDeckWrite(c, user, Number(child.project_id), 'deck_image_reverted', `${child.card == null ? 'The deck' : `Card ${Number(child.card) + 1}`}: an edit reverted`);
  return c.json({ parent: view(c, parent), discarded: child.uid });
});

// ── D1534 (#3778 phase 2): the AI image tools ───────────────────────────────

let toolDeps: ToolDeps | undefined;
export function __setToolDepsForTest(d: ToolDeps | undefined): void { toolDeps = d; }

/** The deck-image option a tool press is recorded with. */
const TOOL_OPTION = 'deck:image-tool';

deckImageEdits.get('/images/tools', async (c) => {
  await requireAuth(c);
  return c.json({ tools: toolStates(c.env) });
});

/** The parent and the tool, checked, or the response that refuses them. Nothing is held here. */
async function toolPlan(c: any, user: User): Promise<{ parent: any; tool: 'remove_background' | 'upscale' } | Response> {
  const tool = c.req.param('tool');
  if (!isImageTool(tool)) return c.json({ error: 'not found' }, 404);
  const parent = await imageOf(c, user);
  if (parent instanceof Response) return parent;
  if (parent.state === 'discarded') return refuse(c, 422, { code: 'image_discarded', message: 'That image was discarded. Nothing was run.' });
  const state = toolState(c.env, tool);
  if (!state.on) return refuse(c, 503, { code: 'image_tool_off', message: state.message ?? 'Coming later.' });
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: NO_STORAGE });
  return { parent, tool };
}

deckImageEdits.post('/images/:uid/tools/:tool/quote', async (c) => {
  const user = await requireAuth(c);
  const p = await toolPlan(c, user);
  if (p instanceof Response) {
    // Off is an answer for a quote, not an error: the toolbar draws "Coming later".
    if (p.status === 503) { const b = await p.clone().json().catch(() => ({})) as any; return c.json({ ai: false, reason: b.error ?? 'image_tool_off', message: b.message ?? '' }); }
    return p;
  }
  const m = gatewayImageModelFor(p.tool)!;
  const hold = await toolQuoteMicro(c.env, Number(user.id), m);
  const short = await balanceRefusal(c.env, Number(user.id), hold);
  return c.json({
    ai: true, tool: p.tool, label: TOOL_WORDS[p.tool], model: m.id, model_label: m.name, hold_microusd: hold,
    balance: short ? { ok: false, code: short.code, message: short.message } : { ok: true },
  });
});

deckImageEdits.post('/images/:uid/tools/:tool', async (c) => {
  const user = await requireAuth(c);
  const p = await toolPlan(c, user);
  if (p instanceof Response) return p;
  const userId = Number(user.id);
  const projectId = Number(p.parent.project_id);
  const obj = await c.env.FILES!.get(p.parent.r2_key).catch(() => null);
  if (!obj) return refuse(c, 404, { code: 'image_missing', message: 'That image\'s file is not stored any more. Nothing was run.' });
  const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
  const mime = (MIMES as readonly string[]).includes(p.parent.mime) ? p.parent.mime : sniffMime(bytes);
  if (mime !== 'image/png' && mime !== 'image/jpeg') {
    return refuse(c, 422, { code: 'image_unreadable', message: 'Background removal takes a PNG or a JPEG. Nothing was run.' });
  }
  let ticket;
  try { ticket = await assertStorageRoom(c.env, { projectId }, IMAGE_BYTES_ESTIMATE, user); }
  catch (e) { if (e instanceof Response) return e; throw e; }
  // One press is one execution: a retried request with the same key is not charged twice.
  const executionId = String(c.req.header('Idempotency-Key') || crypto.randomUUID()).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 120) || crypto.randomUUID();
  const r = await runImageTool(c.env, { tool: p.tool, userId, bytes, mime, executionId, surface: AI_SURFACE.raisePitch, option: TOOL_OPTION }, toolDeps);
  if (!r.ok) return refuse(c, r.status, { code: r.code, message: r.message });
  const cut = stripMetadata(r.bytes, 'image/png');
  const size = imageSize(cut, 'image/png');
  const sha = await sha256Hex(cut);
  const taken = await c.env.DB.prepare('SELECT 1 FROM deck_images WHERE project_id = ? AND sha256 = ?').bind(projectId, sha).first();
  const uid = crypto.randomUUID();
  const key = `deck-images/${projectId}/${uid}.${EXTENSION['image/png']}`;
  try {
    await c.env.FILES!.put(key, cut, { httpMetadata: { contentType: 'image/png' }, customMetadata: { projectId: String(projectId), userId: String(userId), parent: String(p.parent.uid) } });
  } catch {
    return refuse(c, 503, { code: 'image_unsaved', message: 'The background was removed but the result could not be stored. It was charged for the run; try again in a moment.' });
  }
  // A child, as an edit's is: `parent_uid` and `image_tool` together, never `edit_op` (migration 766).
  await c.env.DB.prepare(`INSERT INTO deck_images (uid, project_id, deck_id, card, card_uid, r2_key, mime, size_bytes, width, height, sha256, source, prompt, style, aspect, use,
      overlay, alt, state, model, ai_usage_log_id, charged_microusd, created_by, parent_uid, image_tool)
    VALUES (?, ?, ?, ?, ?, ?, 'image/png', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?)`)
    .bind(uid, projectId, p.parent.deck_id ?? null, p.parent.card ?? null, p.parent.card_uid ?? null, key, cut.byteLength, size?.width ?? null, size?.height ?? null,
      taken ? null : sha, p.parent.source, p.parent.style ?? null, p.parent.aspect ?? null, p.parent.use, p.parent.overlay ?? null, p.parent.alt ?? null,
      r.model, r.usage_log_id ?? null, r.charged_microusd, userId, p.parent.uid, p.tool).run();
  await noteStorageLanded(c.env, ticket);
  const where = p.parent.card == null ? 'The deck' : `Card ${Number(p.parent.card) + 1}`;
  await auditDeckWrite(c, user, projectId, 'deck_image_tool', `${where}: an image's background removed`);
  const row = await c.env.DB.prepare('SELECT * FROM deck_images WHERE uid = ?').bind(uid).first();
  return c.json({
    image: view(c, row), parent_uid: p.parent.uid, tool: p.tool,
    cost: { hold_microusd: r.hold_microusd, charged_microusd: r.charged_microusd, usage_log_id: r.usage_log_id },
  });
});

export default deckImageEdits;
