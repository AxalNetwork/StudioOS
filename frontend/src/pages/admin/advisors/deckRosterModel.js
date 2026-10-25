/**
 * D980 (#2766) — the Deck roster's words and rules, as pure functions over
 * D974's roster read (`GET /api/admin/network-profiles`). No React here, so
 * `node --test` loads it alone.
 *
 * A row is shown (`is_active`, on the deck), hidden (kept, off the deck) or
 * archived (out of this list and the deck, restorable). The deck reads the
 * shown rows in their order, and that order decides what each one gets.
 */

/** The Worker's three kinds (D229); a stored `mentor` is an Advisor (D975). */
export const KINDS = [
  { key: 'advisor', label: 'Advisor' },
  { key: 'partner', label: 'Partner' },
  { key: 'investor', label: 'Investor' },
];
export const kindOf = (kind) => (kind === 'mentor' ? 'advisor' : kind);
export const kindLabel = (kind) => KINDS.find((k) => k.key === kindOf(kind))?.label || 'Not recorded';

/** The 12-axis catalogue (`networkProfilesSchema.ts` SKILL_CATALOG). */
export const SKILLS = [
  'Legal', 'Finance', 'GTM', 'Sales', 'Marketing', 'Product',
  'Engineering', 'Design', 'Recruiting', 'Technical DD',
  'Operations', 'Fundraising',
];

/**
 * D214's rule (`services/decks/deckRoster.ts`), the same numbers: the first
 * six shown people are drawn on the slide; the next shown people with a
 * name, up to eight names in all, reach the deck's data as names only; the
 * rest are counted in the network total.
 */
export const ON_SLIDE = 6;
export const NAMES = 8;

/** Each shown row's reach, in order, as the Worker labels it. */
export function reachOf(names) {
  let named = 0;
  return names.map((name, i) => {
    const has = Boolean(name);
    if (i < ON_SLIDE) { if (has) named += 1; return 'on_slide'; }
    if (has && named < NAMES) { named += 1; return 'name_only'; }
    return 'counted';
  });
}

export const REACH = {
  on_slide: { label: 'On the slide', tip: 'Drawn on the Team & Network slide with photo, name and role.' },
  name_only: { label: 'Name only', tip: 'Not drawn on the slide; the name reaches the deck’s data and counts in the network total.' },
  counted: { label: 'Counted only', tip: 'Counted in the network total, never named.' },
};

/** The shown rows (in the deck's order) and the hidden ones, from one list read. */
export function splitRoster(profiles) {
  const rows = Array.isArray(profiles) ? profiles : [];
  const order = (a, z) => (Number(a.display_order ?? 0) - Number(z.display_order ?? 0))
    || String(a.name || '').localeCompare(String(z.name || '')) || (Number(a.id) - Number(z.id));
  const shown = rows.filter((p) => p.state ? p.state === 'shown' : Boolean(p.is_active)).sort(order);
  const hidden = rows.filter((p) => (p.state ? p.state === 'hidden' : !p.is_active)).sort(order);
  return { shown: withReach(shown), hidden };
}

/** The shown rows with their reach worked out for the order they are in now. */
export function withReach(shown) {
  const reach = reachOf(shown.map((p) => String(p.name || '')));
  return shown.map((p, i) => ({ ...p, deck_reach: reach[i], position: i + 1 }));
}

/** The order after moving one row by `delta`, or null when it cannot move. */
export function moveRow(shown, id, delta) {
  const from = shown.findIndex((p) => p.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= shown.length) return null;
  const next = [...shown];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return withReach(next);
}

/** The order after dropping one row onto another's place. */
export function dropRow(shown, id, targetId) {
  const from = shown.findIndex((p) => p.id === id);
  const to = shown.findIndex((p) => p.id === targetId);
  if (from < 0 || to < 0 || from === to) return null;
  return moveRow(shown, id, to - from);
}

/** What a screen reader hears after a move. */
export function moveLine(row, total) {
  return `${row.name || 'This person'} moved to position ${row.position} of ${total}. ${REACH[row.deck_reach]?.label || ''}.`.replace(' .', '.');
}

/** The search and the Kind filter, over loaded rows. Reordering waits while either is on. */
export function filterRows(rows, { q = '', kind = '' } = {}) {
  const needle = String(q).trim().toLowerCase();
  return rows.filter((p) => (!kind || kindOf(p.kind) === kind)
    && (!needle || [p.name, p.role, p.company].some((v) => String(v || '').toLowerCase().includes(needle))));
}

/** The four tiles. A failed read is Unreadable, never a zero. */
export function tilesOf(read, shown) {
  if (!read || read.status === 'loading') return [['shown', 'Shown'], ['on_slide', 'On the slide'], ['hidden', 'Hidden'], ['archived', 'Archived']].map(([key, label]) => ({ key, label, kind: 'loading', text: 'Reading…' }));
  const ok = read.status === 'ready' && read.data?.counts;
  const c = read.data?.counts || {};
  const num = (v) => (ok && Number.isFinite(Number(v)) ? { kind: 'value', text: Number(v).toLocaleString('en-US') } : { kind: 'unreadable', text: 'Unreadable' });
  return [
    { key: 'shown', label: 'Shown', ...num(c.shown), sub: 'Everyone shown counts in the network total.' },
    { key: 'on_slide', label: 'On the slide', ...num(ok ? shown.filter((p) => p.deck_reach === 'on_slide').length : null), sub: `The first ${ON_SLIDE} shown, with photo, name and role.` },
    { key: 'hidden', label: 'Hidden', ...num(c.hidden), sub: 'Kept here, left off the deck.' },
    { key: 'archived', label: 'Archived', ...num(c.archived), sub: 'Out of this list and the deck; restorable.' },
  ];
}

