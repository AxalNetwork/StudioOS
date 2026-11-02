/**
 * D1564 (#3811, deck builder v2 D3) — a share link published as a web page:
 * its publish state, the 506(b) refusal, the email gate, `/embed/:token` for
 * the sites the founder lists, and the link's own preview card.
 *
 *   GET  /api/decks/:id/investor-links/:shareId/publish   { link_id, publish, public_views, note }
 *   PUT  /api/decks/:id/investor-links/:shareId/publish   { on: true, exemption: '506c', gate?: 'email', embed_origins?: [https origins] } | { on: false }
 *   POST /api/decks/share/:token/email                    { email } → the reader passes the email gate in this browser
 *   GET  /embed/:token                                    the SPA shell, framed only by the link's listed origins (index.ts, before Hono)
 *   GET  /deck/share/:token, /share/deck/:token            the link's own preview card, only while public views are on (index.ts)
 *
 * The rules are `services/decks/publish.ts` (pure). OWNER DECISION T: public
 * views are off (`PUBLIC_VIEWS_ON`), so an un-gated publish is refused (409
 * `public_views_off`), every published link asks for an email before it
 * sends a card, and no link previews as itself: the static private card of
 * #3916 stays. A 506(b) round never publishes (409 `exemption_506b`).
 *
 * Publishing changes nothing else about the link: its expiry, view cap,
 * forwarding, NDA and what it includes all still apply, so a link meant as a
 * page is made with No cap and Forwarding on. A forwarding-off link cannot be
 * embedded: no browser is bound to a frame.
 *
 * The gate's cookie is `SameSite=None; Partitioned`, so it also works inside a
 * listed site's frame; it is the gate's alone, never the forwarding cookie.
 *
 * WHO. `projectOwned`, as every deck route: the read for the venture's
 * readers, the write with `write: true`. The email gate and the embed are the
 * token's, like the share read.
 *
 * Mounted in index.ts BEFORE `decks`, beside `deck_investor_links.ts`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { auditDeckWrite, getDeckRow, projectOwned, rowToDeck, shareLinkLive, verifySignedToken, viewerHashOf } from './decks';
import { ensureDeckShareConversionSchema } from './deck_share_actions';
import { parseShareInclude, shareSlides } from '../services/decks/shareInclude';
import {
  PUBLIC_VIEWS_OFF, cleanEmail, cleanEmbedOrigins, embedAllowed, frameAncestors, gateFor, linkOgImage,
  publicViewsOn, publishOf, publishRefusal, withPublish, type Publish,
} from '../services/decks/publish';
import { SHELL_HEADERS, rewriteShell } from '../services/socialCards';
import { SITE_NAME, ogImageUrl } from '../../../frontend/src/lib/ogRegistry.js';

const deckPublish = new Hono<{ Bindings: Env }>();

/** The email gate's cookie: one per browser, read only by the gate. */
export const GATE_COOKIE = 'axal_deck_gate';
const TOKEN_RE = /^[A-Za-z0-9._~-]{16,2048}$/;

async function sha256Hex(s: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function cookieOf(header: string | null | undefined, name: string): string | null {
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) {
      const v = part.slice(at + 1).trim();
      return /^[A-Za-z0-9_-]{16,128}$/.test(v) ? v : null;
    }
  }
  return null;
}

const gateHash = (value: string) => sha256Hex(`deck-gate:${value}`);

type LinkRow = { id: number; deck_id: number; include_json: string | null; revoked_at: string | null; live: number };

async function deckFor(c: any, user: User, write: boolean): Promise<{ row: any } | { refused: Response }> {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return { refused: refuse(c, 400, { code: 'bad_id', message: 'There is no such deck.' }) };
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return { refused: c.json({ error: 'not found' }, 404) }; }
  try { await projectOwned(c, user, Number(row.project_id), write ? { write: true } : {}); } catch (e: any) {
    return { refused: e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403) };
  }
  return { row };
}

