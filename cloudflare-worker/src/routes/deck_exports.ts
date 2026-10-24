/**
 * D901 (#2680) — Pitch deck studio part 7: the HTML export and the export
 * ledger. Mounted at `/api/decks` BEFORE `decks.ts`, so its middleware sees
 * the existing PDF and PowerPoint export first.
 *
 *   POST /api/decks/:id/export/html  {notes?: boolean, sources?: boolean}
 *        → the version as one self-contained HTML file (`offlineHtml.ts`).
 *          Writes one `deck_exports` row (with the file's SHA-256) and one
 *          `raise.pitch-deck` audit row in one batch; when they cannot be
 *          written the file is not handed out.
 *   GET  /api/decks/:id/exports
 *        → {exports: [{id, deck_id, version, format, content_hash, by, created_at}]}
 *          for every version of the deck's venture, newest first (50).
 *   POST /api/decks/:id/export  (decks.ts, PDF and PowerPoint)
 *        the middleware below hashes the file the route answers and writes
 *        its `deck_exports` row; its audit row is part 1's (#2674, fix 11).
 *        Part 1 owns `decks.ts`, so this part does not edit it: once it
 *        merges, `{format: 'html'}` joins that route and this middleware
 *        becomes one call there.
 *
 * WHO. The same check as the PDF export: `projectOwned` with `write`, so an
 * advisor is refused and an admin is not (PD21's "an admin changes nothing"
 * is part 1's to close in the Worker; the studio hides Export for them).
 *
 * BRAND. The venture owner's plan, never the exporter's (bug 9, as part 1's
 * `deckOwnerBrand`): a missing owner reads as the free plan.
 *
 * IMAGES. Every slide image is fetched here, once, under one deadline and a
 * byte cap, and kept only when its own first bytes are PNG, JPEG, GIF or
 * WebP (never SVG). One that cannot be fetched says so on its card. Nothing
 * here logs a URL, a title or a figure.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { refuse } from '../util/refusal';
import { logCycleWriteStatement } from '../services/cycleActivity';
import { getDeckBrand } from '../services/decks/branding';
import { boundedDownload } from '../services/channels/providerHttp';
import { imageDataUri, imageUrlsOf, sniffImage, writeOfflineDeck } from '../services/decks/offlineHtml';
import { sanitizeImageUrl } from './decks';

const deckExports = new Hono<{ Bindings: Env }>();

export const EXPORT_FORMATS = ['pdf', 'pptx', 'html', 'google_slides'] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];

/** One image: 2 MB; all of them: 12 MB; at most 40 distinct images per file. */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGES_MAX_BYTES = 12 * 1024 * 1024;
export const IMAGES_MAX = 40;
const IMAGE_DEADLINE_MS = 10_000;

export const NOT_RECORDED_MESSAGE = 'The export could not be recorded, so no file was made. Try again in a moment. Nothing was shared.';

const AUDIT_SUMMARY: Record<ExportFormat, string> = {
  pdf: 'Deck exported as PDF',
  pptx: 'Deck exported as PowerPoint',
  html: 'Deck exported as HTML',
  google_slides: 'Deck exported to Google Slides',
};

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type DeckRow = { id: number; project_id: number; version: number | null; title: string | null; slides: string | null };

async function deckRow(env: Env, id: number): Promise<DeckRow | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return env.DB.prepare('SELECT id, project_id, version, title, slides FROM pitch_decks WHERE id = ?').bind(id).first<DeckRow>();
}

