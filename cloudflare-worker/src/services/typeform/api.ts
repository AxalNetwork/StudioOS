/**
 * D5828 (#5828) — Typeform's two reads for the response importer, and what
 * is taken from each. READ ONLY, GET only, two path shapes, two origins.
 *
 *   forms.get        GET /forms/{form_id}             the field ids, types,
 *                                                     titles and choice ids
 *   responses.list   GET /forms/{form_id}/responses   one page of responses
 *
 * The origin is chosen by the connection's validated region (#5827 owns the
 * validation and the grant; until it lands, the region is read from
 * `integrations.config_json.region` and anything but `us` or `eu` refuses the
 * read rather than guessing a data center). The token is passed in; this file
 * never stores or logs it.
 *
 * WHAT IS READ FROM A RESPONSE: its id, its paging token, whether it is
 * completed or partial, its dates, and the answers to the mapped field ids.
 * `hidden`, `metadata`, `variables`, `calculated`, every unmapped answer and
 * every identity-bearing answer type are never read, so they cannot reach
 * storage or a log. A provider body never becomes an error message.
 */

/** The two data centers. UNVERIFIED against a live EU account until #5827's pilot callback. */
export const TYPEFORM_API_ORIGINS = Object.freeze({ us: 'https://api.typeform.com', eu: 'https://api.eu.typeform.com' } as const);
/** Where a founder opens the form's responses in Typeform, by region. UNVERIFIED like the origins. */
export const TYPEFORM_ADMIN_ORIGINS = Object.freeze({ us: 'https://admin.typeform.com', eu: 'https://admin.eu.typeform.com' } as const);
export type TypeformRegion = keyof typeof TYPEFORM_API_ORIGINS;

export const FORM_ID = /^[A-Za-z0-9]{1,64}$/;
export const FIELD_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const RESPONSE_ID = /^[A-Za-z0-9]{1,128}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
/** Query parameters a read may carry; anything else is refused before a request is built. */
const QUERY_KEYS = Object.freeze(['page_size', 'since', 'after', 'sort', 'response_type', 'fields', 'included_response_ids'] as const);
const QUERY_VALUE = /^[A-Za-z0-9_,:.\-]{1,4000}$/;
export const READ_TIMEOUT_MS = 10_000;
export const READ_MAX_BYTES = 5_000_000;

export type TypeformErrorCode = 'rate_limited' | 'access_revoked' | 'form_unavailable' | 'region_unknown' | 'unreadable';
export class TypeformReadError extends Error {
  code: TypeformErrorCode;
  retryAfterSec: number | null;
  constructor(code: TypeformErrorCode, retryAfterSec: number | null = null) { super(code); this.name = 'TypeformReadError'; this.code = code; this.retryAfterSec = retryAfterSec; }
}

export function regionOf(configJson: unknown): TypeformRegion | null {
  let cfg: any = configJson;
  if (typeof configJson === 'string') { try { cfg = JSON.parse(configJson); } catch { return null; } }
  const r = cfg && typeof cfg === 'object' ? cfg.region : null;
  return r === 'us' || r === 'eu' ? r : null;
}

/** The form's responses page in Typeform for the validated region, or null when the region or id is not valid. */
export function responsesLink(region: TypeformRegion | null, formId: string): string | null {
  if (!region || !(region in TYPEFORM_ADMIN_ORIGINS) || !FORM_ID.test(formId)) return null;
  return `${TYPEFORM_ADMIN_ORIGINS[region]}/form/${formId}/results#responses`;
}

