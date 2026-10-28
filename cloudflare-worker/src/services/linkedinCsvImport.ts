/**
 * D1351 (#3566, part 2 of #3564) — the member's contact import from LinkedIn's
 * own data export, `Connections.csv`, parsed on the server (migration 652).
 *
 * WHAT LINKEDIN GIVES. LinkedIn → Settings → Data privacy → Get a copy of
 * your data → Connections. The file opens with a few lines of "Notes:"
 * before its header, then First Name, Last Name, URL, Email Address,
 * Company, Position and Connected On. The email is often empty: LinkedIn
 * includes it only when the connection allowed it.
 *
 * THE MEMBER'S OWN, ONLY. A row is matched against the member's own records
 * and nobody else's (matching across members is part 7):
 *   · their book (`network_connections`, `user_id` = the member);
 *   · their raise pipeline (`raise_prospects` on ventures they found);
 *   · their recruiting (`job_applications` to postings they host or on their
 *     ventures) and interviews (`discovery_interviews` on their ventures);
 *   · a partner's book (`partner_book_contacts`, `owner_user_id` = them).
 *
 * CONSERVATIVE MATCHING, in order: the exact profile URL; the exact email,
 * lowercased; otherwise name plus company. Only an exact URL or email match
 * against a row of the book is taken as that row (`matched`): the import
 * fills its blanks and records the source, and never overwrites a value. A
 * name-and-company match, and any match on a record outside the book, is a
 * suggestion (`contact_match_reviews`): the row is added, and the member
 * decides — Merge, Keep both or Dismiss. Nothing is merged on its own.
 */
import type { Env, User } from '../types';
import { finishImportJob, startImportJob } from './linkedinConnections';

/** The largest file taken, and the most rows read from it. */
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 20_000;
/** Rows written per D1 batch, so a large export stays inside the invocation's query budget. */
const CHUNK = 50;

export type RawRow = { line: number; first: string; last: string; url: string; email: string; company: string; position: string; connected_on: string };
export type Contact = { line: number; name: string; email: string | null; company: string | null; title: string | null; linkedin_url: string | null; connected_on: string | null };
export type CandidateTable = 'network_connections' | 'raise_prospects' | 'job_applications' | 'discovery_interviews' | 'partner_book_contacts';
export type Reason = 'url' | 'email' | 'name_company';
export type Planned =
  | { kind: 'new'; contact: Contact }
  | { kind: 'duplicate'; contact: Contact; bookId: number; reason: 'url' | 'email' }
  | { kind: 'suggestion'; contact: Contact; candidate: { table: CandidateTable; id: number; reason: Reason } }
  | { kind: 'skipped'; line: number; why: 'repeat_in_file' }
  | { kind: 'error'; line: number; why: 'no_name' };

// ---------------------------------------------------------------- parse

/** One CSV line into its fields: commas inside quotes stay, `""` is a quote. */
function splitRow(line: string): string[] {
  const out: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && q && line[i + 1] === '"') { f += '"'; i++; continue; }
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(f); f = ''; continue; }
    f += ch;
  }
  out.push(f);
  return out.map((s) => s.trim());
}

/** The text's records: a newline inside quotes stays in its field. Each keeps the 1-based line it starts on. */
function records(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let cur = '';
  let start = 1;
  let line = 1;
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (q && text[i + 1] === '"') { cur += '""'; i++; continue; } q = !q; cur += ch; continue; }
    if ((ch === '\n' || ch === '\r') && !q) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (cur.trim().length) out.push({ line: start, text: cur });
      cur = ''; line += 1; start = line;
      continue;
    }
    if (ch === '\n') line += 1;
    cur += ch;
  }
  if (cur.trim().length) out.push({ line: start, text: cur });
  return out;
}

/**
 * `Connections.csv` into its rows, as `frontend/src/lib/linkedinCsv.js` reads
 * it: a BOM is dropped, the header is the first of the first ten lines naming
 * First Name and Last Name, and the preamble above it is skipped. A file
 * with no such header is not LinkedIn's: `{ header: false }`.
 */
