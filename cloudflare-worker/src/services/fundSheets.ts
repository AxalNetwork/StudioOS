/**
 * Google Sheets sync for Super Admin fund research (D7035 canvas, D7170).
 *
 * Sheets never talks to D1. This module is the Worker job that sits between
 * them: it reads `research_funds` for the authenticated owner, writes those
 * rows onto a tab the owner chose by gid (Export), and reads the tab back into
 * the same owner's rows (Import). Import never deletes. Calendar tokens are
 * not reused — adding the spreadsheets scope to `GOOGLE_SCOPES` in
 * calendar.ts would force every connected calendar to re-consent.
 *
 * Each direction has a preview that writes nothing and a run that is recorded
 * in `research_fund_sheet_runs` with an idempotency key. A run is Complete
 * only when its counts were read back; an import whose identifiers did not
 * reach the sheet stays `uncertain` until it is reconciled.
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
  sheetTitle: string | null = null,
): Promise<SheetLink> {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    `SELECT spreadsheet_id FROM research_fund_sheet_links WHERE owner_user_id = ?`,
  ).bind(user.id).first<{ spreadsheet_id: string }>();
  if (existing) {
    await env.DB.prepare(
      `UPDATE research_fund_sheet_links
          SET spreadsheet_id = ?, sheet_gid = ?, sheet_title = ?, last_error = NULL, updated_at = ?
        WHERE owner_user_id = ?`,
    ).bind(spreadsheetId, sheetGid, sheetTitle, now, user.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO research_fund_sheet_links
         (owner_user_id, spreadsheet_id, sheet_gid, sheet_title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(user.id, spreadsheetId, sheetGid, sheetTitle, now, now).run();
  }
  return (await loadSheetLink(env, user.id)) as SheetLink;
}

async function stampSheetError(env: Env, userId: number, message: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE research_fund_sheet_links SET last_error = ?, updated_at = ? WHERE owner_user_id = ?`,
  ).bind(message.slice(0, 500), now, userId).run().catch(() => null);
}

/**
 * The last successful time per direction. It records the tab's title as read
 * by gid and never changes the gid: before D7170 a missing tab fell back to
 * the first one and this saved that tab's gid as the new link.
 */
async function stampSheetClock(
  env: Env, userId: number, which: 'pulled' | 'pushed', sheetTitle: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  if (which === 'pulled') {
    await env.DB.prepare(
      `UPDATE research_fund_sheet_links
          SET last_pulled_at = ?, last_error = NULL, sheet_title = ?, updated_at = ?
        WHERE owner_user_id = ?`,
    ).bind(now, sheetTitle, now, userId).run();
    return;
  }
  await env.DB.prepare(
    `UPDATE research_fund_sheet_links
        SET last_pushed_at = ?, last_error = NULL, sheet_title = ?, updated_at = ?
      WHERE owner_user_id = ?`,
  ).bind(now, sheetTitle, now, userId).run();
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

// ---------------------------------------------------------------------------
// D7170 — which fields a run moves.
//
// The fund record (name, cheques, stage fit, path, state, source URL) always
// moves. Thesis is ticked by default. Notes and pass reasons are private: they
// move only when ticked on that run, in either direction (D7035, option A).
// On import a field also has to be a column on the sheet; an unticked field
// or a missing column leaves Axal's value as it is.
// ---------------------------------------------------------------------------

type FundField = Exclude<keyof FundSheetRow, 'uid'>;

/** The columns a fund writes, in the order of `SHEET_HEADERS` after uid. */
export const FUND_FIELDS: FundField[] = [
  'name', 'cheque_min_cents', 'cheque_max_cents', 'stage_fit', 'path', 'status',
  'pass_reason', 'thesis', 'note', 'source_url',
];
export const PRIVATE_FIELDS = new Set<FundField>(['note', 'pass_reason']);
const OPTIONAL_FIELDS = new Set<FundField>(['thesis', 'note', 'pass_reason']);

export type SyncFields = { thesis: boolean; note: boolean; pass_reason: boolean };

/** A run's field ticks. Private fields are off unless the request ticks them. */
export function readSyncFields(input: unknown): SyncFields {
  const f = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    thesis: f.thesis !== false,
    note: f.note === true,
    pass_reason: f.pass_reason === true,
  };
}

function fieldTicked(field: FundField, fields: SyncFields): boolean {
  if (!OPTIONAL_FIELDS.has(field)) return true;
  return fields[field as keyof SyncFields] === true;
}

export function fundToCells(f: FundRecord, fields: SyncFields = { thesis: true, note: true, pass_reason: true }): string[] {
  const opt = (field: FundField, v: string | null) => (fieldTicked(field, fields) ? v || '' : '');
  return [
    f.uid || '',
    f.name || '',
    centsToUsdCell(f.cheque_min_cents),
    centsToUsdCell(f.cheque_max_cents),
    f.stage_fit || '',
    f.path || '',
    f.status || '',
    opt('pass_reason', f.pass_reason),
    opt('thesis', f.thesis),
    opt('note', f.note),
    f.source_url || '',
  ];
}

