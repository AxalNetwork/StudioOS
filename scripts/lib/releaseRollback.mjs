// D7152 (#7152): the automatic-rollback decision after a production release's
// post-deploy smoke, off by default behind RELEASE_ROLLBACK_MODE (`report`
// logs "would roll back to <version>", `act` performs it), the re-run gate and
// the retention-ledger rewrite. Driven by `../release-rollback.mjs`; tested
// with a faked deploy and smoke in `releaseRollback.test.mjs`.
//
// The release classifier (D7151, `rollbackClass.mjs`) records before any write
// whether the release could be rolled back, and to which version. This module
// decides what to do with that record once the release has published and the
// live smoke has run:
//
//   mode off (unset, or any value but `report`/`act`)   nothing at all
//   the smoke passed                                     nothing
//   the smoke failed once, then passed on its retry      nothing (flaky): never one failure
//   failed twice, class `manual` (or unreadable)         alert: the reasons and DEPLOY.md §3 fix-forward
//   failed twice, this commit was already rolled back    page: one automatic rollback per release
//   failed twice, the live version is not this release's alert: superseded, nothing to undo
//   failed twice, safe class, mode `report`              "would roll back to <version>"
//   failed twice, safe class, mode `act`                 roll back, then re-run the smoke on the
//                                                        restored version; a failed rollback or a
//                                                        failed verification pages and stops
//
// Effects (smoke, wrangler, the GitHub API) are injected into
// `runRollbackDecision`, so the whole path runs against fakes in tests. The
// rest is pure: no process, no network, no file system.

export const MODES = Object.freeze(['off', 'report', 'act']);
export const SAFE_CLASSES = Object.freeze(['auto', 'auto-additive']);
export const MODE_VARIABLE = 'RELEASE_ROLLBACK_MODE';

/** The artifact that marks a commit automatic rollback took off production (the re-run gate reads it). */
export const markerName = (sha) => `release-rolled-back-${sha}`;

export const FIX_FORWARD = 'Fix forward (DEPLOY.md §3): a Worker rollback reverts the code and never D1, so '
  + 'this release needs a person. Check that the previous Worker is compatible with the migrated schema before '
  + 'any `wrangler rollback`, or land a fix or a revert on `main`; the next release ships it.';

export const NEXT_RELEASE = 'The next `main` commit releases normally and is checked the same way; it carries '
  + 'the same change unless a revert or a fix has landed.';

/** The mode from the repository variable. Anything but exactly `report` or `act` is off. */
export function rollbackMode(raw) {
  const v = String(raw ?? '').trim();
  return v === 'report' || v === 'act' ? v : 'off';
}

/** `[spa-live] FAIL  <row>` lines from check-spa-live output, de-duplicated, at most `max`. */
export function smokeRows(output, max = 20) {
  const rows = [];
  for (const line of String(output ?? '').split('\n')) {
    const m = /^\[spa-live\] FAIL {2}(.+)$/.exec(line.trim());
    if (m && !rows.includes(m[1].trim())) rows.push(m[1].trim());
  }
  return rows.slice(0, max);
}

