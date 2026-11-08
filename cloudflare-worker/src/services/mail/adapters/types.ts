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
/** D1343: a member's own MCP mail server: the custom connector and its owner; its tokens stay the connector's. */
export type McpCreds = { kind: 'mcp'; connection_uid: string; user_id: number };
export type Creds = OAuthCreds | ImapCreds | McpCreds;

/** D4493: one file at most, today only a sequence step's voice note the founder recorded. */
export type Attachment = { filename: string; mime: string; bytes: Uint8Array };
export type Outgoing = { from: string; fromName: string | null; to: string; subject: string; body: string; attachments?: Attachment[] };
export type SendResult = { messageId: string | null; creds?: Creds };
export type ThreadMessage = { id?: string; from: string | null; subject: string | null; received_at: string | null; preview: string | null };
/** D4494: a thread read can rotate the mailbox's access just as a send can. */
export type ThreadRead = { messages: ThreadMessage[]; creds?: Creds };

/**
 * `uncertain` (D4665): the provider may or may not have the message. It is raised only from the point
 * where the message has left (an SMTP payload written, a send request issued) and the answer was lost.
 * `consent`: the provider refused for want of a permission the member did not grant.
 */
export type AdapterCode = 'expired' | 'auth_failed' | 'refused' | 'unreachable' | 'unconfigured' | 'uncertain' | 'consent';

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
  listThread?(env: Env, creds: Creds, sentMessageId: string): Promise<ThreadRead>;
}
