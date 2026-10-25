/**
 * D840 (#2346) — which reader a member's own Mercury row is read through.
 *
 * A row a member connected with a pasted Read Only API token (`api_key`, D713)
 * reads through D710's GET-only client; one they signed in with
 * (`oauth_mcp`, D840) reads through Mercury's MCP server, its access token
 * refreshed when it is about to expire. Both give the same organization,
 * accounts and lines (`MercuryBankReader`), so D713's and D752's feeds do not
 * know which way the member connected. Since D881 (#2554) no new `api_key`
 * row is made; one kept from before D881 still reads here, unchanged.
 */
import type { Env } from '../../types';
import type { IntegrationRow } from '../../integrations/registry';
import { decryptCredentials } from '../../integrations/secrets';
import type { MercuryFetch } from './client';
import { mcpAccessFor, mcpCredentialsOf, MERCURY_AUTH_TYPE } from './oauth';
import { mcpBankReader, tokenBankReader, type MercuryBankReader } from './reads';

/** The row's reader, or null when its credentials cannot be read. */
export async function bankReaderFor(env: Env, row: IntegrationRow, fetcher?: MercuryFetch): Promise<MercuryBankReader | null> {
  try {
    if (row.auth_type === MERCURY_AUTH_TYPE) {
      const creds = await mcpCredentialsOf(env, row);
      return creds ? mcpBankReader(await mcpAccessFor(env, row, creds, fetcher)) : null;
    }
    const creds = await decryptCredentials(env, row.uid, row.credentials_enc);
    const token = typeof creds?.api_key === 'string' ? creds.api_key : '';
    return token ? tokenBankReader(token, fetcher) : null;
  } catch {
    return null;
  }
}
