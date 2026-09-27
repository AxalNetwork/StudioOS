/**
 * The pure parts of the Messages page (D414): which chip a thread answers to,
 * what search reads, and how bubbles group. Kept out of MessagesPage.jsx so a
 * test can run them rather than read them.
 */

/** The label each subject type reads as, on chips and in search. */
export const SUBJECT_LABEL = {
  introduction: 'Introduction',
  match: 'Co-founder match',
  job: 'Role search',
  engagement: 'Engagement',
  service: 'Service',
  session: 'Advisory',
};

// The canvas's seven filter chips, and which subject types each one answers
// to. `engagement` and `service` are both engagements; `session` is advisory.
export const FILTERS = [
  { k: 'All', types: null },
  { k: 'Unread', types: null },
  { k: 'Introductions', types: ['introduction'] },
  { k: 'Co-founder', types: ['match'] },
  { k: 'Hiring', types: ['job'] },
  { k: 'Engagements', types: ['engagement', 'service'] },
  { k: 'Advisory', types: ['session'] },
];

/** What the other person is called here — never an address, never a guess. */
export const nameOf = (p) => p?.name || null;
export const initialsOf = (p) => {
  const src = p?.name || p?.handle || '';
  return src.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '·';
};
export const roleLine = (p) => p?.headline || (p?.role ? p.role.charAt(0).toUpperCase() + p.role.slice(1) : '');
export const money = (cents) => `$${Math.round(Number(cents) / 100).toLocaleString()}`;

export function dayKey(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toDateString();
}
export function dayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  if ((today - d) / 86400000 < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export const timeOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};
export function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === new Date().toDateString()) return timeOf(iso);
  return dayLabel(iso);
}

/**
 * Messages grouped the canvas's way: a day separator where the day changes;
 * within a run from one sender, the name on the first, the avatar and the
 * time on the last.
 */
export function groupMessages(messages, meId) {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const mine = m.sender_user_id === meId;
    const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
    const nextNewDay = !next || dayKey(next.created_at) !== dayKey(m.created_at);
    const firstOfRun = newDay || prev.sender_user_id !== m.sender_user_id;
    const lastOfRun = nextNewDay || next.sender_user_id !== m.sender_user_id;
    return {
      ...m, mine,
      day: newDay ? dayLabel(m.created_at) : '',
      showName: !mine && firstOfRun,
      showAvatar: !mine && lastOfRun,
      showTime: lastOfRun,
    };
  });
}

/** Does a thread answer to the chip and the search box? */
export function threadMatches(t, filter, query) {
  const f = FILTERS.find((x) => x.k === filter);
  if (filter === 'Unread' && !(t.unread > 0)) return false;
  if (f?.types && !f.types.includes(t.subject_type)) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    ...(t.participants || []).flatMap((p) => [p.name, p.handle, p.headline]),
    t.subject, SUBJECT_LABEL[t.subject_type], t.preview,
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}


/**
 * D415 — what the composer's file picker offers, and the size the Worker
 * accepts. The Worker is the rule (routes/messages.ts sniffs the bytes and
 * counts the size); these only stop the page offering what it would refuse.
 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx';

/** A byte count as a person reads it. */
export function fileSize(n) {
  const b = Number(n);
  if (!Number.isFinite(b) || b < 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
