// D885 (#2561) — HQ › Integration keys › Channels, as words. Pure, so the
// rules are tested without a browser (frontend/test/integration_keys_channels_d885.test.mjs).

/** The rollout states a channel var can hold, as the Worker reads them (`channelRollout`). */
export const ROLLOUT_WORDS = Object.freeze({
  off: 'Off for everyone',
  canary: 'Super Admins only (canary)',
  on: 'On for every member',
});

/** "Configured" only when the Worker's own check says so; anything else is not. */
export function channelBadge(row) {
  return row?.configured === true
    ? { text: 'Configured', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' }
    : { text: 'Not configured', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200' };
}

/** One secret's state: set or not set. A value is never part of the row. */
export const secretStateText = (s) => (s?.set === true ? 'Set' : 'Not set');

/** The rollout line: the var, what its value means, and that a PR changes it. */
export function rolloutLine(rollout) {
  if (!rollout || typeof rollout.var !== 'string') return '';
  const words = ROLLOUT_WORDS[rollout.value] || 'Unknown';
  return `${rollout.var} is "${rollout.value}": ${words}. It is changed by a PR to wrangler.toml, not here.`;
}

/** The secret names a save may send: this channel's own, with a value typed. Trimmed; empty ones are left out. */
export function setPayload(row, typed) {
  const names = Array.isArray(row?.secrets) ? row.secrets.map((s) => s?.name).filter((n) => typeof n === 'string') : [];
  const out = {};
  for (const name of names) {
    const v = typeof typed?.[name] === 'string' ? typed[name].trim() : '';
    if (v) out[name] = v;
  }
  return out;
}

export const GENERATED_ONCE = 'Copy it into the provider\'s dashboard now. Axal does not show it again; a new one replaces it.';
export const CHANNELS_NOTE = 'The interview channels\' secrets. A save writes Worker secrets on the production Worker; a new value is read by the next request. The rollout vars and Axal\'s display number are set in wrangler.toml by a PR.';

/** Remove's confirmation: which secrets go, and that members stop being served until they are set again. */
export function removeChannelText(row) {
  const names = Array.isArray(row?.secrets) ? row.secrets.map((s) => s.name).join(', ') : '';
  return `Remove ${row?.label || 'this channel'}'s secrets (${names})? The channel stops working for members until they are set again.`;
}
