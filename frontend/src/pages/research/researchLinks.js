/**
 * D4612 — the Research links this reader may follow, from the signed-in user
 * and the page's research role (`lib/researchAccess.js` holds the rule). A
 * destination the reader is not admitted to is shown as text, not a link.
 */
import { useAuth } from '../../hooks/useAuthSync.jsx';
import { canOpenResearch } from '../../lib/researchAccess.js';

export function researchLinks(user, role) {
  return {
    companies: canOpenResearch('companies', user, role),
    funds: canOpenResearch('funds', user, role),
  };
}

export function useResearchLinks(role) {
  const auth = useAuth();
  return researchLinks(auth?.user || null, role);
}
