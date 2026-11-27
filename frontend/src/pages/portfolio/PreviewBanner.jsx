/**
 * D4817 part 8 (#5311, canvas PF-08 and PF-11 "preview privacy"): the one
 * Admin Investor preview banner and the compact "Private in preview" chip.
 *
 * The banner says who is being previewed (the Investor shell), that the page
 * is read-only and reads no investor record, and how to leave: the same way
 * back the shell's Preview shell strip offers (Back to HQ for the holder, Back
 * to HQ’s own accounts for any other administrator). It is drawn once, by the
 * Portfolio frame's `banner` slot; the shell's strip stands down on these
 * pages (`pageOwnsPreviewBanner`), so there is one banner, not two.
 */
import React from 'react';
import { Lock } from 'lucide-react';
import { PREVIEW_BANNER, PREVIEW_READ_ONLY, PRIVATE_IN_PREVIEW, previewExitLabel } from './previewModel';
import './preview.css';

export function PreviewBanner({ superAdmin = false, onExit }) {
  return (
    <div className="pf-preview-banner" role="status" data-testid="portfolio-preview-banner">
      <Lock size={14} aria-hidden="true" />
      <div className="pf-preview-banner-text">
        <b>{PREVIEW_BANNER}</b>
        <span>{PREVIEW_READ_ONLY}</span>
      </div>
      {onExit ? (
        <button type="button" className="pf-preview-exit" onClick={onExit} data-testid="button-portfolio-preview-exit">
          {previewExitLabel(superAdmin)}
        </button>
      ) : null}
    </div>
  );
}

/** A withheld record: the lock and the words, never a zero or a blank. */
export function PrivateChip({ what }) {
  return (
    <span className="pf-private" data-testid="chip-private-in-preview" title={what ? `${what}: withheld in preview` : undefined}>
      <Lock size={11} aria-hidden="true" />{PRIVATE_IN_PREVIEW}
    </span>
  );
}

export default PreviewBanner;