export function fundsToSheetValues(funds: FundRecord[], fields?: SyncFields): string[][] {
  return [[...SHEET_HEADERS], ...funds.map((f) => fundToCells(f, fields))];
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

/** Rows with content, in order. Kept for callers that only want records; an import plans with `planImport`. */
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

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = Math.trunc(index) + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function isBlankRow(row: unknown): boolean {
  return !Array.isArray(row) || row.every((c) => String(c ?? '').trim() === '');
}

/** One cell read as a field: its value, or `invalid` when there is text that is not a value of that field. */
function readField(field: FundField, raw: unknown): { value: string | number | null; invalid: boolean } {
  const text = String(raw ?? '').trim();
  switch (field) {
    case 'cheque_min_cents':
    case 'cheque_max_cents': {
      if (!text) return { value: null, invalid: false };
      const cents = usdCellToCents(text);
      return cents === null ? { value: null, invalid: true } : { value: cents, invalid: false };
    }
    case 'stage_fit':
    case 'path':
    case 'status': {
      if (!text) return { value: null, invalid: false };
      const set = field === 'stage_fit' ? FUND_STAGE_FIT : field === 'path' ? FUND_PATH : FUND_STATUS;
      const v = oneOf(text, set);
      return v === null ? { value: null, invalid: true } : { value: v, invalid: false };
    }
    case 'name': return { value: clampText(text, 200), invalid: false };
    case 'pass_reason': return { value: clampText(text, 1000), invalid: false };
    case 'thesis':
    case 'note': return { value: clampText(text, 2000), invalid: false };
    case 'source_url': return { value: clampText(text, 500), invalid: false };
  }
  return { value: null, invalid: false };
}

/** Axal's stored value in the same shape `readField` returns, so an untouched row compares equal. */
function storedValue(field: FundField, f: FundRecord): string | number | null {
  const v = (f as any)[field];
  if (v === null || v === undefined) return null;
  if (field === 'cheque_min_cents' || field === 'cheque_max_cents') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return readField(field, v).value;
}

export type SheetColumn = { column: string; header: string; field: keyof FundSheetRow | null; private: boolean };
export type SheetMapping = {
  header_row: 1;
  columns: SheetColumn[];
  uid_column: string | null;
  /** Fields with no column on this sheet. Axal keeps its value for each. */
  missing_fields: FundField[];
};

export function mapHeader(headers: unknown[]): { mapping: SheetMapping; idx: Partial<Record<keyof FundSheetRow, number>> } {
  const idx = headerIndex(headers);
  const columns: SheetColumn[] = headers.map((h, i) => {
    const field = (Object.keys(idx) as (keyof FundSheetRow)[]).find((k) => idx[k] === i) || null;
    return {
      column: columnLetter(i),
      header: String(h ?? '').trim(),
      field,
      private: !!field && PRIVATE_FIELDS.has(field as FundField),
    };
  });
  return {
    idx,
    mapping: {
      header_row: 1,
      columns,
      uid_column: idx.uid === undefined ? null : columnLetter(idx.uid),
      missing_fields: FUND_FIELDS.filter((f) => idx[f] === undefined),
    },
  };
}

export type ImportAction = 'create' | 'update' | 'unchanged' | 'skip' | 'resolve' | 'blank';
export type ImportChange = { field: FundField; from: string | number | null; to: string | number | null; private: boolean };
export type ImportResolve = {
  kind: 'foreign_uid' | 'duplicate_uid' | 'invalid_value' | 'no_uid_column';
  field?: FundField;
  sheet_value?: string;
  axal_value?: string | number | null;
  /** What the person may choose for this run. A foreign or repeated uid is never imported. */
  options: ('keep_axal' | 'skip')[];
};
export type ImportPlanRow = {
  /** The sheet's own row number. A blank row keeps its number, and so does every row after it. */
  row: number;
  action: ImportAction;
  uid: string | null;
  name: string | null;
  changes: ImportChange[];
  note: string | null;
  resolve?: ImportResolve;
  resolution?: 'keep_axal' | 'skip';
  /** The cell a new fund's identifier goes to: the mapped uid column on this row. */
  uid_cell?: string;
  /** The full record a create inserts. */
  record?: FundSheetRow;
};
export type ImportCounts = Record<ImportAction, number> & { rows: number };
export type ImportPlan = {
  mapping: SheetMapping;
  rows: ImportPlanRow[];
  counts: ImportCounts;
  first_row: number;
  last_row: number;
};

export type Resolutions = Record<string, 'keep_axal' | 'skip'>;

export function readResolutions(input: unknown): Resolutions {
  const out: Resolutions = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!/^\d+$/.test(k)) continue;
    if (v === 'keep_axal' || v === 'skip') out[k] = v;
  }
  return out;
}

/**
 * The import, decided before anything is written. Pure: the preview and the
 * run both call it, so what the review showed is what the run does.
 *
 * Rows carry the sheet's own numbers. A blank row is listed as blank and keeps
 * its place, so the identifier for row 11 goes to row 11 and not to row 10.
 */
export function planImport(
  values: unknown[][],
  owned: Map<string, FundRecord>,
  fields: SyncFields,
  resolutions: Resolutions = {},
): ImportPlan {
  const { mapping, idx } = mapHeader(Array.isArray(values[0]) ? values[0] : []);
  if (idx.name === undefined && idx.uid === undefined) {
    throw new SheetSyncError('header_missing', 422,
      'Row 1 of this tab has no Fund or uid header, so its rows cannot be matched to funds.');
  }
  const counts: ImportCounts = { create: 0, update: 0, unchanged: 0, skip: 0, resolve: 0, blank: 0, rows: 0 };
  const rows: ImportPlanRow[] = [];
  const seen = new Set<string>();
  const considered = FUND_FIELDS.filter((f) => idx[f] !== undefined && fieldTicked(f, fields));

  for (let i = 1; i < values.length; i++) {
    const rowNo = i + 1;
    const cells = Array.isArray(values[i]) ? values[i] : [];
    counts.rows += 1;
    if (isBlankRow(cells)) {
      rows.push({ row: rowNo, action: 'blank', uid: null, name: null, changes: [], note: 'Empty row. Kept in place; later rows keep their numbers.' });
      counts.blank += 1;
      continue;
    }
    const cell = (k: keyof FundSheetRow) => (idx[k] === undefined ? '' : cells[idx[k] as number]);
    const uid = clampText(cell('uid'), 64);
    const name = clampText(cell('name'), 200);
    const read = new Map<FundField, { value: string | number | null; invalid: boolean; raw: string }>();
    for (const f of considered) {
      const raw = String(cell(f) ?? '').trim();
      read.set(f, { ...readField(f, raw), raw });
    }
    const invalid = considered.filter((f) => read.get(f)!.invalid);
    const choice = resolutions[String(rowNo)];

    const push = (r: ImportPlanRow) => { rows.push(r); counts[r.action] += 1; };

    if (uid) {
      const existing = owned.get(uid);
      if (!existing) {
        push({
          row: rowNo, action: 'resolve', uid, name, changes: [],
          note: 'This uid is not in your funds. Not imported; nothing is taken over.',
          resolve: { kind: 'foreign_uid', options: ['skip'] },
        });
        continue;
      }
      if (seen.has(uid)) {
        push({
          row: rowNo, action: 'resolve', uid, name: name || existing.name, changes: [],
          note: 'This uid is on an earlier row too. Only the first row is imported.',
          resolve: { kind: 'duplicate_uid', options: ['skip'] },
        });
        continue;
      }
      seen.add(uid);
      const changes: ImportChange[] = [];
      for (const f of considered) {
        const r = read.get(f)!;
        if (r.invalid) continue;
        // A blank name or state is not a value to store: the fund keeps its own.
        if ((f === 'name' || f === 'status') && r.value === null) continue;
        const from = storedValue(f, existing);
        if (from !== r.value) changes.push({ field: f, from, to: r.value, private: PRIVATE_FIELDS.has(f) });
      }
      if (invalid.length && choice !== 'keep_axal') {
        const f = invalid[0];
        const res: ImportResolve = {
          kind: 'invalid_value', field: f, sheet_value: read.get(f)!.raw,
          axal_value: storedValue(f, existing), options: ['keep_axal', 'skip'],
        };
        if (choice === 'skip') {
          push({ row: rowNo, action: 'skip', uid, name: existing.name, changes: [], note: 'Skipped for this run.', resolve: res, resolution: 'skip' });
        } else {
          push({
            row: rowNo, action: 'resolve', uid, name: existing.name, changes,
            note: `${f} “${read.get(f)!.raw}” is not a value Axal records. Choose one or keep Axal’s.`,
            resolve: res,
          });
        }
        continue;
      }
      push({
        row: rowNo,
        action: changes.length ? 'update' : 'unchanged',
        uid, name: existing.name, changes,
        note: invalid.length ? 'Axal keeps its value where the sheet’s is not one it records.' : null,
        ...(invalid.length ? { resolution: 'keep_axal' as const } : {}),
      });
      continue;
    }

    if (!name) {
      push({ row: rowNo, action: 'skip', uid: null, name: null, changes: [], note: 'No fund name. Nothing to create.' });
      continue;
    }
    if (!mapping.uid_column) {
      push({
        row: rowNo, action: 'resolve', uid: null, name, changes: [],
        note: 'This tab has no uid column, so the new fund’s identifier could not be written back.',
        resolve: { kind: 'no_uid_column', options: ['skip'] },
      });
      continue;
    }
    if (invalid.length && choice !== 'keep_axal') {
      const f = invalid[0];
      const res: ImportResolve = { kind: 'invalid_value', field: f, sheet_value: read.get(f)!.raw, axal_value: null, options: ['keep_axal', 'skip'] };
      if (choice === 'skip') {
        push({ row: rowNo, action: 'skip', uid: null, name, changes: [], note: 'Skipped for this run.', resolve: res, resolution: 'skip' });
      } else {
        push({
          row: rowNo, action: 'resolve', uid: null, name, changes: [],
          note: `${f} “${read.get(f)!.raw}” is not a value Axal records. Choose one or leave it blank.`,
          resolve: res,
        });
      }
      continue;
    }
    const record: FundSheetRow = {
      uid: null, name, cheque_min_cents: null, cheque_max_cents: null, stage_fit: null, path: null,
      status: null, pass_reason: null, thesis: null, note: null, source_url: null,
    };
    const changes: ImportChange[] = [];
    for (const f of considered) {
      const r = read.get(f)!;
      if (r.invalid || r.value === null) continue;
      (record as any)[f] = r.value;
      if (f !== 'name') changes.push({ field: f, from: null, to: r.value, private: PRIVATE_FIELDS.has(f) });
    }
    push({
      row: rowNo, action: 'create', uid: null, name, changes, note: null,
      uid_cell: `${mapping.uid_column}${rowNo}`, record,
      ...(invalid.length ? { resolution: 'keep_axal' as const } : {}),
    });
  }
  return { mapping, rows, counts, first_row: 2, last_row: values.length };
}