async function linkOf(env: Env, deckId: number, shareId: number): Promise<LinkRow | null> {
  return env.DB.prepare(
    `SELECT id, deck_id, include_json, revoked_at, (revoked_at IS NULL AND datetime(expires_at) > datetime('now')) AS live
       FROM pitch_deck_share_tokens WHERE id = ? AND deck_id = ?`,
  ).bind(shareId, deckId).first<LinkRow>();
}

const answer = (linkId: number, p: Publish | null) => {
  const on = publicViewsOn();
  return { link_id: linkId, publish: p, gate: p ? gateFor(p, on) : null, public_views: on, note: on ? null : PUBLIC_VIEWS_OFF };
};

deckPublish.get('/:id/investor-links/:shareId/publish', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, false);
  if ('refused' in got) return got.refused;
  const shareId = Number(c.req.param('shareId'));
  if (!Number.isSafeInteger(shareId) || shareId < 1) return c.json({ error: 'not found' }, 404);
  const link = await linkOf(c.env, Number(got.row.id), shareId);
  if (!link) return c.json({ error: 'not found' }, 404);
  return c.json(answer(Number(link.id), publishOf(link.include_json)));
});

deckPublish.put('/:id/investor-links/:shareId/publish', async (c) => {
  const user = await requireAuth(c);
  const got = await deckFor(c, user, true);
  if ('refused' in got) return got.refused;
  const shareId = Number(c.req.param('shareId'));
  if (!Number.isSafeInteger(shareId) || shareId < 1) return c.json({ error: 'not found' }, 404);
  const link = await linkOf(c.env, Number(got.row.id), shareId);
  if (!link) return c.json({ error: 'not found' }, 404);
  const b = await c.req.json<any>().catch(() => null);
  const body: Record<string, unknown> = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  const projectId = Number(got.row.project_id);
  if (body.on === false) {
    await c.env.DB.prepare('UPDATE pitch_deck_share_tokens SET include_json = ? WHERE id = ?').bind(withPublish(link.include_json, null), link.id).run();
    await auditDeckWrite(c, user, projectId, 'deck_link_unpublished', 'A share link was unpublished');
    return c.json(answer(Number(link.id), null));
  }
  if (body.on !== true) return refuse(c, 422, { code: 'on_missing', message: 'Say whether to publish the link: on true or false.' });
  const no = publishRefusal(body);
  if (no) return refuse(c, no.status, { code: no.code, message: no.message });
  if (!Number(link.live)) return refuse(c, 409, { code: 'link_closed', message: 'This link no longer opens, so it cannot be published. Make a new one.' });
  const p: Publish = {
    on: true, gate: body.gate === 'none' ? 'none' : 'email', exemption: '506c',
    embed_origins: cleanEmbedOrigins(body.embed_origins) ?? [], at: new Date().toISOString(),
  };
  await c.env.DB.prepare('UPDATE pitch_deck_share_tokens SET include_json = ? WHERE id = ?').bind(withPublish(link.include_json, p), link.id).run();
  await auditDeckWrite(c, user, projectId, 'deck_link_published', `A share link was published under 506(c), ${gateFor(p) === 'email' ? 'email gate on' : 'no gate'}`);
  return c.json(answer(Number(link.id), p));
});

/** The live link a share token names, with its publish state; null for a bad, closed or unpublished one. */
async function publishedLink(env: Env, token: string, viewerHash: string | null): Promise<{ id: number; deck_id: number; project_id: number; include_json: string | null; publish: Publish } | null> {
  if (!TOKEN_RE.test(token)) return null;
  let payload: any;
  try { payload = await verifySignedToken(env, token); } catch { return null; }
  const m = /^deck:(\d+):v(\d+)$/.exec(String(payload?.k || ''));
  if (!m) return null;
  const hash = await sha256Hex(token);
  const live = await shareLinkLive(env, hash, viewerHash);
  if (!live || live.deck_id !== Number(m[1])) return null;
  const row = await env.DB.prepare(
    'SELECT t.id, t.deck_id, t.include_json, d.project_id FROM pitch_deck_share_tokens t JOIN pitch_decks d ON d.id = t.deck_id WHERE t.id = ?',
  ).bind(live.id).first<{ id: number; deck_id: number; include_json: string | null; project_id: number }>();
  const publish = row ? publishOf(row.include_json) : null;
  return row && publish ? { id: Number(row.id), deck_id: Number(row.deck_id), project_id: Number(row.project_id), include_json: row.include_json, publish } : null;
}

