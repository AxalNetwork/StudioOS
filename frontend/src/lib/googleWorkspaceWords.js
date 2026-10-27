/**
 * D1091 (#2956), the screens D1314 gives it — Google Workspace's words, in
 * one place, for the connector page (GW1, GW2, GW8), the shared From Google
 * section (GW3, GW7) and the Map columns dialog (GW4). Pure, so the tests read
 * them without a browser.
 *
 * The modules a file can be chosen for are the Worker's own list
 * (`routes/google_workspace.ts`, `MODULE_KINDS`); the labels are
 * `integrations/moduleLabels.ts`', prefixed with their cycle as the canvas
 * draws them ("Build › Product roadmap").
 */

/** module key → [cycle, module label, the kinds of file it takes] */
export const WORKSPACE_MODULES = Object.freeze({
  customer_research: ['Validate', 'Customer research', ['doc']],
  demand_signals: ['Validate', 'Demand and urgency signals', ['form']],
  experiments: ['Validate', 'Experiments and evidence', ['form']],
  solution_design: ['Build', 'Solution design', ['doc']],
  product_roadmap: ['Build', 'Product roadmap', ['sheet']],
  pitch_deck: ['Raise', 'Pitch deck', ['slides']],
  data_room: ['Raise', 'Data room', ['doc', 'sheet', 'slides', 'file']],
  revenue_traction: ['Grow', 'Revenue and traction', ['sheet']],
  grow_updates: ['Grow', 'Updates', ['sheet']],
});
export const moduleLabel = (key) => (WORKSPACE_MODULES[key] ? WORKSPACE_MODULES[key][1] : null);
export const modulePath = (key) => (WORKSPACE_MODULES[key] ? `${WORKSPACE_MODULES[key][0]} › ${WORKSPACE_MODULES[key][1]}` : null);

export const KIND_WORDS = Object.freeze({ doc: 'Doc', sheet: 'Sheet', slides: 'Slides', form: 'Form', file: 'File' });
export const kindWord = (k) => KIND_WORDS[k] || 'File';
export const sourceWord = (k) => ({ doc: 'Google Docs', sheet: 'Google Sheets', slides: 'Google Slides', form: 'Google Forms' }[k] || 'Google Drive');

export const PAGE = Object.freeze({
  tagline: 'Choose Google files for your modules. Axal VC reads only the files you choose.',
  permissionTitle: 'Permission: files you choose',
  permissionLines: [
    'Only files you pick in Google’s file picker',
    'Read only: Axal VC never edits, moves or deletes them',
    'Stop using a file and Axal VC can no longer open it',
  ],
  googlePage: 'Google sign-in is on the Google page ›',
  googlePageHref: '/account/connectors/google',
  allowTitle: 'Allow Axal VC to open the files you choose',
  allowBody: 'Axal VC opens only the files you pick in Google’s file picker. It cannot see the rest of your Drive.',
  allowNote: 'Google asks you to confirm. Nothing is opened until you choose a file.',
  allowButton: 'Allow Google files',
  noGoogleTitle: 'Google is not connected yet',
  noGoogleBody: 'Connect your Google account first. Then you can choose files here.',
  noGoogleLink: 'Open the Google page ›',
  chooseButton: 'Choose files',
  filesTitle: 'Files you chose',
  noFiles: 'No files chosen yet. Choose a file for a module, and it is listed here.',
});

/** The band's pill (GW1, GW2): the connection as the member sees it. */
export function statePill(state, email) {
  if (state === 'google_not_connected') return { tone: 'neutral', text: 'Google not connected' };
  if (state === 'workspace_not_allowed') return { tone: 'warn', text: 'Files not allowed yet' };
  if (state === 'ready') return { tone: 'ok', text: email ? `✓ Connected · ${email}` : '✓ Connected' };
  return null;
}

/** "5 files · 1 venture" (GW1). */
export function filesLine(n, ventures) {
  return `${n} ${n === 1 ? 'file' : 'files'} · ${ventures} ${ventures === 1 ? 'venture' : 'ventures'}`;
}

/** "2026-10-21 09:12" from a stored stamp; never read is said, never blank. */
export function readStamp(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(s || ''));
  return m ? `${m[1]} ${m[2]}` : null;
}
export const NEVER_READ = 'Not read yet: no module has read this file.';

/** GW1's Stop using dialog. `rows` is how many rows the module already read, when its feed knows. */
export function stopCopy(file, rows = null) {
  const where = moduleLabel(file?.module) || 'The module';
  return {
    title: `Stop using “${file?.name || 'this file'}”?`,
    keeps: rows == null
      ? `${where} keeps what it already read, marked “No longer synced”.`
      : `${where} keeps the ${rows} ${rows === 1 ? 'row' : 'rows'} already read, marked “No longer synced”.`,
    google: 'Axal VC can no longer open this file. The file in Google is not changed.',
    button: 'Stop using',
  };
}

