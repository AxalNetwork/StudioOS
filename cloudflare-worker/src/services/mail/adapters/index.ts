/** D1340 (#3548) — the adapter for each provider. D1343 (#3551): `mcp`, a member's own MCP mail server. */
import { imapAdapter } from './imap';
import { mcpAdapter } from './memberMcp';
import { gmailAdapter, outlookAdapter } from './oauth';
import type { MailAdapter } from './types';

export type Provider = 'gmail' | 'outlook' | 'imap' | 'mcp';

export const ADAPTERS: Readonly<Partial<Record<Provider, MailAdapter>>> = Object.freeze({
  outlook: outlookAdapter,
  gmail: gmailAdapter,
  imap: imapAdapter,
  mcp: mcpAdapter,
});
