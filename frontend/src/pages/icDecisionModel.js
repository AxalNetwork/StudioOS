// IC decision pages' rules (#6155, D6155): who may change a record, the
// recusal request, and the tally in words. Interim: proposal 1 of the IC
// design brief replaces ICDecisionPage.jsx and ICDecisionsPage.jsx, so these
// stay as small as the Worker's own rules in cloudflare-worker/src/routes/ic.ts.

// PUT /api/ic/:uid answers 403 unless the caller wrote the record or is an
// Admin (ic.ts, `d.created_by !== user.id && !isAdmin(user)`). The page offers
// Save memo, Record decision and Outcome on exactly that rule.
export function canChangeDecision(user, decision) {
  if (!user || !decision) return false;
  if (String(user.role || '').toLowerCase() === 'admin') return true;
  return decision.created_by != null && user.id != null && Number(decision.created_by) === Number(user.id);
}

export const AUTHOR_ONLY_LINE = 'Only the person who opened this record, or an Admin, can change its memo, terms, conditions, decision and outcome.';

// POST /api/ic/:uid/vote with `recused` needs the declared conflict as its
// rationale, and the Worker keeps a recusal final.
export function recusalBody(declaration) {
  const rationale = String(declaration ?? '').trim();
  if (!rationale) return null;
  return { vote: 'recused', rationale };
}

export const RECUSAL_FINAL_LINE = 'A recusal is final: your declaration stands and no later vote from you is recorded.';

export function ownRecusal(user, votes) {
  if (!user || user.id == null) return null;
  return (votes || []).find((v) => Number(v.user_id) === Number(user.id) && v.vote === 'recused') || null;
}

// The tally in words and numbers. A count the read did not carry is
// "Not recorded", never 0. Recused sits beside the tally, never in it.
export function tallyText(tally) {
  if (!tally || typeof tally !== 'object') return 'Votes not recorded';
  const n = (k) => (Number.isFinite(Number(tally[k])) && tally[k] !== null && tally[k] !== undefined ? String(Number(tally[k])) : 'Not recorded');
  return `Yes ${n('yes')} · No ${n('no')} · Abstain ${n('abstain')} · Recused ${n('recused')}`;
}

export const VOTE_WORDS = { yes: 'Yes', no: 'No', abstain: 'Abstain', recused: 'Recused' };

export const CONDITION_WORDS = { open: 'Open', met: 'Met', waived: 'Waived' };

// D6154: partners may use Commit only; other Deals zones keep their original guards.
export function canOpenCommitRoom(role) {
  return role === 'admin' || role === 'investor' || role === 'partner';
}

// Cast rationale counts exclude final recusal declarations, as DX7 already does.
export function ballotOf(decision) {
  const votes = decision?.votes ?? [];
  const recused = votes.filter((v) => v.vote === 'recused');
  const cast = votes.filter((v) => v.vote !== 'recused');
  return {
    eligible: null,
    voted: cast.length,
    recused: recused.length,
    rationales: cast.filter((v) => String(v.rationale || '').trim().length > 0).length,
  };
}
