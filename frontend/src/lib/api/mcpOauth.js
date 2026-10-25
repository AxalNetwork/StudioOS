// D1080 (#2945, #2404 part 2) — Sign in with <Provider> for a connector whose
// MCP server signs members in (any record but Mercury's, which keeps
// `mercuryPersonal.js`'s own start). `start` answers `{ authorize_url }`; the
// browser goes there and comes back to the connector's page with an outcome
// word only (`?oauth=ok|error&provider=<key>&reason=<word>`).
// Worker: routes/connector_mcp_oauth.ts.
import { request } from '../api.js';

export const mcpOauthApi = {
  start: (key, returnTo) => {
    const q = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//') ? `?return_to=${encodeURIComponent(returnTo)}` : '';
    return request(`/integrations/mcp/${encodeURIComponent(key)}/start${q}`);
  },
};
