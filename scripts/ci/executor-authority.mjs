/** D7905: composes the receipt reader (#7973) and the profile catalog (#7906) for the executor and admission CLIs. */
import { resolveCatalogProfile } from './runners/catalog.mjs';

/**
 * The authority URL and audience are repository configuration, never a workflow input or receipt field. Without
 * them, or without the reader module, no `readReceipt` is returned and admission keeps refusing at
 * `receipt_authority_unconfigured`. The OIDC closure reads only GitHub's reserved request variables, which the
 * executor's allowlisted test environment and the container never receive.
 */
export async function trustedAuthority(env = process.env, { loadClient = () => import('./capacity-client.mjs'), resolveProfile = resolveCatalogProfile } = {}) {
  const authority = { resolveProfile: id => resolveProfile(id) };
  const url = env.CAPACITY_AUTHORITY_URL, audience = env.CAPACITY_AUTHORITY_AUDIENCE;
  if (typeof url !== 'string' || !url || typeof audience !== 'string' || !audience) return authority;
  try {
    const client = await loadClient();
    return { ...authority, readReceipt: client.createReceiptReader({ url, audience, oidcToken: client.githubOidcToken(env) }) };
  } catch {
    return authority;
  }
}
