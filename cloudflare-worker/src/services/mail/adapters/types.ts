/**
 * D1340 (#3548) — what every mailbox provider does for a member's own mailbox.
 *
 * An adapter never logs, returns or stores a secret itself: it is handed the
 * opened credentials, and hands back rotated ones for `accounts.ts` to seal.
 * Every failure is an `AdapterError` with a code and a sentence written here,
 * never the provider's own text, which can carry a token or an address.
 */
import type { Env } from '../../../types';

export type OAuthCreds = { kind: 'oauth'; refresh_token: string };
export type Tls = 'tls' | 'starttls';
export type ImapCreds = {
  kind: 'imap'; username: string; password: string;
  smtp_host: string; smtp_port: number; smtp_tls: Tls;
  imap_host: string; imap_port: number; imap_tls: Tls;
};
export type Creds = OAuthCreds | ImapCreds;

export type Outgoing = { from: string; fromName: string | null; to: string; subject: string; body: string };
export type SendResult = { messageId: string | null; creds?: Creds };
export type ThreadMessage = { from: string | null; subject: string | null; received_at: string | null; preview: string | null };

export type AdapterCode = 'expired' | 'auth_failed' | 'refused' | 'unreachable' | 'unconfigured';

export class AdapterError extends Error {
  readonly code: AdapterCode;
  readonly sentence: string;
  constructor(code: AdapterCode, sentence: string) { super(sentence); this.code = code; this.sentence = sentence; }
}

export interface MailAdapter {
  send(env: Env, creds: Creds, msg: Outgoing): Promise<SendResult>;
  /** Proves the credentials work without sending anything. */
  verify(env: Env, creds: Creds): Promise<{ creds?: Creds }>;
  /** Revokes at the provider where it can; a provider that cannot is a no-op. */
  revoke(env: Env, creds: Creds): Promise<void>;
  /** Only where the account `can_read`: the messages of a thread Axal sent. */
  listThread?(env: Env, creds: Creds, threadId: string): Promise<ThreadMessage[]>;
}
