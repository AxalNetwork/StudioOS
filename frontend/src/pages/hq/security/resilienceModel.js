/**
 * D4803 (#4803, canvas SE09 Resilience, SE11e phone) — what the Resilience
 * workspace says about the restore drill, the D1 export and the KV snapshot,
 * from `/overview`'s `backup_dr`. Pure, for the tests.
 *
 * A BACKUP IS NOT A RESTORE. The export heartbeat proves an export exists; only
 * a drill that restored it proves it can be used. So the drill leads, its state
 * is never inferred from the heartbeat, and a passing drill older than its
 * window is Stale, not Verified.
 */

/** The drill's steps, in the order `scripts/dr-drill.sh` runs them (its STEP values). */
export const DRILL_STEPS = Object.freeze([
  { key: 'find_backup', label: 'Find backup' },
  { key: 'verify', label: 'Verify backup' },
  { key: 'create_db', label: 'Create drill database' },
  { key: 'restore', label: 'Restore' },
  { key: 'smoke', label: 'Smoke test' },
  { key: 'teardown', label: 'Teardown' },
]);
/** The optional preview steps run between the smoke test and teardown; a failure there is named as itself. */
const PREVIEW_STEPS = Object.freeze({
  preview_deploy: 'Preview deploy', preview_smoke: 'Preview smoke test', preview_teardown: 'Preview teardown',
});

export const RUNBOOK_HREF = 'https://github.com/AxalNetwork/StudioOS/blob/main/documentation/operations/D1_RECOVERY.md';
export const DRILL_RUNS_HREF = 'https://github.com/AxalNetwork/StudioOS/actions/workflows/dr-drill.yml';
/** `.github/workflows/dr-drill.yml`'s schedule, in words. */
export const DRILL_SCHEDULE = 'Monthly, on the 1st at 06:00 UTC, or run it now from GitHub Actions';

/** A step key as words: its label, else the key itself (never hidden). */
export const stepLabel = (key) => DRILL_STEPS.find((s) => s.key === key)?.label || PREVIEW_STEPS[key] || (key ? String(key) : 'an unrecorded step');

/**
 * Each step's mark for the pipeline: `done`, `failed` or `skipped`, from the
 * step the marker names. A passed drill ran every step; a failed one ran those
 * before its step, failed at it, and never reached the rest. A failure at a
 * step this list does not hold (a preview step) marks the main steps it
 * reached and leaves the list honest about where it stopped.
 */
export function pipeline(drill) {
  if (!drill || drill.available !== true || (drill.state !== 'last_run_failed' && drill.state !== 'last_run_passed')) {
    return DRILL_STEPS.map((s) => ({ ...s, mark: 'unknown' }));
  }
  if (drill.state === 'last_run_passed') return DRILL_STEPS.map((s) => ({ ...s, mark: 'done' }));
  const at = DRILL_STEPS.findIndex((s) => s.key === drill.step);
  if (at < 0) {
    // A preview step runs after the smoke test; anything else unknown stops the marks.
    const afterSmoke = Boolean(PREVIEW_STEPS[drill.step]);
    return DRILL_STEPS.map((s, i) => ({ ...s, mark: afterSmoke && i <= 4 ? 'done' : 'unknown' }));
  }
  return DRILL_STEPS.map((s, i) => ({ ...s, mark: i < at ? 'done' : i === at ? 'failed' : 'skipped' }));
}

/** "Sun 1 Nov 2026, 03:10 UTC", or null. */
export function whenOf(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(',', '');
  return `${day}, ${d.toISOString().slice(11, 16)} UTC`;
}

/** "4 min 12 s", "41 s", or null. */
export function durationOf(s) {
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) return null;
  const m = Math.floor(s / 60);
  return m ? `${m} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`;
}

/** "48.2 MB", or null. */
export function sizeOf(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ['bytes', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i += 1; }
  return i === 0 ? `${v} bytes` : `${v.toFixed(1)} ${units[i]}`;
}

const ago = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

/**
 * The drill's headline: `{ state, title, line, verified }`. `state` is a key of
 * the shared vocabulary. Unreadable and invalid say they are not a pass.
 */
