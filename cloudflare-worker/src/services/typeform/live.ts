/**
 * D5828 part 2 (#5828) — the production `ImportDeps`: #5827's encrypted grant
 * and the data center recorded with it, for one connection.
 *
 * The token comes from `typeformSession` (decrypted per run, refreshed behind
 * #5827's lease when near expiry) and is handed only to the request; the
 * region is the one stored with the grant (`recordedRegion`), never the
 * sign-in default. Requests refuse redirects, so the bearer token never
 * follows one off Typeform's origin.
 *
 * How a grant failure reads to the importer:
 *   a refresh another caller holds       -> busy (nothing stored)
 *   Typeform's token endpoint unreadable -> unreadable
 *   revoked, changed, unreadable grant,
 *   or the connection gone               -> access_revoked
 */
import type { Env } from '../../types';
import type { IntegrationRow } from '../../integrations/registry';
import { typeformSession } from '../../integrations/providers/typeform';
import { TypeformError } from '../../integrations/typeformOAuth';
import { TypeformReadError, type FetchLike } from './api';
import { TypeformSessionBusy, type ImportDeps } from './importer';

const noRedirect: FetchLike = (url, init) => fetch(url, { ...init, redirect: 'error' });

/** The grant failure as the importer stores it. Exported for the test. */
export function sessionFailure(e: unknown): Error {
  if (e instanceof TypeformError) {
    if (e.code === 'typeform_refresh_busy') return new TypeformSessionBusy();
    if (e.code === 'typeform_token_failed' || e.code === 'typeform_token_invalid') return new TypeformReadError('unreadable');
  }
  return new TypeformReadError('access_revoked');
}

export function typeformImportDeps(env: Env, connection: Pick<IntegrationRow, 'id' | 'uid'>, opts: { fetch?: FetchLike; now?: () => number } = {}): ImportDeps {
  return {
    fetch: opts.fetch ?? noRedirect,
    now: opts.now ?? Date.now,
    runId: crypto.randomUUID(),
    async session(integrationId) {
      // This deps object serves its own connection only.
      if (integrationId !== Number(connection.id)) throw new TypeformReadError('access_revoked');
      try {
        const s = await typeformSession(env, connection);
        return { accessToken: s.accessToken, region: s.recordedRegion };
      } catch (e) { throw sessionFailure(e); }
    },
  };
}
