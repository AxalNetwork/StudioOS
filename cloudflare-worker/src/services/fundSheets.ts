/**
 * Google Sheets sync for Super Admin fund research.
 *
 * Sheets never talks to D1. This module is the Worker job that sits between
 * them: it reads `research_funds` for the authenticated owner, writes those
 * rows onto a spreadsheet the owner named, and reads the sheet back into
 * POST/PATCH on the same table. Push never deletes. Calendar tokens are not
 * reused — adding the spreadsheets scope to `GOOGLE_SCOPES` in calendar.ts
 * would force every connected calendar to re-consent.
 *
 * Routes in `routes/research.ts` refuse anyone who is not a Super Admin.
 * No Hono Context, no Response.
 */
import type { Env } from '../types';
import { encryptString, decryptString } from './cryptoBox';
import { callbackBase, stripTrailingSlashes } from '../util/url';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const STATE_TTL_SECONDS = 600;

export const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
];

export const SHEET_HEADERS = [
  'uid',
  'Fund',
  'Cheque min (USD)',
  'Cheque max (USD)',
  'Stage fit',
  'Path',
  'State',
  'Pass reason',
  'Thesis',
  'Note',
  'Source URL',
] as const;

export const FUND_STAGE_FIT = new Set(['right', 'wrong']);
export const FUND_PATH = new Set(['warm', 'cold']);
export const FUND_STATUS = new Set(['researching', 'passed']);

/** Placeholder only — the Super Admin pastes a URL; this is not the only target. */
export const SUGGESTED_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1aLFMMqZYXdnIcutEnggadAFOunDKEyDeB5sWuhFk1OQ/edit?gid=100';

export type FundSheetRow = {
  uid: string | null;
  name: string | null;
  cheque_min_cents: number | null;
  cheque_max_cents: number | null;
  stage_fit: string | null;
  path: string | null;
  status: string | null;
  pass_reason: string | null;
  thesis: string | null;
  note: string | null;
  source_url: string | null;
};

export type FundRecord = {
  uid: string;
  name: string;
  cheque_min_cents: number | null;
  cheque_max_cents: number | null;
  stage_fit: string | null;
  path: string | null;
  status: string;
  pass_reason: string | null;
  thesis: string | null;
  note: string | null;
  source_url: string | null;
};

export type SheetLink = {
  spreadsheet_id: string;
  sheet_gid: number;
  sheet_title: string | null;
  last_pulled_at: string | null;
  last_pushed_at: string | null;
  last_error: string | null;
};

type SheetToken = {
  refresh_token: string;
  scope: string;
  google_email: string | null;
};

function isProd(env: Env): boolean {
  const e = String(env.ENVIRONMENT || '').toLowerCase();
  return e === 'production' || e === 'prod';
}

function overrideAcceptable(env: Env, override: string | undefined): string | null {
  if (!override) return null;
  if (isProd(env)) {
    try {
      const host = new URL(override).hostname.toLowerCase();
      if (host.endsWith('.workers.dev')) return null;
    } catch {
      return null;
    }
  }
  return override;
}

export function googleSheetsClientId(env: Env): string | undefined {
  return env.GOOGLE_SHEETS_CLIENT_ID || env.GOOGLE_CLIENT_ID || env.GOOGLE_CAL_CLIENT_ID;
}

export function googleSheetsClientSecret(env: Env): string | undefined {
  return env.GOOGLE_SHEETS_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || env.GOOGLE_CAL_CLIENT_SECRET;
}

export function googleSheetsRedirectUri(env: Env): string {
  const ov = overrideAcceptable(env, env.GOOGLE_SHEETS_REDIRECT_URI);
  if (ov) return ov;
  const base = stripTrailingSlashes(callbackBase(env));
  return base ? `${base}/api/research/funds/sheet/callback` : '';
}

export function googleSheetsOAuthAvailable(env: Env): boolean {
  return !!(googleSheetsClientId(env) && googleSheetsClientSecret(env) && googleSheetsRedirectUri(env));
}