// ---------------------------------------------------------------------------
// Google Sheets calls
// ---------------------------------------------------------------------------

/** A refusal the route answers with its own status and code. `sentence` is ours, written here, never a provider's. */
export class SheetSyncError extends Error {
  code: string;
  status: number;
  sentence: string;
  extra: Record<string, unknown>;
  constructor(code: string, status: number, sentence: string, extra: Record<string, unknown> = {}) {
    super(sentence);
    this.code = code;
    this.sentence = sentence;
    this.status = status;
    this.extra = extra;
  }
}

/** A Google answer that was not a success. `status` is 0 when Google did not answer at all. */
export class SheetsApiError extends Error {
  status: number;
  constructor(status: number, text: string) {
    super(`sheets_api:${status}:${text.slice(0, 180)}`);
    this.status = status;
  }
}

function a1Sheet(title: string): string {
  return `'${String(title).replace(/'/g, "''")}'`;
}

function a1Range(title: string, cells: string): string {
  return `${a1Sheet(title)}!${cells}`;
}

async function sheetsFetch(accessToken: string, url: string, init: RequestInit = {}): Promise<any> {
  let r: Response;
  try {
    r = await fetchWithTimeout(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
  } catch (e: any) {
    throw new SheetsApiError(0, String(e?.name || e?.message || 'no_answer'));
  }
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new SheetsApiError(r.status, txt);
  }
  if (r.status === 204) return {};
  const text = await r.text();
  return text ? JSON.parse(text) : {};
}

const sheetUrl = (id: string) => `${SHEETS_API}/${encodeURIComponent(id)}`;

async function readValues(token: string, spreadsheetId: string, range: string): Promise<unknown[][]> {
  const body = await sheetsFetch(token, `${sheetUrl(spreadsheetId)}/values/${encodeURIComponent(range)}`);
  return Array.isArray(body.values) ? body.values : [];
}

async function readRanges(token: string, spreadsheetId: string, ranges: string[]): Promise<unknown[][][]> {
  if (!ranges.length) return [];
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const body = await sheetsFetch(token, `${sheetUrl(spreadsheetId)}/values:batchGet?${qs}`);
  const vr = Array.isArray(body.valueRanges) ? body.valueRanges : [];
  return ranges.map((_, i) => (Array.isArray(vr[i]?.values) ? vr[i].values : []));
}

export type SheetTab = { gid: number; title: string; index: number };

async function workbookMeta(token: string, spreadsheetId: string): Promise<{ title: string | null; tabs: SheetTab[] }> {
  const meta = await sheetsFetch(
    token,
    `${sheetUrl(spreadsheetId)}?fields=properties.title,sheets.properties(sheetId,title,index)`,
  );
  const sheets = (meta.sheets || []) as { properties?: { sheetId?: number; title?: string; index?: number } }[];
  return {
    title: meta?.properties?.title || null,
    tabs: sheets
      .filter((s) => s.properties?.title)
      .map((s, i) => ({
        gid: Number(s.properties?.sheetId || 0),
        title: String(s.properties?.title),
        index: Number.isFinite(Number(s.properties?.index)) ? Number(s.properties?.index) : i,
      })),
  };
}

/**
 * The linked tab, found by its gid and nothing else. Being first in the
 * workbook never makes a tab the destination: a gid that is gone is
 * `tab_missing`, and the link is left as it was until someone chooses.
 */
export function findTab(tabs: SheetTab[], gid: number): SheetTab {
  const tab = tabs.find((t) => t.gid === gid);
  if (!tab) {
    throw new SheetSyncError('tab_missing', 409,
      'The linked tab is no longer in this workbook. Choose a tab before exporting or importing.',
      { sheet_gid: gid, tabs });
  }
  return tab;
}

