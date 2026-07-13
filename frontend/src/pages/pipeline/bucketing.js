// Pure, dependency-free helpers for the investor Pipeline lifecycle pages.
// Kept in their own module (no React / api imports) so the stage-bucketing
// contract can be unit-tested directly — see frontend/test/pipeline_bucketing.test.mjs.

const norm = (s) => String(s || '').toLowerCase().trim();

// ── Stage bucketing ────────────────────────────────────────────────────────
// `pipeline_stage` carries two vocabularies: the Worker returns studio stage
// names (idea, mvp_dev, traction_review, decision_gate, spinout_ready, iterate)
// while the dev mirror returns the project's own `stage` free-text. Bucketing is
// STAGE-DRIVEN: a deal is at Commit only while its current stage is the decision
// gate. We deliberately do NOT treat the presence of `latest_gate` as "in
// committee" — prod `/pipeline/active` returns `latest_gate` as the latest
// *historical* gate row, so a deal that moved back to iterate/screening after a
// decision still carries one. Anything unrecognized defaults to Screening so no
// real deal is silently dropped.
export function isTransactionDeal(d) {
  return norm(d.project_status) === 'spinout' || norm(d.pipeline_stage) === 'spinout_ready';
}
export function isCommitDeal(d) {
  if (isTransactionDeal(d)) return false;
  return norm(d.pipeline_stage) === 'decision_gate';
}
export function isScreeningDeal(d) {
  return !isTransactionDeal(d) && !isCommitDeal(d);
}

// ── Formatting ──────────────────────────────────────────────────────────────
const STAGE_LABELS = {
  idea: 'Idea',
  mvp_dev: 'MVP Development',
  traction_review: 'Traction Review',
  decision_gate: 'Investment Committee',
  spinout_ready: 'Spin-out Ready',
  iterate: 'Iterating',
};

export function prettyStage(s) {
  const k = norm(s);
  if (STAGE_LABELS[k]) return STAGE_LABELS[k];
  if (!s) return '—';
  return String(s).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return String(iso).slice(0, 10);
}

export function fmtMoney(n) {
  if (n == null) return '—';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${n}`;
}

export function avg(nums) {
  const vals = nums.filter((n) => n != null && Number.isFinite(n));
  if (!vals.length) return null;
  return Math.round(vals.reduce((s, n) => s + n, 0) / vals.length);
}