export type TypeformCall = 'forms.get' | 'responses.list';
export interface ReadTarget { region: TypeformRegion | null; token: string; formId: string }
export type FetchLike = (url: string, init: { method: 'GET'; headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

/** The exact URL a call reads, or a thrown `TypeformReadError`. Exported for the endpoint-shape test. */
export function typeformUrl(region: TypeformRegion | null, call: TypeformCall, formId: string, query: Record<string, string> = {}): string {
  if (!region || !(region in TYPEFORM_API_ORIGINS)) throw new TypeformReadError('region_unknown');
  if (!FORM_ID.test(formId)) throw new TypeformReadError('form_unavailable');
  const path = call === 'forms.get' ? `/forms/${formId}` : `/forms/${formId}/responses`;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (!(QUERY_KEYS as readonly string[]).includes(k) || !QUERY_VALUE.test(v)) throw new TypeformReadError('unreadable');
    if (call === 'forms.get') throw new TypeformReadError('unreadable');
    params.set(k, v);
  }
  const qs = params.toString();
  return `${TYPEFORM_API_ORIGINS[region]}${path}${qs ? `?${qs}` : ''}`;
}

/** One bounded GET. 429 carries Retry-After; 401/403 is a lost grant; 404 a deleted or moved form. */
export async function typeformRead(fetchImpl: FetchLike, target: ReadTarget, call: TypeformCall, query: Record<string, string> = {}): Promise<any> {
  const url = typeformUrl(target.region, call, target.formId, query);
  if (typeof target.token !== 'string' || !target.token) throw new TypeformReadError('access_revoked');
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'GET', headers: { authorization: `Bearer ${target.token}`, accept: 'application/json' }, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  } catch { throw new TypeformReadError('unreadable'); }
  if (res.status === 429) {
    const after = Number(res.headers.get('retry-after'));
    throw new TypeformReadError('rate_limited', Number.isFinite(after) && after > 0 ? Math.min(Math.ceil(after), 3600) : 60);
  }
  if (res.status === 401 || res.status === 403) throw new TypeformReadError('access_revoked');
  if (res.status === 404 || res.status === 410) throw new TypeformReadError('form_unavailable');
  if (!res.ok) throw new TypeformReadError('unreadable');
  const text = await res.text().catch(() => '');
  if (text.length > READ_MAX_BYTES) throw new TypeformReadError('unreadable');
  try { return JSON.parse(text); } catch { throw new TypeformReadError('unreadable'); }
}

// ---------------------------------------------------------------------------
// What is taken from a form and from a response
// ---------------------------------------------------------------------------

export interface FormField { id: string; type: string; title: string; choices: Array<{ id: string; label: string }> }

/** Every field with a stable id, group children included: id, type, title and choice ids/labels. */
export function formFields(form: any): FormField[] {
  const out: FormField[] = [];
  const walk = (fields: unknown, depth: number) => {
    if (depth > 3) return;
    for (const f of Array.isArray(fields) ? fields : []) {
      if (!f || typeof f.id !== 'string' || !FIELD_ID.test(f.id) || typeof f.type !== 'string') continue;
      const choices = (Array.isArray(f.properties?.choices) ? f.properties.choices : [])
        .filter((c: any) => typeof c?.id === 'string' && FIELD_ID.test(c.id))
        .map((c: any) => ({ id: c.id, label: String(c.label ?? '').slice(0, 200) }));
      out.push({ id: f.id, type: f.type.slice(0, 40), title: String(f.title ?? '').slice(0, 500), choices });
      if (Array.isArray(f.properties?.fields)) walk(f.properties.fields, depth + 1);
    }
  };
  walk(form?.fields, 0);
  return out;
}

export interface ResponseHead { response_id: string; token: string; response_type: 'completed' | 'partial'; submitted_at: string | null; landed_at: string | null }

/**
 * The head of a response, or null when it is not one the importer counts (a
 * `started` response, or an id or date that does not parse). Reads five keys.
 */
export function responseHead(item: any): ResponseHead | null {
  const id = typeof item?.response_id === 'string' && RESPONSE_ID.test(item.response_id) ? item.response_id : null;
  if (!id) return null;
  const type = item.response_type === 'partial' ? 'partial' : item.response_type === 'completed' || (item.response_type == null && typeof item.submitted_at === 'string') ? 'completed' : null;
  if (!type) return null;
  const submitted = typeof item.submitted_at === 'string' && ISO.test(item.submitted_at) ? item.submitted_at : null;
  if (type === 'completed' && !submitted) return null;
  const token = typeof item.token === 'string' && RESPONSE_ID.test(item.token) ? item.token : id;
  return { response_id: id, token, response_type: type, submitted_at: submitted, landed_at: typeof item.landed_at === 'string' && ISO.test(item.landed_at) ? item.landed_at : null };
}

/** The answer object for one mapped field id, or null. Never looks at any other answer. */
export function answerFor(item: any, fieldId: string): any | null {
  for (const a of Array.isArray(item?.answers) ? item.answers : []) if (a?.field?.id === fieldId) return a;
  return null;
}