async function accessTokenFor(env: Env, userId: number): Promise<{ token: string; google_email: string | null }> {
  const tok = await loadSheetsToken(env, userId);
  if (!tok) throw new SheetSyncError('not_connected', 409, 'Connect a Google account first.');
  const access = await refreshSheetsAccessToken(env, tok.refresh_token);
  return { token: access, google_email: tok.google_email };
}

async function requireLink(env: Env, userId: number): Promise<SheetLink> {
  const link = await loadSheetLink(env, userId);
  if (!link) throw new SheetSyncError('no_spreadsheet', 409, 'Choose a workbook and tab first.');
  return link;
}

async function linkedTab(env: Env, user: { id: number }): Promise<{ link: SheetLink; token: string; tab: SheetTab; workbook: string | null; tabs: SheetTab[] }> {
  const link = await requireLink(env, user.id);
  const { token } = await accessTokenFor(env, user.id);
  const meta = await workbookMeta(token, link.spreadsheet_id);
  const tab = findTab(meta.tabs, Number(link.sheet_gid));
  return { link, token, tab, workbook: meta.title, tabs: meta.tabs };
}

// ---------------------------------------------------------------------------
// Funds (owner-scoped, every row)
// ---------------------------------------------------------------------------

const FUND_PAGE = 500;

/** Every fund this owner holds, newest first, read a page at a time — no cap. */
export async function listOwnerFunds(env: Env, user: { id: number }): Promise<FundRecord[]> {
  const out: FundRecord[] = [];
  for (let offset = 0; ; offset += FUND_PAGE) {
    const rows = await env.DB.prepare(
      `SELECT uid, name, cheque_min_cents, cheque_max_cents, stage_fit, path, status,
              pass_reason, thesis, note, source_url
         FROM research_funds WHERE owner_user_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    ).bind(user.id, FUND_PAGE, offset).all<FundRecord>();
    const page = rows.results || [];
    out.push(...page);
    if (page.length < FUND_PAGE) break;
  }
  return out;
}

async function countOwnerFunds(env: Env, userId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM research_funds WHERE owner_user_id = ?`,
  ).bind(userId).first<{ n: number }>();
  return Number(row?.n || 0);
}

// ---------------------------------------------------------------------------
// Run records (D7170)
// ---------------------------------------------------------------------------

export type RunStatus = 'running' | 'complete' | 'partial' | 'failed' | 'uncertain';
export type PendingCell = { row: number; cell: string; uid: string; name: string; state?: 'matches' | 'empty' | 'differs'; found?: string };
export type SheetRun = {
  uid: string;
  direction: 'export' | 'import';
  status: RunStatus;
  spreadsheet_id: string;
  sheet_gid: number;
  sheet_title: string | null;
  fields: SyncFields;
  counts: Record<string, unknown>;
  pending: PendingCell[];
  detail: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  uid: string; direction: 'export' | 'import'; status: RunStatus; spreadsheet_id: string;
  sheet_gid: number; sheet_title: string | null; fields_json: string; counts_json: string;
  pending_json: string; detail: string | null; verified_at: string | null; created_at: string; updated_at: string;
};

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  try { return text ? (JSON.parse(text) as T) : fallback; } catch { return fallback; }
}