export function preflightSheetsOAuthSecrets(env: Env): string[] {
  const missing: string[] = [];
  if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!googleSheetsClientId(env)) missing.push('GOOGLE_SHEETS_CLIENT_ID');
  if (!googleSheetsClientSecret(env)) missing.push('GOOGLE_SHEETS_CLIENT_SECRET');
  if (!googleSheetsRedirectUri(env)) missing.push('PUBLIC_BASE_URL');
  return missing;
}

export function fundsAppBase(env: Env): string {
  return stripTrailingSlashes(env.PUBLIC_BASE_URL || env.APP_URL || 'https://axal.vc');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacSign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return b64url(sig);
}

export function buildSheetsAuthUrl(env: Env, state: string, loginHint?: string): string {
  const p = new URLSearchParams({
    client_id: googleSheetsClientId(env)!,
    redirect_uri: googleSheetsRedirectUri(env),
    response_type: 'code',
    scope: SHEETS_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'select_account consent',
    state,
  });
  if (loginHint) p.set('login_hint', loginHint);
  return `${GOOGLE_AUTH_URL}?${p.toString()}`;
}

export async function makeSheetsState(env: Env, userId: number): Promise<string> {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const sig = await hmacSign(env.JWT_SECRET || '', nonce);
  const expires = new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString();
  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    `DELETE FROM oauth_state_tokens WHERE expires_at < ? AND expires_at != ''`,
  ).bind(nowIso).run().catch(() => null);
  await env.DB.prepare(
    `INSERT INTO oauth_state_tokens (state, user_id, provider, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(nonce, userId, 'google_sheets', expires).run();
  return `${nonce}.${sig}`;
}

export async function consumeSheetsState(env: Env, raw: string | null | undefined): Promise<number | null> {
  if (!raw || typeof raw !== 'string') return null;
  const i = raw.indexOf('.');
  if (i < 0) return null;
  const nonce = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = await hmacSign(env.JWT_SECRET || '', nonce);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let j = 0; j < sig.length; j++) diff |= sig.charCodeAt(j) ^ expected.charCodeAt(j);
  if (diff !== 0) return null;
  const row = await env.DB.prepare(
    `SELECT user_id, expires_at FROM oauth_state_tokens
      WHERE state = ? AND provider = ?`,
  ).bind(nonce, 'google_sheets').first<{ user_id: number; expires_at: string }>();
  await env.DB.prepare(
    `DELETE FROM oauth_state_tokens WHERE state = ?`,
  ).bind(nonce).run();
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.user_id as number;
}

export async function exchangeSheetsCode(env: Env, code: string): Promise<any> {
  if (!googleSheetsOAuthAvailable(env)) throw new Error('sheets_oauth_unavailable');
  const body = new URLSearchParams({
    code,
    client_id: googleSheetsClientId(env)!,
    client_secret: googleSheetsClientSecret(env)!,
    redirect_uri: googleSheetsRedirectUri(env),
    grant_type: 'authorization_code',
  });
  const r = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    let err = '';
    try { err = (JSON.parse(txt) as any)?.error || ''; } catch { /* ignore */ }
    throw new Error(`token_exchange_failed:${r.status}:${err || 'unknown'}`);
  }
  return r.json();
}

export async function refreshSheetsAccessToken(env: Env, refreshToken: string): Promise<string> {
  if (!googleSheetsOAuthAvailable(env)) throw new Error('sheets_oauth_unavailable');
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: googleSheetsClientId(env)!,
    client_secret: googleSheetsClientSecret(env)!,
    grant_type: 'refresh_token',
  });
  const r = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!r.ok) throw new Error(`refresh_failed:${r.status}`);
  return ((await r.json()) as any).access_token as string;
}

export async function fetchSheetsUserinfo(accessToken: string): Promise<any> {
  try {
    const r = await fetchWithTimeout(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (r.ok) return r.json();
  } catch { /* ignore */ }
  return {};
}

export async function saveSheetsToken(
  env: Env,
  user: { id: number },
  args: { refreshToken: string; scope: string; googleEmail: string | null; googleSub: string },
): Promise<void> {
  const enc = await encryptString(env, args.refreshToken);
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    `SELECT id FROM google_sheets_oauth_tokens WHERE user_id = ?`,
  ).bind(user.id).first<{ id: number }>();
  if (existing) {
    await env.DB.prepare(
      `UPDATE google_sheets_oauth_tokens
          SET refresh_token = ?, scope = ?, google_email = ?, google_sub = ?, updated_at = ?
        WHERE user_id = ?`,
    ).bind(enc, args.scope, args.googleEmail, args.googleSub || null, now, user.id).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO google_sheets_oauth_tokens
       (user_id, refresh_token, scope, google_email, google_sub, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(user.id, enc, args.scope, args.googleEmail, args.googleSub || null, now, now).run();
}

export async function loadSheetsToken(env: Env, userId: number): Promise<SheetToken | null> {
  const row = await env.DB.prepare(
    `SELECT refresh_token, scope, google_email FROM google_sheets_oauth_tokens WHERE user_id = ?`,
  ).bind(userId).first<{ refresh_token: string; scope: string; google_email: string | null }>();
  if (!row?.refresh_token) return null;
  const decrypted = await decryptString(env, row.refresh_token);
  return {
    refresh_token: decrypted || row.refresh_token,
    scope: row.scope || '',
    google_email: row.google_email || null,
  };
}

export async function deleteSheetsToken(env: Env, user: { id: number }): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM google_sheets_oauth_tokens WHERE user_id = ?`,
  ).bind(user.id).run();
}

