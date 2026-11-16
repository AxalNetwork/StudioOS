/**
 * D4708 part 3 (#4708) — H23's Backup / DR card and its two sentences, moved out of
 * `../SecurityPage.jsx` unchanged. `ResilienceWorkspace.jsx` keeps this card behind
 * "How this is measured", and the rail reads the same two sentences.
 */
import React from 'react';
import { Unreadable } from '../../../ui';
import { day, num } from './securityShared.js';

/**
 * D200 — H23's Backup / DR card, as TWO facts with their own states.
 *
 * The backup half reads the heartbeat the nightly export writes to R2: absent
 * with its reason when the binding is unbound or nothing was ever written,
 * present with the export's own stamp otherwise. D263 — the drill half reads
 * the marker the restore drill writes on every exit, in four states of its
 * own (unreadable, never run, last run failed, last run passed), and none of
 * them is inferred from the backup half however green that is. The canvas's
 * own words: "stated in words rather than a green light."
 */
export function drillSentence(drill) {
  // D4691 — invalid is its own word: something was read, and it is not a
  // drill marker this page can believe.
  if (drill?.state === 'invalid') return `Invalid — ${drill.reason || 'the drill marker is not valid evidence.'}`;
  if (!drill || drill.state === 'unreadable' || drill.available === false) {
    return `Unreadable — ${drill?.reason || 'the drill marker could not be read.'}`;
  }
  if (drill.state === 'never_run') return `Never run — ${drill.reason}`;
  const when = day(drill.at) || 'an unstamped date';
  // D4691 — a result older than its window is history, said so before the result.
  const stale = drill.fresh === false
    ? `Stale — older than ${drill.stale_after_days} days, so it does not vouch for recovery today. `
    : '';
  if (drill.state === 'last_run_failed') {
    const exit = drill.exit_code === null || drill.exit_code === undefined ? 'no exit code recorded' : `exit ${drill.exit_code}`;
    return `${stale}Last run failed on ${when}, at step ${drill.step || 'not recorded'} (${exit}).`;
  }
  if (drill.state === 'last_run_passed') {
    const missed = [drill.rpo_met === false ? 'its recovery-point target' : null, drill.rto_met === false ? 'its recovery-time target' : null]
      .filter(Boolean);
    return `${stale}Last run passed on ${when}, restoring ${drill.backup_key || 'a backup it did not name'}.`
      + (missed.length ? ` It missed ${missed.join(' and ')}.` : '');
  }
  return `Unreadable — the drill marker is in a state this page does not know (${String(drill.state)}).`;
}

/**
 * D4691 — the export heartbeat in one sentence, by its own state. A heartbeat
 * that is not valid evidence, or is older than its window, never reads as a
 * recorded backup.
 */
export function backupSentence(b) {
  if (!b) return 'Unreadable — the heartbeat could not be read.';
  if (b.available === false) {
    if (b.state === 'invalid') return `Invalid — ${b.reason}`;
    if (b.state === 'never_written') return `Not recorded — ${b.reason}`;
    return `Unreadable — ${b.reason || 'the heartbeat could not be read.'}`;
  }
  const what = `${b.kind === 'kv' ? 'KV' : 'D1'} export of ${day(b.recovery_point || b.at) || 'an unstamped time'}`;
  if (b.fresh === false) {
    return `Stale — the last ${what} is older than ${b.stale_after_hours} hours, so it is not a current backup.`;
  }
  return `Last ${what}${b.source ? ` · ${b.source}` : ''}${b.size_bytes !== null && b.size_bytes !== undefined ? ` · ${num(b.size_bytes)} bytes` : ''}.`;
}

function DrillState({ drill }) {
  // D4691 — a stale result is amber whatever it says: it is history, not a status.
  const stale = drill?.fresh === false;
  const failed = drill?.state === 'last_run_failed' || drill?.state === 'invalid';
  const passed = drill?.state === 'last_run_passed' && !stale;
  const tone = stale ? 'text-amber-800 dark:text-amber-300'
    : failed ? 'text-red-700 dark:text-red-300' : passed ? 'text-emerald-700 dark:text-emerald-300' : 'text-axal-muted';
  return (
    <p className={`text-[12.5px] leading-relaxed ${tone}`} data-state={drill?.state || 'unreadable'}>
      {drillSentence(drill)}
    </p>
  );
}

export function BackupDr({ block, unreadable }) {
  // Same rule as Sanctions: a failed overview read is not a load in progress.
  if (!block) {
    return unreadable
      ? (
        <Unreadable
          what="The security overview"
          claim="This is not a claim that nothing happened."
        />
      )
      : <p className="text-[12px] text-axal-muted">Loading…</p>;
  }
  const b = block.backup;
  return (
    <div className="space-y-2" data-testid="hq-backup-dr">
      <div>
        <div className="text-[9.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted">Nightly export</div>
        {b?.available && b.fresh !== false ? (
          <p className="mt-0.5 text-[12px] text-axal-muted" data-testid="hq-backup-heartbeat" data-state={b.state || 'fresh'}>
            {backupSentence(b)}
          </p>
        ) : (
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-amber-800 dark:text-amber-300" data-testid={b?.available ? 'hq-backup-stale' : 'hq-backup-unreadable'} data-state={b?.state || 'unreadable'}>
            {backupSentence(b)}
          </p>
        )}
      </div>
      <div>
        <div className="text-[9.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted">Restore drill</div>
        <div className="mt-0.5" data-testid="hq-restore-drill">
          <DrillState drill={block.drill} />
        </div>
      </div>
    </div>
  );
}
