/**
 * D668 (#1498) — the "AI assistants" group on Connectors: one StudioOS MCP
 * server (D665, #1495) and how each assistant adds it.
 *
 * THE STEPS ARE THE VENDORS', read from their own help pages on 2026-10-09,
 * and each card links the page it was written from. Re-read the page before
 * changing a step: these move faster than this file. Where a vendor limits
 * the feature to some plans, accounts or countries, the card says so.
 */

/** The one server URL every assistant is given (D665). */
export const MCP_SERVER_URL = 'https://axal.vc/api/mcp';

export const ASSISTANTS = [
  {
    key: 'chatgpt', name: 'ChatGPT', by: 'OpenAI',
    doc: 'https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt',
    steps: [
      'On chatgpt.com (web only), turn on developer mode in Settings. On a Business, Enterprise or Edu workspace, an admin allows it first.',
      'Create an app from a custom MCP server, and paste the StudioOS server URL.',
      'Sign in when ChatGPT asks, and approve StudioOS for your companies.',
    ],
    limits: 'Full MCP support, with write actions, is in beta for Business, Enterprise and Edu. On Pro, developer mode connects read and fetch tools only, so submitting an interview may not be offered. ChatGPT asks you to confirm each write.',
  },
  {
    key: 'claude', name: 'Claude', by: 'Anthropic',
    doc: 'https://support.claude.com/en/articles/11175166',
    steps: [
      'Open Settings → Connectors, choose Add custom connector, and paste the StudioOS server URL.',
      'Leave the advanced OAuth settings empty: StudioOS registers the client itself.',
      'Choose Connect, sign in, and approve StudioOS for your companies.',
    ],
    limits: 'Custom connectors are in beta on Free, Pro, Max, Team and Enterprise. On Team and Enterprise an owner adds the connector to the organization first, then each member connects.',
  },
  {
    key: 'gemini', name: 'Gemini', by: 'Google',
    doc: 'https://support.google.com/gemini/answer/17209137',
    steps: [
      'On gemini.google.com (web only), open Settings → Connected Apps.',
      'Under Custom apps, add an app and paste the StudioOS server URL.',
      'Sign in when Gemini asks, and approve StudioOS for your companies. The app then appears on mobile too.',
    ],
    limits: 'Custom apps need a personal Google Account with Gemini Spark access and Keep Activity on, and are limited by country and language. Gemini Enterprise adds MCP servers through its admin instead.',
  },
  {
    key: 'grok', name: 'Grok', by: 'xAI',
    doc: 'https://docs.x.ai/grok/connectors',
    steps: [
      'Open grok.com/connectors, choose New Connector, then Custom.',
      'Paste the StudioOS server URL.',
      'Sign in when Grok asks, and approve StudioOS for your companies.',
    ],
    limits: 'Custom connectors are on paid Grok plans.',
  },
  {
    key: 'other', name: 'Another MCP client', by: 'Any client that speaks remote MCP',
    doc: 'https://modelcontextprotocol.io/specification',
    steps: [
      'Add a remote MCP server over Streamable HTTP, with the StudioOS server URL.',
      'The client registers itself and signs in with OAuth 2.1; nothing is pasted as a key.',
      'Approve it for your companies when StudioOS asks.',
    ],
    limits: 'A client that cannot register itself (RFC 7591) or use OAuth cannot connect.',
  },
];

/** A grant row as drawn; a missing date is "Not recorded", never a guess. */
export function grantRow(g) {
  const companies = Array.isArray(g?.companies) ? g.companies.map((c) => c?.name || `Company #${c?.id}`) : [];
  return {
    id: g?.id,
    client: String(g?.client_name || '').trim() || 'Not recorded',
    host: String(g?.redirect_host || '').trim() || 'Not recorded',
    companies: companies.length ? companies.join(', ') : 'Not recorded',
    connected: g?.connected_at ? String(g.connected_at).slice(0, 10) : 'Not recorded',
    lastUsed: g?.last_used_at ? String(g.last_used_at).slice(0, 10) : 'Never used',
  };
}

/** The list after a confirmed revoke: that grant is gone at once, the rest unchanged. */
export const grantsAfterRevoke = (grants, id) => (grants || []).filter((g) => String(g?.id) !== String(id));