export async function loadSheetLink(env: Env, userId: number): Promise<SheetLink | null> {
  const row = await env.DB.prepare(
    `SELECT spreadsheet_id, sheet_gid, sheet_title, last_pulled_at, last_pushed_at, last_error
       FROM research_fund_sheet_links WHERE owner_user_id = ?`,
  ).bind(userId).first<SheetLink>();
  return row || null;
}

export async function upsertSheetLink(
  env: Env,
  user: { id: number },
  spreadsheetId: string,
  sheetGid: number,
): Promise<SheetLink> {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    `SELECT spreadsheet_id FROM research_fund_sheet_links WHERE owner_user_id = ?`,
  ).bind(user.id).first<{ spreadsheet_id: string }>();
  if (existing) {
    await env.DB.prepare(
      `UPDATE research_fund_sheet_links
          SET spreadsheet_id = ?, sheet_gid = ?, last_error = NULL, updated_at = ?
        WHERE owner_user_id = ?`,
    ).bind(spreadsheetId, sheetGid, now, user.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO research_fund_sheet_links
         (owner_user_id, spreadsheet_id, sheet_gid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(user.id, spreadsheetId, sheetGid, now, now).run();
  }
  return (await loadSheetLink(env, user.id)) as SheetLink;
}

async function stampSheetError(env: Env, userId: number, message: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE research_fund_sheet_links SET last_error = ?, updated_at = ? WHERE owner_user_id = ?`,
  ).bind(message.slice(0, 500), now, userId).run().catch(() => null);
}

async function stampSheetClock(
  env: Env, userId: number, which: 'pulled' | 'pushed', sheetTitle: string | null, gid: number,
): Promise<void> {
  const now = new Date().toISOString();
  if (which === 'pulled') {
    await env.DB.prepare(
      `UPDATE research_fund_sheet_links
          SET last_pulled_at = ?, last_error = NULL, sheet_title = ?, sheet_gid = ?, updated_at = ?
        WHERE owner_user_id = ?`,
    ).bind(now, sheetTitle, gid, now, userId).run();
    return;
  }
  await env.DB.prepare(
    `UPDATE research_fund_sheet_links
        SET last_pushed_at = ?, last_error = NULL, sheet_title = ?, sheet_gid = ?, updated_at = ?
      WHERE owner_user_id = ?`,
  ).bind(now, sheetTitle, gid, now, userId).run();
}

export function parseSpreadsheetRef(input: string):
  { spreadsheet_id: string; sheet_gid: number | null } | { error: string } {
  const raw = String(input || '').trim();
  if (!raw) return { error: 'Paste a Google Sheets URL or spreadsheet id' };
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const m = u.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!m) return { error: 'That URL is not a Google Sheet' };
      let gid: number | null = null;
      const gidParam = u.searchParams.get('gid');
      if (gidParam != null && gidParam !== '') {
        const n = Number(gidParam);
        if (Number.isFinite(n) && n >= 0) gid = Math.trunc(n);
      }
      if (gid == null && u.hash) {
        const hm = u.hash.match(/gid=(\d+)/);
        if (hm) gid = Number(hm[1]);
      }
      return { spreadsheet_id: m[1], sheet_gid: gid };
    } catch {
      return { error: 'That URL is not a Google Sheet' };
    }
  }
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) return { spreadsheet_id: raw, sheet_gid: null };
  return { error: 'Paste a Google Sheets URL or spreadsheet id' };
}

export function usdCellToCents(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (!t) return null;
  const cleaned = t.replace(/[$,]/g, '').replace(/\s/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function centsToUsdCell(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2);
}

function clampText(v: unknown, max: number): string | null {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
}

function oneOf(v: unknown, set: Set<string>): string | null {
  const t = String(v ?? '').trim().toLowerCase();
  return set.has(t) ? t : null;
}

const HEADER_ALIASES: Record<string, keyof FundSheetRow> = (() => {
  const map: Record<string, keyof FundSheetRow> = {};
  const add = (key: keyof FundSheetRow, ...names: string[]) => {
    for (const n of names) map[n] = key;
  };
  add('uid', 'uid', 'id');
  add('name', 'fund', 'name');
  add('cheque_min_cents', 'cheque min (usd)', 'cheque min', 'cheque_min', 'min cheque');
  add('cheque_max_cents', 'cheque max (usd)', 'cheque max', 'cheque_max', 'max cheque');
  add('stage_fit', 'stage fit', 'stage', 'stage_fit');
  add('path', 'path', 'route', 'route in');
  add('status', 'state', 'status');
  add('pass_reason', 'pass reason', 'pass_reason', 'reason');
  add('thesis', 'thesis');
  add('note', 'note', 'what the research says');
  add('source_url', 'source url', 'source', 'url');
  return map;
})();

export function headerIndex(headers: unknown[]): Partial<Record<keyof FundSheetRow, number>> {
  const out: Partial<Record<keyof FundSheetRow, number>> = {};
  headers.forEach((h, i) => {
    const key = HEADER_ALIASES[String(h ?? '').trim().toLowerCase()];
    if (key && out[key] === undefined) out[key] = i;
  });
  return out;
}

export function fundToCells(f: FundRecord): string[] {
  return [
    f.uid || '',
    f.name || '',
    centsToUsdCell(f.cheque_min_cents),
    centsToUsdCell(f.cheque_max_cents),
    f.stage_fit || '',
    f.path || '',
    f.status || '',
    f.pass_reason || '',
    f.thesis || '',
    f.note || '',
    f.source_url || '',
  ];
}

export function fundsToSheetValues(funds: FundRecord[]): string[][] {
  return [ [...SHEET_HEADERS], ...funds.map(fundToCells) ];
}

export function rowToFund(idx: Partial<Record<keyof FundSheetRow, number>>, row: unknown[]): FundSheetRow {
  const cell = (key: keyof FundSheetRow) => {
    const i = idx[key];
    return i === undefined ? '' : row[i];
  };
  return {
    uid: clampText(cell('uid'), 64),
    name: clampText(cell('name'), 200),
    cheque_min_cents: usdCellToCents(cell('cheque_min_cents')),
    cheque_max_cents: usdCellToCents(cell('cheque_max_cents')),
    stage_fit: oneOf(cell('stage_fit'), FUND_STAGE_FIT),
    path: oneOf(cell('path'), FUND_PATH),
    status: oneOf(cell('status'), FUND_STATUS),
    pass_reason: clampText(cell('pass_reason'), 1000),
    thesis: clampText(cell('thesis'), 2000),
    note: clampText(cell('note'), 2000),
    source_url: clampText(cell('source_url'), 500),
  };
}

export function parseSheetValues(values: unknown[][]): FundSheetRow[] {
  if (!values.length) return [];
  const idx = headerIndex(values[0] || []);
  if (idx.name === undefined && idx.uid === undefined) return [];
  const out: FundSheetRow[] = [];
  for (const row of values.slice(1)) {
    if (!Array.isArray(row) || row.every((c) => String(c ?? '').trim() === '')) continue;
    out.push(rowToFund(idx, row));
  }
  return out;
}

function a1Range(title: string, cells: string): string {
  const escaped = String(title).replace(/'/g, "''");
  return `'${escaped}'!${cells}`;
}

async function sheetsFetch(accessToken: string, url: string, init: RequestInit = {}): Promise<any> {
  const r = await fetchWithTimeout(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`sheets_api:${r.status}:${txt.slice(0, 180)}`);
  }
  if (r.status === 204) return {};
  const text = await r.text();
  return text ? JSON.parse(text) : {};
}

async function resolveSheetTitle(
  accessToken: string, spreadsheetId: string, gid: number,
): Promise<{ title: string; gid: number }> {
  const meta = await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title)`,
  );
  const sheets = (meta.sheets || []) as { properties?: { sheetId?: number; title?: string } }[];
  const wanted = sheets.find((s) => Number(s.properties?.sheetId) === gid);
  if (wanted?.properties?.title) {
    return { title: wanted.properties.title, gid };
  }
  const first = sheets[0]?.properties;
  if (!first?.title) throw new Error('sheets_api:no_tabs');
  return { title: first.title, gid: Number(first.sheetId || 0) };
}

