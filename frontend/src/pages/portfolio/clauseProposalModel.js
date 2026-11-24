/**
 * D6907 part 2 (#6907, canvas PRM18 rail of `Portfolio v2 Rights and Request a Mark`): Eadwyn's proposal of a right
 * that is in the investor's signed paper but not recorded, as pure rules. No React, no fetch, no clock.
 *
 * It reads `GET /api/portfolio-clauses/:uid?type=` (D6907 part 1): the investor's own completed envelopes for the
 * company, each readable or not with its reason, and the clauses that match a right type. It asks only for the types
 * `askableTypes` gives from `GET /api/portfolio-rights/:uid` (D6868): not recorded and with no open request. So a
 * recorded right, or one already requested, is never proposed.
 *
 * Accept sends the existing request to record a right (`POST /api/portfolio-rights/requests`) with the clause and its
 * citation as the description. Eadwyn never records a right; HQ does.
 */
import { DESCRIPTION_MAX, RIGHT_TYPES } from './rightsModel';
import { day } from './portfolioModel';

/** What each right grants, as the sentence says it ("grants you an observer seat"). */
export const RIGHT_PHRASE = Object.freeze({
  pro_rata: 'a pro rata right',
  information_rights: 'information rights',
  board_seat: 'a board seat',
  observer_seat: 'an observer seat',
  liquidation_preference: 'a liquidation preference',
  anti_dilution: 'anti-dilution protection',
});

/** What the clause read must carry to be read at all. */
export const CLAUSES_SHAPE = (v) => Array.isArray(v?.documents) && v.documents.every((d) => typeof d?.readable === 'boolean');

export const PROPOSAL_FOOT = 'Accept sends HQ a request to record this right. Nothing is recorded until HQ does.';
export const RAIL_FOOT = 'Eadwyn reads stored records and the signed documents you hold. It never records a right, and nothing leaves until you accept.';
export const CLAUSES_UNREADABLE = 'Eadwyn could not read your signed documents. That is not a finding that none grants a right.';

/** "§3.3", else the clause's heading, else "line 42"; then ", page 9" where the body marks pages. */
export function clauseLocation(c) {
  const where = c?.number ? `§${String(c.number).replace(/^§\s*/, '')}` : c?.heading ? `“${c.heading}”` : Number.isFinite(c?.line) ? `line ${c.line}` : null;
  const page = Number.isFinite(c?.page) ? `page ${c.page}` : null;
  return [where, page].filter(Boolean).join(', ') || 'clause not located';
}

/** The clause's own name for the sentence: "§3.3" or its heading; the page stays in the citation. */
const clauseName = (c) => (c?.number ? `§${String(c.number).replace(/^§\s*/, '')}` : c?.heading ? `“${c.heading}”` : null);

const trimText = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/**
 * The proposals for the rights the investor may ask for: one per right type, from the first readable document (in
 * the read's order) and its first matching clause. A type the caller may not ask for is never proposed, whatever the
 * paper says.
 */
export function proposalsOf(read, askable) {
  const allowed = new Set((askable || []).filter((t) => RIGHT_TYPES.includes(t)));
  const seen = new Set();
  const out = [];
  for (const d of read?.documents || []) {
    if (!d?.readable) continue;
    for (const c of d.clauses || []) {
      const type = c?.right_type;
      if (!allowed.has(type) || seen.has(type)) continue;
      seen.add(type);
      const title = d.title || 'signed document';
      const where = clauseLocation(c);
      const signed = day(d.signed_at);
      const cite = `Source: signed ${title}${signed ? ` · ${signed}` : ''} · ${where}`;
      const head = `${title}, ${where}${signed ? `, signed ${signed}` : ''}: `;
      const quote = trimText(c.text, Math.max(0, DESCRIPTION_MAX - head.length - 2));
      out.push({
        key: `${d.envelope_uuid}:${c.line}:${type}`,
        type,
        sentence: `This ${title}${clauseName(c) ? ` ${clauseName(c)}` : ''} grants you ${RIGHT_PHRASE[type]}; it is not recorded here. Add it?`,
        cite,
        description: `${head}“${quote}”`.slice(0, DESCRIPTION_MAX),
      });
    }
  }
  return out;
}

/** The documents Eadwyn could not read, each with its reason, so the rail never reads as "none found". */
export function unreadableDocs(read) {
  return (read?.documents || []).filter((d) => d && !d.readable)
    .map((d) => ({ key: d.envelope_uuid, title: d.title || 'A signed document', reason: d.unreadable_reason || 'It could not be read.' }));
}

/**
 * The rail's state:
 *   nothing_to_ask  every right is recorded or already requested, so nothing is read or proposed
 *   loading         the clauses are being read
 *   unreadable      the clause read failed: said, never "none found"
 *   no_documents    the read succeeded and the investor holds no signed document for the company
 *   proposals       at least one proposal (unreadable documents are listed beside them)
 *   none_found      every readable document was read and none grants an unrecorded right (unreadable ones listed)
 */
export function railState({ askable, read }) {
  if (!askable?.length) return 'nothing_to_ask';
  if (!read || read.state === 'loading') return 'loading';
  if (read.state !== 'ok') return 'unreadable';
  const docs = read.value?.documents || [];
  if (!docs.length) return 'no_documents';
  if (proposalsOf(read.value, askable).length) return 'proposals';
  return docs.some((d) => d.readable) ? 'none_found' : 'unreadable_all';
}

/** "Eadwyn read 2 signed documents and found no unrecorded right." */
export function noneFoundLine(read) {
  const n = (read?.documents || []).filter((d) => d?.readable).length;
  return `Eadwyn read ${n} signed ${n === 1 ? 'document' : 'documents'} and found no clause granting a right that is not recorded or requested.`;
}
