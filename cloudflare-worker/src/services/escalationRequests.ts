/**
 * What an Administrator's request to HQ carries (D799, #2232).
 *
 * THE OWNER'S ANSWER (D795): an Administrator REQUESTS and HQ decides. The
 * requests are a renewal, a term change, more seats, a delegate admin and
 * notice of non-renewal. Each is an escalation (migration 259) whose kind says
 * which, and each kind carries a few structured fields beside the person's own
 * note. This file is those fields: one rule per kind, and one sentence for
 * each refusal, read by every door that records one — the HQ-tier lane
 * (`routes/licence_requests.ts`), the branch's "To HQ" lane
 * (`routes/branch_escalations.ts`) and HQ's `recordEscalation`, which checks
 * again what a branch sends.
 *
 * THE FIELDS TRAVEL IN `detail`, AND NO MIGRATION IS NEEDED. Every path an
 * escalation takes already carries `detail` verbatim: HQ's insert, the
 * branch's local row, the RPC call between them and the branch's retry of an
 * undelivered row. A request is stored there as one small JSON object,
 * `{ v: 1, request, note }`, built by `encodeRequestDetail` and read by
 * `decodeRequestDetail`. A row whose `detail` is not that object is plain
 * text, as every row before D799 is, and reads back as a note with no request.
 * `v` is the format's version, so a later change to a kind's fields can be
 * told from this one rather than guessed at.
 *
 * A FIELD THIS DOES NOT KNOW IS REFUSED, NOT DROPPED. A field dropped in
 * silence reads as stored (the D208 rule), so a request names exactly its
 * kind's fields. The notice date of a non-renewal is the one field the person
 * may not send: it is the day HQ records the notice, set by the door that
 * writes the row (`withNoticeDate`).
 */

/** The kinds that carry a structured request. */
export const REQUEST_KINDS = ['renewal', 'terms_change', 'seat_increase', 'delegate', 'non_renewal'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/**
 * The kinds D799 added. No caller older than D799 raises them, so their
 * request is required on every door. `seat_increase` is older: the branch
 * drawer has raised it as text since D112, so on the branch path its fields
 * are checked when sent and a text-only raise is still accepted.
 */
export const NEW_REQUEST_KINDS: readonly RequestKind[] = ['renewal', 'terms_change', 'delegate', 'non_renewal'];

export const isRequestKind = (kind: string): kind is RequestKind =>
  (REQUEST_KINDS as readonly string[]).includes(kind);

/**
 * The terms a `terms_change` may name. D797's terms schedule
 * (`services/licenceTerms.ts`) adds its own keys to this list; it was not on
 * `main` when this was written, so these are the licence's own four
 * (migration 187): its territory, its seats, its fee and its term.
 */
export const REQUESTABLE_TERMS = ['territory', 'seats', 'fee', 'term'] as const;

/** The four seat types, as migration 187's CHECK names them. */
export const SEAT_TYPES = ['founder', 'investor', 'advisor', 'partner'] as const;

/** The stored format's version. */
export const REQUEST_FORMAT = 1;

/** How long the note beside a request may be, so the stored object fits `detail`'s 4000. */
export const REQUEST_NOTE_MAX = 2000;
/** How long a term's current or asked value may be. */
export const TERM_VALUE_MAX = 300;
/** The most seats one request asks for. */
export const SEATS_MAX = 10_000;
/** The longest renewal term a request may ask for, in years. */
export const RENEWAL_YEARS_MAX = 25;

const FIELDS: Record<RequestKind, readonly string[]> = {
  renewal: ['term_years'],
  terms_change: ['term', 'current', 'asked'],
  seat_increase: ['seat_type', 'seats'],
  delegate: ['email', 'name'],
  non_renewal: [],
};

export const REQUEST_REFUSALS = {
  bad_request:
    'The request must be an object of its kind\'s fields.',
  request_required:
    'This kind of request needs its details: say what you are asking HQ for.',
  request_not_for_kind:
    'Only a renewal, a term change, a seat increase, a delegate or a notice of non-renewal carries a request. '
    + 'Put what this concerns in the subject and the note.',
  unknown_request_field:
    'The request carries a field its kind does not have, and a field dropped in silence would read as stored.',
  bad_renewal_term:
    `A renewal names its term in whole years, from 1 to ${RENEWAL_YEARS_MAX}, or leaves it to HQ.`,
  term_required:
    'A term change names the term it is about.',
  bad_term:
    `A term change names one of the licence's terms: ${REQUESTABLE_TERMS.join(', ')}.`,
  term_values_required:
    'A term change says the value as it stands and what you are asking for instead.',
  term_value_too_long:
    `A term's value is at most ${TERM_VALUE_MAX} characters. Put the reasoning in the note.`,
  seat_type_required:
    `A seat increase names the seat type: ${SEAT_TYPES.join(', ')}.`,
  seats_required:
    `A seat increase names how many more seats, a whole number from 1 to ${SEATS_MAX}.`,
  delegate_email_required:
    'A delegate request names the person by the email address they sign in with.',
  bad_delegate_email:
    'That is not an email address. A delegate is named by the address they sign in with.',
  notice_date_not_accepted:
    'The notice date is the day HQ records the notice, so it is set for you and cannot be sent.',
  note_too_long:
    `The note beside a request is at most ${REQUEST_NOTE_MAX} characters.`,
} as const;

export type RequestRefusalCode = keyof typeof REQUEST_REFUSALS;
export type RequestRefusal = { ok: false; error: RequestRefusalCode; message: string };
export type ParsedRequest = { ok: true; request: Record<string, unknown> | null };

const refuse = (error: RequestRefusalCode): RequestRefusal => ({ ok: false, error, message: REQUEST_REFUSALS[error] });

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const text = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max + 1) : null;
};

