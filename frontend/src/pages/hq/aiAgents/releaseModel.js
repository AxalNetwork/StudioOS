/**
 * D4537 (#4537, step 3) — the release evidence on a From Axal skill, as pure rules.
 *
 * Reads what `GET /api/admin/ai-agents/skills/:uid` already answers (D4533):
 *   - `freshness`: the server's release decision for the current draft: `ready`, `blocking`, `evidence`, `review`, `evaluation`;
 *   - each `versions[].evidence`: the manifest a published version was released on, or null when none was recorded.
 * Nothing is decided here: the publish gate refuses on the same `freshness`, and this only says it in words. A value
 * the server did not send reads "Not recorded", never 0 or "ready".
 */
import { NOT_RECORDED } from './aiAgentsModel';

/** Each `Blocking` code (skillLifecycle.ts) in the page's words. */
export const BLOCKING_WORDS = {
  needs_approval: 'A second Super Admin has not approved this exact draft, its cases, evaluator and models.',
  evaluation_incomplete: 'Some required runs have no result on the current evidence. A missing result is not a pass.',
  golden_cases_failing: 'Fewer golden-case runs pass than the bar requires.',
};
export const blockingWords = (code) => BLOCKING_WORDS[code] ?? `Blocked: ${code}.`;

/** What evidence is made of (`EvidencePart`), in the page's words. */
export const PART_WORDS = { definition: 'Definition', cases: 'Golden cases', evaluator: 'Evaluator', models: 'Required models' };

export const shortHash = (h) => (typeof h === 'string' && h.length >= 12 ? h.slice(0, 12) : NOT_RECORDED);

/** The readiness headline: ready, blocked with its reasons, or not recorded when the decision was not sent. */
export function readiness(freshness) {
  if (!freshness || typeof freshness.ready !== 'boolean') return { state: 'unknown', label: NOT_RECORDED, reasons: [] };
  if (freshness.ready) return { state: 'ready', label: 'Ready to publish', reasons: [] };
  const reasons = (freshness.blocking ?? []).map(blockingWords);
  return { state: 'blocked', label: 'Not ready to publish', reasons: reasons.length ? reasons : ['The server did not say why.'] };
}

/** The evaluation against the bar: "8 of 10 pass · 2 not evaluated · bar 9 of 10", never a pass count for missing runs. */
export function evaluationLine(ev) {
  if (!ev || !Number.isFinite(ev.total)) return NOT_RECORDED;
  if (ev.total === 0) return 'No required runs: the skill has no golden cases or no required models.';
  const bar = ev.pass_bar ? ` · bar ${ev.pass_bar.pass} of ${ev.pass_bar.of}` : '';
  const missing = ev.not_evaluated ? ` · ${ev.not_evaluated} not evaluated` : '';
  return `${ev.pass} of ${ev.total} pass${missing}${bar}`;
}

/**
 * What changed since the latest approval, part by part. `changes` null: never approved. A part null: the approval
 * predates that part being recorded, which is "Not recorded", not "unchanged".
 */
export function changeRows(review) {
  if (!review?.changes) return null;
  return Object.keys(PART_WORDS).map((part) => {
    const v = review.changes[part];
    return { part, label: PART_WORDS[part], text: v === true ? 'Changed since the last approval' : v === false ? 'Unchanged' : NOT_RECORDED };
  });
}

/** The current evidence's identity, as rows. */
export function evidenceRows(e) {
  if (!e) return null;
  const models = e.models?.required;
  return [
    ['Definition', shortHash(e.definition_hash)],
    ['Golden cases', e.suite?.cases ? `${e.suite.cases.length} · revision ${shortHash(e.suite.revision)}` : NOT_RECORDED],
    ['Evaluator', Number.isFinite(e.evaluator_version) ? `v${e.evaluator_version}` : NOT_RECORDED],
    ['Required models', Array.isArray(models) ? `${models.length ? models.join(' · ') : 'None'}${e.models.source === 'default' ? ' (the default set)' : ''}` : NOT_RECORDED],
    ['Evidence', shortHash(e.evidence_hash)],
  ];
}

/** One published version's release record: its manifest, or why there is none. */
export function versionRecord(v) {
  const head = `v${v.version}${v.published_at ? ` · ${v.published_at}` : ''}${v.by?.name ? ` · ${v.by.name}` : ''}`;
  const audited = v.publish_audited === false ? 'This publish has no audit row.' : null;
  if (!v.evidence) return { head, recorded: false, lines: ['No release evidence recorded: published before release manifests (D4533).'], audited };
  const e = v.evidence;
  const bar = e.bar && Number.isFinite(e.bar.total) ? `${e.bar.pass} of ${e.bar.total} runs passed` : NOT_RECORDED;
  const reviewer = e.review ? `Approved by ${e.review.reviewer?.name ?? NOT_RECORDED}${e.review.decided_at ? ` on ${e.review.decided_at}` : ''}` : 'No approval recorded';
  return {
    head, recorded: true, audited,
    lines: [
      `Evidence ${shortHash(e.evidence_hash)} · definition ${shortHash(e.definition_hash)}`,
      `${bar} · ${e.suite?.cases?.length ?? NOT_RECORDED} cases · evaluator ${Number.isFinite(e.evaluator_version) ? `v${e.evaluator_version}` : NOT_RECORDED} · ${Array.isArray(e.models?.required) ? e.models.required.join(' · ') || 'no models' : NOT_RECORDED}`,
      reviewer,
    ],
  };
}
