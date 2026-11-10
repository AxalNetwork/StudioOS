/**
 * D4575 update (#5346): one run's provenance as rows, for the run detail in
 * HQ › AI agents › Runs (`Operations.jsx`). The record is
 * `GET /api/admin/ai-agents/runs/:uid/provenance`, `runProvenance` unchanged.
 * Every field the Worker marks `{ available: false, why }` reads "Not
 * recorded", with its reason: never 0, never a blank.
 */
export const NOT_RECORDED = 'Not recorded';

export const RECONCILIATION_WORDS = Object.freeze({
  nothing_charged: 'Nothing charged: no hold, no usage row, no proposal',
  settled_matches: 'Settled at exactly the charge',
  held_unsettled: 'Held, not settled yet',
  held_expired: 'Held past its expiry: an orphan for the sweep',
  released: 'Released: refunded, nothing charged',
  mismatch: 'Mismatch: the hold and the charge disagree',
  unrecorded: 'Unrecorded: a charge or hold could not be read',
});

const isKnown = (k) => !!k && typeof k === 'object' && k.available === true && 'value' in k;
const whyOf = (k) => (k && typeof k === 'object' && k.available === false && typeof k.why === 'string' && k.why.trim() ? k.why : null);
const usd = (micro) => (Number.isFinite(micro) ? `$${(micro / 1e6).toFixed(6)}` : NOT_RECORDED);

/** A `Known<T>` as { value, why }: the value formatted when known, else "Not recorded" and the reason. */
export function knownCell(k, fmt = (v) => String(v)) {
  if (isKnown(k)) return { value: fmt(k.value), why: null };
  return { value: NOT_RECORDED, why: whyOf(k) };
}
const plain = (v) => ({ value: v == null || v === '' ? NOT_RECORDED : String(v), why: null });

/** The record as labelled rows, in the order the runbook's scorecard reads them. */
export function provenanceRows(p) {
  if (!p || typeof p !== 'object') return [];
  const hold = knownCell(p.hold, (h) => `${h.status}, held ${usd(h.held_microusd)}${h.expired ? ', expired' : ''}`);
  const settled = isKnown(p.hold) ? knownCell(p.hold.value.settled_microusd, usd) : { value: NOT_RECORDED, why: whyOf(p.hold) };
  const proposal = knownCell(p.proposal, (x) => `${x.uid} (${x.status})`);
  const decided = isKnown(p.proposal) ? knownCell(p.proposal.value.decided_at) : { value: NOT_RECORDED, why: whyOf(p.proposal) };
  return [
    { label: 'Run', ...plain(p.run && `${p.run.uid} · attempt ${p.run.attempt} · ${p.run.status}`) },
    { label: 'Admitted', ...plain(p.run?.admitted_at) },
    { label: 'Ended', ...knownCell(p.run?.ended_at) },
    { label: 'Failure', ...knownCell(p.run?.failure) },
    { label: 'Task', ...plain(p.task && `${p.task.uid} · ${p.task.scope}${p.task.module ? ` · ${p.task.module}` : ''}`) },
    { label: 'Agent', ...plain(p.agent && `${p.agent.uid} · ${p.agent.role_key}`) },
    { label: 'Model configured', ...plain(p.agent?.model_configured) },
    { label: 'Model invoked', ...knownCell(p.model_invoked) },
    { label: 'Skill version', ...knownCell(p.skill, (s) => `skill ${s.id}, version ${s.version}`) },
    { label: 'Tool grants at admission', ...knownCell(p.tool_grants_at_admission) },
    { label: 'Data class', ...knownCell(p.data_class) },
    { label: 'Run key', ...plain(p.idempotency?.run_key) },
    { label: 'Hold key', ...plain(p.idempotency?.hold_key) },
    { label: 'Hold', ...hold },
    { label: 'Settled', ...settled },
    { label: 'Charge', ...knownCell(p.charge_microusd, usd) },
    { label: 'Proposal', ...proposal },
    { label: 'Decided', ...decided },
    { label: 'Reconciliation', ...plain(RECONCILIATION_WORDS[p.reconciliation] ?? p.reconciliation) },
  ];
}
