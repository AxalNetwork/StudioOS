/**
 * D702 (#1664) — the pure parts of the founder's profile pages, so a test can
 * hold them without a DOM: each page's title and sub (`Studio Mobile
 * Page.dc.html`, SMP:133-161, byte for byte, "Your company’s public facts."
 * with its U+2019), the five-link row, initials, the preview's figure rows,
 * and the visibility options with the effective label.
 *
 * Every value a page draws comes from a Worker read (`lib/api/profile.js`);
 * nothing here decides what an audience may see.
 */
import { EADWYN_MENU, menuHref } from '../founder/EadwynMenu';

export const PROFILE_PAGES = {
  you: { route: '/profile', title: 'You', sub: 'What members read about you.' },
  venture: { route: '/profile/venture', title: 'Your venture', sub: 'Your company’s public facts.' },
  archetype: { route: '/studio/archetype', title: 'Archetype card', sub: 'Read from your conversations with Eadwyn, not a quiz.' },
  preview: { route: '/profile/preview', title: 'What others see', sub: 'Your profile and venture, as each audience reads them.' },
  visibility: { route: '/profile/visibility', title: 'Visibility', sub: 'Changes apply at once.' },
};

/**
 * The drawer's "Your profile" rows (#1663), which the desktop draws as a row
 * of links. The rows that read a venture keep the page's `project_id`, and
 * the rest add none, through the drawer's own `menuHref`.
 */
export const PROFILE_LINKS = EADWYN_MENU.find((g) => g.label === 'Your profile').rows;
export const profileLinks = (search = '') => PROFILE_LINKS.map((r) => ({ title: r.title, route: r.route, href: menuHref(r, search) }));

/** "Sam Example" → "SE"; one word gives one letter; nothing gives "?". */
export function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

export const MASK = '••••';
const MONEY = new Set(['mrr', 'revenue', 'raise']);

/**
 * The preview's Figures rows, as the Worker reported them (`figureRows` in
 * `routes/founder_profile.ts`): a value, "••••" when the only read that serves
 * it masks it, and a served field with no value as Not recorded. A field no
 * read serves is not in the list, so it draws no row; Interviews is never one.
 */
export function figureView(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    if (r.display === 'masked') return { key: r.key, label: r.label, value: MASK, notRecorded: false };
    const n = Number(r.value);
    if (r.value == null || r.value === '' || !Number.isFinite(n)) {
      return r.value == null || r.value === ''
        ? { key: r.key, label: r.label, value: null, notRecorded: true }
        : { key: r.key, label: r.label, value: String(r.value), notRecorded: false };
    }
    return { key: r.key, label: r.label, value: MONEY.has(r.key) ? `$${Math.round(n).toLocaleString('en-US')}` : n.toLocaleString('en-US'), notRecorded: false };
  });
}

/** The three audiences, as `?audience=` names them and as the tabs read. */
export const AUDIENCES = [
  { id: 'investors', label: 'Investors' },
  { id: 'founders', label: 'Founders' },
  { id: 'partners', label: 'Partners' },
];
export const audienceOf = (search) => {
  const a = new URLSearchParams(search || '').get('audience');
  return AUDIENCES.some((x) => x.id === a) ? a : 'investors';
};

/** Whom an address is served to, in words. */
export const SERVED_TO_LABEL = {
  everyone: 'Served to everyone',
  members: 'Served to signed-in members only',
  only_you: 'Served only to you',
  no_one: 'Served to no one',
};

/** The radios, with the canvas's words (SMP:160); the stored words are the Worker's. */
export const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public', sub: 'Anyone with the address' },
  { value: 'network', label: 'Members only', sub: 'Signed-in Axal VC members' },
  { value: 'private', label: 'Hidden', sub: 'Only you' },
];
export const NOT_CHOSEN_LINE = 'You have not chosen yet, so your profile is public.';

/** The label of the visibility the profile is served with (`GET /settings/privacy`'s effective value). */
export function visibilityLabel(value) {
  return VISIBILITY_OPTIONS.find((o) => o.value === value)?.label ?? null;
}

/** Your venture's Edit form: the seven fields `PATCH /api/profile/venture` writes, in the form's order. */
export const VENTURE_FIELDS = [
  { key: 'description', label: 'One line', max: 280 },
  { key: 'sector', label: 'Sector', max: 80 },
  { key: 'problem_statement', label: 'The problem it solves', max: 1000, multiline: true },
  { key: 'founded_year', label: 'Founded', number: true },
  { key: 'hq', label: 'Location', max: 120 },
  { key: 'employee_count', label: 'Team', max: 40 },
  { key: 'website', label: 'Website', max: 300 },
];

/** The form's starting values, from the venture read. */
export function ventureDraft(v) {
  const facts = v?.facts || {};
  return {
    description: v?.card?.description ?? '',
    sector: v?.card?.sector ?? '',
    problem_statement: v?.problem_statement ?? '',
    founded_year: facts.founded_year == null ? '' : String(facts.founded_year),
    hq: facts.hq ?? '',
    employee_count: facts.employee_count ?? '',
    website: facts.website ?? '',
  };
}

/** Only the fields the founder changed, as the Worker takes them: an empty field clears, Founded is a number. */
export function ventureChanges(before, draft) {
  const out = {};
  for (const f of VENTURE_FIELDS) {
    const was = before[f.key] ?? '';
    const now = String(draft[f.key] ?? '').trim();
    if (now === String(was).trim()) continue;
    out[f.key] = now === '' ? null : f.number ? Number(now) : now;
  }
  return out;
}
