/**
 * D6144 (#6144) — what the Commit zone may offer the person reading it on the
 * decision on the card: cast a vote, change it, recuse, or nothing, and why.
 * Pure, so the rules are tested without a page. The Worker's own rules are in
 * `cloudflare-worker/src/routes/ic.ts` (`POST /api/ic/:uid/vote`):
 *
 *   · the vote is `yes | no | abstain | recused`, and every one records its
 *     reason (`rationale_required`); a recusal's reason is the declared
 *     conflict (`recusal_requires_declaration`);
 *   · where a roster is set, only its members vote or recuse (`not_on_roster`);
 *   · a decided record takes no later vote or recusal (`voting_closed`);
 *   · a recusal is final (`recusal_is_final`); recusing after voting is allowed.
 *
 * UNREADABLE NEVER OFFERS A VOTE. A decision whose votes or roster the read did
 * not carry cannot say whether the reader has voted or may vote, so no control
 * is drawn and the panel says the record is unavailable.
 */

export const VOTE_CHOICES = ['yes', 'no', 'abstain'];

/** The decision's votes, or null when the read did not carry them. */
function votesOf(decision) {
  return Array.isArray(decision?.votes) ? decision.votes : null;
}

/**
 * What the reader may do on `decision`.
 * Returns `{ state, mine, may: { vote, recuse }, reason }`, where `state` is one of
 * `unreadable`, `decided`, `off_roster`, `recused`, `voted`, `not_voted`.
 */
export function voteOffer(decision, user) {
  const none = { vote: false, recuse: false };
  const votes = votesOf(decision);
  const roster = decision?.roster;
  if (!decision || !user || user.id == null || !votes || !roster || typeof roster !== 'object') {
    return { state: 'unreadable', mine: null, may: none, reason: 'Unavailable: your vote and who may vote could not be read, so no vote is offered.' };
  }
  const mine = votes.find((v) => Number(v.user_id) === Number(user.id)) || null;
  if (decision.status === 'decided') {
    return { state: 'decided', mine, may: none, reason: 'Voting is closed: this decision has been recorded.' };
  }
  if (mine?.vote === 'recused') {
    return { state: 'recused', mine, may: none, reason: 'A recusal is final: your declaration stands and no later vote from you is recorded.' };
  }
  if (roster.available === true) {
    const members = Array.isArray(roster.members) ? roster.members : null;
    if (!members) {
      return { state: 'unreadable', mine, may: none, reason: 'Unavailable: the voting roster could not be read, so no vote is offered.' };
    }
    if (!members.some((m) => Number(m.user_id) === Number(user.id))) {
      return { state: 'off_roster', mine, may: none, reason: 'You are not on this decision’s voting roster. The person who opened it, or an Admin, picks who votes.' };
    }
  } else if (roster.available !== false) {
    return { state: 'unreadable', mine, may: none, reason: 'Unavailable: the voting roster could not be read, so no vote is offered.' };
  }
  const may = { vote: true, recuse: true };
  return mine
    ? { state: 'voted', mine, may, reason: 'Changing your vote replaces the earlier one.' }
    : { state: 'not_voted', mine: null, may, reason: 'Every vote records its reason.' };
}

/** The vote body, or null until a choice and a reason are written. Never `recused`: that is the recusal dialog's. */
export function voteBody(vote, rationale) {
  const reason = String(rationale ?? '').trim();
  if (!VOTE_CHOICES.includes(vote) || !reason) return null;
  return { vote, rationale: reason };
}

/** A refused or failed write, in the Worker's own words; a fallback only when it sent none. */
export function refusalWords(cause, fallback) {
  const said = typeof cause?.message === 'string' ? cause.message.trim() : '';
  return said || fallback;
}

/**
 * Who may vote, for the eligible / to-vote line (D6143). `null` figures when
 * no roster is set (Not recorded, with the Worker's reason), and `unreadable`
 * when the read did not carry the roster at all.
 */
export function rosterLine(decision) {
  const roster = decision?.roster;
  if (!roster || typeof roster !== 'object') return { unreadable: true };
  if (roster.available !== true) return { eligible: null, toVote: null, reason: roster.reason || 'No voting roster is set for this decision.' };
  const n = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : null);
  return { eligible: n(roster.eligible), toVote: n(roster.to_vote), reason: null };
}
