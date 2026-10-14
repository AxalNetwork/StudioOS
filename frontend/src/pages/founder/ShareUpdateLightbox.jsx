import React from 'react';
import Lightbox from '../../ui/Lightbox';
import ShareUpdateSheet from './ShareUpdateSheet';

/**
 * D686 §5.8 (#1599) — Grow's "Share an update" in the cycle lightbox:
 * `<Lightbox size="tall">` around the sheet's `ActionSheet`. Grow's `Mount`
 * (`pages/cycles/CycleRoute.jsx`); completion is the cycle's replace to
 * `/updates/:uid`.
 */
export default function ShareUpdateLightbox({ projectId, onClose, onSent }) {
  return (
    <Lightbox label="Share an update" size="tall" width={640} onClose={onClose} testId="share-update-lightbox">
      <ShareUpdateSheet projectId={projectId} onClose={onClose} onSent={onSent} />
    </Lightbox>
  );
}
