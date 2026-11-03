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
 *   POST /api/decks/:id/export  (PDF in decks.ts; PowerPoint here, D1574)
 *        the middleware below hashes the file the route answers and writes
 *        its `deck_exports` row; its audit row is part 1's (#2674, fix 11).
 *        D1574 (#3821): {format:'pptx'} is answered by the handler at the end
 *        of this file with the editable PowerPoint (`pptxEditable.ts`); a
 *        PDF passes on to decks.ts with D895's route and audit.
 *
 * WHO. The same D895 deck-specific check as PDF/PowerPoint: founders export,
 * admins read without exporting, and advisors cannot read deck data.
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
import { refuse } from '../util/refusal';
import { logCycleWriteStatement } from '../services/cycleActivity';
import { getDeckBrand } from '../services/decks/branding';
import { imageDataUri, imageUrlsOf, sniffImage, writeOfflineDeck, type ImageKind } from '../services/decks/offlineHtml';
import { fetchExternalImage } from '../services/decks/imageSafety';
import type { ExportImageCopies } from '../services/decks/imageCopy';
import { dohResolver } from '../integrations/customMcp';
import { auditDeckWrite, copyStoredDeckImages, deckOwnerBrand, ensureSchema, exportDeckOf, projectOwned, sanitizeImageUrl, signDeckPrintToken, themeOfRow } from './decks';
import { deckCompliance } from '../services/decks/compliance';
import { context as workspaceContext, member } from './google_workspace';
import { WorkspaceError } from '../services/google/workspace';
import { createPresentation, driveName } from '../services/google/driveCreate';
import { writeEditableDeck, type ChartShot } from '../services/decks/pptxEditable';
import type { ResolvedSeries } from '../services/decks/pptxChart';
import { readSeries } from '../services/decks/chartSeries';
import { dirOf } from '../services/decks/designSystem';
import { ODP_MIMETYPE, writeOdp } from '../services/decks/odp';
import { visibleCards } from '../services/decks/slideModel';
import { stripTrailingSlashes } from '../util/url';
import { aiImagesOf, markImages } from '../services/decks/aiMarking';
import { pdfLangOf } from '../services/decks/pdfExport';
import { DECK_PAGE_LOAD_MS, MAX_SLIDE_PNG_BYTES, renderUrl } from '../services/browserRun';

const deckExports = new Hono<{ Bindings: Env }>();

export const EXPORT_FORMATS = ['pdf', 'pptx', 'html', 'google_slides', 'odp'] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];

/** One image: 2 MB; all of them: 12 MB; at most 40 distinct images per file. */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGES_MAX_BYTES = 12 * 1024 * 1024;
export const IMAGES_MAX = 40;
const IMAGE_DEADLINE_MS = 10_000;
/** #3655: every chart picture of one Google Slides export, together. */
export const CHART_SHOTS_BUDGET_MS = 120_000;

export const NOT_RECORDED_MESSAGE = 'The export could not be recorded, so no file was made. Try again in a moment. Nothing was shared.';

const AUDIT_SUMMARY: Record<ExportFormat, string> = {
  pdf: 'Deck exported as PDF',
  pptx: 'Deck exported as PowerPoint',
  html: 'Deck exported as HTML',
  google_slides: 'Deck exported to Google Slides',
  odp: 'Deck exported as a slides-suite file (.odp)',
};

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type DeckRow = { id: number; project_id: number; version: number | null; title: string | null; slides: string | null; theme_json?: string | null };

async function deckRow(env: Env, id: number): Promise<DeckRow | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(id).first<DeckRow>();
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

/** Each URL → its bytes and kind, or null when it could not be fetched, was too large, or is not a raster image. */
export async function fetchImages(urls: string[]): Promise<Map<string, { kind: ImageKind; bytes: Uint8Array } | null>> {
  const out = new Map<string, { kind: ImageKind; bytes: Uint8Array } | null>();
  const wanted = urls.slice(0, IMAGES_MAX);
  for (const u of urls.slice(IMAGES_MAX)) out.set(u, null);
  const resolve = dohResolver(fetch);
  const got = await Promise.all(wanted.map(async (u) => {
    const safe = sanitizeImageUrl(u);
    if (!safe) return null;
    // D1506: through the DNS-checked fetcher (public addresses only, redirects checked hop by hop).
    const d = await fetchExternalImage(safe, resolve, fetch, IMAGE_DEADLINE_MS, IMAGE_MAX_BYTES);
    if (!d.ok) return null;
    const kind = sniffImage(d.bytes);
    return kind ? { kind, bytes: d.bytes } : null;
  }));
  let total = 0;
  wanted.forEach((u, i) => {
    const g = got[i];
    if (!g || total + g.bytes.length > IMAGES_MAX_BYTES) { out.set(u, null); return; }
    total += g.bytes.length;
    out.set(u, g);
  });
  return out;
}

