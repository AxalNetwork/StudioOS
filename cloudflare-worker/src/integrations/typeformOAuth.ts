/**
 * D5827 (#5827) — Typeform's OAuth requests and form reads, against
 * Typeform's two documented API origins only.
 *
 * A Typeform account lives in one data center. The member says which at
 * sign-in (`region`, US by default); the choice rides in the signed state and
 * every request for that connection goes to that region's origin, the
 * authorize page included. A token is never sent anywhere else: each request
 * is built here from `REGION_ORIGIN` and a fixed path, and a form id is
 * checked for its shape before it is put into one.
 *
 * Scopes are `forms:read` and `responses:read`, and `offline` for the
 * refresh token background sync needs. Typeform rotates the refresh token on
 * every refresh (UNVERIFIED until the owner's pilot app is registered; a
 * refresh that returns none keeps the old one).
 */
export const TYPEFORM_READ_SCOPES = ['forms:read', 'responses:read', 'offline'] as const;

export type TypeformRegion = 'us' | 'eu';
const US_API = 'https://api.typeform.com';
const EU_API = 'https://api.eu.typeform.com';
export const REGION_ORIGIN: Record<TypeformRegion, string> = Object.freeze({ us: US_API, eu: EU_API });
export const regionOf = (value: unknown): TypeformRegion => (value === 'eu' ? 'eu' : 'us');
/** The authorize page's path on the region's origin. */
const AUTHORIZE_PATH = '/oauth/authorize';
const TOKEN_PATH = '/oauth/token';
const FORMS_PATH = '/forms';
export const PAGE_SIZE = 50;

export interface TypeformApp { id: string; secret: string }

export interface TypeformTokens {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  scope: string | null;
}

/** A Typeform answer this module refuses to read past. `status` is Typeform's, 0 for a malformed body. */
export class TypeformError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 0) { super(code); this.code = code; this.status = status; }
}

/** Typeform form ids are short alphanumeric strings. Anything else is never put into a URL. */
export const isFormId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9]{1,64}$/.test(value);

export function typeformAuthorizeUrl(region: TypeformRegion, clientId: string, redirectUri: string, state: string): string {
  const url = new URL(AUTHORIZE_PATH, REGION_ORIGIN[region]);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: TYPEFORM_READ_SCOPES.join(' '),
    response_type: 'code',
  }).toString();
  return url.toString();
}

async function tokenPost(region: TypeformRegion, app: TypeformApp, fields: Record<string, string>, refused: string): Promise<TypeformTokens> {
  const response = await fetch(`${REGION_ORIGIN[region]}${TOKEN_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...fields, client_id: app.id, client_secret: app.secret }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new TypeformError(response.status === 400 || response.status === 401 ? refused : 'typeform_token_failed', response.status);
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!data || typeof data.access_token !== 'string' || !data.access_token ||
      typeof data.expires_in !== 'number' || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0 ||
      (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || !data.refresh_token)) ||
      (data.scope !== undefined && typeof data.scope !== 'string')) {
    throw new TypeformError('typeform_token_invalid');
  }
  return {
    access_token: data.access_token,
    refresh_token: (data.refresh_token as string | undefined) ?? null,
    expires_in: data.expires_in,
    scope: (data.scope as string | undefined) ?? null,
  };
}

export function exchangeTypeformCode(region: TypeformRegion, app: TypeformApp, code: string, redirectUri: string) {
  return tokenPost(region, app, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, 'typeform_code_refused');
}

export function refreshTypeformToken(region: TypeformRegion, app: TypeformApp, refreshToken: string) {
  return tokenPost(region, app, { grant_type: 'refresh_token', refresh_token: refreshToken }, 'typeform_grant_revoked');
}

async function apiGet(region: TypeformRegion, accessToken: string, path: string): Promise<unknown> {
  const response = await fetch(`${REGION_ORIGIN[region]}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401) throw new TypeformError('typeform_grant_revoked', 401);
  if (response.status === 403) throw new TypeformError('typeform_scope_missing', 403);
  if (response.status === 404) throw new TypeformError('form_not_found', 404);
  if (response.status === 429) throw new TypeformError('typeform_rate_limited', 429);
  if (!response.ok) throw new TypeformError('typeform_unreachable', response.status);
  return response.json().catch(() => { throw new TypeformError('typeform_malformed'); });
}

export interface TypeformFormSummary { id: string; title: string | null; last_updated_at: string | null }
export interface TypeformFormPage { items: TypeformFormSummary[]; page: number; page_count: number; total_items: number }

/** One page of the member's forms, newest change first as Typeform orders them. An empty account is `items: []`. */
export async function listTypeformForms(region: TypeformRegion, accessToken: string, page: number): Promise<TypeformFormPage> {
  const p = Number.isSafeInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
  const data = await apiGet(region, accessToken, `${FORMS_PATH}?${new URLSearchParams({ page: String(p), page_size: String(PAGE_SIZE) })}`) as Record<string, unknown> | null;
  if (!data || !Array.isArray(data.items)) throw new TypeformError('typeform_malformed');
  const items = data.items.flatMap((raw): TypeformFormSummary[] => {
    const f = raw as Record<string, unknown> | null;
    if (!f || !isFormId(f.id)) return [];
    return [{
      id: f.id,
      title: typeof f.title === 'string' ? f.title.slice(0, 200) : null,
      last_updated_at: typeof f.last_updated_at === 'string' ? f.last_updated_at : null,
    }];
  });
  const count = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0);
  return { items, page: p, page_count: count(data.page_count), total_items: count(data.total_items) };
}

/** A field's stable identity: Typeform's `id`, its `ref` and its `type`. Titles stay with Typeform. */
export interface TypeformField { id: string; ref: string | null; type: string }

const FIELD_ID = /^[A-Za-z0-9_-]{1,128}$/;
const FIELD_TYPE = /^[a-z_]{1,64}$/;

function fieldsOf(raw: unknown, out: TypeformField[], depth = 0): void {
  if (!Array.isArray(raw) || depth > 3) return;
  for (const entry of raw) {
    const f = entry as { id?: unknown; ref?: unknown; type?: unknown; properties?: { fields?: unknown } } | null;
    if (!f || typeof f.id !== 'string' || !FIELD_ID.test(f.id) || typeof f.type !== 'string' || !FIELD_TYPE.test(f.type)) continue;
    out.push({ id: f.id, ref: typeof f.ref === 'string' && FIELD_ID.test(f.ref) ? f.ref : null, type: f.type });
    // A group or inline group nests its own fields.
    fieldsOf(f.properties?.fields, out, depth + 1);
  }
}

export interface TypeformForm { id: string; title: string | null; fields: TypeformField[] }

/** One form by its exact id: proof the grant can read it now, and its field identities. */
export async function getTypeformForm(region: TypeformRegion, accessToken: string, formId: string): Promise<TypeformForm> {
  if (!isFormId(formId)) throw new TypeformError('form_malformed');
  const data = await apiGet(region, accessToken, `${FORMS_PATH}/${formId}`) as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') throw new TypeformError('typeform_malformed');
  if (data.id !== formId) throw new TypeformError('form_mismatch');
  const fields: TypeformField[] = [];
  fieldsOf(data.fields, fields);
  return { id: formId, title: typeof data.title === 'string' ? data.title.slice(0, 200) : null, fields };
}
