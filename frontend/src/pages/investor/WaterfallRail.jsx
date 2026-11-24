/**
 * D6221 (#6221, canvas D6220 EW-01): the Exit Waterfall's rail, the Portfolio
 * boards' own `WorkerRail` in their self-drawn `pf-rail` frame. Eadwyn's exit
 * values to try and its explanation of a result need the Worker first, so the
 * rail carries only its note.
 */
import React from 'react';
import WorkerRail from '../../ui/WorkerRail';

export default function WaterfallRail() {
  return (
    <WorkerRail workspace="Portfolio" role="investor" className="pf-rail" data-testid="waterfall-rail"
      note="The Exit Waterfall is a model of a split, not a distribution. Its figures come from the fund's recorded commitments and the inputs you type." />
  );
}