/**
 * D1578 (#3825): the images an export embeds, each AI-drawn one marked in its
 * own file (IPTC DigitalSourceType and the model id, `aiMarking.markImages`),
 * so the mark survives the PowerPoint, .odp, HTML and Google Slides files.
 */
export async function markedImages(env: Env, projectId: number, slides: any[], urls: string[] = imageUrlsOf(slides)): Promise<Map<string, { kind: ImageKind; bytes: Uint8Array } | null>> {
  const images = await fetchImages(urls);
  markImages(images, await aiImagesOf(env, projectId, slides));
  return images;
}


/** At most this many distinct bound series are read for one file. */
export const BOUND_SERIES_MAX = 24;

/**
 * D1574 (#3821): each bound chart series' points, read from its store now
 * (`chartSeries.readSeries`), by source key — what the editor and the print
 * page draw. A series its store cannot read, or holds nothing for, is absent;
 * the writer then draws the chart from what it has, never a made-up point.
 */
export async function boundSeries(env: Env, projectId: number, slides: any[]): Promise<ResolvedSeries> {
  const keys = new Set<string>();
  for (const s of slides) for (const b of Array.isArray(s?.blocks) ? s.blocks : []) {
    if (b?.kind !== 'chart') continue;
    for (const sr of Array.isArray(b.series) ? b.series : []) {
      const k = sr?.binding?.source_key;
      if (typeof k === 'string' && k) keys.add(k);
    }
  }
  const out: ResolvedSeries = new Map();
  for (const k of [...keys].slice(0, BOUND_SERIES_MAX)) {
    const got = await readSeries(env, projectId, k).catch(() => null);
    if (got && got.state === 'recorded' && got.points.length) out.set(k, got.points);
  }
  return out;
}

const fileName = (row: DeckRow, ext: string) =>
  `${(row.title || 'pitch-deck').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80)}${row.version == null ? '' : `-v${row.version}`}.${ext}`;

