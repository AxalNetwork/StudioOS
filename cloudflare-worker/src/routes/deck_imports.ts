/**
 * D1563 (#3810, deck v2 D2) — Start from › Import a document (pd1).
 *
 *   POST /api/decks/imports?project_id=
 *        { text, audience? }                       pasted text
 *        multipart `file` (.docx, .pdf or .pptx), optional `audience`
 *        → 201 { kind: 'outline', source, proposal, proposal_hash, outline: { rows, proposed_by }, counts }
 *              paste, DOCX and PDF: an outline of New deck's catalogue cards
 *              (`decks/documentOutline.ts`), stored as the venture's
 *              outline proposal. The page then sends it to `/api/decks/generate`
 *              with `proposal_id`, and the built cards open in the shared
 *              OneClickBuild review (Accept / Accept all).
 *        → 201 { kind: 'cards', source: 'pptx', proposal, proposal_hash, counts }
 *              a .pptx: each slide an editable card, its words in text blocks
 *              on whole cells (`pptxCards`, through D11's shared parser), stored
 *              as the venture's proposal and opened in the same review.
 *
 * Decision C = B (S1): the outline path for words that have no layout, the
 * cards path for a deck that has one. Nothing is a version until it is kept
 * (`/api/decks/proposals/:id/keep-slides`): an import replaces the venture's
 * unkept proposal, as every fill does (D767).
 *
 * UNTRUSTED. The document's words are data. No model reads them here: the
 * outline is mapped by code, and its rows reach the build run only inside one
 * untrusted block (`newDeck.buildMessage`). A heading or sentence that names a
 * number is left out of the outline, so figures still come from the records.
 * A .pptx runs no model at all.
 *
 * COST. Reading a DOCX or PDF is the router's metered conversion
 * (`convertToMarkdown`: one usage row, no charge, refused while AI is paused).
 * Paste and .pptx read nothing remote.
 *
 * WHO. The deck routes' writers (`projectOwned`), on the plan New deck is on.
 * The .pptx path is switched by HQ › Decks' `deck:pptx_import` (404
 * `not_switched_on` while off). All SQL is bound. Nothing logs the file, its
 * name or its words.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { ensureTier } from '../middleware/requireTier';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { AI_SURFACE } from '../services/aiSurfaces';
import { flagsFor, notSwitchedOn } from '../services/featureFlags';
import { extractDeck } from '../services/deckExtract';
import { outlineFromDocument } from '../services/decks/documentOutline';
import { FAST_PATH_AUDIENCE, LENGTH_IDS, type Audience } from '../services/decks/newDeck';
import { AUDIENCES } from '../services/decks/slideModel';
import { TEMPLATE_MAX_BYTES, TemplateError, readPptxSlides } from '../services/decks/pptxTemplate';
import { cardsOfSlides } from '../services/decks/pptxCards';
import decks, { auditDeckWrite, ensureSchema, projectOwned, proposalHash, rowToProposal, sanitizeSlides } from './decks';
import { proposalRow, writeProposal } from './deck_new';

const deckImports = new Hono<{ Bindings: Env }>();

/** The longest paste read, in characters (the reviewer's own cap on a document's text). */
export const PASTE_MAX = 40_000;
/** A DOCX or PDF can be up to this many bytes. */
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

export const IMPORT_REFUSALS = Object.freeze({
  text_required: 'Paste the text of your document, or choose a file to import.',
  file_type: 'Import a Word document (.docx), a PDF or a PowerPoint deck (.pptx).',
  too_large: 'A document can be up to 20 MB, and a .pptx deck up to 50 MB.',
  unreadable: 'That document could not be read. Paste its text instead; nothing was changed.',
  empty: 'That document holds no text to import. Nothing was changed.',
  not_a_pptx: 'That file is not a PowerPoint (.pptx) deck.',
  pptx_unreadable: 'That deck could not be read. Save it again from PowerPoint and try once more.',
  no_slides: 'That deck holds no slides to import. Nothing was changed.',
});

const MIME: Record<'docx' | 'pdf', string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