export function runDto(row: RunRow): SheetRun {
  return {
    uid: row.uid,
    direction: row.direction,
    status: row.status,
    spreadsheet_id: row.spreadsheet_id,
    sheet_gid: Number(row.sheet_gid),
    sheet_title: row.sheet_title || null,
    fields: readSyncFields(parseJson(row.fields_json, {})),
    counts: parseJson(row.counts_json, {}),
    pending: parseJson(row.pending_json, [] as PendingCell[]),
    detail: row.detail || null,
    verified_at: row.verified_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function loadRun(env: Env, userId: number, runUid: string): Promise<SheetRun | null> {
  const row = await env.DB.prepare(
    `SELECT uid, direction, status, spreadsheet_id, sheet_gid, sheet_title, fields_json,
            counts_json, pending_json, detail, verified_at, created_at, updated_at
       FROM research_fund_sheet_runs WHERE uid = ? AND owner_user_id = ?`,
  ).bind(runUid, userId).first<RunRow>();
  return row ? runDto(row) : null;
}

/** The latest run in each direction, for the card's last-result lines. */
export async function latestRuns(env: Env, userId: number): Promise<{ export: SheetRun | null; import: SheetRun | null }> {
  const one = async (direction: 'export' | 'import') => {
    const row = await env.DB.prepare(
      `SELECT uid, direction, status, spreadsheet_id, sheet_gid, sheet_title, fields_json,
              counts_json, pending_json, detail, verified_at, created_at, updated_at
         FROM research_fund_sheet_runs
        WHERE owner_user_id = ? AND direction = ?
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).bind(userId, direction).first<RunRow>();
    return row ? runDto(row) : null;
  };
  return { export: await one('export'), import: await one('import') };
}

/** An import whose identifiers are not confirmed. While one is open, a new import is refused. */
export async function openImportRun(env: Env, userId: number): Promise<SheetRun | null> {
  const row = await env.DB.prepare(
    `SELECT uid, direction, status, spreadsheet_id, sheet_gid, sheet_title, fields_json,
            counts_json, pending_json, detail, verified_at, created_at, updated_at
       FROM research_fund_sheet_runs
      WHERE owner_user_id = ? AND direction = 'import' AND status = 'uncertain'
      ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).bind(userId).first<RunRow>();
  return row ? runDto(row) : null;
}

/** An idempotency key: what the page sends once per reviewed run. */
export function readIdempotencyKey(raw: unknown): string {
  const key = String(raw ?? '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) {
    throw new SheetSyncError('idempotency_key_required', 400,
      'Each run needs an idempotency key of 8 to 80 letters, digits, dashes or underscores.');
  }
  return key;
}

async function startRun(
  env: Env, userId: number, direction: 'export' | 'import', key: string,
  link: SheetLink, tab: SheetTab, fields: SyncFields,
): Promise<{ run: SheetRun; replayed: boolean }> {
  const uid = `${direction === 'export' ? 'exp' : 'imp'}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO research_fund_sheet_runs
       (uid, owner_user_id, direction, idempotency_key, status, spreadsheet_id, sheet_gid,
        sheet_title, fields_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)
     ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING`,
  ).bind(uid, userId, direction, key, link.spreadsheet_id, tab.gid, tab.title, JSON.stringify(fields), now, now).run();
  const row = await env.DB.prepare(
    `SELECT uid, direction, status, spreadsheet_id, sheet_gid, sheet_title, fields_json,
            counts_json, pending_json, detail, verified_at, created_at, updated_at
       FROM research_fund_sheet_runs WHERE owner_user_id = ? AND idempotency_key = ?`,
  ).bind(userId, key).first<RunRow>();
  if (!row) throw new Error('run_not_recorded');
  const run = runDto(row);
  if (run.uid !== uid && run.direction !== direction) {
    throw new SheetSyncError('idempotency_key_reused', 409, 'That idempotency key belongs to a run in the other direction.');
  }
  return { run, replayed: run.uid !== uid };
}

function finishRunStatement(
  env: Env, userId: number, runUid: string,
  patch: { status: RunStatus; counts?: Record<string, unknown>; pending?: PendingCell[]; detail?: string | null; verified?: boolean },
): D1PreparedStatement {
  const now = new Date().toISOString();
  return env.DB.prepare(
    `UPDATE research_fund_sheet_runs
        SET status = ?, counts_json = COALESCE(?, counts_json), pending_json = COALESCE(?, pending_json),
            detail = ?, verified_at = CASE WHEN ? THEN ? ELSE verified_at END, updated_at = ?
      WHERE uid = ? AND owner_user_id = ?`,
  ).bind(
    patch.status,
    patch.counts ? JSON.stringify(patch.counts) : null,
    patch.pending ? JSON.stringify(patch.pending) : null,
    patch.detail ?? null,
    patch.verified ? 1 : 0, now, now,
    runUid, userId,
  );
}

async function finishRun(
  env: Env, userId: number, runUid: string,
  patch: Parameters<typeof finishRunStatement>[3],
): Promise<SheetRun> {
  await finishRunStatement(env, userId, runUid, patch).run();
  return (await loadRun(env, userId, runUid)) as SheetRun;
}

// ---------------------------------------------------------------------------
// Tabs and destination
// ---------------------------------------------------------------------------

export type TabListing = {
  spreadsheet_id: string;
  workbook_title: string | null;
  read_at: string;
  tabs: (SheetTab & { rows: number; headers_match: boolean })[];
  linked_gid: number | null;
  linked_present: boolean | null;
};

/** The workbook's tabs by gid, each with its filled rows and whether row 1 is Axal's headers. Nothing is preselected. */
export async function listWorkbookTabs(env: Env, user: { id: number }, spreadsheetId?: string): Promise<TabListing> {
  const link = await loadSheetLink(env, user.id);
  const id = spreadsheetId || link?.spreadsheet_id;
  if (!id) throw new SheetSyncError('no_spreadsheet', 409, 'Paste the workbook’s URL first.');
  const { token } = await accessTokenFor(env, user.id);
  const meta = await workbookMeta(token, id);
  const shown = meta.tabs.slice(0, 25);
  const values = await readRanges(token, id, shown.map((t) => a1Range(t.title, 'A1:K')));
  const sameWorkbook = !!link && link.spreadsheet_id === id;
  return {
    spreadsheet_id: id,
    workbook_title: meta.title,
    read_at: new Date().toISOString(),
    tabs: shown.map((t, i) => {
      const v = values[i] || [];
      const idx = headerIndex(Array.isArray(v[0]) ? v[0] : []);
      return { ...t, rows: v.length, headers_match: idx.uid !== undefined && idx.name !== undefined };
    }),
    linked_gid: sameWorkbook ? Number(link!.sheet_gid) : null,
    linked_present: sameWorkbook ? meta.tabs.some((t) => t.gid === Number(link!.sheet_gid)) : null,
  };
}

/**
 * Save the destination: a workbook and a tab chosen by gid, or a new empty
 * tab created on save. The gid has to be a tab in that workbook now. Writes
 * no funds.
 */
export async function saveSheetDestination(
  env: Env,
  user: { id: number },
  args: { spreadsheetId: string; sheetGid: number | null; createTab: string | null },
): Promise<SheetLink> {
  const { token } = await accessTokenFor(env, user.id);
  const meta = await workbookMeta(token, args.spreadsheetId);
  let tab: SheetTab;
  if (args.createTab) {
    const title = args.createTab.trim().slice(0, 100);
    if (meta.tabs.some((t) => t.title.toLowerCase() === title.toLowerCase())) {
      throw new SheetSyncError('tab_exists', 409, 'A tab with that name is already in the workbook. Choose it, or name the new tab differently.');
    }
    const body = await sheetsFetch(token, `${sheetUrl(args.spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    });
    const props = body?.replies?.[0]?.addSheet?.properties;
    if (props?.sheetId === undefined || props?.sheetId === null) throw new SheetsApiError(502, 'add_sheet_no_id');
    tab = { gid: Number(props.sheetId), title: String(props.title || title), index: Number(props.index || meta.tabs.length) };
  } else {
    if (args.sheetGid === null) {
      throw new SheetSyncError('tab_required', 400, 'Choose a tab. The first tab is not used unless you choose it.');
    }
    tab = findTab(meta.tabs, args.sheetGid);
  }
  return upsertSheetLink(env, user, args.spreadsheetId, tab.gid, tab.title);
}

/** Whether the linked tab is still there, for the card. Google failing says nothing either way. */
export async function checkLinkedTab(env: Env, userId: number, link: SheetLink): Promise<{ state: 'present' | 'missing' | 'unknown'; title: string | null; workbook_title: string | null; checked_at: string }> {
  const checked_at = new Date().toISOString();
  try {
    const { token } = await accessTokenFor(env, userId);
    const meta = await workbookMeta(token, link.spreadsheet_id);
    const tab = meta.tabs.find((t) => t.gid === Number(link.sheet_gid));
    return { state: tab ? 'present' : 'missing', title: tab?.title || link.sheet_title || null, workbook_title: meta.title, checked_at };
  } catch {
    return { state: 'unknown', title: link.sheet_title || null, workbook_title: null, checked_at };
  }
}

// ---------------------------------------------------------------------------
// Export: preview and run
// ---------------------------------------------------------------------------

function filledRows(values: unknown[][], fromCol: number, toCol: number): number[] {
  const out: number[] = [];
  values.forEach((row, i) => {
    if (!Array.isArray(row)) return;
    for (let c = fromCol; c <= toCol && c < row.length; c++) {
      if (String(row[c] ?? '').trim() !== '') { out.push(i + 1); return; }
    }
  });
  return out;
}

export type ExportPreview = {
  spreadsheet_id: string;
  workbook_title: string | null;
  sheet_gid: number;
  sheet_title: string;
  checked_at: string;
  fields: SyncFields;
  funds: number;
  range: string;
  last_row: number;
  current: { rows: number; last_row: number };
  cleared: { count: number; cells: string[]; range: string | null };
  other_columns: { column: string; header: string; filled: number }[];
  other_tabs: string[];
  private: { note: number; pass_reason: number };
  thesis: number;
};

/** What an export would write and what it would clear, read from the tab now. Writes nothing. */
export function describeExport(funds: FundRecord[], current: unknown[][], fields: SyncFields) {
  const lastRow = funds.length + 1;
  const kRows = filledRows(current, 0, 10);
  const below: string[] = [];
  current.forEach((row, i) => {
    const rowNo = i + 1;
    if (rowNo <= lastRow || !Array.isArray(row)) return;
    for (let c = 0; c <= 10 && c < row.length; c++) {
      if (String(row[c] ?? '').trim() !== '') below.push(`${columnLetter(c)}${rowNo}`);
    }
  });
  const header = Array.isArray(current[0]) ? current[0] : [];
  const width = current.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
  const other: { column: string; header: string; filled: number }[] = [];
  for (let c = 11; c < width; c++) {
    const filled = current.slice(1).filter((r) => Array.isArray(r) && String(r[c] ?? '').trim() !== '').length;
    const h = String(header[c] ?? '').trim();
    if (filled || h) other.push({ column: columnLetter(c), header: h, filled });
  }
  const oldLast = kRows.length ? kRows[kRows.length - 1] : 0;
  return {
    range: `A1:K${lastRow}`,
    last_row: lastRow,
    current: { rows: Math.max(0, kRows.filter((r) => r > 1).length), last_row: oldLast },
    cleared: {
      count: below.length,
      cells: below.slice(0, 20),
      range: oldLast > lastRow ? `A${lastRow + 1}:K${oldLast}` : null,
    },
    other_columns: other,
    private: {
      note: fields.note ? funds.filter((f) => f.note).length : 0,
      pass_reason: fields.pass_reason ? funds.filter((f) => f.pass_reason).length : 0,
    },
    thesis: fields.thesis ? funds.filter((f) => f.thesis).length : 0,
    available: {
      note: funds.filter((f) => f.note).length,
      pass_reason: funds.filter((f) => f.pass_reason).length,
      thesis: funds.filter((f) => f.thesis).length,
    },
  };
}

export async function previewExport(env: Env, user: { id: number }, fields: SyncFields) {
  const { link, token, tab, workbook, tabs } = await linkedTab(env, user);
  const funds = await listOwnerFunds(env, user);
  const current = await readValues(token, link.spreadsheet_id, a1Sheet(tab.title));
  return {
    spreadsheet_id: link.spreadsheet_id,
    workbook_title: workbook,
    sheet_gid: tab.gid,
    sheet_title: tab.title,
    checked_at: new Date().toISOString(),
    fields,
    funds: funds.length,
    ...describeExport(funds, current, fields),
    other_tabs: tabs.filter((t) => t.gid !== tab.gid).map((t) => t.title),
  };
}

/** How many of `funds` the read-back rows hold, in order, by uid in column A. */
export function countWrittenBack(funds: FundRecord[], readBack: unknown[][]): number {
  let n = 0;
  funds.forEach((f, i) => {
    const row = readBack[i + 1];
    if (Array.isArray(row) && String(row[0] ?? '').trim() === f.uid) n += 1;
  });
  return n;
}

/**
 * Export: write first, then clear only the rows past the new end, then read
 * the range back. A write Google refused leaves the tab as it was; a write
 * that was not confirmed is never reported as Complete.
 */
export async function exportFundsToSheet(
  env: Env, user: { id: number }, opts: { fields: SyncFields; idempotencyKey: string },
): Promise<{ run: SheetRun; replayed: boolean }> {
  const { link, token, tab } = await linkedTab(env, user);
  const started = await startRun(env, user.id, 'export', opts.idempotencyKey, link, tab, opts.fields);
  if (started.replayed) return started;
  const runUid = started.run.uid;

  const funds = await listOwnerFunds(env, user);
  const expected = await countOwnerFunds(env, user.id);
  const lastRow = funds.length + 1;
  const base = { expected, private_fields: (['note', 'pass_reason'] as const).filter((f) => opts.fields[f]) };

  let current: unknown[][];
  try {
    current = await readValues(token, link.spreadsheet_id, a1Range(tab.title, 'A:K'));
  } catch (e: any) {
    await stampSheetError(env, user.id, String(e?.message || e));
    const run = await finishRun(env, user.id, runUid, { status: 'failed', counts: { ...base, written: 0 }, detail: 'The tab could not be read. Nothing was written.' });
    return { run, replayed: false };
  }
  const oldLast = current.length;

  let writeError: SheetsApiError | null = null;
  try {
    await sheetsFetch(
      token,
      `${sheetUrl(link.spreadsheet_id)}/values/${encodeURIComponent(a1Range(tab.title, `A1:K${lastRow}`))}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: fundsToSheetValues(funds, opts.fields) }) },
    );
  } catch (e: any) {
    writeError = e instanceof SheetsApiError ? e : new SheetsApiError(0, String(e?.message || e));
  }

  let clearError = false;
  if (!writeError && oldLast > lastRow) {
    try {
      await sheetsFetch(
        token,
        `${sheetUrl(link.spreadsheet_id)}/values/${encodeURIComponent(a1Range(tab.title, `A${lastRow + 1}:K${oldLast}`))}:clear`,
        { method: 'POST', body: '{}' },
      );
    } catch {
      clearError = true;
    }
  }

  let readBack: unknown[][] | null = null;
  try {
    readBack = await readValues(token, link.spreadsheet_id, a1Range(tab.title, `A1:K${Math.max(lastRow, oldLast)}`));
  } catch {
    readBack = null;
  }

  // Google rejected the write outright (4xx): it applied none of it.
  if (writeError && writeError.status >= 400 && writeError.status < 500) {
    await stampSheetError(env, user.id, writeError.message);
    const run = await finishRun(env, user.id, runUid, {
      status: 'failed', counts: { ...base, written: 0, google_status: writeError.status },
      detail: 'Google refused the write. Axal and the sheet are unchanged.',
    });
    return { run, replayed: false };
  }
  if (!readBack) {
    const run = await finishRun(env, user.id, runUid, {
      status: 'uncertain', counts: { ...base, written: null },
      detail: 'The rows could not be read back, so the export is not confirmed. Exporting again is safe.',
    });
    return { run, replayed: false };
  }
  const written = countWrittenBack(funds, readBack);
  const leftover = filledRows(readBack, 0, 10).filter((r) => r > lastRow).length;
  const headerOk = Array.isArray(readBack[0]) && String(readBack[0][0] ?? '') === SHEET_HEADERS[0];
  const complete = written === expected && funds.length === expected && leftover === 0 && headerOk;
  const counts = {
    ...base, written, not_written: Math.max(0, expected - written), leftover_rows: leftover,
    range: `A1:K${lastRow}`, cleared_rows: oldLast > lastRow ? oldLast - lastRow : 0,
  };
  const detail = complete
    ? null
    : clearError || leftover
      ? 'The rows were written, but rows below them were not cleared.'
      : `${written} of ${expected} funds were read back from the sheet.`;
  const run = await finishRun(env, user.id, runUid, { status: complete ? 'complete' : 'partial', counts, detail, verified: true });
  await stampSheetClock(env, user.id, 'pulled', tab.title);
  return { run, replayed: false };
}

