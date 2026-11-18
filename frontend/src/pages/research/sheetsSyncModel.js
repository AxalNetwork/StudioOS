/**
 * D7170 (#7170) — what the Google Sheets card and its Sheet say, as pure
 * functions of the Worker's answers (FND-G00 to FND-G09).
 *
 * One state per card, one primary action per state, and one result
 * vocabulary: Complete only for counts that were read back, Partial when
 * fewer were, Failed only when nothing was written, and Outcome uncertain
 * when Axal was written and the sheet is not confirmed. No figure here is
 * made up: a count the Worker did not send is not shown.
 */

export const EXPORT_LABEL = 'Export Axal funds to Sheets';
export const IMPORT_LABEL = 'Import from Sheets';

/** The card's state from `GET /research/funds/sheet/status` (and whether that read failed). */
export function cardState(status, { loading = false, failed = false } = {}) {
  if (loading) return 'loading';
  if (failed || !status) return 'unavailable';
  if (status.configured === false) return 'unconfigured';
  if (!status.connected) return 'disconnected';
  if (!status.spreadsheet_id) return 'no_destination';
  if (status.tab_state === 'missing') return 'tab_missing';
  if (status.open_run) return 'pending';
  return 'ready';
}

/** The one primary action for each state. `null` is a state with none. */
export function primaryAction(state) {
  return {
    disconnected: 'connect',
    no_destination: 'destination',
    tab_missing: 'destination',
    pending: 'reconcile',
    ready: 'export',
  }[state] || null;
}

/** Why each direction can or cannot run now, as the card's "What can run" lines. */
export function whatCanRun(state, status) {
  const tab = status?.sheet_title ? `‘${status.sheet_title}’` : 'the tab';
  if (state === 'tab_missing') {
    return [
      { ok: false, label: 'Export', text: 'Blocked until you choose a destination tab' },
      { ok: false, label: 'Import', text: 'Blocked until you choose a source tab' },
    ];
  }
  if (state === 'pending') {
    const cells = (status?.open_run?.pending || []).filter((p) => p.state !== 'matches').map((p) => p.row);
    return [
      { ok: true, label: 'Export', text: 'Available · Axal is unaffected by the open import' },
      { ok: false, label: 'Import', text: cells.length ? `Retry waits until rows ${listRows(cells)} have identifiers` : 'Retry waits until the open import is reconciled' },
    ];
  }
  if (state === 'ready') {
    return [
      { ok: true, label: 'Export', text: `My funds → ${tab}, from row 1` },
      { ok: true, label: 'Import', text: `Reads ${tab} from row 2 → My funds · never deletes` },
    ];
  }
  return [];
}

/** Why a disabled action is off, said beside it. */
export function disabledReason(state, action) {
  if (state === 'loading') return 'Checking the connection…';
  if (state === 'unavailable') return 'Off until the Sheets status loads.';
  if (state === 'unconfigured') return 'Both stay off until the integration is configured.';
  if (state === 'disconnected') return 'Connect a Google account first.';
  if (state === 'no_destination') return 'Choose a workbook and tab first.';
  if (state === 'tab_missing') return 'Off until you choose a tab.';
  if (state === 'pending' && action === 'import') return 'Off until the open import is reconciled.';
  return null;
}

export function listRows(rows) {
  const r = rows.map(String);
  if (r.length <= 1) return r.join('');
  return `${r.slice(0, -1).join(', ')} and ${r[r.length - 1]}`;
}