/**
 * Has this browser passed the email gate on this link (the share read asks).
 * An answer that cannot be read is no: the gate stays shut.
 */
export async function emailGatePassed(env: Env, cookieHeader: string | null | undefined, linkId: number): Promise<boolean> {
  const value = cookieOf(cookieHeader, GATE_COOKIE);
  if (!value) return false;
  try {
    await ensureDeckShareConversionSchema(env);
    const ok = await env.DB.prepare(
      "SELECT 1 AS ok FROM deck_share_conversions WHERE share_token_id = ? AND type = 'email_gate' AND json_extract(ref_id, '$.v') = ? LIMIT 1",
    ).bind(linkId, await gateHash(value)).first<{ ok: number }>();
    return !!ok;
  } catch (e) {
    console.error('[deck publish] email gate unreadable', (e as Error).message);
    return false;
  }
}

/** The share read's answer for a published link whose reader has not passed the gate: no card, no view used. */
export async function emailGateAnswer(env: Env, deckId: number) {
  const deck = await env.DB.prepare(
    'SELECT d.version, d.title, d.created_at, p.name AS project_name FROM pitch_decks d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = ?',
  ).bind(deckId).first<{ version: number; title: string | null; created_at: string | null; project_name: string | null }>();
  return {
    gate: 'email',
    project_name: deck?.project_name ? String(deck.project_name).slice(0, 200) : null,
    title: deck?.title ?? null,
    frozen: { version: deck ? Number(deck.version) : null, as_of: deck?.created_at ?? null },
  };
}

deckPublish.post('/share/:token/email', async (c) => {
  const token = c.req.param('token');
  // With forwarding off, only the bound browser's link is live (decision 5), as on the share read.
  const link = await publishedLink(c.env, token, await viewerHashOf(c));
  if (!link) return refuse(c, 404, { code: 'not_published', message: 'This link is not open as a page.' });
  const b = await c.req.json<any>().catch(() => null);
  const email = cleanEmail(b?.email);
  if (!email) return refuse(c, 422, { code: 'email_invalid', message: 'Enter your email address to read the deck.' });
  let value = cookieOf(c.req.header('cookie'), GATE_COOKIE);
  if (!value) value = b64url(crypto.getRandomValues(new Uint8Array(24)));
  await ensureDeckShareConversionSchema(c.env);
  const v = await gateHash(value);
  const seen = await c.env.DB.prepare(
    "SELECT 1 AS ok FROM deck_share_conversions WHERE share_token_id = ? AND type = 'email_gate' AND json_extract(ref_id, '$.v') = ? LIMIT 1",
  ).bind(link.id, v).first<{ ok: number }>();
  if (!seen) {
    // The address is the venture's record of who read the page; it is never logged.
    await c.env.DB.prepare(
      "INSERT INTO deck_share_conversions (share_token_id, deck_id, project_id, type, ref_id) VALUES (?, ?, ?, 'email_gate', ?)",
    ).bind(link.id, link.deck_id, link.project_id, JSON.stringify({ v, e: email })).run();
  }
  c.header('Set-Cookie', `${GATE_COOKIE}=${value}; Path=/api/decks/share; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${30 * 24 * 3600}`);
  return c.json({ ok: true });
});

const textResponse = (status: number, body: string) => new Response(body, {
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff' },
});

