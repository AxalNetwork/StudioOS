/**
 * D5065 (#5065) — one normalized Operating Systems connection state.
 *
 * Before this module the state was derived three times: once in the module
 * row, once in the tiles and once in the record. Each fell back to
 * `not_connected` for a status that was neither `active` nor `error`, while
 * the record's subtitle was derived from the mere existence of a connection
 * row and so still said "Connected … · last good sync …". The same record
 * could therefore read **Not connected** and **Connected** at once, and the
 * record's primary action was always Reconnect, even for a healthy system.
 *
 * Everything that names a system's state — the module rows, the tiles, the
 * record facts, the subtitle, the card's next action, the record's primary
 * action and the connector copy — now reads it from here.
 */

/**
 * `not_connected` means no connection is mapped at all: there is nothing to
 * repair, only something to choose. `disconnected` means a connection is
 * mapped but is no longer usable (revoked, disabled, expired, anything the
 * connector does not report as active): it needs reconnecting, and it must
 * never be described as connected.
 */
export type SystemState = 'connected' | 'failing' | 'disconnected' | 'not_connected';

export const SYSTEM_STATE_LABEL: Record<SystemState, string> = {
  connected: 'Connected', failing: 'Failing', disconnected: 'Reconnect required', not_connected: 'Not connected',
};
export const SYSTEM_STATE_TONE: Record<SystemState, string> = {
  connected: 'ok', failing: 'bad', disconnected: 'amb', not_connected: 'grey',
};
/** Worst first, so a list sorted by State surfaces what needs a hand. */
export const SYSTEM_STATE_ORDER: readonly SystemState[] = ['failing', 'disconnected', 'connected', 'not_connected'];

/**
 * The one derivation. `connection` is the mapped connection as the caller is
 * allowed to read it, or null when the kind maps none; `status` is that
 * connection's own status. A connection that exists is never `not_connected`.
 */
export function systemStateOf(connection: unknown, status: unknown): SystemState {
  if (connection == null) return 'not_connected';
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return value === 'active' ? 'connected' : value === 'error' ? 'failing' : 'disconnected';
}

/** True while the connection is mapped and the connector reports it usable. */
export const systemIsConnected = (state: SystemState) => state === 'connected';
/** True while a mapped connection needs reconnecting: Reconnect is the action. */
export const systemNeedsReconnect = (state: SystemState) => state === 'failing' || state === 'disconnected';

const DISCONNECTED_REASON: Record<string, string> = {
  revoked: 'access was revoked',
  disabled: 'the connection is disabled',
  expired: 'the connection expired',
  inactive: 'the connection is not active',
  pending: 'the connection was never completed',
};
/**
 * Why a `disconnected` system is not connected, in the member's words. An
 * unrecognised status is reported in general terms rather than echoed, so a
 * stored value never reaches the page as copy.
 */
export function disconnectedReason(status: unknown): string {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return DISCONNECTED_REASON[value] ?? 'the connector no longer reports it as active';
}

/**
 * The primary action a state earns. A healthy system is managed, not
 * repaired; a mapped but unusable one is reconnected; a kind with no
 * connection connects the connector it already names, or chooses one.
 */
export type SystemActionIntent = 'manage' | 'reconnect' | 'connect' | 'choose';
export function systemActionIntent(state: SystemState, hasProvider: boolean): SystemActionIntent {
  if (state === 'connected') return 'manage';
  if (systemNeedsReconnect(state)) return 'reconnect';
  return hasProvider ? 'connect' : 'choose';
}
export const SYSTEM_ACTION_LABEL: Record<SystemActionIntent, string> = {
  manage: 'Manage connection', reconnect: 'Reconnect', connect: 'Connect', choose: 'Choose connector',
};