/** A run's result chip: tone and words. */
export function resultLabel(run) {
  if (!run) return null;
  switch (run.status) {
    case 'complete': return { tone: 'ok', text: 'Complete · counts verified' };
    case 'partial': return { tone: 'warn', text: 'Partial' };
    case 'failed': return { tone: 'danger', text: 'Failed · nothing written' };
    case 'uncertain': return { tone: 'warn', text: 'Outcome uncertain · reconciliation pending' };
    default: return { tone: 'neutral', text: 'Running' };
  }
}

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The counts line for a run, from what the Worker read back. */
export function runCounts(run) {
  if (!run) return '';
  const c = run.counts || {};
  if (run.direction === 'export') {
    const written = n(c.written);
    const expected = n(c.expected);
    if (written === null) return expected === null ? '' : `${expected} funds · not read back`;
    return expected !== null && written !== expected
      ? `${written} of ${expected} funds written · read back`
      : `${written} funds written · read back`;
  }
  const parts = [];
  if (n(c.created) !== null) parts.push(`${c.created} created`);
  if (n(c.updated) !== null) parts.push(`${c.updated} updated`);
  const planned = c.planned || {};
  if (n(planned.skip)) parts.push(`${planned.skip} skipped`);
  if (n(planned.resolve)) parts.push(`${planned.resolve} to resolve`);
  if (n(c.ids_expected)) parts.push(`identifiers ${n(c.ids_confirmed) ?? 0} / ${c.ids_expected} on the sheet`);
  return parts.join(' · ');
}

/**
 * The live-region text for a result (FND-G09 § Announcements). Complete is a
 * polite status; anything that needs the person to act is an alert.
 */
export function announcement(run) {
  if (!run) return null;
  const c = run.counts || {};
  const dir = run.direction === 'export' ? 'Export' : 'Import';
  if (run.status === 'complete') {
    if (run.direction === 'export') return { role: 'status', text: `Export complete. ${n(c.written) ?? 0} funds written and read back.` };
    return { role: 'status', text: `Import complete: ${n(c.created) ?? 0} created, ${n(c.updated) ?? 0} updated.` };
  }
  if (run.status === 'partial') {
    if (run.direction === 'export' && n(c.written) !== null && n(c.expected) !== null) {
      return { role: 'alert', text: `Export partial. ${c.written} of ${c.expected} funds written. ${Math.max(0, c.expected - c.written)} not written.` };
    }
    return { role: 'alert', text: `${dir} partial. ${run.detail || ''}`.trim() };
  }
  if (run.status === 'failed') return { role: 'alert', text: `${dir} failed. Nothing was written.` };
  if (run.status === 'uncertain') {
    if (run.direction === 'import') {
      return { role: 'alert', text: `Import outcome uncertain. ${n(c.created) ?? 0} created in Axal; identifiers on the sheet not confirmed. Retry is off until reconciled.` };
    }
    return { role: 'alert', text: 'Export outcome uncertain. The rows could not be read back. Exporting again is safe.' };
  }
  return { role: 'status', text: `${dir} running.` };
}

/** One key per reviewed run, so a resend answers the same run. */
export function newIdempotencyKey() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return `rfg-${c.randomUUID()}`;
  return `rfg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The import's primary label: how many changes it writes, and how many rows wait to be resolved. */
export function importPrimaryLabel(counts) {
  const changes = (counts?.create || 0) + (counts?.update || 0);
  const resolve = counts?.resolve || 0;
  const head = `Import ${changes} ${changes === 1 ? 'change' : 'changes'}`;
  return resolve ? `${head}, skip ${resolve} to resolve` : head;
}

export const ACTION_LABEL = {
  create: 'Create', update: 'Update', unchanged: 'Unchanged', skip: 'Skip', resolve: 'Resolve', blank: 'Blank · ignored',
};

export const FIELD_LABEL = {
  name: 'Fund', cheque_min_cents: 'Cheque min', cheque_max_cents: 'Cheque max', stage_fit: 'Stage fit',
  path: 'Path', status: 'State', pass_reason: 'Pass reason', thesis: 'Thesis', note: 'Note', source_url: 'Source URL', uid: 'uid',
};

/** A Google Sheets URL that opens the linked tab. */
export function sheetHref(status) {
  if (!status?.spreadsheet_id) return null;
  const gid = status.sheet_gid == null ? '' : `#gid=${status.sheet_gid}`;
  return `https://docs.google.com/spreadsheets/d/${status.spreadsheet_id}/edit${gid}`;
}

/** "16 Nov, 10:47 UTC" from an ISO stamp; empty when there is none. */
export function utcStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${hh}:${mm} UTC`;
}
