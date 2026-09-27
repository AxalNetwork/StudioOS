/**
 * Each party's own position on each clause of a generated co-founder
 * agreement draft — D354. Read from GET /legal/cofounder-agreement/:docId/
 * positions; written through PUT …/positions/:clauseKey, where the Worker takes
 * the actor from the session and refuses a body naming anyone else.
 *
 * Pure, so the page's derivations are tested without React. A position the
 * store does not hold for a party is `null` — "not recorded", never counted as
 * accepted — and a clause is agreed only when EVERY party with an account has
 * accepted it. A party with no account on file cannot record anything, so a
 * draft with one is never "agreed" by this page: it says who is missing.
 */

/** The draft the positions belong to: the newest generated agreement. */
export function latestAgreementDoc(docs) {
  const list = (Array.isArray(docs) ? docs : []).filter((d) => d && d.id != null);
  if (!list.length) return null;
  return [...list].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || Number(b.id) - Number(a.id))[0];
}

/** { clause_key → [{ party_index, name, is_you, has_account, position, note }] } */
export function positionsByClause(read) {
  if (!read || read.state !== 'ok') return {};
  const parties = Array.isArray(read.data?.parties) ? read.data.parties : [];
  const positions = Array.isArray(read.data?.positions) ? read.data.positions : [];
  const out = {};
  const keys = new Set(positions.map((p) => p.clause_key));
  for (const key of keys) {
    out[key] = parties.map((party) => {
      const p = positions.find((x) => x.clause_key === key && x.party_index === party.party_index);
      return { ...party, position: p ? p.position : null, note: p ? p.note : null };
    });
  }
  return out;
}

/** The rows for one clause, including clauses nobody has touched yet. */
export function clauseRows(read, clauseKey) {
  if (!read || read.state !== 'ok') return [];
  const parties = Array.isArray(read.data?.parties) ? read.data.parties : [];
  const by = positionsByClause(read)[clauseKey] || [];
  return parties.map((party) => by.find((r) => r.party_index === party.party_index) || { ...party, position: null, note: null });
}

/**
 * Where a clause stands across the parties:
 *   agreed      — every party with an account accepted, and no party lacks one
 *   alignment   — at least one party marked it "needs alignment"
 *   open        — anything else (someone has not recorded a position yet)
 */
export function clauseAgreement(rows) {
  if (!rows.length) return 'open';
  if (rows.some((r) => r.position === 'needs_alignment')) return 'alignment';
  if (rows.every((r) => r.has_account && r.position === 'accepted')) return 'agreed';
  return 'open';
}

/** Counts for the banner: agreed / needs alignment / open, over clause keys. */
export function agreementTally(read, clauseKeys) {
  const t = { agreed: 0, alignment: 0, open: 0 };
  for (const k of clauseKeys) t[clauseAgreement(clauseRows(read, k))] += 1;
  return t;
}