// ---------------------------------------------------------------------------
// Import: preview, run and reconcile
// ---------------------------------------------------------------------------

async function ownedMap(env: Env, user: { id: number }): Promise<Map<string, FundRecord>> {
  const funds = await listOwnerFunds(env, user);
  return new Map(funds.map((f) => [f.uid, f]));
}

export async function previewImport(env: Env, user: { id: number }, fields: SyncFields, resolutions: Resolutions) {
  const { link, token, tab, workbook } = await linkedTab(env, user);
  const values = await readValues(token, link.spreadsheet_id, a1Sheet(tab.title));
  const owned = await ownedMap(env, user);
  const plan = planImport(values, owned, fields, resolutions);
  const onSheet = new Set(plan.rows.map((r) => r.uid).filter(Boolean) as string[]);
  return {
    spreadsheet_id: link.spreadsheet_id,
    workbook_title: workbook,
    sheet_gid: tab.gid,
    sheet_title: tab.title,
    checked_at: new Date().toISOString(),
    fields,
    funds_in_axal: owned.size,
    not_on_sheet: [...owned.keys()].filter((u) => !onSheet.has(u)).length,
    open_run: (await openImportRun(env, user.id))?.uid || null,
    mapping: plan.mapping,
    counts: plan.counts,
    first_row: plan.first_row,
    last_row: plan.last_row,
    rows: plan.rows.map(({ record, ...r }) => r),
  };
}

