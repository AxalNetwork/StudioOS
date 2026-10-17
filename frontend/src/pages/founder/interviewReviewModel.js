// D685 §5.10–§5.11 (#1589) — the rules of the interview review at
// `/validate/interviews/:id`, kept apart from the page so a Node test reads
// them without React: which session opens, what each one is called in the
// switcher, and which passage a summary sentence's citation points at.
// D697 (#1659) adds the record's: a passage's start as `[hh:mm:ss]`, the
// passages Search keeps, and where Delete lands.

/** A session with a transcript to review: the review opens on the newest of these (§5.11.1). */
export const REVIEWABLE = new Set(['transcribed', 'structured', 'reviewed']);

const STATUS_WORDS = {
  draft: 'Not started',
  recording: 'Recording',
  paused: 'Paused',
  stopped: 'Stopped',
  transcribing: 'Transcribing',
  transcribed: 'Transcribed',
  structured: 'Findings proposed',
  reviewed: 'Reviewed',
};

const CHANNELS = { in_person: 'In person', video: 'Video call', phone: 'Audio call', text: 'Text chat' };

/**
 * The session the review opens on: the one `?session=` names when it belongs
 * to this interview, else the newest reviewable one, else the newest. The
 * Worker lists the interview's sessions newest first, drafts and recordings
 * included, so "the newest" alone could open an empty draft.
 */
export function pickSession(items, wanted = null) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  if (wanted != null && wanted !== '') {
    const hit = list.find((s) => String(s.id) === String(wanted));
    if (hit) return hit;
  }
  return list.find((s) => REVIEWABLE.has(s.status)) || list[0];
}

/** What a status reads as, in words; one the page does not know is shown as the Worker wrote it. */
export const statusWord = (status) => STATUS_WORDS[status] || (status ? String(status) : 'Not recorded');

/** The switcher's label: when, how, and where it stands. A missing date says so. */
export function sessionLabel(s) {
  const when = typeof s?.created_at === 'string' && s.created_at ? s.created_at.slice(0, 10) : 'Date not recorded';
  const how = s?.call_label || CHANNELS[s?.channel] || (s?.channel ? String(s.channel) : 'Channel not recorded');
  return `${when} · ${how} · ${statusWord(s?.status)}`;
}

/**
 * The passage a citation points at: the first final segment its span
 * overlaps (spans are milliseconds, D685 §5.10). Null when the transcript
 * holds none, so the sentence keeps its quote and draws no dead link.
 */
export function citeTarget(segments, cite) {
  const from = Number(cite?.from), to = Number(cite?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  const finals = (Array.isArray(segments) ? segments : []).filter((s) => s.source === 'final');
  const hit = finals.find((s) => Number(s.start_ms) < to && Number(s.end_ms) > from);
  return hit ? `seg-${hit.id}` : null;
}

/** "Interviewee · Company", each missing part saying so. */
export function whoLine(interview) {
  const name = String(interview?.interviewee_name || '').trim() || 'Name not recorded';
  const company = String(interview?.interviewee_company || '').trim() || 'Not recorded';
  return { name, company };
}

/**
 * A passage's start as `[hh:mm:ss]`, from its `start_ms` (D697). Null when the
 * start is absent or unreadable, so the passage draws no time rather than a
 * made-up `[00:00:00]`.
 */
export function clock(ms) {
  if (ms === null || ms === undefined || ms === '') return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return null;
  const total = Math.floor(n / 1000);
  const pad = (v) => String(v).padStart(2, '0');
  return `[${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}]`;
}

/**
 * The passages the transcript draws, narrowed by Search (D697). The same
 * passages `TranscriptReview` draws, the final segments when there are any,
 * then those whose words hold the search text, case aside. Empty or blank
 * text keeps every passage. It reads nothing: Search filters what the page
 * already holds.
 */
export function findPassages(segments, text) {
  const all = Array.isArray(segments) ? segments : [];
  const finals = all.filter((s) => s?.source === 'final');
  const rows = finals.length ? finals : all;
  const needle = typeof text === 'string' ? text.trim().toLowerCase() : '';
  // Every passage holds the empty text, so blank keeps them all.
  return rows.filter((s) => String(s?.text ?? '').toLowerCase().includes(needle));
}

/**
 * Where the record lands after Delete (D697): Customer research, for the same
 * venture. An id that is not a positive whole number is left off, so a stray
 * value never reaches the URL.
 */
export function afterDelete(projectId) {
  const id = String(projectId ?? '').trim();
  return /^[1-9][0-9]{0,15}$/.test(id)
    ? `/validate/customer-research?project_id=${id}`
    : '/validate/customer-research';
}

// The record's sections, as #1692's Customer research read names them. A
// section is found by its key, else by its title, so a key the read spells
// differently still finds it; one the read does not send is not drawn.
const SECTIONS = {
  transcript: { keys: ['transcript'], titles: ['transcript'] },
  placements: { keys: ['placements'], titles: ['eadwyn’s placements', "eadwyn's placements", 'placements'] },
  fed: { keys: ['fed', 'what-it-fed', 'what_it_fed'], titles: ['what it fed'] },
  cost: { keys: ['cost'], titles: ['cost'] },
  session: { keys: ['session'], titles: ['session'] },
};
const norm = (v) => String(v ?? '').trim().toLowerCase();
const isSection = (section, name) => SECTIONS[name].keys.includes(norm(section?.key)) || SECTIONS[name].titles.includes(norm(section?.title));

/**
 * What the record draws (D697 decision 14): the sections the read sends, and
 * the record's own parts inside them. The Transcript, Eadwyn's placements,
 * Cost and Session sections are the writer's (D690 decision 2), so a partner's
 * read has none of them, and `sessions` is false: the page then calls no
 * session route. The interview's tools are drawn when the read declares any
 * action, which only a writer's does.
 */
export function recordParts(read) {
  const main = Array.isArray(read?.main) ? read.main : [];
  const side = Array.isArray(read?.side) ? read.side : [];
  const all = [...main, ...side];
  const find = (name) => all.find((s) => isSection(s, name)) || null;
  const actions = Array.isArray(read?.actions) ? read.actions : [];
  const action = (key) => actions.find((a) => a?.key === key) || null;
  const transcript = find('transcript');
  return {
    transcript, placements: find('placements'), fed: find('fed'), cost: find('cost'), session: find('session'),
    kind: (section) => Object.keys(SECTIONS).find((name) => isSection(section, name)) || null,
    sessions: !!transcript,
    tools: actions.length > 0,
    edit: action('edit-details'), remove: action('delete'), recording: action('open-recording'),
  };
}
