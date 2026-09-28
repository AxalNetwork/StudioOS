import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { loadUserVectors } from '../services/matchingVectors';
import { ensureTier, userMeetsTier } from '../middleware/requireTier';
import { computeCounterpartyMatches } from '../services/bestFit';

// The AI Matching Engine that lived here (`/deal-flow`, `/co-invest`,
// `/referral-scores`, `/score`, `/investor-match`, `/admin/all`, and the
// `/matches` page that read them) was removed. What remains is Best-Fit's
// summary, which the profile's Fit section reads and which was only ever
// mounted under this prefix. `match_scores` rows written before the removal
// stay in D1 and are still read by the dashboard, syndicate recommendations
// and the onboarding checklist; nothing writes new ones.
const matches = new Hono<{ Bindings: Env }>();

// --------- Best-Fit cross-counterparty summary (Task #19) ---------
//
// Top matches for the current user across all five counterparty types.
//   free      → counts + ONE anonymized teaser per type
//   studio    → full ranked matches with identity (names/contact)
//   bypass    → admin/partner/investor/advisor see full (via userMeetsTier)
//   ?detail=full → free callers get a 402 PaywallModal trigger; unlocked get full.
// The default (no `detail`) ALWAYS returns 200 so the summary card never 402s.
matches.get('/summary', async (c) => {
  const user = await requireAuth(c);
  const wantsDetail = (c.req.query('detail') || '').toLowerCase() === 'full';
  const unlocked = userMeetsTier(user, 'studio');
  // Explicit full-detail request from a non-unlocked caller → 402 PaywallModal.
  if (wantsDetail && !unlocked) ensureTier(user, 'studio'); // throws 402 Response

  const viewerVectors = await loadUserVectors(c.env, user.id);
  const results = await computeCounterpartyMatches(c.env, user.id, viewerVectors, { limit: 5 });

  const types = results.map((r) => {
    if (unlocked) {
      return { type: r.type, label: r.label, count: r.count, matches: r.matches };
    }
    // Free: counts + a single identity-stripped teaser.
    const top = r.matches[0];
    const teaser = top
      ? {
          match_score: top.match_score,
          band: top.band,
          values_alignment: top.values_alignment,
          skill_complementarity: top.skill_complementarity,
          top_reason: top.reasons[0] ?? null,
        }
      : null;
    return { type: r.type, label: r.label, count: r.count, teaser };
  });

  return c.json({ unlocked, types });
});

export default matches;
