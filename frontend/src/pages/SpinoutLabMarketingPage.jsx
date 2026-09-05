import React, { useMemo, useState } from 'react';
import PublicNav from '../components/PublicNav';
import PublicFooter from '../components/PublicFooter';
import LabIntro from '../components/spinout/LabIntro';
import { GraduatesSection } from './SpinoutLabPage';
import {
  LAB_APPLY_HREF, openCohortCopy, useCohortDirectory, useShippedFeed,
} from '../lib/spinoutLab';
import { DEFAULT_TRACK } from '../lib/spinoutLabArsenal';

/**
 * `/spinout-lab`, logged out — the public Spin-Out Lab introduction.
 *
 * DESIGN HANDOFF: `design/canvases/integrated/Spin-Out Lab · Intro.dc.html`.
 * The whole body is `components/spinout/LabIntro.jsx`, which the signed-in
 * surface renders too; this file is the public chrome around it and nothing
 * else. That is the point of the change: header, hero, pipeline and
 * deliverables used to exist twice, hand-maintained, here and in `Dashboard`,
 * and they had drifted — different hover states, different connector colours,
 * and two different ideas of what the four weeks were called.
 *
 * WHAT WAS DELETED HERE, and why it matters more than the duplication:
 *
 *   const PHASE_STATUS = ['done', 'active', 'future', 'future'];
 *
 * That drew gate 1 with a completed tick and gate 2 with a live pulsing dot,
 * on a public page, for a cohort that does not exist — its own comment
 * conceded "the logged-out page has no cohort". It is the same class of defect
 * as the sample companies the canvas drew and this integration refused: a
 * fixture rendered as a fact. The gates now render with no status at all,
 * because a visitor has no position in them.
 */
export default function SpinoutLabMarketingPage() {
  // Client state only — the track restyles which tools lead, the jurisdiction
  // restyles the entity/filing wording. Neither is recorded anywhere; see
  // LabIntro's header for why no `track` param rides the apply link.
  const [track, setTrack] = useState(DEFAULT_TRACK);
  const [jurisdiction, setJurisdiction] = useState('de');
  const cohort = useMemo(() => openCohortCopy(), []);

  const directory = useCohortDirectory();
  // Logged out: the gate feed needs a session, so it is not requested at all
  // rather than fired and 401'd. LabIntro states the limit on this surface.
  const shipped = useShippedFeed({ enabled: false });

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <PublicNav />
      <main>
        <LabIntro
          surface="public"
          cohort={cohort}
          applyHref={LAB_APPLY_HREF}
          track={track}
          onTrack={setTrack}
          jurisdiction={jurisdiction}
          onJurisdiction={setJurisdiction}
          directory={directory}
          shipped={shipped}
        >
          <GraduatesSection />
        </LabIntro>
      </main>
      <PublicFooter />
    </div>
  );
}
