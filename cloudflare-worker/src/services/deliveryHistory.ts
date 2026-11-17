/**
 * #4709 (D4709) — Delivery histories: input checks, keyset pages and the
 * at-send blocker record, shared by `routes/partner_delivery.ts`.
 *
 * INPUTS. A date or a link is checked before it is stored, and a refusal is a
 * fixed sentence with a code (`bad_date`, `bad_link`, `bad_input`), never the
 * parser's text. A link is http or https only: a `javascript:` or `data:` link
 * stored on a deliverable is one a client would be handed to open.
 *
 * PAGES. Each Delivery list is ordered by a key that ends in the row id, so no
 * two rows tie and a page boundary cannot repeat or skip one. The cursor is
 * that key for the last row returned, opaque to the page (base64url JSON).
 * The firm-wide figures beside a list are counted over the whole book, never
 * over the page.
 */

type Refusal = { status: number; code: string; detail: string };

export function refuse(r: Refusal): Response {
  return new Response(JSON.stringify({ detail: r.detail, code: r.code }), {
    status: r.status, headers: { 'Content-Type': 'application/json' },
  });
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * A date the firm typed: `2026-11-15`, or an ISO date and time. Absent, null
 * or blank is null (the field is cleared). Anything else that is not a real
 * calendar date is refused with `bad_date`.
 */
export function dateInput(v: unknown, label: string): string | null {
  if (v === null || v === undefined) return null;
  const bad = () => refuse({ status: 400, code: 'bad_date', detail: `${label} must be a date, like 2026-11-15.` });
  if (typeof v !== 'string') throw bad();
  const s = v.trim();
  if (!s) return null;
  const m = s.length <= 40 ? DATE_RE.exec(s) : null;
  if (!m) throw bad();
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1900 || y > 2200 || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) throw bad();
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || (m[6] !== undefined && Number(m[6]) > 59))) throw bad();
  return s;
}

/** A link the client is handed: http or https, no credentials in it. */
export function linkInput(v: unknown, label = 'The link'): string | null {
  if (v === null || v === undefined) return null;
  const bad = () => refuse({
    status: 400, code: 'bad_link', detail: `${label} must be a web address starting with https:// or http://.`,
  });
  if (typeof v !== 'string') throw bad();
  const s = v.trim();
  if (!s) return null;
  if (s.length > 600) throw bad();
  let u: URL;
  try { u = new URL(s); } catch { throw bad(); }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname || u.username || u.password) throw bad();
  return s;
}

/** Free text: a string (or a number, written as one); never an object, list or boolean. */
export function textInput(v: unknown, max: number, label: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' && typeof v !== 'number') {
    throw refuse({ status: 400, code: 'bad_input', detail: `${label} must be text.` });
  }
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

// ---------------------------------------------------------------------------
// Keyset pages
// ---------------------------------------------------------------------------

export type Key = Array<string | number | null>;

export function encodeCursor(key: Key): string {
  const b = btoa(unescape(encodeURIComponent(JSON.stringify(key))));
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const badCursor = () => refuse({
  status: 400, code: 'bad_cursor', detail: 'That page link is no longer valid. Start again from the first page.',
});

/** The key a cursor names, checked against its shape: `n` parts, the last a row id. */
export function decodeCursor(raw: string | undefined, n: number): Key | null {
  if (raw === undefined || raw === '') return null;
  let key: unknown;
  try {
    const b = raw.replace(/-/g, '+').replace(/_/g, '/');
    key = JSON.parse(decodeURIComponent(escape(atob(b + '='.repeat((4 - (b.length % 4)) % 4)))));
  } catch { throw badCursor(); }
  if (!Array.isArray(key) || key.length !== n) throw badCursor();
  const id = key[n - 1];
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) throw badCursor();
  for (const part of key.slice(0, -1)) {
    if (part !== null && typeof part !== 'string' && typeof part !== 'number') throw badCursor();
  }
  return key as Key;
}

/** `?limit=`: a whole number from 1 to `max`; absent is `max`. */
export function pageLimit(raw: string | undefined, max: number): number {
  if (raw === undefined || raw === '') return max;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw refuse({ status: 400, code: 'bad_limit', detail: `A page holds from 1 to ${max} rows.` });
  }
  return n;
}

export type Page = { limit: number; returned: number; total: number; next_cursor: string | null; complete: boolean };

/**
 * One page of an already ordered whole book (newest `created_at` first, then
 * the highest id). Used where the firm-wide figures need every row anyway, so
 * the page is cut from the same rows the figures were counted over.
 */
export function pageOfBook<T>(
  rows: T[], keyOf: (r: T) => [string, number], cursor: Key | null, limit: number,
): { rows: T[]; page: Page } {
  const cAt = cursor ? String(cursor[0] ?? '') : '';
  const cId = cursor ? Number(cursor[1]) : 0;
  const after = cursor
    ? rows.filter((r) => { const [at, id] = keyOf(r); return at < cAt || (at === cAt && id < cId); })
    : rows;
  const out = after.slice(0, limit);
  const more = after.length > limit;
  const last = out[out.length - 1];
  return {
    rows: out,
    page: {
      limit, returned: out.length, total: rows.length,
      next_cursor: more && last ? encodeCursor(keyOf(last)) : null,
      complete: !cursor && !more,
    },
  };
}

// ---------------------------------------------------------------------------
// Blockers at send
// ---------------------------------------------------------------------------

export type AtSendBlocker = { side: string; summary: string; raised_at: string | null };

/** The stored JSON, or null when nothing was recorded (or it cannot be read). */
export function blockersAtSend(raw: unknown): AtSendBlocker[] | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const v = JSON.parse(String(raw));
    if (!Array.isArray(v)) return null;
    return v
      .filter((b) => b && typeof b === 'object' && typeof b.summary === 'string')
      .map((b) => ({ side: b.side === 'client' ? 'client' : 'ours', summary: b.summary, raised_at: b.raised_at ?? null }));
  } catch { return null; }
}