/** The ledger row, and (when asked) its audit row, as one batch. */
export function exportStatements(env: Env, a: {
  deck: DeckRow; format: ExportFormat; contentHash: string | null; externalRef?: string | null; userId: number; audit: boolean;
}) {
  const out = [env.DB.prepare(
    'INSERT INTO deck_exports (deck_id, version, format, content_hash, external_ref, created_by) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(a.deck.id, a.deck.version ?? null, a.format, a.contentHash, a.externalRef ?? null, a.userId)];
  if (a.audit) {
    out.push(logCycleWriteStatement(env, {
      projectId: Number(a.deck.project_id), userId: a.userId, cycle: 'raise', module: 'pitch-deck',
      entityId: null, action: 'deck_exported', summary: AUDIT_SUMMARY[a.format],
    } as any));
  }
  return out;
}

/** The venture owner's plan decides the footer and the watermark (bug 9). */
async function ventureBrand(env: Env, projectId: number) {
  const owner = await env.DB.prepare(
    "SELECT u.id, u.role, u.subscription_tier FROM users u JOIN projects p ON p.founder_id = u.founder_id WHERE p.id = ? AND u.role = 'founder' ORDER BY u.id LIMIT 1",
  ).bind(projectId).first<any>().catch(() => null);
  return getDeckBrand(env, owner || ({ id: 0, role: 'founder', subscription_tier: 'free' } as any));
}

/** Each URL → a `data:` URI, or null when it could not be fetched, was too large, or is not a raster image. */
export async function inlineImages(urls: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const wanted = urls.slice(0, IMAGES_MAX);
  for (const u of urls.slice(IMAGES_MAX)) out.set(u, null);
  const got = await Promise.all(wanted.map(async (u) => {
    const safe = sanitizeImageUrl(u);
    if (!safe) return null;
    const d = await boundedDownload(safe, { maxBytes: IMAGE_MAX_BYTES, deadlineMs: IMAGE_DEADLINE_MS });
    if (!d.ok) return null;
    const kind = sniffImage(d.bytes);
    return kind ? { kind, bytes: d.bytes } : null;
  }));
  let total = 0;
  wanted.forEach((u, i) => {
    const g = got[i];
    if (!g || total + g.bytes.length > IMAGES_MAX_BYTES) { out.set(u, null); return; }
    total += g.bytes.length;
    out.set(u, imageDataUri(g.kind, g.bytes));
  });
  return out;
}

const fileName = (row: DeckRow, ext: string) =>
  `${(row.title || 'pitch-deck').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80)}${row.version == null ? '' : `-v${row.version}`}.${ext}`;

deckExports.post('/:id/export/html', async (c) => {
  const user = await requireAuth(c);
  const row = await deckRow(c.env, Number(c.req.param('id')));
  if (!row) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c, user, Number(row.project_id), { write: true }); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  const body = await c.req.json().catch(() => ({} as any));

  let slides: any[] = [];
  try { slides = JSON.parse(row.slides || '[]'); } catch { slides = []; }
  if (!Array.isArray(slides)) slides = [];
  slides = slides.slice(0, 60);

  const brand = await ventureBrand(c.env, Number(row.project_id));
  const urls = imageUrlsOf(slides);
  if (brand.watermark_url) urls.push(brand.watermark_url);
  const images = await inlineImages(urls);
  const html = await writeOfflineDeck({
    title: row.title || 'Pitch deck',
    version: row.version ?? null,
    slides,
    images,
    footer: brand.show_footer ? brand.footer_text : null,
    watermark: brand.watermark_url ? images.get(brand.watermark_url) ?? null : null,
    notes: body?.notes === true,
    sources: body?.sources === true,
  });
  const bytes = new TextEncoder().encode(html);
  const hash = await sha256Hex(bytes);
  try {
    await c.env.DB.batch(exportStatements(c.env, { deck: row, format: 'html', contentHash: hash, userId: Number(user.id), audit: true }));
  } catch (e) {
    return refuse(c, 503, { code: 'export_not_recorded', message: NOT_RECORDED_MESSAGE, raw: e, audience: 'member' });
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName(row, 'html')}"`,
      'Cache-Control': 'no-store',
      'X-Content-SHA256': hash,
    },
  });
});

deckExports.get('/:id/exports', async (c) => {
  const user = await requireAuth(c);
  const row = await deckRow(c.env, Number(c.req.param('id')));
  if (!row) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c, user, Number(row.project_id)); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.deck_id, e.version, e.format, e.content_hash, e.created_at, u.name AS by_name
       FROM deck_exports e JOIN pitch_decks d ON d.id = e.deck_id
       LEFT JOIN users u ON u.id = e.created_by
      WHERE d.project_id = ? ORDER BY e.id DESC LIMIT 50`,
  ).bind(Number(row.project_id)).all<any>();
  return c.json({
    exports: (results || []).map((r: any) => ({
      id: r.id, deck_id: r.deck_id, version: r.version ?? null, format: r.format,
      content_hash: r.content_hash ?? null, by: r.by_name ?? null, created_at: r.created_at,
    })),
  });
});

const FORMAT_OF_TYPE: Record<string, ExportFormat> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/** The PDF and PowerPoint file `decks.ts` answers, recorded before it is handed out. */
deckExports.use('/:id/export', async (c, next) => {
  if (c.req.method !== 'POST') return next();
  await next();
  const res = c.res;
  const format = FORMAT_OF_TYPE[String(res.headers.get('content-type') || '').split(';')[0].trim()];
  if (res.status !== 200 || !format) return;
  const bytes = await res.arrayBuffer();
  const row = await deckRow(c.env, Number(c.req.param('id')));
  const user = await requireAuth(c);
  const hash = await sha256Hex(bytes);
  try {
    if (!row) throw new Error('deck row gone');
    await c.env.DB.batch(exportStatements(c.env, { deck: row, format, contentHash: hash, userId: Number(user.id), audit: false }));
  } catch (e) {
    c.res = undefined as any;
    c.res = refuse(c, 503, { code: 'export_not_recorded', message: NOT_RECORDED_MESSAGE, raw: e, audience: 'member' });
    return;
  }
  const headers = new Headers(res.headers);
  headers.set('X-Content-SHA256', hash);
  c.res = undefined as any;
  c.res = new Response(bytes, { status: 200, headers });
});

export default deckExports;