const FIELD_SQL_ORDER: FundField[] = [
  'name', 'cheque_min_cents', 'cheque_max_cents', 'stage_fit', 'path', 'status',
  'pass_reason', 'thesis', 'note', 'source_url',
];

/** The writes a plan makes: an INSERT per create, an UPDATE of only the changed fields per update. */
export function planStatements(env: Env, user: { id: number }, plan: ImportPlan, now: string): { statements: D1PreparedStatement[]; pending: PendingCell[]; created: string[]; updated: string[] } {
  const statements: D1PreparedStatement[] = [];
  const pending: PendingCell[] = [];
  const created: string[] = [];
  const updated: string[] = [];
  for (const r of plan.rows) {
    if (r.action === 'create' && r.record && r.uid_cell) {
      const uid = crypto.randomUUID().replace(/-/g, '');
      const rec = r.record;
      statements.push(env.DB.prepare(
        `INSERT INTO research_funds
           (uid, owner_user_id, project_id, name, cheque_min_cents, cheque_max_cents,
            stage_fit, path, status, pass_reason, thesis, note, source_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        uid, user.id, null, rec.name,
        rec.cheque_min_cents, rec.cheque_max_cents, rec.stage_fit, rec.path,
        rec.status || 'researching', rec.pass_reason, rec.thesis, rec.note, rec.source_url, now, now,
      ));
      created.push(uid);
      pending.push({ row: r.row, cell: r.uid_cell, uid, name: rec.name || '' });
    } else if (r.action === 'update' && r.uid && r.changes.length) {
      const changed = new Map(r.changes.map((c) => [c.field, c.to]));
      const binds: unknown[] = [];
      for (const f of FIELD_SQL_ORDER) {
        binds.push(changed.has(f) ? 1 : 0, changed.has(f) ? changed.get(f) : null);
      }
      statements.push(env.DB.prepare(
        `UPDATE research_funds
            SET name = CASE WHEN ? THEN ? ELSE name END,
                cheque_min_cents = CASE WHEN ? THEN ? ELSE cheque_min_cents END,
                cheque_max_cents = CASE WHEN ? THEN ? ELSE cheque_max_cents END,
                stage_fit = CASE WHEN ? THEN ? ELSE stage_fit END,
                path = CASE WHEN ? THEN ? ELSE path END,
                status = CASE WHEN ? THEN ? ELSE status END,
                pass_reason = CASE WHEN ? THEN ? ELSE pass_reason END,
                thesis = CASE WHEN ? THEN ? ELSE thesis END,
                note = CASE WHEN ? THEN ? ELSE note END,
                source_url = CASE WHEN ? THEN ? ELSE source_url END,
                updated_at = ?
          WHERE uid = ? AND owner_user_id = ?`,
      ).bind(...binds, now, r.uid, user.id));
      updated.push(r.uid);
    }
  }
  return { statements, pending, created, updated };
}

async function readBackAxal(env: Env, userId: number, created: string[], updated: string[], now: string): Promise<{ created: number; updated: number }> {
  const c = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM research_funds
      WHERE owner_user_id = ? AND uid IN (SELECT value FROM json_each(?))`,
  ).bind(userId, JSON.stringify(created)).first<{ n: number }>();
  const u = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM research_funds
      WHERE owner_user_id = ? AND updated_at = ? AND uid IN (SELECT value FROM json_each(?))`,
  ).bind(userId, now, JSON.stringify(updated)).first<{ n: number }>();
  return { created: Number(c?.n || 0), updated: Number(u?.n || 0) };
}

async function readPendingCells(token: string, spreadsheetId: string, title: string, pending: PendingCell[]): Promise<PendingCell[]> {
  const got = await readRanges(token, spreadsheetId, pending.map((p) => a1Range(title, p.cell)));
  return pending.map((p, i) => {
    const v = String(got[i]?.[0]?.[0] ?? '').trim();
    return { ...p, state: v === p.uid ? 'matches' : v === '' ? 'empty' : 'differs', found: v || undefined };
  });
}

async function writeCells(token: string, spreadsheetId: string, title: string, cells: PendingCell[]): Promise<void> {
  if (!cells.length) return;
  await sheetsFetch(token, `${sheetUrl(spreadsheetId)}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: cells.map((p) => ({ range: a1Range(title, p.cell), values: [[p.uid]] })),
    }),
  });
}

function pendingStatus(cells: PendingCell[]): RunStatus {
  if (cells.every((c) => c.state === 'matches')) return 'complete';
  if (cells.some((c) => c.state !== 'matches' && c.state !== 'differs')) return 'uncertain';
  return 'partial';
}

/**
 * Import: plan, write Axal in one batch with the run record, then write the
 * new identifiers to the mapped uid column and read them back. A timeout
 * after the Axal writes leaves the run `uncertain`, and a new import is
 * refused until it is reconciled, so a retry cannot create the funds twice.
 */