export function initialsOf(name) {
  const words = (String(name || '').trim() || '?').split(/\s+/);
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

/** The slide's role line (`deckAdvisorRole`): their own, or "Advisor". */
export function slideRole(role) {
  const r = String(role || '').trim();
  return r && r !== '—' ? r : 'Advisor';
}

/** The slide preview: the six drawn, and how many more are counted. */
export function previewOf(shown) {
  const drawn = shown.slice(0, ON_SLIDE).map((p) => ({ id: p.id, name: p.name || '—', role: slideRole(p.role), initials: initialsOf(p.name), photo: p.photo_url || null }));
  const more = Math.max(0, shown.length - ON_SLIDE);
  return {
    drawn, more, total: shown.length,
    line: shown.length ? `${more ? `+ ${more} more counted · ` : ''}${shown.length} in the network total` : 'No one is shown, so the slide draws no advisor block.',
    alt: shown.length
      ? `Slide preview: ${drawn.length} ${drawn.length === 1 ? 'person' : 'people'} drawn with photo, name and role${more ? `; ${more} more counted in the network total` : ''}.`
      : 'Slide preview: no advisor block.',
  };
}

// ── the card dialog (AP8) ─────────────────────────────────────────────────

export const EMPTY_CARD = {
  name: '', kind: 'advisor', role: '', company: '', bio: '', linkedin_url: '', skills: [], is_active: true, linked_user: null,
};

/** The editor's form for a row, or a new one. */
export function cardOf(row) {
  if (!row?.id) return { ...EMPTY_CARD, skills: [] };
  return {
    name: row.name || '', kind: kindOf(row.kind || 'advisor'), role: row.role || '', company: row.company || '',
    bio: row.bio || '', linkedin_url: row.linkedin_url || '', skills: Array.isArray(row.skills) ? [...row.skills] : [],
    is_active: row.state ? row.state === 'shown' : Boolean(row.is_active), linked_user: row.linked_user || null,
  };
}

/** The Worker keeps a URL only when it matches this, and drops anything else silently, so the dialog says so first. */
const URL_RE = /^https?:\/\/[^\s]{4,500}$/i;
export const MAX_BIO = 2000;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Inline errors, by field. An empty object means it can be saved. */
export function cardErrors(form) {
  const e = {};
  if (!String(form.name || '').trim()) e.name = 'A name is required.';
  else if (String(form.name).length > 200) e.name = 'Keep the name to 200 characters.';
  const url = String(form.linkedin_url || '').trim();
  if (url && !URL_RE.test(url)) e.linkedin_url = 'Use a full LinkedIn address, starting https://';
  if (String(form.bio || '').length > MAX_BIO) e.bio = `Keep the bio to ${MAX_BIO.toLocaleString('en-US')} characters.`;
  return e;
}

/** Why a photo cannot be used, or null. */
export function photoError(file) {
  if (!file) return null;
  if (!PHOTO_TYPES.includes(file.type)) return 'Use a JPG, PNG or WebP photo.';
  if (file.size > MAX_PHOTO_BYTES) return 'The photo is over 2 MB.';
  return null;
}

/** What one Save sends. The member link is sent only by the dialog, which always carries it. */
export function cardPayload(form) {
  return {
    name: String(form.name || '').trim(),
    kind: kindOf(form.kind),
    role: form.role || null,
    company: form.company || null,
    bio: form.bio || null,
    linkedin_url: String(form.linkedin_url || '').trim() || null,
    skills: form.skills || [],
    is_active: !!form.is_active,
    ...(form.linked_user !== undefined ? { linked_user_id: form.linked_user?.id ?? null } : {}),
  };
}

/** A member account as the link field lists it. Inactive accounts cannot be linked (D974). */
export function memberOptions(users, taken = []) {
  const rows = Array.isArray(users) ? users : Array.isArray(users?.users) ? users.users : [];
  return rows.filter((u) => u && u.is_active !== false && u.is_active !== 0)
    .map((u) => ({ id: Number(u.id), name: u.name || 'Name not recorded', role: u.role ? String(u.role).replace(/_/g, ' ') : 'Role not recorded', taken: taken.includes(Number(u.id)) }));
}

// ── the confirmations (AP9a, AP9b) ────────────────────────────────────────

/** Each act's dialog: what it says it changes, and its button. */
export function confirmCopy(act, row) {
  const who = row?.name || 'This person';
  return {
    hide: { title: `Hide ${who} from the Demo Day deck?`, body: 'The next deck built leaves them out. Their card stays here under Hidden.', button: 'Hide', busy: 'Hiding…', done: `${who} is hidden from the deck.` },
    show: { title: `Show ${who} on the Demo Day deck?`, body: 'The next deck built includes them, in their saved place in the order. Move them afterwards if they belong elsewhere.', button: 'Show', busy: 'Showing…', done: `${who} is shown on the deck.` },
    archive: { title: `Archive ${who}?`, body: 'They leave this list and the deck. The record and photo are kept, and you can restore them from Archived.', button: 'Archive', busy: 'Archiving…', done: `${who} is archived.` },
    restore: { title: `Restore ${who}?`, body: 'They come back under Hidden, not on the deck. Showing them on the deck is a separate step.', button: 'Restore', busy: 'Restoring…', done: `${who} is restored, under Hidden.` },
  }[act];
}

/** A refusal in words. The Worker's 409s say why an act cannot run. */
export function refusalOf(e) {
  const code = e?.code || e?.data?.error;
  if (code === 'invalid_linked_user') return 'That account cannot be linked: only an active member account can.';
  if (e?.status === 409) return e?.data?.message || e?.message || 'This profile changed state elsewhere. Refresh and try again.';
  return e?.message || 'It could not be saved. Try again.';
}
