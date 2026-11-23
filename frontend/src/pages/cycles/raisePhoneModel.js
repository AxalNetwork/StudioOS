/**
 * D6047 (#6047, Raise V2 build 3/5) — the pure rules of Raise's phone root, drawn to
 * `design/incoming/Raise v2 Page.dc.html` board RA-11 (RA11a) with the states it shares with
 * desktop (RA-03, RA-04, RA-06, RA-08). No React and no fetch: it reads the same overview the
 * desktop page reads (`GET /api/cycles/raise/overview`) and reuses `raiseOverviewModel.js`'s
 * builders, so both widths offer the same primary action, the same next steps and the same sources.
 *
 * What the read does not serve yet is drawn as #5129's Not recorded, never invented:
 *   - next actions beyond readiness (follow-ups due, unanswered objections), #8256;
 *   - per-area readiness status (needs attention, stale), #8257;
 *   - whether a connected source is fresh or stale, #8258.
 */
import { safeHref } from './cycleModel.js';
import { MATERIALS, journeyMark } from './raiseOverviewModel.js';

/**
 * A read the RA-11 root draws: one that carries D6045's `stage` or `primary_action`, which every
 * Raise overview on main sends (founder and staff alike). A read without either predates D6045 and
 * keeps D703's focus root, as `PhoneCycleRoot.jsx` draws every cycle.
 */
export function isRaiseV2Read(raw) {
  return !!raw && typeof raw === 'object' && (Object.hasOwn(raw, 'stage') || Object.hasOwn(raw, 'primary_action'));
}

/** The words a journey mark reads as on a module row. */
const MARK_WORDS = { recorded: 'Has records', started: 'Started' };

/**
 * RA-11's module status list: the Worker's index rows (`phoneIndex`), with the Pitch row saying the
 * deck's state (RA-05) where the read carries it. With no index (a staff read, which is sent no
 * focus, meter or index), one row per module card from what its card says: Has records, Started,
 * Not recorded (nothing in it) or Unreadable (its card could not be read), never a guess.
 */
export function raisePhoneRows(raw, rows, search = '') {
  const cards = Array.isArray(raw?.cards) ? raw.cards.filter((c) => c && c.slug) : [];
  const cardOf = (slug) => cards.find((c) => c.slug === slug) || null;
  const pitchRow = (r) => {
    const p = cardOf('pitch-deck')?.pitch_state;
    if (p?.state === 'unreadable') return { ...r, detail: 'Deck state', value: 'Unreadable' };
    if (p?.state === 'ok' && typeof p.label === 'string' && p.label) return { ...r, detail: p.label, value: '' };
    return r;
  };
  if (Array.isArray(raw?.index)) return rows.map((r) => (r.key === 'pitch-deck' ? pitchRow(r) : r));
  const order = ['fundraising-readiness', ...MATERIALS, 'capital-relationships'];
  const known = cards.filter((c) => /^[a-z0-9-]+$/.test(c.slug))
    .sort((a, b) => (order.indexOf(a.slug) + 1 || 99) - (order.indexOf(b.slug) + 1 || 99));
  return known.map((c) => {
    const mark = journeyMark(c);
    const href = c.slug === 'pitch-deck' ? `/raise/pitch${search}` : `/raise/${c.slug}${search}`;
    const row = { key: c.slug, title: c.name || c.slug, href: safeHref(href) };
    if (mark === 'unavailable') return { ...row, detail: '', value: 'Unreadable' };
    if (mark === 'empty') return { ...row, detail: 'Nothing recorded yet', value: null };
    return c.slug === 'pitch-deck' ? pitchRow({ ...row, detail: MARK_WORDS[mark], value: '' }) : { ...row, detail: MARK_WORDS[mark] || '', value: '' };
  });
}

/**
 * RA-06's phone line: the connected sources by name, each with its last read; the ones that could
 * not be read named apart. Built over `sourcesView` (`state` none, unavailable or ready).
 */
export function sourcesLine(view) {
  if (!view || view.state !== 'ready') return null;
  return {
    connected: view.rows.filter((r) => r.state === 'connected'),
    unreadable: view.rows.filter((r) => r.state === 'unreadable'),
    notConnected: view.rows.filter((r) => r.state === 'not_connected').length,
  };
}
