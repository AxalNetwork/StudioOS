// Set by the mounted shell. This stays local to the active tab's React tree.
let investorPreview = false;

export const INVESTOR_PREVIEW_REFUSED = 'studioos:investor_preview_read_only';

export function setInvestorPreview(active) {
  investorPreview = active;
}

export function investorPreviewHeaders() {
  return investorPreview ? { 'X-Axal-Preview-Shell': 'investor' } : {};
}

export function announceInvestorPreviewRefusal(status, code) {
  if (investorPreview && status === 403 && code === 'investor_preview_read_only' && typeof window !== 'undefined') {
    window.dispatchEvent(new window.Event(INVESTOR_PREVIEW_REFUSED));
  }
}