export function drillHeadline(drill) {
  if (!drill) return { state: 'pending', title: 'Reading the drill record…', line: null, verified: false };
  if (drill.available === false) {
    return {
      state: 'unavailable',
      title: drill.state === 'invalid' ? 'The drill record is not valid evidence' : 'The drill record could not be read',
      line: `${drill.reason || 'No reason was given.'} The last drill result can't be shown; this is not a pass.`,
      verified: false,
    };
  }
  if (drill.state === 'never_run') {
    return { state: 'action_required', title: 'No restore drill has run', line: 'Backups exist but have never been restored. Until a drill passes they are not verified restorable.', verified: false };
  }
  const when = whenOf(drill.at);
  const age = typeof drill.age_days === 'number' ? ago(drill.age_days, 'day') : null;
  if (drill.state === 'last_run_failed') {
    return {
      state: 'failed',
      title: `Restore drill failed at the ${stepLabel(drill.step).toLowerCase()} step`,
      line: [when, age].filter(Boolean).join(' · ') + '. Until a drill passes, backups are present but not verified restorable.',
      verified: false,
    };
  }
  if (!drill.fresh) {
    return {
      state: 'stale',
      title: 'The last restore drill passed, but it is old',
      line: `${[when, age].filter(Boolean).join(' · ')}. A pass older than ${drill.stale_after_days} days does not vouch for recovery today.`,
      verified: false,
    };
  }
  return { state: 'verified', title: 'Restore drill passed', line: [when, age].filter(Boolean).join(' · '), verified: true };
}

/** The drill's facts, as label and value, in the order SE09 draws them; absent ones are left out. */
export function drillFacts(drill) {
  if (!drill || drill.available !== true || !drill.at) return [];
  const out = [];
  if (drill.state === 'last_run_failed') out.push(['Failed step', `${drill.step || 'not recorded'} · exit code ${drill.exit_code}`, true]);
  if (drill.reason) out.push(['Reason', drill.reason, false]);
  const d = durationOf(drill.duration_s);
  if (d) out.push(['Duration', d, false]);
  if (drill.backup_key) out.push(['Backup used', drill.backup_key, true]);
  if (drill.recovery_point) out.push(['Recovery point', whenOf(drill.recovery_point), false]);
  if (drill.migration) out.push(['Schema at', drill.migration, true]);
  if (typeof drill.tables === 'number') out.push(['Tables restored', String(drill.tables), false]);
  if (drill.rpo_met === true || drill.rpo_met === false) out.push(['Recovery point target (24 h)', drill.rpo_met ? 'Met' : 'Missed', false]);
  if (drill.rto_met === true || drill.rto_met === false) out.push(['Recovery time target (4 h)', drill.rto_met ? 'Met' : 'Missed', false]);
  out.push(['Evidence', `Drill record drill-d1.json in the backups bucket${drill.run_id ? ` · run ${drill.run_id}` : ''}`, false]);
  out.push(['Next drill', DRILL_SCHEDULE, false]);
  return out;
}

/**
 * A heartbeat's card state: `{ state, label, line }`. Fresh is Healthy, past
 * its window is Stale, never written is Action required, unreadable or not
 * valid evidence is Unavailable with its reason.
 */
export function heartbeatState(hb, what = 'export') {
  if (!hb) return { state: 'pending', label: 'Reading…', line: null };
  if (hb.available === false) {
    if (hb.state === 'never_written') return { state: 'action_required', label: 'Never written', line: hb.reason || `No ${what} has been recorded.` };
    return { state: 'unavailable', label: hb.state === 'invalid' ? 'Not valid evidence' : 'Unavailable', line: hb.reason || null };
  }
  const age = typeof hb.age_hours === 'number' ? ago(hb.age_hours, 'hour') : null;
  if (!hb.fresh) return { state: 'stale', label: `Stale · ${age || 'age unknown'}`, line: `Older than its ${hb.stale_after_hours}-hour limit.` };
  return { state: 'healthy', label: `Present · ${age || 'fresh'}`, line: null };
}
