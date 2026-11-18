/**
 * D6907 (#6907, Worker part): the clauses of an investor's own signed
 * documents for one company, by right type, so Eadwyn can propose a right that
 * is in the paper but not recorded (PRM18 rail, D6868).
 *
 * WHICH DOCUMENTS. The source reporting duties already keep (D1058): the
 * investor's own received closing lines for the company, each line's envelope,
 * and only an envelope whose status is `completed` (signed). Nobody else's line
 * is read.
 *
 * WHAT IS READ. The envelope's stored body (`document_body`), and only when its
 * SHA-256 matches the envelope's `body_sha256`, the hash both parties signed
 * over. A body that is missing or does not match is not read: the document is
 * returned as `readable: false` with its reason, never as "no clause found".
 *
 * WHAT IS RETURNED. For each matching clause: the right type, the clause's
 * number and heading as the paper writes them, its text (at most 2,000
 * characters), its line, and its page where the body marks pages (a form
 * feed); otherwise the page is null, never guessed. The rest of the body is
 * never returned.
 *
 * WHAT IS MATCHED. Six right types, by the words the paper uses. A match is a
 * candidate for a person to confirm; nothing here records a right.
 */
import type { Env } from '../types';

export const RIGHT_TYPES = Object.freeze([
  'pro_rata', 'information_rights', 'board_seat', 'observer_seat', 'liquidation_preference', 'anti_dilution',
] as const);
export type RightType = typeof RIGHT_TYPES[number];

/** The words each right is written in. Each pattern is checked against one clause at a time. */
export const RIGHT_PATTERNS: Readonly<Record<RightType, RegExp>> = Object.freeze({
  pro_rata: /\bpro[\s-]?rata\b|\bpre-?emptive rights?\b|\bright of first offer\b|\bparticipation rights?\b/i,
  information_rights: /\binformation rights?\b|\binspection rights?\b|\b(?:deliver|furnish|provide)\b[^.]{0,80}\bfinancial statements\b/i,
  board_seat: /\b(?:designate|appoint|elect|nominate)\b[^.]{0,80}\b(?:director|member of the board)\b|\bboard seat\b/i,
  observer_seat: /\b(?:board )?observer\b/i,
  liquidation_preference: /\bliquidation preference\b|\bpreference amount\b|\bliquidation event\b[^.]{0,120}\bprior to\b/i,
  anti_dilution: /\banti[\s-]?dilution\b|\bweighted[\s-]average\b|\bfull[\s-]ratchet\b/i,
});

export const CLAUSE_TEXT_MAX = 2000;

export type Clause = { number: string | null; heading: string | null; text: string; line: number; page: number | null };
export type ClauseMatch = Clause & { right_type: RightType };

/**
 * A line that opens a clause: a markdown heading, or a number the paper uses
 * for a section ("3.", "3.3", "3.3(a)", "§3.3", "Section 3.3", "Article 3").
 */
const OPENER = /^\s*(?:(#{1,6})\s+(.*)|(?:§\s*|section\s+|article\s+)?(\d+(?:\.\d+)*(?:\([a-z0-9]+\))?)[.)]?\s+(.*))$/i;

/** The body split into clauses, in order. A body with no clause openers is one clause. */
export function splitClauses(body: string): Clause[] {
  const text = String(body ?? '').replace(/\r\n?/g, '\n');
  const marksPages = text.includes('\f');
  const lines = text.split('\n');
  const out: Clause[] = [];
  let cur: { number: string | null; heading: string | null; lines: string[]; line: number; page: number | null } | null = null;
  let page = 1;
  const flush = () => {
    if (!cur) return;
    const body = cur.lines.join('\n').replace(/\f/g, '').trim();
    if (body) out.push({ number: cur.number, heading: cur.heading, text: body.slice(0, CLAUSE_TEXT_MAX), line: cur.line, page: cur.page });
  };
  lines.forEach((raw, i) => {
    // A form feed before the text starts the line on the next page; one after it ends the page.
    const lead = (/^\f*/.exec(raw)?.[0].length) ?? 0;
    page += lead;
    const line = raw.replace(/\f/g, '');
    const m = OPENER.exec(line);
    if (m) {
      flush();
      const heading = (m[2] ?? m[4] ?? '').trim();
      cur = { number: m[3] ?? null, heading: heading ? heading.slice(0, 200) : null, lines: [line], line: i + 1, page: marksPages ? page : null };
    } else {
      if (!cur) cur = { number: null, heading: null, lines: [], line: i + 1, page: marksPages ? page : null };
      cur.lines.push(line);
    }
    page += (raw.match(/\f/g) || []).length - lead;
  });
  flush();
  return out;
}

/** Each clause that writes one of the six rights, once per right type it writes. */
export function matchRights(clauses: readonly Clause[], types: readonly RightType[] = RIGHT_TYPES): ClauseMatch[] {
  const out: ClauseMatch[] = [];
  for (const c of clauses) {
    const words = `${c.heading ?? ''}\n${c.text}`;
    for (const t of types) if (RIGHT_PATTERNS[t].test(words)) out.push({ ...c, right_type: t });
  }
  return out;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type SignedDocument = {
  envelope_uuid: string;
  title: string;
  document_type: string;
  signed_at: string | null;
  readable: boolean;
  unreadable_reason: string | null;
  clauses: ClauseMatch[];
};

export const UNREADABLE_NO_BODY = 'The signed text is not stored with this document.';
export const UNREADABLE_HASH = 'The stored text does not match what was signed, so it is not read.';

/**
 * The investor's own signed documents for one company, each with the clauses
 * that write the requested right types. Documents are the envelopes of the
 * investor's received closing lines, signed (`completed`), newest first.
 */
export async function investorSignedClauses(
  env: Env, projectId: number, userId: number, types: readonly RightType[] = RIGHT_TYPES,
): Promise<SignedDocument[]> {
  const rows = (await env.DB.prepare(
    `SELECT DISTINCT e.id, e.envelope_uuid, e.document_type, e.document_title, e.document_body, e.body_sha256, e.completed_at
       FROM closing_lines l
       JOIN closings c ON c.id = l.closing_id
       JOIN esign_envelopes e ON e.id = l.envelope_id
      WHERE c.project_id = ? AND l.investor_user_id = ? AND l.status = 'received' AND e.status = 'completed'
      ORDER BY e.completed_at DESC, e.id DESC LIMIT 50`,
  ).bind(projectId, userId).all<any>()).results || [];
  const out: SignedDocument[] = [];
  for (const r of rows) {
    const base = {
      envelope_uuid: String(r.envelope_uuid), title: String(r.document_title || r.document_type),
      document_type: String(r.document_type), signed_at: r.completed_at ?? null,
    };
    const body = typeof r.document_body === 'string' ? r.document_body : '';
    if (!body.trim()) { out.push({ ...base, readable: false, unreadable_reason: UNREADABLE_NO_BODY, clauses: [] }); continue; }
    const want = String(r.body_sha256 || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(want) || (await sha256Hex(body)) !== want) {
      out.push({ ...base, readable: false, unreadable_reason: UNREADABLE_HASH, clauses: [] });
      continue;
    }
    out.push({ ...base, readable: true, unreadable_reason: null, clauses: matchRights(splitClauses(body), types) });
  }
  return out;
}