async function accessTokenFor(env: Env, userId: number): Promise<{ token: string; google_email: string | null }> {
  const tok = await loadSheetsToken(env, userId);
  if (!tok) throw new Error('not_connected');
  const access = await refreshSheetsAccessToken(env, tok.refresh_token);
  return { token: access, google_email: tok.google_email };
}

export async function applySheetRecords(
  env: Env,
  user: { id: number },
  records: FundSheetRow[],
): Promise<{ created: number; updated: number; skipped: number; uid_writes: { row: number; uid: string }[] }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const uid_writes: { row: number; uid: string }[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const sheetRow = i + 2; // header is row 1
    if (rec.uid) {
      const existing = await env.DB.prepare(
        `SELECT uid, name, cheque_min_cents, cheque_max_cents, stage_fit, path, status,
                pass_reason, thesis, note, source_url
           FROM research_funds WHERE uid = ? AND owner_user_id = ?`,
      ).bind(rec.uid, user.id).first<FundRecord>();
      if (!existing) {
        // A uid that is not this owner's is either someone else's or a stale
        // paste. Do not steal it and do not mint a colliding uid.
        skipped += 1;
        continue;
      }
      const name = rec.name || existing.name;
      await env.DB.prepare(
        `UPDATE research_funds
            SET name = ?, cheque_min_cents = ?, cheque_max_cents = ?, stage_fit = ?, path = ?,
                status = ?, pass_reason = ?, thesis = ?, note = ?, source_url = ?, updated_at = ?
          WHERE uid = ? AND owner_user_id = ?`,
      ).bind(
        name, rec.cheque_min_cents, rec.cheque_max_cents, rec.stage_fit, rec.path,
        rec.status || existing.status || 'researching',
        rec.pass_reason, rec.thesis, rec.note, rec.source_url, now,
        rec.uid, user.id,
      ).run();
      updated += 1;
      continue;
    }
    if (!rec.name) {
      skipped += 1;
      continue;
    }
    const uid = crypto.randomUUID().replace(/-/g, '');
    await env.DB.prepare(
      `INSERT INTO research_funds
         (uid, owner_user_id, project_id, name, cheque_min_cents, cheque_max_cents,
          stage_fit, path, status, pass_reason, thesis, note, source_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      uid, user.id, null, rec.name,
      rec.cheque_min_cents, rec.cheque_max_cents,
      rec.stage_fit, rec.path,
      rec.status || 'researching',
      rec.pass_reason, rec.thesis, rec.note, rec.source_url, now, now,
    ).run();
    created += 1;
    uid_writes.push({ row: sheetRow, uid });
  }
  return { created, updated, skipped, uid_writes };
}

export async function listOwnerFunds(env: Env, user: { id: number }): Promise<FundRecord[]> {
  const rows = await env.DB.prepare(
    `SELECT uid, name, cheque_min_cents, cheque_max_cents, stage_fit, path, status,
            pass_reason, thesis, note, source_url
       FROM research_funds WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 500`,
  ).bind(user.id).all<FundRecord>();
  return rows.results || [];
}

export async function pullFundsToSheet(
  env: Env, user: { id: number },
): Promise<{ written: number; spreadsheet_id: string; sheet_gid: number; sheet_title: string }> {
  const link = await loadSheetLink(env, user.id);
  if (!link) throw new Error('no_spreadsheet');
  const { token } = await accessTokenFor(env, user.id);
  const funds = await listOwnerFunds(env, user);
  const resolved = await resolveSheetTitle(token, link.spreadsheet_id, Number(link.sheet_gid) || 0);
  const values = fundsToSheetValues(funds);
  const range = a1Range(resolved.title, 'A:K');
  try {
    await sheetsFetch(
      token,
      `${SHEETS_API}/${encodeURIComponent(link.spreadsheet_id)}/values/${encodeURIComponent(range)}:clear`,
      { method: 'POST', body: '{}' },
    );
    await sheetsFetch(
      token,
      `${SHEETS_API}/${encodeURIComponent(link.spreadsheet_id)}/values/${encodeURIComponent(a1Range(resolved.title, 'A1'))}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values }) },
    );
  } catch (e: any) {
    await stampSheetError(env, user.id, String(e?.message || e));
    throw e;
  }
  await stampSheetClock(env, user.id, 'pulled', resolved.title, resolved.gid);
  return {
    written: funds.length,
    spreadsheet_id: link.spreadsheet_id,
    sheet_gid: resolved.gid,
    sheet_title: resolved.title,
  };
}

