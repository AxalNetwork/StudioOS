/**
 * D1572 (#3819, deck v2 D11) — a company's .pptx template and the venture's
 * own layouts (pd30 "Import a .pptx template", pd10's "YOUR LAYOUTS").
 *
 *   POST   /api/decks/templates/import?project_id=   the .pptx (multipart `file`, or the raw bytes)
 *          → pd30's mapping report (`pptxTemplate.parseTemplate`): the colours
 *            and fonts found (each font with its stand-in when it is not one of
 *            the OFL list), "[n] layouts found · [n] placed on whole cells ·
 *            [n] could not be placed", and each layout's areas or its reason.
 *            Nothing is stored: the report is what Save as your layouts sends.
 *   GET    /api/decks/layouts?project_id=            the venture's saved layouts
 *   POST   /api/decks/layouts?project_id=            { source_name, layouts: [{ name, areas }] }
 *          → saves each layout whose areas are whole cells that do not overlap
 *            (checked again here, never trusted from the client)
 *   DELETE /api/decks/layouts/:uid?project_id=       removes one
 *
 * WHO. Reading is the deck's readers'; importing, saving and removing are its
 * writers' (`projectOwned`). The import is switched by HQ › Decks'
 * `deck:pptx_import` (D4189), as the deck import is: off, it answers 404
 * `not_switched_on`. No model runs; nothing is charged. All SQL is bound.
 * Nothing logs a layout name, a colour or the file.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import decks, { auditDeckWrite, projectOwned } from './decks';
import type { RouteMount } from '../util/routeRegistry';
import { flagsFor, notSwitchedOn } from '../services/featureFlags';
import { LAYOUTS_MAX, TEMPLATE_MAX_BYTES, TemplateError, cleanName, parseTemplate, type AreaKind, type TemplateArea } from '../services/decks/pptxTemplate';

const deckLayouts = new Hono<{ Bindings: Env }>();

const KINDS: readonly AreaKind[] = ['heading', 'text', 'image', 'chart', 'table', 'graphic'];
const UID = /^[0-9a-f-]{36}$/;
/** A venture keeps at most this many layouts of its own. */
export const VENTURE_LAYOUTS_MAX = LAYOUTS_MAX;

const TEMPLATE_REFUSAL: Record<TemplateError['code'], { status: 413 | 422; message: string }> = {
  not_a_pptx: { status: 422, message: 'That file is not a PowerPoint (.pptx) template.' },
  too_large: { status: 413, message: 'A template can be up to 50 MB.' },
  unreadable: { status: 422, message: 'That template could not be read. Save it again from PowerPoint and try once more.' },
};

/** A layout's areas, kept only when every one is whole cells of the 12 × 6 grid and no two share a cell. */
export function checkAreas(v: unknown): TemplateArea[] | null {
  if (!Array.isArray(v) || !v.length || v.length > 24) return null;
  const out: TemplateArea[] = [];
  for (const a of v as any[]) {
    const ok = KINDS.includes(a?.kind) && [a?.c1, a?.c2, a?.r1, a?.r2].every(Number.isInteger)
      && a.c1 >= 1 && a.c2 <= 12 && a.c1 <= a.c2 && a.r1 >= 1 && a.r2 <= 6 && a.r1 <= a.r2;
    if (!ok) return null;
    out.push({ kind: a.kind, c1: a.c1, c2: a.c2, r1: a.r1, r2: a.r2 });
  }
  for (let i = 0; i < out.length; i += 1) for (let j = i + 1; j < out.length; j += 1) {
    const a = out[i], z = out[j];
    if (a.c1 <= z.c2 && z.c1 <= a.c2 && a.r1 <= z.r2 && z.r1 <= a.r2) return null;
  }
  return out;
}

async function venture(c: any, write: boolean): Promise<{ user: any; pid: number } | Response> {
  const user = await requireAuth(c);
  const pid = Number(c.req.query('project_id'));
  if (!Number.isSafeInteger(pid) || pid <= 0) return c.json({ error: 'project_id required' }, 400);
  try { await projectOwned(c, user, pid, write ? { write: true } : undefined); } catch { return c.json({ error: 'forbidden' }, 403); }
  return { user, pid };
}

type LayoutRow = { uid: string; name: string; source_name: string | null; blocks_json: string; created_at: string };
const layoutOf = (r: LayoutRow) => {
  let areas: unknown = [];
  try { areas = JSON.parse(r.blocks_json); } catch { areas = []; }
  return { uid: r.uid, name: r.name, source_name: r.source_name, areas: checkAreas(areas) ?? [], created_at: r.created_at };
};

async function layoutsOf(env: Env, pid: number) {
  const rows = (await env.DB.prepare(
    'SELECT uid, name, source_name, blocks_json, created_at FROM deck_custom_layouts WHERE project_id = ? ORDER BY id LIMIT ?',
  ).bind(pid, VENTURE_LAYOUTS_MAX).all<LayoutRow>()).results || [];
  return rows.map(layoutOf);
}

