/**
 * D1352 (#3567, part 3 of #3564) — what the LinkedIn connector page and the
 * Network's contacts say. Pure, so a test can hold every word.
 *
 * THE PAGE CLAIMS NO API. Axal VC confirms who the member is (OpenID Connect,
 * D1350) and imports the Connections.csv the member downloads and uploads
 * (D1351). It reads nothing else from LinkedIn. Part 5 (#3569) adds a line
 * here only when API access is live.
 */

/** LinkedIn's own page for downloading your data: step 1 links it. */
export const LINKEDIN_EXPORT_URL = 'https://www.linkedin.com/mypreferences/d/download-my-data';

export const CAN = Object.freeze(['Confirm who you are', 'Import the connections file you upload']);
export const CANNOT = Object.freeze(['Read your LinkedIn messages', 'Post on LinkedIn for you', 'See your connections without your file']);

const SCOPE_WORDS = Object.freeze({ openid: 'Sign in', profile: 'Your name and photo', email: 'Your email address' });

/** The scopes LinkedIn granted, in words; one LinkedIn names that Axal does not know is shown as LinkedIn names it. */
export function grantedScopes(scopes) {
  const list = Array.isArray(scopes) ? scopes : String(scopes || '').split(/\s+/);
  return list.filter(Boolean).map((s) => ({ scope: s, label: SCOPE_WORDS[s] || s }));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The preview's counts, in the order the page draws them. Nothing is imported yet. */
export function previewCounts(p) {
  const c = p?.counts || p || {};
  return [
    ['new', 'New', c.new], ['duplicates', 'Already in your Network', c.duplicates], ['suggestions', 'Possible duplicates to review', c.suggestions],
    ['skipped', 'Repeated in the file', c.skipped], ['errors', 'Could not be read', c.errors],
  ].map(([key, label, n]) => ({ key, label, n: Number.isFinite(Number(n)) ? Number(n) : null }));
}

/** The last import, in one line; nothing when there has been none. A count the job did not record says so. */
export function lastImportLine(job) {
  if (!job) return null;
  const when = job.finished_at || job.started_at;
  const day = when ? new Date(String(when).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(when)) ? '' : 'Z')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null;
  if (job.status === 'running') return `An import is running${day ? `, started ${day}` : ''}.`;
  if (job.status === 'failed') return `The last import${day ? ` (${day})` : ''} failed.${job.error ? ` ${job.error}` : ''}`;
  const n = (v) => (v == null ? 'not recorded' : String(v));
  return `Last import${day ? `, ${day}` : ''}: ${n(job.rows_created)} added, ${n(job.rows_matched)} matched, ${n(job.rows_skipped)} skipped, ${n(job.rows_errors)} not read.`;
}

/** The review's three actions, in the words the page shows, and the decision each sends. */
export const REVIEW_ACTIONS = Object.freeze([
  { decision: 'merge', label: 'Merge' },
  { decision: 'keep', label: 'Keep both' },
  { decision: 'dismiss', label: 'Dismiss' },
]);

/** Merge is offered only between two rows of the member's own book (D1351 §5). */
export const reviewActions = (review) => REVIEW_ACTIONS.filter((a) => a.decision !== 'merge' || review?.can_merge !== false);

/** What "Also delete" deletes and keeps, said before Disconnect is pressed. Counts the status could not read say so. */
export function deleteChoice(imported) {
  const read = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  if (!imported || read(imported.linkedin_only) == null || read(imported.kept) == null) return { label: 'Also delete the contacts imported from LinkedIn', note: 'How many would be deleted could not be read. Contacts that also came from somewhere else always stay.' };
  const only = read(imported.linkedin_only);
  const kept = read(imported.kept);
  return {
    label: only ? `Also delete the ${plural(only, 'contact', 'contacts')} imported only from LinkedIn` : 'Also delete the contacts imported from LinkedIn (there are none)',
    note: kept ? `${plural(kept, 'contact', 'contacts')} also came from somewhere else, so ${kept === 1 ? 'it stays' : 'they stay'}.` : 'Every LinkedIn contact came only from LinkedIn.',
  };
}

/** After Disconnect: what was deleted and what stayed. */
export function disconnectedLine(r) {
  if (!r || !Number.isFinite(Number(r.deleted_imported)) || r.kept_imported == null) return 'LinkedIn is disconnected. Your contacts stay in your Network.';
  return `LinkedIn is disconnected. ${plural(Number(r.deleted_imported), 'contact', 'contacts')} deleted; ${plural(Number(r.kept_imported), 'contact', 'contacts')} kept because another source has them.`;
}

const LINKEDIN_SOURCES = new Set(['linkedin_csv', 'linkedin_api', 'linkedin_dma']);
/** A contact's source chips: From LinkedIn, From a spreadsheet, Added by hand. One chip per kind, in that order. */
export function sourceChips(sources) {
  const list = Array.isArray(sources) ? sources : [];
  const chips = [];
  if (list.some((s) => LINKEDIN_SOURCES.has(s))) chips.push({ key: 'linkedin', label: 'From LinkedIn' });
  if (list.includes('csv')) chips.push({ key: 'csv', label: 'From a spreadsheet' });
  if (list.includes('typed') || list.length === 0) chips.push({ key: 'typed', label: 'Added by hand' });
  return chips;
}