deckExports.post('/:id/export/html', async (c) => {
  const user = await requireAuth(c);
  const found = await deckRow(c.env, Number(c.req.param('id')));
  if (!found) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c, user, Number(found.project_id), { write: true }); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  // D1506: outside images are copied in before any export reads them.
  const copied = await copyStoredDeckImages(c, user, found);
  if ('refused' in copied) return copied.refused;
  const row: DeckRow = copied.row;
  const body = await c.req.json().catch(() => ({} as any));

  let slides: any[] = [];
  try { slides = JSON.parse(row.slides || '[]'); } catch { slides = []; }
  if (!Array.isArray(slides)) slides = [];
  // D1545 (#3788): a hidden card is not in the HTML file.
  slides = visibleCards(slides).slice(0, 60);

  const brand = await ventureBrand(c.env, Number(row.project_id));
  const urls = imageUrlsOf(slides);
  if (brand.watermark_url) urls.push(brand.watermark_url);
  // D1578: the HTML file's pictures are its embedded bytes, each AI-drawn one marked.
  const images = new Map([...(await markedImages(c.env, Number(row.project_id), slides, urls))].map(([u, g]) => [u, g ? imageDataUri(g.kind, g.bytes) : null] as const));
  const html = await writeOfflineDeck({
    title: row.title || 'Pitch deck',
    version: row.version ?? null,
    slides,
    images,
    footer: brand.show_footer ? brand.footer_text : null,
    watermark: brand.watermark_url ? images.get(brand.watermark_url) ?? null : null,
    notes: body?.notes === true,
    sources: body?.sources === true,
    compliance: deckCompliance(slides, themeOfRow(row)),
    // D1571 (#3818): the deck's language and direction on every card of the file.
    lang: typeof themeOfRow(row)?.lang === 'string' ? themeOfRow(row).lang : null,
    dir: dirOf(themeOfRow(row)?.lang, themeOfRow(row)?.dir),
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

/**
 * A chart pictured from the print page, block by block, when the headless browser is bound;
 * null otherwise. #3655: through the documented `quickAction` (`renderUrl`), one try each
 * under one deadline; a chart that cannot be pictured goes in as words.
 */
async function chartShotFor(c: any, row: DeckRow, opts: { notes: boolean; sources: boolean }, imageCopies?: ExportImageCopies): Promise<ChartShot | null> {
  if (typeof c.env.BROWSER?.quickAction !== 'function') return null;
  const token = await signDeckPrintToken(c.env, row.id, 300, opts, imageCopies);
  const base = stripTrailingSlashes((c.env as any).PUBLIC_BASE_URL || (c.env as any).APP_URL || 'https://axal.vc');
  const deadline = Date.now() + CHART_SHOTS_BUDGET_MS;
  return async (i, r) => {
    const shot = await renderUrl(c.env, 'screenshot', {
      url: `${base}/deck/print-export/${token}?print_mode=single&slide=${i}`,
      viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
      gotoOptions: { waitUntil: 'networkidle0', timeout: DECK_PAGE_LOAD_MS },
      screenshotOptions: { type: 'png', omitBackground: false, clip: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h) } },
    }, { kind: 'png', maxBytes: MAX_SLIDE_PNG_BYTES, attempts: 1, deadline });
    if (!shot.ok) { console.warn('[decks/export] chart as words', shot.code, shot.status ?? ''); return null; }
    return shot.bytes;
  };
}

/**
 * D1603 (#3882) — pd8b's "Slides-suite file (.odp)": the version as an
 * OpenDocument Presentation (`odp.ts`), editable at 16:9 in LibreOffice
 * Impress and the other open suites. The HTML export's rules: the D895 deck
 * check (founders export; admins, advisors and share-only readers do not), 60
 * cards, the venture owner's brand, and one `deck_exports` row with one
 * `raise.pitch-deck` audit row in one batch before the file is handed out.
 * No model runs; nothing is charged.
 */
deckExports.post('/:id/export/odp', async (c) => {
  const user = await requireAuth(c);
  const found = await deckRow(c.env, Number(c.req.param('id')));
  if (!found) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c, user, Number(found.project_id), { write: true }); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  // D1506: outside images are copied in before any export reads them.
  const copied = await copyStoredDeckImages(c, user, found);
  if ('refused' in copied) return copied.refused;
  const row: DeckRow = copied.row;
  const body = await c.req.json().catch(() => ({} as any));
  const opts = { notes: body?.notes === true, sources: body?.sources === true };
  const { slides: all, renderable } = exportDeckOf(row, opts);
  const slides = all.slice(0, 60);
  const cards = renderable.slides.slice(0, slides.length);
  const pages = opts.sources && renderable.slides.length > all.length ? [...cards, renderable.slides[renderable.slides.length - 1]] : cards;
  const brand = await ventureBrand(c.env, Number(row.project_id));
  const urls = imageUrlsOf(slides);
  if (brand.watermark_url) urls.push(brand.watermark_url);
  const images = await markedImages(c.env, Number(row.project_id), slides, urls);
  const odp = await writeOdp({
    title: row.title || 'Pitch deck', version: row.version ?? null, slides, renderable: pages, images, brand, compliance: deckCompliance(slides, themeOfRow(row)),
    notes: opts.notes, chartShot: await chartShotFor(c, row, opts, copied.imageCopies),
  });
  const hash = await sha256Hex(odp.bytes);
  try {
    await c.env.DB.batch(exportStatements(c.env, { deck: row, format: 'odp', contentHash: hash, userId: Number(user.id), audit: true }));
  } catch (e) {
    return refuse(c, 503, { code: 'export_not_recorded', message: NOT_RECORDED_MESSAGE, raw: e, audience: 'member' });
  }
  return new Response(odp.bytes, {
    status: 200,
    headers: {
      'Content-Type': ODP_MIMETYPE,
      'Content-Disposition': `attachment; filename="${fileName(row, 'odp')}"`,
      'Cache-Control': 'no-store',
      'X-Content-SHA256': hash,
    },
  });
});

/**
 * D904 (#2683) — PD17's Google Slides: the version as an editable PowerPoint
 * (`pptxEditable.ts`), created as a new presentation in the member's own
 * Drive (`driveCreate.ts`, the one Workspace write), then recorded.
 *
 * WHO. A signed-in member, never a support session (D1091); the D895 deck
 * check, as the other formats; and D1091's Workspace scope for the deck's
 * venture: the member's connection is active and its company is enabled.
 * Every refusal is a code; the dialog says it in words.
 *
 * ORDER. The file is created first, because its Drive id is what the
 * ledger keeps (`deck_exports.external_ref`, migration 537), with the
 * uploaded file's SHA-256 and one `raise.pitch-deck` audit row in one batch.
 * When that batch fails the presentation already exists in the member's
 * Drive, so the answer says so and links it (`export_not_recorded_created`)
 * rather than claiming nothing happened.
 */