/** A refusal's code, in words. The Worker answers codes only (D1091). */
export function workspaceRefusal(e) {
  const code = e?.code || e?.data?.error;
  const WORDS = {
    google_not_connected: 'Google is not connected yet. Connect your Google account on the Google page first.',
    workspace_not_allowed: 'Google files are not allowed yet. Allow Google files first.',
    company_not_enabled: 'Google files are not switched on for this venture’s company. Allow Google files for it first.',
    project_not_available: 'You cannot choose files for this venture.',
    file_not_shared: 'Google did not let Axal VC open that file. Choose it again in Google’s file picker.',
    wrong_file_kind: 'That kind of file does not fit this module.',
    file_not_found: 'That file is no longer chosen.',
    support_session_refused: 'A support session cannot use Google files.',
    picker_not_ready: 'Google’s file picker is not set up on Axal yet. Nothing was chosen.',
    picker_unavailable: 'Google’s file picker could not be loaded. Try again in a moment.',
    picker_scope_refused: 'Google answered with a wider permission than “files you choose”, so nothing was opened.',
    picker_cancelled: 'Nothing was chosen.',
    invalid_files: 'Choose between 1 and 20 files.',
    mapping_not_supported: 'Only a Sheet or a Form is mapped.',
    consent_not_google: 'Google did not answer with its consent page. Try again in a moment.',
  };
  return WORDS[code] || 'Google could not be read just now. Nothing changed. Try again.';
}

// ---------------------------------------------------------------- From Google (GW3, GW7)

export const FROM = Object.freeze({
  title: 'From Google',
  loading: 'Reading…',
  empty: 'No Google files chosen for this module yet.',
  emptyNote: 'Axal VC opens only the files you choose.',
  choose: 'Choose from Google Drive',
  sync: 'Sync from Google',
  syncAgain: 'Sync again',
  chooseAgain: 'Choose again',
});

/** The section's source line: what it reads, and as of when. */
export function sourceLine({ file, state }) {
  if (state === 'loading') return file ? `Reading “${file.name}”…` : 'Reading…';
  if (!file) return 'No file chosen';
  const day = String(file.last_synced_at || '').slice(0, 10);
  if (state === 'unreadable') return day ? `“${file.name}” · last read ${day}` : `“${file.name}” · never read`;
  return day ? `“${file.name}” · From ${sourceWord(file.kind)}, as of ${day}` : `“${file.name}” · From ${sourceWord(file.kind)}, not read yet`;
}

/** GW7's Unreadable words. `kept` is how many rows read before stay below, when the feed knows. */
export function unreadableCopy(file, kept = null) {
  const day = String(file?.last_synced_at || '').slice(0, 10);
  return {
    title: `We could not read “${file?.name || 'the file'}”.`,
    body: kept && day
      ? `Google says the file was moved, or you no longer have access to it. The ${kept} ${kept === 1 ? 'row' : 'rows'} read on ${day} ${kept === 1 ? 'is' : 'are'} kept below.`
      : 'Google says the file was moved, or you no longer have access to it. Nothing read before is removed.',
  };
}

/** GW7's Partly synced line. */
export const partlyLine = (read, total) => `Partly synced: ${read} of ${total} rows read.`;

/** GW3's Delete dialog. */
export function deleteRowCopy({ row, module, file }) {
  return {
    title: 'Delete this row?',
    body: `“${row}” leaves ${moduleLabel(module) || 'this module'}. It stays deleted when you sync again.`,
    google: `“${file || 'The file'}” in Google is not changed.`,
    button: 'Delete',
  };
}

// ---------------------------------------------------------------- Map columns (GW4)

export const DONT_USE = '';
export const DONT_USE_WORD = 'Don’t use';
const DAYLIKE = /^\d{4}-\d{2}(-\d{2})?$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

/**
 * The columns that hold something a field cannot take, among the preview's
 * rows: a date field takes a date, a number field a number. Each problem names
 * its rows (1-based, the sheet's own row number after the header).
 */
export function mappingProblems(header, rows, mapping, fields) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out = [];
  header.forEach((col, i) => {
    const field = byKey.get(mapping[col]);
    if (!field || !field.type) return;
    const bad = [];
    rows.forEach((r, n) => {
      const v = String(r?.[i] ?? '').trim();
      const ok = field.type === 'date' ? DAYLIKE.test(v) : field.type === 'number' ? v !== '' && Number.isFinite(Number(v.replace(/[^0-9.-]/g, ''))) && /\d/.test(v) : true;
      if (!ok) bad.push({ row: n + 2, value: v });
    });
    if (bad.length) out.push({ column: col, field, rows: bad });
  });
  return out;
}

const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "Date column has 3 rows that are not dates. They will be skipped." and the rows named. */
export function problemCopy(p) {
  const what = p.field.type === 'date' ? 'dates' : 'numbers';
  const n = p.rows.length;
  return {
    line: `${p.column} column has ${n} ${n === 1 ? 'row' : 'rows'} that ${n === 1 ? 'is not a' : 'are not'} ${n === 1 ? what.slice(0, -1) : what}. ${n === 1 ? 'It' : 'They'} will be skipped.`,
    rows: `${n === 1 ? 'Row' : 'Rows'} ${list(p.rows.map((r) => String(r.row)))} read ${list(p.rows.map((r) => (r.value ? `“${r.value}”` : 'a blank cell')))}.`,
  };
}
