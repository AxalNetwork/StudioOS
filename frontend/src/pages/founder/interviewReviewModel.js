// D685 §5.10–§5.11 (#1589) — the rules of the interview review at
// `/validate/interviews/:id`, kept apart from the page so a Node test reads
// them without React: which session opens, what each one is called in the
// switcher, and which passage a summary sentence's citation points at.

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