export async function importFundsFromSheet(
  env: Env, user: { id: number },
  opts: { fields: SyncFields; resolutions: Resolutions; idempotencyKey: string },
): Promise<{ run: SheetRun; replayed: boolean }> {
  const { link, token, tab } = await linkedTab(env, user);
  const prior = await env.DB.prepare(
    `SELECT uid FROM research_fund_sheet_runs WHERE owner_user_id = ? AND idempotency_key = ?`,
  ).bind(user.id, opts.idempotencyKey).first<{ uid: string }>();
  if (prior) return { run: (await loadRun(env, user.id, prior.uid)) as SheetRun, replayed: true };
  const open = await openImportRun(env, user.id);
  if (open) {
    throw new SheetSyncError('reconcile_required', 409,
      'The last import is not confirmed on the sheet. Reconcile it before importing again, or the same funds would be created twice.',
      { run: open.uid });
  }
  const started = await startRun(env, user.id, 'import', opts.idempotencyKey, link, tab, opts.fields);
  if (started.replayed) return started;
  const runUid = started.run.uid;

  let values: unknown[][];
  try {
    values = await readValues(token, link.spreadsheet_id, a1Sheet(tab.title));
  } catch (e: any) {
    await stampSheetError(env, user.id, String(e?.message || e));
    const run = await finishRun(env, user.id, runUid, { status: 'failed', detail: 'The tab could not be read. Nothing was written.' });
    return { run, replayed: false };
  }
  const owned = await ownedMap(env, user);
  let plan: ImportPlan;
  try {
    plan = planImport(values, owned, opts.fields, opts.resolutions);
  } catch (e) {
    await finishRun(env, user.id, runUid, { status: 'failed', detail: e instanceof SheetSyncError ? e.sentence : 'The sheet could not be read as funds.' });
    throw e;
  }
  const now = new Date().toISOString();
  const { statements, pending, created, updated } = planStatements(env, user, plan, now);
  const planned = {
    create: plan.counts.create, update: plan.counts.update, unchanged: plan.counts.unchanged,
    skip: plan.counts.skip, resolve: plan.counts.resolve, blank: plan.counts.blank, rows: plan.counts.rows,
  };
  // The run's state is written in the same batch as the funds: if the batch
  // lands, the record says Axal was written and which cells await an id.
  statements.push(finishRunStatement(env, user.id, runUid, {
    status: pending.length ? 'uncertain' : 'running',
    counts: { planned, ids_confirmed: 0, ids_expected: pending.length },
    pending,
    detail: pending.length ? 'Axal saved the import. The identifiers on the sheet are not confirmed yet.' : null,
  }));
  try {
    await env.DB.batch(statements);
  } catch (e: any) {
    console.error('[SHEETS:import] batch', String(e?.message || e));
    const run = await finishRun(env, user.id, runUid, { status: 'failed', detail: 'Axal could not save the import. Nothing was written.' });
    return { run, replayed: false };
  }
  const axal = await readBackAxal(env, user.id, created, updated, now);
  const counts: Record<string, unknown> = {
    planned, created: axal.created, updated: axal.updated,
    ids_expected: pending.length, ids_confirmed: 0,
  };
  if (!pending.length) {
    const ok = axal.created === created.length && axal.updated === updated.length;
    const run = await finishRun(env, user.id, runUid, {
      status: ok ? 'complete' : 'partial', counts, verified: true,
      detail: ok ? null : 'Axal did not read back every change.',
    });
    await stampSheetClock(env, user.id, 'pushed', tab.title);
    return { run, replayed: false };
  }
  let cells: PendingCell[];
  try {
    await writeCells(token, link.spreadsheet_id, tab.title, pending);
    cells = await readPendingCells(token, link.spreadsheet_id, tab.title, pending);
  } catch (e: any) {
    console.error('[SHEETS:import] writeback', String(e?.message || e));
    const run = await finishRun(env, user.id, runUid, {
      status: 'uncertain', counts, pending,
      detail: 'Axal saved the import. Google did not answer while identifiers were written to the sheet.',
    });
    return { run, replayed: false };
  }
  const confirmed = cells.filter((c) => c.state === 'matches').length;
  const status = pendingStatus(cells) === 'complete' && axal.created === created.length && axal.updated === updated.length
    ? 'complete'
    : pendingStatus(cells) === 'complete' ? 'partial' : pendingStatus(cells);
  const run = await finishRun(env, user.id, runUid, {
    status,
    counts: { ...counts, ids_confirmed: confirmed },
    pending: cells,
    verified: status === 'complete',
    detail: status === 'complete' ? null : `${confirmed} of ${cells.length} identifiers are confirmed on the sheet.`,
  });
  await stampSheetClock(env, user.id, 'pushed', tab.title);
  return { run, replayed: false };
}

/**
 * Reconcile an uncertain import: read the cells that should hold the new
 * identifiers, and with `write` put each missing one there. A cell that holds
 * something else is reported and left alone.
 */
export async function reconcileImportRun(
  env: Env, user: { id: number }, runUid: string, opts: { write: boolean },
): Promise<SheetRun> {
  const run = await loadRun(env, user.id, runUid);
  if (!run) throw new SheetSyncError('run_not_found', 404, 'That run is not one of yours.');
  if (run.direction !== 'import' || !run.pending.length) {
    throw new SheetSyncError('nothing_to_reconcile', 409, 'This run wrote no identifiers to the sheet.');
  }
  if (run.status === 'complete') return run;
  const { token } = await accessTokenFor(env, user.id);
  const meta = await workbookMeta(token, run.spreadsheet_id);
  const tab = findTab(meta.tabs, run.sheet_gid);
  let cells = await readPendingCells(token, run.spreadsheet_id, tab.title, run.pending);
  if (opts.write) {
    const missing = cells.filter((c) => c.state === 'empty');
    if (missing.length) {
      await writeCells(token, run.spreadsheet_id, tab.title, missing);
      cells = await readPendingCells(token, run.spreadsheet_id, tab.title, run.pending);
    }
  }
  const status = pendingStatus(cells);
  const confirmed = cells.filter((c) => c.state === 'matches').length;
  const detail = status === 'complete'
    ? null
    : status === 'partial'
      ? `${cells.length - confirmed} identifier cells hold something else on the sheet. They were left alone.`
      : `${confirmed} of ${cells.length} identifiers are on the sheet.`;
  return finishRun(env, user.id, runUid, {
    status,
    counts: { ...run.counts, ids_confirmed: confirmed, reconciled_at: new Date().toISOString() },
    pending: cells,
    verified: status === 'complete',
    detail,
  });
}
