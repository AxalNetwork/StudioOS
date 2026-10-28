/** D1340 (#3548) — the adapter for each provider. `mcp` is reserved by migration 647 and has none yet. */
import { imapAdapter } from './imap';
import { gmailAdapter, outlookAdapter } from './oauth';
import type { MailAdapter } from './types';

export type Provider = 'gmail' | 'outlook' | 'imap' | 'mcp';

export const ADAPTERS: Readonly<Partial<Record<Provider, MailAdapter>>> = Object.freeze({
  outlook: outlookAdapter,
  gmail: gmailAdapter,
  imap: imapAdapter,
});