deckExports.post('/:id/export/google-slides', async (c) => {
  let user: any;
  try { user = await member(c); } catch (e) {
    if (e instanceof WorkspaceError) return c.json({ error: e.code }, e.status as any);
    throw e;
  }
  const found = await deckRow(c.env, Number(c.req.param('id')));
  if (!found) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c, user, Number(found.project_id), { write: true }); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  // D1506: outside images are copied in before any export reads them.
  const copied = await copyStoredDeckImages(c, user, found);
  if ('refused' in copied) return copied.refused;
  const row: DeckRow = copied.row;
  try { await workspaceContext(c, user, row.project_id); } catch (e) {
    const w = e instanceof WorkspaceError ? e : new WorkspaceError('workspace_unreadable');
    return c.json({ error: w.code }, w.status as any);
  }
  const body = await c.req.json().catch(() => ({} as any));
  const opts = { notes: body?.notes === true, sources: body?.sources === true };
  const { slides, renderable } = exportDeckOf(row, opts);
  const brand = await ventureBrand(c.env, Number(row.project_id));
  const images = await markedImages(c.env, Number(row.project_id), slides);

  const chartShot = await chartShotFor(c, row, opts, copied.imageCopies);
  // D1571 (#3818): an Arabic or Hebrew deck's words read right to left in the editable file too.
  // D1574 (#3821): the same writer as the PowerPoint download — native charts from the stores' points.
  const series = await boundSeries(c.env, Number(row.project_id), slides);
  const deck = await writeEditableDeck({ slides, renderable: renderable.slides, brand, notes: opts.notes, images, chartShot, compliance: deckCompliance(slides, themeOfRow(row)), dir: dirOf(themeOfRow(row)?.lang, themeOfRow(row)?.dir), series,
    meta: { title: row.title || 'Pitch deck', lang: pdfLangOf(themeOfRow(row)) } });
  const hash = await sha256Hex(deck.bytes);

  let created;
  try {
    created = await createPresentation(c.env, Number(user.id), { name: driveName(row.title || 'Pitch deck', row.version ?? null), bytes: deck.bytes });
  } catch (e) {
    const w = e instanceof WorkspaceError ? e : new WorkspaceError('google_not_created');
    return c.json({ error: w.code }, w.status as any);
  }
  try {
    await c.env.DB.batch(exportStatements(c.env, { deck: row, format: 'google_slides', contentHash: hash, externalRef: created.file_id, userId: Number(user.id), audit: true }));
  } catch (e) {
    console.warn('[decks/export/google-slides] created but not recorded', (e as Error)?.name);
    return c.json({ error: 'export_not_recorded_created', url: created.url, converted: created.converted }, 503);
  }
  return c.json({
    created: true, file_id: created.file_id, url: created.url, converted: created.converted,
    charts: deck.charts, images: deck.images, content_hash: hash,
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
  [ODP_MIMETYPE]: 'odp',
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

/**
 * D1574 (#3821, deck v2 E1) — pd8b's PowerPoint, "Keeps your layout": the
 * version as the editable PowerPoint (`pptxEditable.ts`) — every area a
 * native text box, shape, picture or chart at The Grid's placement, the
 * one the editor draws and the .odp writer uses. It replaces the picture of
 * each slide, so no headless browser is needed; one is used only to picture
 * a chart whose type has no native counterpart (`chartShotFor`).
 *
 * Registered after the ledger middleware above, which records the file
 * before it is handed out; a PDF passes on to `decks.ts`. The D895 check,
 * the venture owner's brand and the `deck_exported` audit row are the PDF's.
 */
deckExports.post('/:id/export', async (c, next) => {
  const body = await c.req.json().catch(() => ({} as any));
  if (String(body?.format || 'pdf').toLowerCase() !== 'pptx') return next();
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const found = await deckRow(c.env, Number(c.req.param('id')));
  if (!found) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c, user, Number(found.project_id), { write: true }); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  // D1506: outside images are copied in before any export reads them.
  const copied = await copyStoredDeckImages(c, user, found);
  if ('refused' in copied) return copied.refused;
  const row: DeckRow = copied.row;
  // D1112 (#2992): PD17's two options apply to every format.
  const opts = { notes: body?.notes === true, sources: body?.sources === true };
  const { slides, renderable } = exportDeckOf(row, opts);
  const projectId = Number(row.project_id);
  const theme = themeOfRow(row);
  const deck = await writeEditableDeck({
    slides, renderable: renderable.slides, brand: await deckOwnerBrand(c.env, projectId), notes: opts.notes,
    images: await markedImages(c.env, projectId, slides), chartShot: await chartShotFor(c, row, opts, copied.imageCopies),
    compliance: deckCompliance(slides, theme), dir: dirOf(theme?.lang, theme?.dir), series: await boundSeries(c.env, projectId, slides),
    meta: { title: row.title || 'Pitch deck', lang: pdfLangOf(theme) },
  });
  await auditDeckWrite(c, user, projectId, 'deck_exported', 'Deck exported');
  const fname = (row.title || 'pitch-deck').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80);
  return new Response(deck.bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${fname}.pptx"`,
      'Cache-Control': 'no-store',
      'X-Deck-Export-Mode': 'editable',
    },
  });
});

export default deckExports;
