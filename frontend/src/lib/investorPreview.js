// Set by the mounted shell. This stays local to the active tab's React tree.
let investorPreview = false;

export const INVESTOR_PREVIEW_REFUSED = 'studioos:investor_preview_read_only';

export function setInvestorPreview(active) {
  investorPreview = active;
}

// D8730 (#8730): the Founder or Exploring preview this tab is in, or null. Its
// writes carry the same header, and the Worker's advisor routes refuse them.
let rolePreviewShell = null;

export function setRolePreviewShell(shell) {
  rolePreviewShell = shell === 'founder' || shell === 'exploring' ? shell : null;
}

export function investorPreviewHeaders() {
  if (investorPreview) return { 'X-Axal-Preview-Shell': 'investor' };
  return rolePreviewShell ? { 'X-Axal-Preview-Shell': rolePreviewShell } : {};
}

export function announceInvestorPreviewRefusal(status, code) {
  if (investorPreview && status === 403 && code === 'investor_preview_read_only' && typeof window !== 'undefined') {
    window.dispatchEvent(new window.Event(INVESTOR_PREVIEW_REFUSED));
  }
}
