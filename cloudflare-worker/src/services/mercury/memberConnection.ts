/**
 * D882 (#2555) — the founder's own Mercury connection as Grow and Raise say it,
 * read from their `integrations` row alone: no credential is decrypted and no
 * Mercury request is made.
 *
 *   connected         an active row signed in through Mercury's MCP server
 *   sign_in_required  an active row holding a pasted Read Only token (D713):
 *                     it reads bank lines only, so Grow and Raise ask for a
 *                     sign-in rather than show an empty figure
 *   reconnect         the row's sign-in was rejected (`status = 'error'`)
 *   not_connected     no row
 *
 * Every state but `connected` carries "Connect Mercury" and the Connectors
 * page it opens. It reads the member's own row only: never an Axal entity
 * connection (`mercury_entity_connections` is HQ's, D710).
 */
import type { Env } from '../../types';
import { MERCURY_AUTH_TYPE } from './oauth';

export const CONNECT_MERCURY_HREF = '/account/connectors/mercury';
export const CONNECT_MERCURY_LABEL = 'Connect Mercury';

export type MemberMercuryState = 'connected' | 'not_connected' | 'sign_in_required' | 'reconnect';

export const MEMBER_MERCURY_SENTENCES: Readonly<Record<Exclude<MemberMercuryState, 'connected'>, string>> = Object.freeze({
  not_connected: 'Mercury is not connected. Sign in with Mercury to fill these figures from your own bank account.',
  sign_in_required: 'Your Mercury connection is a pasted token, which reads only bank lines. Sign in with Mercury to fill these figures.',
  reconnect: 'Mercury no longer accepts your sign-in. Sign in with Mercury again.',
});

export interface MemberMercury {
  state: MemberMercuryState;
  /** The Connectors page, or null once connected. */
  connect_href: string | null;
  connect_label: string | null;
  sentence: string | null;
}

/** The member's own connection state, from their one Mercury row (`UNIQUE(user_id, provider_key)`). */
export async function memberMercury(env: Env, userId: number | null): Promise<MemberMercury> {
  const row = userId == null ? null : await env.DB.prepare(
    `SELECT status, auth_type FROM integrations WHERE user_id = ? AND provider_key = 'mercury' AND status IN ('active', 'error') LIMIT 1`,
  ).bind(userId).first<{ status: string; auth_type: string | null }>();
  const state: MemberMercuryState = !row ? 'not_connected'
    : row.status !== 'active' ? 'reconnect'
      : row.auth_type === MERCURY_AUTH_TYPE ? 'connected' : 'sign_in_required';
  return state === 'connected'
    ? { state, connect_href: null, connect_label: null, sentence: null }
    : { state, connect_href: CONNECT_MERCURY_HREF, connect_label: CONNECT_MERCURY_LABEL, sentence: MEMBER_MERCURY_SENTENCES[state] };
}
