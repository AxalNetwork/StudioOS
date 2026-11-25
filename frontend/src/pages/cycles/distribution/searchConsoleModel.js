/** Presentation of stored finalized web-search data; never recomputes totals from page rows (#5841). */
export const SEARCH_CONSOLE_CONNECTOR = '/account/connectors/google_search_console';
export const searchConsoleHref = (project) => `${SEARCH_CONSOLE_CONNECTOR}?project_id=${encodeURIComponent(project)}`;
export const searchResultsHref = (project) => `/grow/distribution/results?project_id=${encodeURIComponent(project)}`;
export const searchNumber = (value, reason = 'Not recorded') => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : reason;
export const searchCtr = (value, reason) => typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%` : reason || 'Not recorded';
export function searchReadFailure(error) {
  const code = error?.data?.error;
  if (code === 'search_console_unavailable') return 'Search Console is unavailable until its app is approved.';
  if (['sign_in_again', 'property_revoked', 'not_connected'].includes(code)) return 'Reconnect Search Console, then check the selected property.';
  if (code === 'not_your_binding') return 'Only the member whose connection serves this venture can sync.';
  if (code === 'company_not_enabled') return 'Enable this connection for the venture’s company on its connector page.';
  if (code === 'property_denied') return 'Access to the selected property was lost. Check access or choose another property.';
  return 'Unreadable: Search Console could not be read. Try again.';
}
export function searchFreshness(data, now = Date.now()) {
  if (!data?.last_success_at) return 'Not recorded: no successful sync';
  const parsed = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(data.last_success_at) ? data.last_success_at : `${data.last_success_at.replace(' ', 'T')}Z`);
  return data.last_status !== 'ok' || !Number.isFinite(parsed) || now - parsed > 7 * 86400000 ? 'Stale: last-good stored results' : 'Last-good stored results';
}