/**
 * `GET /embed/:token` (index.ts, before Hono). The SPA shell, whose
 * `/embed/:token` route draws the card view, framed only by the origins the
 * founder listed on a published link: the request must come from a frame
 * whose page is one of them, and the answer carries `frame-ancestors` with
 * those origins and no `X-Frame-Options`. Everything else is refused with
 * frames denied. The SPA's `_headers` deny stays for every other path.
 */
export async function serveDeckEmbed(request: Request, env: Env): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return textResponse(405, 'Method not allowed\n');
  const token = decodeURIComponent(new URL(request.url).pathname.slice('/embed/'.length).replace(/\/+$/, ''));
  let link: Awaited<ReturnType<typeof publishedLink>> = null;
  try { link = env.DB ? await publishedLink(env, token, null) : null; } catch { link = null; }
  if (!link) return textResponse(404, 'Not found\n');
  if (!embedAllowed(link.publish, request.headers.get('referer'), request.headers.get('sec-fetch-dest'))) {
    return textResponse(403, 'This deck may not be embedded here.\n');
  }
  if (!env.ASSETS) return textResponse(404, 'Not found\n');
  const shell = await env.ASSETS.fetch(new Request(request.url, { method: 'GET', headers: { accept: 'text/html' } }));
  const headers = new Headers(shell.headers);
  for (const k of ['content-length', 'etag', 'content-security-policy', 'content-security-policy-report-only', 'x-frame-options']) headers.delete(k);
  for (const [k, v] of Object.entries(SHELL_HEADERS)) if (k !== 'x-frame-options') headers.set(k, v);
  headers.set('content-security-policy', frameAncestors(link.publish));
  headers.set('x-robots-tag', 'noindex');
  headers.set('cache-control', 'no-store');
  return new Response(method === 'HEAD' ? null : shell.body, { status: shell.status, statusText: shell.statusText, headers });
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/**
 * A published link's own preview card (`og:image` per link): the venture and
 * the deck's title, and its first card's picture. Only while public views are
 * on; until then this answers null and the token link keeps #3916's static
 * private card, with no D1 call. Never throws.
 */
export async function serveDeckShareCard(request: Request, env: Env, publicViews: boolean = publicViewsOn()): Promise<Response | null> {
  if (!publicViews || !env.ASSETS || !env.DB) return null;
  const url = new URL(request.url);
  const m = /^\/(?:deck\/share|share\/deck)\/([^/]+)\/?$/.exec(url.pathname);
  if (!m || request.method.toUpperCase() !== 'GET') return null;
  try {
    const link = await publishedLink(env, decodeURIComponent(m[1]), null);
    if (!link) return null;
    const row = await env.DB.prepare('SELECT d.*, p.name AS project_name FROM pitch_decks d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = ?')
      .bind(link.deck_id).first<any>();
    if (!row) return null;
    const slides = shareSlides(rowToDeck(row).slides || [], parseShareInclude(link.include_json));
    const own = linkOgImage(slides);
    const venture = String(row.project_name || '').trim();
    const title = clip([venture, String(row.title || '').trim() || 'Pitch deck'].filter(Boolean).join(' · '), 70);
    const shell = await env.ASSETS.fetch(new Request(request.url, { method: 'GET', headers: { accept: 'text/html' } }));
    if (shell.status !== 200) return null;
    const body = rewriteShell(await shell.text(), {
      title, description: clip(`${venture || 'A venture'}'s deck on ${SITE_NAME}. You will be asked for your email to read it.`, 200),
      url: `${url.origin}${url.pathname}`, image: own || ogImageUrl('default'), imageIsCard: !own, imageAlt: title, type: 'website',
    });
    if (body == null) return null;
    const headers = new Headers(shell.headers);
    for (const k of ['content-length', 'etag', 'content-security-policy']) headers.delete(k);
    for (const [k, v] of Object.entries(SHELL_HEADERS)) headers.set(k, v);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('x-robots-tag', 'noindex');
    return new Response(body, { status: 200, headers });
  } catch { return null; }
}

export default deckPublish;
