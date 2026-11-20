/** D6653 (#6653): metadata-only file backup health; unknown evidence never closes an alert. */
export const FILE_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const FILE_BACKUP_REASONS = Object.freeze(['run_failed', 'heartbeat_missing', 'heartbeat_invalid', 'run_reported_failure', 'copy_missing', 'missed_run', 'healthy', 'unavailable', 'disabled']);

export function latestFileSnapshotRun(runs) {
  return runs.find(run => run.head_branch === 'main' &&
    ['schedule', 'workflow_dispatch'].includes(run.event) && run.path === '.github/workflows/file-recovery.yml' &&
    run.display_title !== 'Synthetic independent file proof');
}

export function fileRecoveryHealth({ enabled, independentRequired = false, observation, latestRun = null, now }) {
  if (!enabled) return { active: null, reason: 'disabled' };
  if (!Number.isFinite(now)) throw new Error('file_backup_clock_invalid');
  const heartbeat = observation?.heartbeat;
  const at = Date.parse(heartbeat?.at || '');
  const failed = latestRun && ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(latestRun.conclusion);
  const failedAt = Date.parse(latestRun?.updated_at || latestRun?.created_at || '');
  if (failed && (!Number.isFinite(at) || String(latestRun.id) === heartbeat?.run_id || (Number.isFinite(failedAt) && failedAt >= at))) {
    return { active: true, reason: 'run_failed' };
  }
  if (observation?.read === 'missing') return { active: true, reason: 'heartbeat_missing' };
  if (observation?.read === 'invalid') return { active: true, reason: 'heartbeat_invalid' };
  if (observation?.read !== 'ok') return { active: null, reason: 'unavailable' };
  if (heartbeat?.schema_version !== 1 || heartbeat.kind !== 'file_recovery' ||
      !Number.isFinite(at) || at > now + 5 * 60 * 1000 ||
      !/^[1-9][0-9]*$/.test(heartbeat.run_id || '') ||
      !Number.isSafeInteger(heartbeat.run_attempt) || heartbeat.run_attempt < 1 ||
      !['success', 'failure'].includes(heartbeat.outcome)) return { active: true, reason: 'heartbeat_invalid' };
  if (heartbeat.outcome === 'failure') return { active: true, reason: 'run_reported_failure' };
  if (!['object_count', 'byte_count'].every(key => Number.isSafeInteger(heartbeat[key]) && heartbeat[key] >= 0)) {
    return { active: true, reason: 'heartbeat_invalid' };
  }
  if (independentRequired && heartbeat.independent !== 'verified') return { active: true, reason: 'copy_missing' };
  if (failed && !Number.isFinite(failedAt)) return { active: null, reason: 'unavailable' };
  const ageHours = Math.max(0, Math.floor((now - at) / 3600000));
  return { active: now - at > 2 * FILE_BACKUP_INTERVAL_MS, reason: now - at > 2 * FILE_BACKUP_INTERVAL_MS ? 'missed_run' : 'healthy',
    ageHours, objectCount: heartbeat.object_count, byteCount: heartbeat.byte_count };
}
