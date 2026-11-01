import { posthogApi } from '../../lib/api/posthog';
import FromPosthog from './FromPosthog';

/**
 * D1607 (#3731, #2409 part 5) — PostHog on Raise's Fundraising readiness,
 * Investor narrative and Pitch deck, on the shared "From PostHog" part
 * (D1609). It draws the metrics tracked for the module and Sync from
 * PostHog. Traction proof's PostHog lines and the consistency check's
 * active users come with each module's own read, labelled "From PostHog";
 * the readiness score never counts them (#2409 decision E, a).
 */
export const RAISE_POSTHOG_MODULES = Object.freeze({
  'fundraising-readiness': 'fundraising_readiness',
  'investor-narrative': 'investor_narrative',
  'pitch-deck': 'pitch_deck',
});

export default function RaisePosthog({ slug, projectId, api = posthogApi, phone = false }) {
  const module = RAISE_POSTHOG_MODULES[slug];
  if (!module) return null;
  return <FromPosthog section="raise" projectId={projectId} module={module} api={api} phone={phone} onSync={() => api.sync('raise', projectId)} />;
}
