/**
 * D227 — what the Integration keys console offers for a key, decided by where
 * the key lives rather than by the old `source === 'db'` test.
 *
 * WHY THE OLD TEST WAS WRONG. A save promotes the pair to Worker secrets and
 * drops the database row, so a key saved from this console reads `env` from
 * then on — and Rotate and Remove appeared only for `db`. The console could
 * set a key and never touch it again. The worker's rotate and remove already
 * go through the Cloudflare secrets API wherever the key lives, behind the
 * holder's bar (D223); the page now offers them wherever the key lives too.
 *
 * `state` is the worker's (`keyStateOf`, D213): `env`, `db`, `unset`, or
 * `unreadable` — the last meaning no Worker secret AND the table did not
 * answer, so whether a key is kept there is unknown. That state offers
 * nothing: Configure would write over whatever the table holds without anyone
 * having seen it, and Remove would be removing something nobody can see.
 *
 * Pure, so a test puts every state through it.
 */

export const KEY_STATES = ['env', 'db', 'unset', 'unreadable'];

/** The actions a key in `state` offers the holder. Anything unrecognised offers nothing. */
export function keyActionsFor(state) {
  switch (state) {
    case 'env':
    case 'db':
      return { configure: false, rotate: true, remove: true };
    case 'unset':
      return { configure: true, rotate: false, remove: false };
    default:
      return { configure: false, rotate: false, remove: false };
  }
}

/** The badge a key's state reads as. An unknown state reads as unknown, never as "not configured". */
export function keyStateBadge(state) {
  switch (state) {
    case 'env':
      return { text: 'Worker secret', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' };
    case 'db':
      return { text: 'database', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' };
    case 'unset':
      return { text: 'not configured', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' };
    default:
      return { text: 'unknown', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' };
  }
}

/**
 * The connected-users line. `null` is a count that could not be read, and says
 * so; it never renders as 0, because Remove quotes this number.
 */
export function connectedUsersLine(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) {
    return 'Connected users: unknown — the count could not be read.';
  }
  const k = Number(n);
  return `${k} active user integration${k === 1 ? '' : 's'}`;
}

/** The Remove confirmation. An unread count is named as unread, not as none. */
export function removeConfirmText(label, n) {
  const head = `Remove ${label} keys?\n\nThis deletes both Worker secrets on the production Worker`;
  if (n === null || n === undefined || !Number.isFinite(Number(n))) {
    return `${head} and disconnects every active user integration for ${label}. How many there are could not be read. Affected users will need to reconnect once new keys are saved.`;
  }
  const k = Number(n);
  if (k === 0) return `${head}. No user integration is active for ${label}.`;
  return `${head} and disconnects ${k} active user integration${k === 1 ? '' : 's'}. Affected users will need to reconnect once new keys are saved.`;
}

/**
 * What a save does, said in the dialog that does it. It replaced "Encrypted at
 * rest. Only the secret hash is ever logged." — which described the database
 * store this console no longer writes, and a hash nothing records.
 */
export const SAVE_EFFECT = {
  configure:
    'Saving writes the Client ID and Client Secret as Worker secrets on the production Worker, through the '
    + 'Cloudflare API, and removes any copy kept in the database. Cloudflare stores Worker secrets encrypted. '
    + 'Neither value is shown again, and the audit log records only the variable names. Worker instances '
    + 'already running keep the old values until they restart.',
  rotate:
    'Rotating writes the new Client Secret as a Worker secret on the production Worker, through the '
    + 'Cloudflare API; the Client ID is unchanged. The value is not shown again, and the audit log records '
    + 'only the variable name. If this Worker has no Cloudflare API token and the key is kept in the '
    + 'database instead, the new secret is stored there, encrypted.',
};