export function parseConnectionsCsv(input: string): { header: boolean; rows: RawRow[]; truncated: boolean } {
  let text = String(input ?? '');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const recs = records(text);
  const at = recs.slice(0, 10).findIndex((r) => { const lc = r.text.toLowerCase(); return lc.includes('first name') && lc.includes('last name'); });
  if (at === -1) return { header: false, rows: [], truncated: false };
  const head = splitRow(recs[at].text).map((h) => h.toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const ix = {
    first: col('first name'), last: col('last name'), url: col('url', 'profile url'), email: col('email address', 'email'),
    company: col('company'), position: col('position', 'title'), connected_on: col('connected on'),
  };
  const body = recs.slice(at + 1);
  const rows = body.slice(0, MAX_CSV_ROWS).map((r) => {
    const c = splitRow(r.text);
    const get = (i: number) => (i >= 0 ? c[i] ?? '' : '');
    return { line: r.line, first: get(ix.first), last: get(ix.last), url: get(ix.url), email: get(ix.email), company: get(ix.company), position: get(ix.position), connected_on: get(ix.connected_on) };
  });
  return { header: true, rows, truncated: body.length > MAX_CSV_ROWS };
}

// ---------------------------------------------------------------- normalise

/** A LinkedIn profile URL as one comparable form, `https://www.linkedin.com/in/<slug>`; null for anything else. */
export function normaliseProfileUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const m = /^\/in\/([^/?#]+)/i.exec(u.pathname);
  if (!m) return null;
  let slug = m[1];
  try { slug = decodeURIComponent(slug); } catch { /* keep it as written */ }
  slug = slug.trim().toLowerCase();
  return slug ? `https://www.linkedin.com/in/${encodeURIComponent(slug)}` : null;
}

export const normaliseEmail = (raw: unknown): string | null => {
  const s = String(raw ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
};

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
/** LinkedIn's "12 Mar 2024" (or an ISO date) as `2024-03-12`; null when it is neither. */
export function normaliseConnectedOn(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/.exec(s);
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const orNull = (s: string, n: number) => { const t = s.trim(); return t ? clip(t, n) : null; };

/** One row as the book holds it, or why it cannot be one. */
export function normaliseRow(r: RawRow): Contact | { error: 'no_name' } {
  const name = [r.first, r.last].map((s) => s.trim()).filter(Boolean).join(' ');
  if (!name) return { error: 'no_name' };
  return {
    line: r.line, name: clip(name, 200), email: normaliseEmail(r.email), company: orNull(r.company, 200), title: orNull(r.position, 200),
    linkedin_url: normaliseProfileUrl(r.url), connected_on: normaliseConnectedOn(r.connected_on),
  };
}

/** Name plus company, as compared: lowercased, spaces folded. Null unless both are there. */
export function nameCompanyKey(name: unknown, company: unknown): string | null {
  const fold = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const n = fold(name); const c = fold(company);
  return n && c ? `${n}|${c}` : null;
}

// ---------------------------------------------------------------- the member's own records

type Indexed = { byUrl: Map<string, { table: CandidateTable; id: number }>; byEmail: Map<string, { table: CandidateTable; id: number }>; byNameCompany: Map<string, { table: CandidateTable; id: number }> };

/**
 * The member's own records, indexed for matching. Every statement binds the
 * member: their book by `user_id`, their ventures by their own `founder_id`,
 * a posting they host by `host_user_id`, a partner's book by `owner_user_id`.
 * The book comes first, so a match there wins over the same key elsewhere.
 */
export async function ownRecords(env: Env, user: Pick<User, 'id'> & { founder_id?: number | null }): Promise<Indexed> {
  const me = Number(user.id);
  const fid = user.founder_id == null ? null : Number(user.founder_id);
  const all = async (sql: string, ...b: unknown[]) => ((await env.DB.prepare(sql).bind(...b).all<any>()).results ?? []) as any[];
  const sets: Array<[CandidateTable, any[]]> = [
    ['network_connections', await all('SELECT id, name, email, company, linkedin_url FROM network_connections WHERE user_id = ?', me)],
    ['raise_prospects', fid == null ? [] : await all(`SELECT rp.id, rp.name, rp.email, rp.firm AS company, NULL AS linkedin_url FROM raise_prospects rp
        JOIN projects p ON p.id = rp.project_id WHERE p.founder_id = ?`, fid)],
    ['job_applications', await all(`SELECT a.id, a.name, a.email, NULL AS company, a.linkedin_url FROM job_applications a
        JOIN job_postings jp ON jp.id = a.posting_id
        WHERE jp.host_user_id = ? OR (? IS NOT NULL AND jp.project_id IN (SELECT id FROM projects WHERE founder_id = ?))`, me, fid, fid)],
    ['discovery_interviews', fid == null ? [] : await all(`SELECT di.id, di.interviewee_name AS name, NULL AS email, di.interviewee_company AS company, NULL AS linkedin_url
        FROM discovery_interviews di JOIN projects p ON p.id = di.project_id WHERE p.founder_id = ?`, fid)],
    ['partner_book_contacts', await all('SELECT id, name, email, organization AS company, NULL AS linkedin_url FROM partner_book_contacts WHERE owner_user_id = ?', me)],
  ];
  const idx: Indexed = { byUrl: new Map(), byEmail: new Map(), byNameCompany: new Map() };
  for (const [table, rows] of sets) {
    for (const r of rows) {
      const hit = { table, id: Number(r.id) };
      const u = normaliseProfileUrl(r.linkedin_url); if (u && !idx.byUrl.has(u)) idx.byUrl.set(u, hit);
      const e = normaliseEmail(r.email); if (e && !idx.byEmail.has(e)) idx.byEmail.set(e, hit);
      const k = nameCompanyKey(r.name, r.company); if (k && !idx.byNameCompany.has(k)) idx.byNameCompany.set(k, hit);
    }
  }
  return idx;
}

// ---------------------------------------------------------------- plan

/**
 * What each row would do, with nothing written: the preview, and the commit's
 * plan. A row repeated in the file (same URL or email as one above it) is
 * skipped; a row with no name is an error.
 */
export function planRows(rows: RawRow[], idx: Indexed): Planned[] {
  const seenUrl = new Set<string>(); const seenEmail = new Set<string>();
  return rows.map((r): Planned => {
    const c = normaliseRow(r);
    if ('error' in c) return { kind: 'error', line: r.line, why: c.error };
    if ((c.linkedin_url && seenUrl.has(c.linkedin_url)) || (c.email && seenEmail.has(c.email))) return { kind: 'skipped', line: c.line, why: 'repeat_in_file' };
    if (c.linkedin_url) seenUrl.add(c.linkedin_url);
    if (c.email) seenEmail.add(c.email);
    const exact = (c.linkedin_url && idx.byUrl.get(c.linkedin_url) && { hit: idx.byUrl.get(c.linkedin_url)!, reason: 'url' as const })
      || (c.email && idx.byEmail.get(c.email) && { hit: idx.byEmail.get(c.email)!, reason: 'email' as const }) || null;
    if (exact && exact.hit.table === 'network_connections') return { kind: 'duplicate', contact: c, bookId: exact.hit.id, reason: exact.reason };
    if (exact) return { kind: 'suggestion', contact: c, candidate: { ...exact.hit, reason: exact.reason } };
    const nc = nameCompanyKey(c.name, c.company);
    const near = nc ? idx.byNameCompany.get(nc) : undefined;
    if (near) return { kind: 'suggestion', contact: c, candidate: { ...near, reason: 'name_company' } };
    return { kind: 'new', contact: c };
  });
}

export function previewOf(plan: Planned[], truncated = false) {
  const n = (k: Planned['kind']) => plan.filter((p) => p.kind === k).length;
  return {
    rows: plan.length, new: n('new'), duplicates: n('duplicate'), suggestions: n('suggestion'), skipped: n('skipped'), errors: n('error'), truncated,
    // A sample for the member to check, never the whole book.
    sample: plan.slice(0, 20).map((p) => ('contact' in p
      ? { line: p.contact.line, kind: p.kind, name: p.contact.name, company: p.contact.company, title: p.contact.title, has_email: !!p.contact.email, has_url: !!p.contact.linkedin_url,
        ...(p.kind === 'duplicate' ? { reason: p.reason } : p.kind === 'suggestion' ? { reason: p.candidate.reason, with: p.candidate.table } : {}) }
      : { line: p.line, kind: p.kind, why: p.why })),
  };
}

// ---------------------------------------------------------------- commit

/**
 * Write the plan into the member's book as one import job: new rows and
 * suggestions are added (`source = 'linkedin_csv'`, one `contact_sources` row
 * each, `created_row = 1`); an exact match fills only the book row's blanks
 * and records the source with `created_row = 0`; each suggestion gets its
 * review. Returns the job's uid and counts.
 */
export async function commitPlan(env: Env, owner: number, plan: Planned[]) {
  const job = await startImportJob(env, owner, 'linkedin_csv', plan.length);
  let created = 0; let matched = 0;
  const skipped = plan.filter((p) => p.kind === 'skipped').length;
  const errors = plan.filter((p) => p.kind === 'error').length;
  try {
    const writable = plan.filter((p): p is Exclude<Planned, { kind: 'skipped' } | { kind: 'error' }> => p.kind !== 'skipped' && p.kind !== 'error');
    for (let i = 0; i < writable.length; i += CHUNK) {
      const part = writable.slice(i, i + CHUNK);
      const first = await env.DB.batch(part.map((p) => (p.kind === 'duplicate'
        ? env.DB.prepare(`UPDATE network_connections SET linkedin_url = COALESCE(linkedin_url, ?), connected_on = COALESCE(connected_on, ?),
              email = COALESCE(NULLIF(email, ''), ?), company = COALESCE(NULLIF(company, ''), ?), title = COALESCE(NULLIF(title, ''), ?)
            WHERE id = ? AND user_id = ? RETURNING id`)
          .bind(p.contact.linkedin_url, p.contact.connected_on, p.contact.email, p.contact.company, p.contact.title, p.bookId, owner)
        : env.DB.prepare(`INSERT INTO network_connections (user_id, name, email, company, title, linkedin_url, connected_on, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'linkedin_csv') RETURNING id`)
          .bind(owner, p.contact.name, p.contact.email, p.contact.company, p.contact.title, p.contact.linkedin_url, p.contact.connected_on))));
      const ids = first.map((r: any) => Number(r?.results?.[0]?.id ?? 0));
      const second: any[] = [];
      part.forEach((p, k) => {
        const id = ids[k];
        if (!id) return;
        const made = p.kind !== 'duplicate';
        if (made) created += 1; else matched += 1;
        second.push(env.DB.prepare(`INSERT OR IGNORE INTO contact_sources (owner_user_id, contact_table, contact_id, source, job_id, source_ref, created_row)
            SELECT ?, 'network_connections', n.id, 'linkedin_csv', ?, ?, ? FROM network_connections n WHERE n.id = ? AND n.user_id = ?`)
          .bind(owner, job.id, p.contact.linkedin_url, made ? 1 : 0, id, owner));
        if (p.kind === 'suggestion') {
          second.push(env.DB.prepare(`INSERT OR IGNORE INTO contact_match_reviews (uid, owner_user_id, job_id, contact_id, candidate_table, candidate_id, reason)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), owner, job.id, id, p.candidate.table, p.candidate.id, p.candidate.reason));
        }
      });
      if (second.length) await env.DB.batch(second);
    }
    await finishImportJob(env, owner, job, { created, matched, skipped, errors });
  } catch (e) {
    await finishImportJob(env, owner, job, { created, matched, skipped, errors, error: 'The import stopped part way. The rows written so far are in your contacts.' });
    throw e;
  }
  return { uid: job.uid, created, matched, skipped, errors, suggestions: plan.filter((p) => p.kind === 'suggestion').length };
}

// ---------------------------------------------------------------- reviews

export type ReviewDecision = 'merge' | 'keep' | 'dismiss';

/** The member's own pending suggestions, with both sides' names, newest first. */
export async function pendingReviews(env: Env, owner: number, limit = 100) {
  const rows = ((await env.DB.prepare(`SELECT r.uid, r.candidate_table, r.candidate_id, r.reason, r.created_at,
        n.id AS contact_id, n.name, n.company, n.title, n.linkedin_url
      FROM contact_match_reviews r JOIN network_connections n ON n.id = r.contact_id AND n.user_id = r.owner_user_id
      WHERE r.owner_user_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC, r.id DESC LIMIT ?`).bind(owner, limit).all<any>()).results ?? []) as any[];
  const out = [];
  for (const r of rows) out.push({
    uid: r.uid, reason: r.reason, created_at: r.created_at, can_merge: r.candidate_table === 'network_connections',
    imported: { id: r.contact_id, name: r.name, company: r.company ?? null, title: r.title ?? null, has_url: !!r.linkedin_url },
    candidate: { table: r.candidate_table, ...(await candidateOf(env, owner, r.candidate_table, Number(r.candidate_id))) },
  });
  return out;
}

/** One of the member's own records, by table, with its name and company only; null when it is gone or not theirs. */
async function candidateOf(env: Env, owner: number, table: CandidateTable, id: number): Promise<{ id: number; name: string | null; company: string | null } | { id: number; gone: true }> {
  const SQL: Record<CandidateTable, string> = {
    network_connections: 'SELECT name, company FROM network_connections WHERE id = ? AND user_id = ?',
    raise_prospects: `SELECT rp.name, rp.firm AS company FROM raise_prospects rp JOIN projects p ON p.id = rp.project_id
      WHERE rp.id = ? AND p.founder_id = (SELECT founder_id FROM users WHERE id = ?)`,
    job_applications: `SELECT a.name, NULL AS company FROM job_applications a JOIN job_postings jp ON jp.id = a.posting_id
      WHERE a.id = ?1 AND (jp.host_user_id = ?2 OR jp.project_id IN (SELECT id FROM projects WHERE founder_id = (SELECT founder_id FROM users WHERE id = ?2)))`,
    discovery_interviews: `SELECT di.interviewee_name AS name, di.interviewee_company AS company FROM discovery_interviews di JOIN projects p ON p.id = di.project_id
      WHERE di.id = ? AND p.founder_id = (SELECT founder_id FROM users WHERE id = ?)`,
    partner_book_contacts: 'SELECT name, organization AS company FROM partner_book_contacts WHERE id = ? AND owner_user_id = ?',
  };
  const r = await env.DB.prepare(SQL[table]).bind(id, owner).first<any>();
  return r ? { id, name: r.name ?? null, company: r.company ?? null } : { id, gone: true };
}

export class ReviewRefusal extends Error {
  readonly status: 404 | 409;
  readonly code: 'not_found' | 'decided' | 'cannot_merge';
  readonly sentence: string;
  constructor(status: 404 | 409, code: 'not_found' | 'decided' | 'cannot_merge', sentence: string) {
    super(code);
    this.name = 'ReviewRefusal';
    this.status = status; this.code = code; this.sentence = sentence;
  }
}

/**
 * The member's decision on one of their own suggestions. Merge (book rows
 * only) folds the imported row into the one already there: blanks are filled,
 * never overwritten; its sources move across with `created_row = 0`, since the
 * row they now describe was there first; its notes and tasks move too; then
 * the imported row goes. Keep both and Dismiss change no contact.
 */
export async function decideReview(env: Env, owner: number, uid: string, decision: ReviewDecision) {
  const r = await env.DB.prepare(`SELECT id, contact_id, candidate_table, candidate_id, status FROM contact_match_reviews WHERE uid = ? AND owner_user_id = ?`)
    .bind(uid, owner).first<any>();
  if (!r) throw new ReviewRefusal(404, 'not_found', 'That suggestion is not here.');
  if (r.status !== 'pending') throw new ReviewRefusal(409, 'decided', 'That suggestion has already been decided.');
  const status = decision === 'merge' ? 'merged' : decision === 'keep' ? 'kept_both' : 'dismissed';
  if (decision !== 'merge') {
    const res = await env.DB.prepare(`UPDATE contact_match_reviews SET status = ?, decided_at = datetime('now') WHERE id = ? AND owner_user_id = ? AND status = 'pending'`)
      .bind(status, r.id, owner).run();
    if (!res.meta?.changes) throw new ReviewRefusal(409, 'decided', 'That suggestion has already been decided.');
    return { status };
  }
  if (r.candidate_table !== 'network_connections') throw new ReviewRefusal(409, 'cannot_merge', 'Only two of your own contacts can be merged. Keep both, or dismiss it.');
  const keep = Number(r.candidate_id); const drop = Number(r.contact_id);
  const both = await env.DB.prepare('SELECT COUNT(*) AS n FROM network_connections WHERE user_id = ? AND id IN (?, ?)').bind(owner, keep, drop).first<{ n: number }>();
  if (Number(both?.n) !== 2 || keep === drop) throw new ReviewRefusal(404, 'not_found', 'One of those contacts is no longer here.');
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE contact_match_reviews SET status = 'merged', decided_at = datetime('now') WHERE id = ? AND owner_user_id = ? AND status = 'pending' RETURNING id`).bind(r.id, owner),
    env.DB.prepare(`UPDATE network_connections SET
        email = COALESCE(NULLIF(email, ''), (SELECT d.email FROM network_connections d WHERE d.id = ?2 AND d.user_id = ?3)),
        company = COALESCE(NULLIF(company, ''), (SELECT d.company FROM network_connections d WHERE d.id = ?2 AND d.user_id = ?3)),
        title = COALESCE(NULLIF(title, ''), (SELECT d.title FROM network_connections d WHERE d.id = ?2 AND d.user_id = ?3)),
        linkedin_url = COALESCE(linkedin_url, (SELECT d.linkedin_url FROM network_connections d WHERE d.id = ?2 AND d.user_id = ?3)),
        connected_on = COALESCE(connected_on, (SELECT d.connected_on FROM network_connections d WHERE d.id = ?2 AND d.user_id = ?3))
      WHERE id = ?1 AND user_id = ?3`).bind(keep, drop, owner),
    env.DB.prepare(`UPDATE OR IGNORE contact_sources SET contact_id = ?, created_row = 0 WHERE owner_user_id = ? AND contact_table = 'network_connections' AND contact_id = ?`).bind(keep, owner, drop),
    env.DB.prepare(`DELETE FROM contact_sources WHERE owner_user_id = ? AND contact_table = 'network_connections' AND contact_id = ?`).bind(owner, drop),
    env.DB.prepare('UPDATE network_contact_notes SET contact_id = ? WHERE owner_user_id = ? AND contact_id = ?').bind(keep, owner, drop),
    env.DB.prepare('UPDATE network_contact_tasks SET contact_id = ? WHERE owner_user_id = ? AND contact_id = ?').bind(keep, owner, drop),
    env.DB.prepare(`UPDATE contact_match_reviews SET status = 'dismissed', decided_at = datetime('now') WHERE owner_user_id = ? AND contact_id = ? AND status = 'pending'`).bind(owner, drop),
    env.DB.prepare('DELETE FROM network_connections WHERE id = ? AND user_id = ?').bind(drop, owner),
  ]);
  if (!(results[0] as any)?.results?.length) throw new ReviewRefusal(409, 'decided', 'That suggestion has already been decided.');
  return { status, contact_id: keep };
}

// ---------------------------------------------------------------- notes and follow-ups

/** The member's own book row, or null. */
export async function ownContact(env: Env, owner: number, id: number) {
  return env.DB.prepare('SELECT id, name, company, title, email, linkedin_url, connected_on, source FROM network_connections WHERE id = ? AND user_id = ?')
    .bind(id, owner).first<any>();
}
/**
 * D1352 (#3567): the member's own book, for Network › Relationships. Each row
 * carries its sources (so the page can say "From LinkedIn"), its note count
 * and its open follow-ups. Every statement binds the owner.
 */
export const BOOK_PAGE = 50;
export async function bookOf(env: Env, owner: number, q: string, page: number) {
  const term = q.trim().toLowerCase().slice(0, 100);
  const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const offset = Math.max(0, page - 1) * BOOK_PAGE;
  const rows = (await env.DB.prepare(
    `SELECT n.id, n.name, n.email, n.company, n.title, n.linkedin_url, n.connected_on, n.created_at,
            (SELECT GROUP_CONCAT(DISTINCT s.source) FROM contact_sources s WHERE s.owner_user_id = ? AND s.contact_table = 'network_connections' AND s.contact_id = n.id) AS sources,
            (SELECT COUNT(*) FROM network_contact_notes x WHERE x.owner_user_id = ? AND x.contact_id = n.id) AS notes,
            (SELECT COUNT(*) FROM network_contact_tasks t WHERE t.owner_user_id = ? AND t.contact_id = n.id AND t.done_at IS NULL) AS open_tasks
       FROM network_connections n
      WHERE n.user_id = ? AND (? = '' OR lower(n.name) LIKE ? ESCAPE '\\' OR lower(COALESCE(n.company, '')) LIKE ? ESCAPE '\\')
      ORDER BY n.name COLLATE NOCASE, n.id LIMIT ? OFFSET ?`,
  ).bind(owner, owner, owner, owner, term, like, like, BOOK_PAGE, offset).all<any>()).results || [];
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM network_connections n
      WHERE n.user_id = ? AND (? = '' OR lower(n.name) LIKE ? ESCAPE '\\' OR lower(COALESCE(n.company, '')) LIKE ? ESCAPE '\\')`,
  ).bind(owner, term, like, like).first<{ n: number }>();
  return {
    total: Number(total?.n ?? 0), page: Math.max(1, page), page_size: BOOK_PAGE,
    contacts: rows.map((r) => ({
      id: Number(r.id), name: r.name, email: r.email, company: r.company, title: r.title, linkedin_url: r.linkedin_url,
      connected_on: r.connected_on, created_at: r.created_at,
      sources: r.sources ? String(r.sources).split(',').sort() : [],
      notes: Number(r.notes), open_tasks: Number(r.open_tasks),
    })),
  };
}

export async function notesOf(env: Env, owner: number, contactId: number) {
  return ((await env.DB.prepare('SELECT uid, body, created_at FROM network_contact_notes WHERE owner_user_id = ? AND contact_id = ? ORDER BY created_at DESC, id DESC LIMIT 200')
    .bind(owner, contactId).all<any>()).results ?? []);
}
export async function addNote(env: Env, owner: number, contactId: number, body: string) {
  const uid = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO network_contact_notes (uid, owner_user_id, contact_id, body)
      SELECT ?, ?, n.id, ? FROM network_connections n WHERE n.id = ? AND n.user_id = ?`).bind(uid, owner, body, contactId, owner).run();
  return uid;
}
export async function tasksOf(env: Env, owner: number, contactId: number) {
  return ((await env.DB.prepare(`SELECT uid, title, due_on, done_at, created_at FROM network_contact_tasks WHERE owner_user_id = ? AND contact_id = ?
      ORDER BY done_at IS NOT NULL, COALESCE(due_on, '9999-12-31'), id LIMIT 200`).bind(owner, contactId).all<any>()).results ?? []);
}
export async function addTask(env: Env, owner: number, contactId: number, title: string, dueOn: string | null) {
  const uid = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO network_contact_tasks (uid, owner_user_id, contact_id, title, due_on)
      SELECT ?, ?, n.id, ?, ? FROM network_connections n WHERE n.id = ? AND n.user_id = ?`).bind(uid, owner, title, dueOn, contactId, owner).run();
  return uid;
}
export async function setTaskDone(env: Env, owner: number, contactId: number, uid: string, done: boolean) {
  const r = await env.DB.prepare(`UPDATE network_contact_tasks SET done_at = CASE WHEN ? THEN COALESCE(done_at, datetime('now')) ELSE NULL END
      WHERE uid = ? AND owner_user_id = ? AND contact_id = ?`).bind(done ? 1 : 0, uid, owner, contactId).run();
  return Number(r.meta?.changes ?? 0) > 0;
}

