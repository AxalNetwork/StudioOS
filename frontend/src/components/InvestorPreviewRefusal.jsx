import React, { useLayoutEffect, useState } from 'react';
import { INVESTOR_PREVIEW_REFUSED, setInvestorPreview } from '../lib/investorPreview';
import Lightbox from '../ui/Lightbox';

export default function InvestorPreviewRefusal({ mode }) {
  const active = mode.superAdmin && mode.viewMode === 'investor' && !mode.isImpersonating;
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    if (!active) {
      setOpen(false);
      return;
    }
    const show = () => setOpen(true);
    setInvestorPreview(true);
    window.addEventListener(INVESTOR_PREVIEW_REFUSED, show);
    return () => {
      window.removeEventListener(INVESTOR_PREVIEW_REFUSED, show);
      setInvestorPreview(false);
    };
  }, [active]);

  if (!active || !open) return null;

  const close = () => setOpen(false);
  return (
    <Lightbox
      label="Investor preview"
      title="Return to HQ to make this change"
      phone="sheet"
      onClose={close}
      testId="investor-preview-refusal"
      footer={(
        <div className="flex justify-end gap-3">
          <button className="min-h-11 px-3 font-semibold text-axal-muted" type="button" onClick={close}>
            Stay in preview
          </button>
          <button className="min-h-11 rounded-lg bg-axal-violet px-4 font-semibold text-white" type="button" onClick={() => { close(); mode.exitPreview(); }}>
            Return to HQ
          </button>
        </div>
      )}
    >
      <p className="m-0 text-sm text-axal-muted">This deal action is unavailable in Investor preview. Your change was not saved.</p>
    </Lightbox>
  );
}