export async function pushFundsFromSheet(
  env: Env, user: { id: number },
): Promise<{ created: number; updated: number; skipped: number; spreadsheet_id: string; sheet_gid: number; sheet_title: string }> {
  const link = await loadSheetLink(env, user.id);
  if (!link) throw new Error('no_spreadsheet');
  const { token } = await accessTokenFor(env, user.id);
  const resolved = await resolveSheetTitle(token, link.spreadsheet_id, Number(link.sheet_gid) || 0);
  let values: unknown[][] = [];
  try {
    const body = await sheetsFetch(
      token,
      `${SHEETS_API}/${encodeURIComponent(link.spreadsheet_id)}/values/${encodeURIComponent(a1Range(resolved.title, 'A:K'))}`,
    );
    values = Array.isArray(body.values) ? body.values : [];
  } catch (e: any) {
    await stampSheetError(env, user.id, String(e?.message || e));
    throw e;
  }
  const records = parseSheetValues(values);
  const result = await applySheetRecords(env, user, records);
  if (result.uid_writes.length) {
    const data = result.uid_writes.map((w) => ({
      range: a1Range(resolved.title, `A${w.row}`),
      values: [[w.uid]],
    }));
    try {
      await sheetsFetch(
        token,
        `${SHEETS_API}/${encodeURIComponent(link.spreadsheet_id)}/values:batchUpdate`,
        { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) },
      );
    } catch (e: any) {
      await stampSheetError(env, user.id, String(e?.message || e));
      throw e;
    }
  }
  await stampSheetClock(env, user.id, 'pushed', resolved.title, resolved.gid);
  return {
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    spreadsheet_id: link.spreadsheet_id,
    sheet_gid: resolved.gid,
    sheet_title: resolved.title,
  };
}
