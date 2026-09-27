/** Which deploy SHA to show for a branch row (D457). Live read wins when the branch answered. */
export function deployVersionDisplay(row) {
  if (!row) return null;
  if (row.version_display) return String(row.version_display);
  if (row.live_state === 'ok' && row.live?.deploy_version) return String(row.live.deploy_version);
  if (row.last_version) return String(row.last_version);
  return null;
}

export const DEPLOY_VERSION_ABSENT_REASON =
  'No deploy version is stamped on this Worker yet. HQ and branch deploy workflows set WORKER_DEPLOY_VERSION at deploy time.';