const wholeNumber = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/**
 * One kind's request, checked and normalised. `raw` is what a door was sent:
 * undefined or null for "none". `required` is the door's: true on the HQ-tier
 * lane for every request kind, and on every door for a kind D799 added.
 * Answers `{ ok: true, request: null }` for a kind with no request, or for an
 * older `seat_increase` that sent none where none is required.
 */
export function parseRequest(kind: string, raw: unknown, opts: { required?: boolean } = {}): ParsedRequest | RequestRefusal {
  const sent = raw !== undefined && raw !== null;
  if (!isRequestKind(kind)) return sent ? refuse('request_not_for_kind') : { ok: true, request: null };
  const required = opts.required === true || NEW_REQUEST_KINDS.includes(kind);
  if (!sent) return required && kind !== 'non_renewal' && kind !== 'renewal'
    ? refuse('request_required')
    : { ok: true, request: required ? emptyRequest(kind) : null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return refuse('bad_request');
  const r = raw as Record<string, unknown>;
  if (kind === 'non_renewal' && 'notice_given_on' in r) return refuse('notice_date_not_accepted');
  if (Object.keys(r).some((k) => !FIELDS[kind].includes(k))) return refuse('unknown_request_field');

  switch (kind) {
    case 'renewal': {
      if (r.term_years === undefined || r.term_years === null || r.term_years === '') return { ok: true, request: { term_years: null } };
      const years = wholeNumber(r.term_years, 1, RENEWAL_YEARS_MAX);
      return years === null ? refuse('bad_renewal_term') : { ok: true, request: { term_years: years } };
    }
    case 'terms_change': {
      const term = text(r.term, 40);
      if (!term) return refuse('term_required');
      if (!(REQUESTABLE_TERMS as readonly string[]).includes(term)) return refuse('bad_term');
      const current = text(r.current, TERM_VALUE_MAX);
      const asked = text(r.asked, TERM_VALUE_MAX);
      if (!current || !asked) return refuse('term_values_required');
      if (current.length > TERM_VALUE_MAX || asked.length > TERM_VALUE_MAX) return refuse('term_value_too_long');
      return { ok: true, request: { term, current, asked } };
    }
    case 'seat_increase': {
      const seatType = text(r.seat_type, 20);
      if (!seatType || !(SEAT_TYPES as readonly string[]).includes(seatType)) return refuse('seat_type_required');
      const seats = wholeNumber(r.seats, 1, SEATS_MAX);
      if (seats === null) return refuse('seats_required');
      return { ok: true, request: { seat_type: seatType, seats } };
    }
    case 'delegate': {
      const email = text(r.email, 254);
      if (!email) return refuse('delegate_email_required');
      if (email.length > 254 || !EMAIL_RE.test(email)) return refuse('bad_delegate_email');
      const name = text(r.name, 200);
      return { ok: true, request: { email: email.toLowerCase(), name: name ? name.slice(0, 200) : null } };
    }
    case 'non_renewal':
      return { ok: true, request: {} };
  }
}

/** The request a kind with no required field records when none is sent. */
function emptyRequest(kind: RequestKind): Record<string, unknown> {
  return kind === 'renewal' ? { term_years: null } : {};
}

/**
 * A non-renewal's notice date, set by the door that writes the row: the day
 * HQ records it, in UTC. D797's `non_renewal_notice_days` is measured from it.
 */
export function withNoticeDate(kind: string, request: Record<string, unknown> | null, now = new Date()) {
  if (kind !== 'non_renewal' || !request) return request;
  return { ...request, notice_given_on: now.toISOString().slice(0, 10) };
}

/** The note beside a request, checked for length. */
export function parseNote(raw: unknown): { ok: true; note: string | null } | RequestRefusal {
  const note = text(raw, REQUEST_NOTE_MAX);
  if (note && note.length > REQUEST_NOTE_MAX) return refuse('note_too_long');
  return { ok: true, note };
}

/** The stored form: `{ v, request, note }` in `detail`. */
export function encodeRequestDetail(request: Record<string, unknown>, note: string | null): string {
  return JSON.stringify({ v: REQUEST_FORMAT, request, note: note ?? null });
}

/**
 * A row's `detail`, read back. A stored request comes back as its fields and
 * its note; anything else is the plain-text note every row before D799 holds,
 * with no request — read as written, never parsed into one.
 */
export function decodeRequestDetail(detail: string | null | undefined): { request: Record<string, unknown> | null; note: string | null } {
  const s = typeof detail === 'string' ? detail : '';
  if (s.startsWith('{"v":')) {
    try {
      const o = JSON.parse(s);
      if (o && o.v === REQUEST_FORMAT && o.request && typeof o.request === 'object' && !Array.isArray(o.request)) {
        return { request: o.request, note: typeof o.note === 'string' ? o.note : null };
      }
    } catch { /* plain text that happens to start like one */ }
  }
  return { request: null, note: s || null };
}

/**
 * A listed row with its request read out: `request` (null when it carries
 * none) and `note`, the person's own words. `detail` stays as stored, so a
 * reader older than D799 still reads what it read before.
 */
export function withRequestView<T extends { detail?: string | null }>(row: T): T & { request: Record<string, unknown> | null; note: string | null } {
  const { request, note } = decodeRequestDetail(row.detail);
  return { ...row, request, note };
}