deckLayouts.post('/templates/import', async (c) => {
  const got = await venture(c, true);
  if (got instanceof Response) return got;
  if (!(await flagsFor(c.env, got.user)).on('deck:pptx_import')) return refuse(c, 404, notSwitchedOn);
  const declared = Number(c.req.header('content-length') || 0);
  if (declared > TEMPLATE_MAX_BYTES + 64 * 1024) return refuse(c, 413, { code: 'too_large', message: TEMPLATE_REFUSAL.too_large.message });
  let bytes: Uint8Array;
  let fileName: string | null = null;
  if (String(c.req.header('content-type') || '').startsWith('multipart/form-data')) {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file') as unknown as { name?: string; arrayBuffer(): Promise<ArrayBuffer> } | null;
    if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') return refuse(c, 400, { code: 'file_required', message: 'Choose a .pptx template to import.' });
    fileName = typeof file.name === 'string' ? file.name : null;
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    bytes = new Uint8Array(await c.req.arrayBuffer());
    fileName = c.req.header('x-file-name') ?? null;
  }
  if (!bytes.byteLength) return refuse(c, 400, { code: 'file_required', message: 'Choose a .pptx template to import.' });
  if (bytes.byteLength > TEMPLATE_MAX_BYTES) return refuse(c, 413, { code: 'too_large', message: TEMPLATE_REFUSAL.too_large.message });
  if (fileName != null && !/\.pptx$/i.test(fileName)) return refuse(c, 422, { code: 'not_a_pptx', message: TEMPLATE_REFUSAL.not_a_pptx.message });
  let report;
  try { report = await parseTemplate(bytes); }
  catch (e) {
    const code = e instanceof TemplateError ? e.code : 'unreadable';
    return refuse(c, TEMPLATE_REFUSAL[code].status, { code, message: TEMPLATE_REFUSAL[code].message });
  }
  return c.json({ project_id: got.pid, source_name: fileName ? cleanName(fileName, 'Template.pptx') : null, ...report });
});

deckLayouts.get('/layouts', async (c) => {
  const got = await venture(c, false);
  if (got instanceof Response) return got;
  return c.json({ project_id: got.pid, layouts: await layoutsOf(c.env, got.pid) });
});

deckLayouts.post('/layouts', async (c) => {
  const got = await venture(c, true);
  if (got instanceof Response) return got;
  const body = await c.req.json().catch(() => null) as any;
  const list = Array.isArray(body?.layouts) ? body.layouts : null;
  if (!list || !list.length) return refuse(c, 400, { code: 'layouts_required', message: 'Send the layouts to save as { layouts: [{ name, areas }] }.' });
  const source = typeof body.source_name === 'string' ? cleanName(body.source_name, '') || null : null;
  const kept: Array<{ name: string; areas: TemplateArea[] }> = [];
  for (const l of list.slice(0, LAYOUTS_MAX)) {
    const areas = checkAreas(l?.areas);
    if (!areas) return refuse(c, 422, { code: 'not_whole_cells', message: `“${cleanName(l?.name, 'A layout')}” is not on whole cells of the grid, so it was not saved. Nothing was saved.` });
    kept.push({ name: cleanName(l?.name, `Layout ${kept.length + 1}`), areas });
  }
  const have = Number((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM deck_custom_layouts WHERE project_id = ?').bind(got.pid).first<{ n: number }>())?.n || 0);
  if (have + kept.length > VENTURE_LAYOUTS_MAX) return refuse(c, 409, { code: 'too_many_layouts', message: `A venture keeps at most ${VENTURE_LAYOUTS_MAX} layouts of its own. Remove some first. Nothing was saved.` });
  await c.env.DB.batch(kept.map((l) => c.env.DB.prepare(
    'INSERT INTO deck_custom_layouts (uid, project_id, name, source_name, blocks_json, created_by) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(crypto.randomUUID(), got.pid, l.name, source, JSON.stringify(l.areas), Number(got.user.id) || null)));
  await auditDeckWrite(c, got.user, got.pid, 'deck_layouts_saved', 'Layouts saved from a .pptx template');
  return c.json({ project_id: got.pid, saved: kept.length, layouts: await layoutsOf(c.env, got.pid) });
});

deckLayouts.delete('/layouts/:uid', async (c) => {
  const got = await venture(c, true);
  if (got instanceof Response) return got;
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return c.json({ error: 'not found' }, 404);
  const r = await c.env.DB.prepare('DELETE FROM deck_custom_layouts WHERE project_id = ? AND uid = ?').bind(got.pid, uid).run();
  if (!Number(r?.meta?.changes || 0)) return c.json({ error: 'not found' }, 404);
  await auditDeckWrite(c, got.user, got.pid, 'deck_layout_removed', 'A saved layout removed');
  return c.json({ project_id: got.pid, layouts: await layoutsOf(c.env, got.pid) });
});

// Ahead of `decks`, whose `/:id` routes would otherwise take these paths.
export const mount: RouteMount = { path: '/api/decks', router: deckLayouts, before: [decks] };

export default deckLayouts;