/** The file's kind from its name, else from its type; null for anything this does not import. */
export function fileKind(name: string | null, type: string | null): 'docx' | 'pdf' | 'pptx' | null {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.pptx')) return 'pptx';
  if (n) return null;
  const t = String(type || '').toLowerCase();
  if (t === MIME.docx) return 'docx';
  if (t === MIME.pdf) return 'pdf';
  if (t === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  return null;
}

function planRefusal(user: User): Response | null {
  try { ensureTier(user, 'studio'); return null; } catch (e) { if (e instanceof Response) return e; throw e; }
}

const audienceOf = (v: unknown): Audience | null | 'bad' =>
  v == null || v === '' ? null : (AUDIENCES as readonly string[]).includes(String(v)) ? (String(v) as Audience) : 'bad';

/** The version an import sits beside: the venture's current one, else none (0). */
async function currentDeckId(env: Env, projectId: number): Promise<number> {
  const cur = await env.DB.prepare('SELECT id FROM pitch_decks WHERE project_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1').bind(projectId).first<any>();
  return Number(cur?.id) || 0;
}

async function ventureTitle(env: Env, projectId: number): Promise<string> {
  const row = await env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(projectId).first<any>().catch(() => null);
  const name = typeof row?.name === 'string' && row.name.trim() ? row.name.trim() : 'Venture';
  return `${name} — Pitch deck`;
}

deckImports.post('/imports', async (c) => {
  const user = await requireAuth(c);
  const plan = planRefusal(user);
  if (plan) return plan;
  const projectId = Number(c.req.query('project_id'));
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return c.json({ error: 'project_id required' }, 400);
  try { await projectOwned(c, user, projectId, { write: true }); }
  catch (e: any) { return e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403); }

  const declared = Number(c.req.header('content-length') || 0);
  if (declared > TEMPLATE_MAX_BYTES + 64 * 1024) return refuse(c, 413, { code: 'too_large', message: IMPORT_REFUSALS.too_large });
  const userId = Number(user.id) || 0;

  let source: 'paste' | 'docx' | 'pdf' | 'pptx';
  let audience: Audience | null | 'bad';
  let markdown = '';
  let bytes: Uint8Array | null = null;
  if (String(c.req.header('content-type') || '').startsWith('multipart/form-data')) {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file') as unknown as { name?: string; type?: string; arrayBuffer(): Promise<ArrayBuffer> } | null;
    if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') return refuse(c, 400, { code: 'text_required', message: IMPORT_REFUSALS.text_required });
    const kind = fileKind(typeof file.name === 'string' ? file.name : null, typeof file.type === 'string' ? file.type : null);
    if (!kind) return refuse(c, 415, { code: 'file_type', message: IMPORT_REFUSALS.file_type });
    source = kind;
    audience = audienceOf(form?.get('audience'));
    bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.byteLength) return refuse(c, 422, { code: 'empty', message: IMPORT_REFUSALS.empty });
    if (bytes.byteLength > (kind === 'pptx' ? TEMPLATE_MAX_BYTES : DOCUMENT_MAX_BYTES)) return refuse(c, 413, { code: 'too_large', message: IMPORT_REFUSALS.too_large });
  } else {
    const body = await c.req.json().catch(() => null) as any;
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!text.trim()) return refuse(c, 400, { code: 'text_required', message: IMPORT_REFUSALS.text_required });
    source = 'paste';
    audience = audienceOf(body?.audience);
    markdown = text.slice(0, PASTE_MAX);
  }
  if (audience === 'bad') return c.json({ error: `audience must be one of ${AUDIENCES.join(', ')}` }, 400);
  const forAudience = audience ?? FAST_PATH_AUDIENCE;
  await ensureSchema(c.env);
  const title = await ventureTitle(c.env, projectId);
  const base = await currentDeckId(c.env, projectId);

  if (source === 'pptx') {
    if (!(await flagsFor(c.env, user)).on('deck:pptx_import')) return refuse(c, 404, notSwitchedOn);
    let read;
    try { read = await readPptxSlides(bytes!); }
    catch (e) {
      const code = e instanceof TemplateError ? e.code : 'unreadable';
      if (code === 'too_large') return refuse(c, 413, { code, message: IMPORT_REFUSALS.too_large });
      return refuse(c, 422, { code: code === 'not_a_pptx' ? 'not_a_pptx' : 'unreadable', message: code === 'not_a_pptx' ? IMPORT_REFUSALS.not_a_pptx : IMPORT_REFUSALS.pptx_unreadable });
    }
    if (!read.slides.length) return refuse(c, 422, { code: 'no_slides', message: IMPORT_REFUSALS.no_slides });
    const { cards, counts } = cardsOfSlides(read);
    const outline = { audience: forAudience, round_ref: null, length: 'standard', prompt: '', start: { kind: 'blank' }, rows: [], proposed_by: 'Your deck', source: 'pptx', rail_proposal_uid: null };
    const id = await writeProposal(c.env, projectId, base, title, sanitizeSlides(cards), outline, userId);
    await auditDeckWrite(c, user, projectId, 'deck_imported', 'Deck proposal imported from a .pptx deck');
    const written = await proposalRow(c.env, id);
    return c.json({ kind: 'cards', source, proposal: rowToProposal(written), proposal_hash: await proposalHash(written), counts }, 201);
  }

  if (bytes) {
    // #3937's metered conversion: refused while AI is paused, an image refused, one usage row, no charge.
    const got = await extractDeck(c.env, bytes, MIME[source as 'docx' | 'pdf'], `document.${source}`, { userId, surface: AI_SURFACE.raisePitch });
    if (got.status === 'failed') return refuse(c, 422, { code: 'unreadable', message: IMPORT_REFUSALS.unreadable });
    if (got.status === 'empty') return refuse(c, 422, { code: 'empty', message: IMPORT_REFUSALS.empty });
    markdown = got.markdown;
  }
  const doc = outlineFromDocument(markdown);
  if (!doc.counts.sections) return refuse(c, 422, { code: 'empty', message: IMPORT_REFUSALS.empty });
  const length = doc.rows.length > 12 ? 'full' : 'standard';
  const outline = {
    audience: forAudience, round_ref: null, length: LENGTH_IDS.includes(length) ? length : 'standard', prompt: '',
    start: { kind: 'blank' }, rows: doc.rows, proposed_by: 'Your document', source, rail_proposal_uid: null,
  };
  const id = await writeProposal(c.env, projectId, base, title, [], outline, userId);
  await auditDeckWrite(c, user, projectId, 'deck_outline_imported', 'Deck outline imported from a document');
  const written = await proposalRow(c.env, id);
  return c.json({
    kind: 'outline', source, proposal: rowToProposal(written), proposal_hash: await proposalHash(written),
    outline: { rows: doc.rows, proposed_by: 'Your document' }, counts: doc.counts,
  }, 201);
});

// Ahead of `decks`, whose `/:id` routes would otherwise take this path.
export const mount: RouteMount = { path: '/api/decks', router: deckImports, before: [decks] };

export default deckImports;