/** The Worker version this release published, from the deploy's outcome.md ("Current Version ID: <uuid>"). */
export function publishedVersion(outcomeMd) {
  const all = [...String(outcomeMd ?? '').matchAll(/Current Version ID: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g)];
  return all.length ? all.at(-1)[1] : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The decision, before anything is done.
 *
 *   mode            rollbackMode(...)
 *   record          rollback-class.json (D7151) or null if unreadable
 *   commit          the release's commit
 *   firstSmoke      the spa-smoke job's result: 'success', 'failure', 'cancelled', 'skipped'
 *   retry           { ok, rows } of the one retry, or null when none ran
 *   priorRollback   true when this commit was already rolled back automatically,
 *                   null when that could not be read
 *   published       the version this release published, or null
 *   live            the version live now, or null if unreadable
 *
 * Returns { mode, action, target, smoke, reasons, page, ledger } where action is one of
 * 'none' | 'alert' | 'page' | 'would-roll-back' | 'roll-back'.
 */
export function decideRollback({ mode, record, commit = null, firstSmoke, retry = null, priorRollback = false, published = null, live = null }) {
  const cls = record?.class ?? null;
  const target = record?.previousVersionId ?? null;
  const out = (action, why, extra = {}) => ({
    mode, commit, class: cls, action, why, target, published, live,
    smoke: firstSmoke === 'success' ? 'passed' : retry == null ? 'unknown' : retry.ok ? 'flaky' : 'failed',
    failedRows: retry && !retry.ok ? retry.rows ?? [] : [],
    reasons: [], page: action === 'page', ledger: 'keep', ...extra,
  });

  if (mode !== 'report' && mode !== 'act') return out('none', 'automatic rollback is off');
  if (firstSmoke === 'success') return out('none', 'the post-deploy smoke passed');
  if (firstSmoke !== 'failure') return out('none', `the post-deploy smoke did not finish (${firstSmoke ?? 'no result'}); nothing is decided on a smoke that did not run`);
  if (!retry) return out('none', 'the smoke failed once and its retry did not run; a single failure never rolls back');
  if (retry.ok) return out('none', 'the smoke failed once and passed on its retry (flaky); a single failure never rolls back');

  if (!SAFE_CLASSES.includes(cls)) {
    const reasons = Array.isArray(record?.reasons) && record.reasons.length
      ? record.reasons.map((r) => ({ rule: r.rule, file: r.file ?? null, line: r.line ?? null, text: r.text }))
      : [{ rule: 'class-unreadable', file: null, line: null, text: 'the release rollback class could not be read (unknown is manual)' }];
    return out('alert', `class \`${cls ?? 'unknown'}\` is never rolled back automatically`, { reasons });
  }
  if (priorRollback == null) return out('alert', 'whether this commit was already rolled back could not be read, so no rollback is attempted');
  if (priorRollback) return out('page', 'this commit was already rolled back automatically once; no second automatic rollback');
  if (!target || !UUID.test(target)) return out('alert', 'no previous version is recorded to roll back to');
  if (!published || !live) return out('alert', 'the published or the live Worker version could not be read, so no rollback is attempted');
  if (live !== published) return out('alert', `the live version \`${live}\` is not the one this release published (\`${published}\`): a newer release or a person moved it, so there is nothing to undo`);
  if (live === target) return out('none', 'the live version already is the recorded previous version');
  if (mode === 'report') return out('would-roll-back', `would roll back to ${target}`);
  return out('roll-back', `rolling back to ${target}`);
}

/** The decision after an `act` rollback ran: page on a failed rollback or verification, else rolled back. */
export function afterRollback(decision, { rolledBack, verify }) {
  if (decision.action !== 'roll-back') return decision;
  if (!rolledBack) return { ...decision, action: 'page', page: true, why: `wrangler rollback to ${decision.target} failed; production still serves ${decision.published}. No further automatic action.` };
  if (!verify?.ok) {
    return { ...decision, action: 'page', page: true, rolledBack: true, ledger: 'demote', verifyRows: verify?.rows ?? [],
      why: `rolled back to ${decision.target}, but the smoke fails on the restored version too: the fault is not the release. No further automatic action.` };
  }
  return { ...decision, action: 'rolled-back', rolledBack: true, ledger: 'demote', why: `rolled back to ${decision.target}; the smoke passes on the restored version` };
}

/**
 * The deploy job's re-run gate. Only `act` ever rolls back, so only `act` can
 * refuse: a commit automatic rollback took off production is not published
 * again unless the dispatch input says so.
 */
export function republishGate({ mode, priorRollback, explicit }) {
  if (mode !== 'act') return { allow: true, why: `mode ${mode}: nothing is ever rolled back, so nothing is held` };
  if (!priorRollback) return { allow: true, why: 'this commit was never rolled back automatically' };
  if (explicit === true || String(explicit).trim() === 'true') return { allow: true, why: 'republished on the explicit `republish_rolled_back` input' };
  return { allow: false, why: 'automatic rollback already took this commit off production; dispatch with `republish_rolled_back` to publish it again' };
}

/**
 * The retention ledger after a rollback (DEPLOY.md §2.1). The build that was
 * rolled back is not the last good deploy: the restored build moves to the
 * front (generation 0, what the next deploy captures as "previous") with a
 * fresh `deployedAt`, because it ships again now. The rolled-back build stays
 * in the ledger with its own `deployedAt`, so the window still keeps its
 * chunks for tabs opened while it served.
 *
 * The restored build is found by its entry chunks (`spa-smoke-previous.json`,
 * captured before the bad build replaced the tree). When it is already
 * generation 0 (the bad release changed no asset) or is not in the ledger, the
 * ledger is returned unchanged with the reason.
 */
export function ledgerAfterRollback(ledger, { previousEntries = [], restoredAt }) {
  if (!Array.isArray(ledger?.builds) || !ledger.builds.length) throw new Error('Cannot rewrite an unreadable retention ledger');
  if (!Number.isFinite(Date.parse(restoredAt))) throw new Error('Invalid restore time');
  const want = [...new Set(previousEntries.map((e) => String(e).replace(/^\/?assets\//, '')))];
  if (!want.length) return { ledger, changed: false, why: 'the previous build\'s entry chunks were not captured' };
  const at = ledger.builds.findIndex((b) => Array.isArray(b?.files) && want.every((f) => b.files.includes(f)));
  if (at < 0) return { ledger, changed: false, why: 'the restored build is not in the retention ledger (retention restarted)' };
  if (at === 0) return { ledger, changed: false, why: 'the rolled-back release shipped the same assets as the restored build' };
  const restored = { ...ledger.builds[at], deployedAt: restoredAt };
  const rest = ledger.builds.filter((_, i) => i !== at);
  return { ledger: { ...ledger, version: 2, builds: [restored, ...rest] }, changed: true, why: `generation ${at} (the restored build) is generation 0 again; the rolled-back build stays retained` };
}

const cell = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const code = (v) => (v ? `\`${v}\`` : 'not recorded');

/** The job summary and alert for a decision. */
export function renderDecision(d) {
  const title = {
    'none': 'no action',
    'alert': 'no automatic rollback: a person decides',
    'page': 'PAGE: stopped, a person must act now',
    'would-roll-back': `would roll back to ${d.target}`,
    'roll-back': `rolling back to ${d.target}`,
    'rolled-back': `rolled back to ${d.target}`,
  }[d.action] ?? d.action;
  const out = [`### Automatic rollback (${d.mode}, D7152): ${title}`, ''];
  out.push(`- Commit: ${code(d.commit)}`);
  out.push(`- Rollback class (D7151): ${code(d.class)}`);
  out.push(`- Post-deploy smoke: ${d.smoke}`);
  out.push(`- Version published by this release: ${code(d.published)}; live before the decision: ${code(d.live)}`);
  out.push(`- Recorded previous version: ${code(d.target)}`);
  if (d.rolledBack) out.push(`- Version restored: ${code(d.target)}`);
  out.push(`- Decision: ${d.why}`);
  if (d.mode === 'report' && d.action === 'would-roll-back') out.push('- Report only: nothing was rolled back. The owner moves the mode to `act` after ten such reports (#7152).');
  if (d.failedRows.length) {
    out.push('', 'Smoke rows that failed on the retry:', '');
    for (const r of d.failedRows) out.push(`- ${cell(r)}`);
  }
  if (d.verifyRows?.length) {
    out.push('', 'Smoke rows that failed on the restored version:', '');
    for (const r of d.verifyRows) out.push(`- ${cell(r)}`);
  }
  if (d.reasons.length) {
    out.push('', '| Rule | Where | Why |', '| --- | --- | --- |');
    for (const x of d.reasons) out.push(`| \`${cell(x.rule)}\` | ${cell(x.file ? `${x.file}${x.line ? `:${x.line}` : ''}` : '')} | ${cell(x.text)} |`);
  }
  if (d.action === 'alert' && d.reasons.length) out.push('', FIX_FORWARD);
  if (d.action !== 'none') out.push('', NEXT_RELEASE);
  return out.join('\n') + '\n';
}

/**
 * The whole path with its effects injected:
 *
 *   mode, record, commit, firstSmoke, published   as decideRollback
 *   smoke(kind)        kind 'retry' | 'verify' → { ok, rows }
 *   priorRollback()    → boolean, or null if unreadable
 *   liveVersion()      → version id or null
 *   rollback(target)   → boolean (act only)
 *
 * Nothing is called while the mode is off or the first smoke passed.
 */
export async function runRollbackDecision({ mode, record, commit, firstSmoke, published, smoke, priorRollback, liveVersion, rollback }) {
  const base = { mode, record, commit, firstSmoke, published };
  const pre = decideRollback(base);
  if (pre.action === 'none' && (mode === 'off' || firstSmoke !== 'failure')) return pre;
  const retry = await smoke('retry');
  let d = decideRollback({ ...base, retry });
  if (d.smoke !== 'failed' || !SAFE_CLASSES.includes(record?.class)) return d;
  d = decideRollback({ ...base, retry, priorRollback: await priorRollback(), live: await liveVersion() });
  if (d.action !== 'roll-back') return d;
  const rolledBack = await rollback(d.target);
  return afterRollback(d, { rolledBack, verify: rolledBack ? await smoke('verify') : null });
}
