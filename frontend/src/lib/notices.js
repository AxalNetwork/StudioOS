/**
 * The compliance ladder's vocabulary, in one place (D138).
 *
 * WHY THIS FILE EXISTS. D136 shipped the ladder's two surfaces on the same day
 * — `pages/admin/AdminLicences.jsx` (HQ issues and reviews) and
 * `pages/subsidiary/MyLicencePage.jsx` (the addressee answers) — and each
 * declared its own copy of what freezes an account and what a notice kind is
 * called. D138 adds a third surface, `pages/hq/HqTeamTable.jsx`, and
 * `frontend/src/lib/README.md` already states the rule that makes a third copy
 * the wrong move: *"If a helper appears in two places, put it here once rather
 * than a third time."* D117 enforced it for the string-level absence helpers;
 * this is the same enforcement one domain over.
 *
 * WHAT DELIBERATELY DID NOT COME, and it is the more useful half of this
 * header. Both pages also declare a `NOTICE_TONE` map, and **they are not the
 * same thing under two names**:
 *
 *   - `AdminLicences.jsx` renders a bordered chip in HQ's console:
 *     `bg-indigo-50 text-indigo-700 border-indigo-200`.
 *   - `MyLicencePage.jsx` renders a dark-mode-aware pill:
 *     `bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300`.
 *
 * The HUE assignment agrees in all six statuses — which is the fact worth
 * sharing — but the class strings are two different visual treatments, and
 * Tailwind cannot build a class name at runtime (the JIT pass scans source for
 * literals, so `bg-${hue}-50` emits nothing). Merging them would therefore mean
 * either changing one page's appearance or shipping classes the build purges.
 * That is D117's `money` lesson verbatim — *two deliberate behaviours under one
 * name* — so it is stated here rather than discovered by whoever tries next.
 * Each surface keeps its own literal map; what is shared is below.
 *
 * `ANSWERABLE` (`issued`/`overdue` — the two statuses `routes/licence.ts`
 * admits a response for) stays in `MyLicencePage.jsx` for the same reason in
 * reverse: it has exactly one caller, and a single-use export is not a
 * consolidation.
 */

/**
 * The two statuses that mean the account cannot write.
 *
 * `FREEZING_STATUSES` in `cloudflare-worker/src/util/authErrors.ts` is the
 * server's definition and the only one that gates anything; this is the SPA's
 * read of the same fact, for presentation. A screen that disagreed with the
 * server would be wrong only on screen — which is still wrong, and is why there
 * is now one copy of it rather than three.
 *
 * `issued` is deliberately absent: a notice inside its window has been
 * delivered and nothing is frozen yet. Rendering that as a freeze is a false
 * alarm; rendering `overdue` as a reminder is the opposite failure, and worse.
 */
export const FREEZING_STATUSES = new Set(['overdue', 'rejected']);

/**
 * Migration 264's `kind` CHECK, in the order HQ's picker offers them, with the
 * labels `KIND_LABELS` in `routes/admin_licences.ts` puts in the addressee's
 * mail — the same words on both sides, so HQ picks the thing the recipient
 * will actually read.
 */
export const NOTICE_KINDS = [
  ['renewal_terms', 'Renewal terms'],
  ['fees', 'Fees'],
  ['term_violation', 'A term of the agreement'],
  ['other', 'Your licence'],
];

export const noticeKindLabel = (k) => NOTICE_KINDS.find(([v]) => v === k)?.[1] || k || 'Not recorded';

/**
 * ONE PRECEDENCE, TWO KEYS. Worst first: frozen outranks waiting-on-HQ outranks
 * waiting-on-them outranks closed, because that is the order in which somebody
 * has to do something.
 *
 * `AdminLicences` sorts NOTICES within one licence, so its key is a notice
 * status. `HqTeamTable` sorts ADMINS by the worst notice standing against each,
 * so its key is the rung `routes/admin_hq.ts` computed — the same four values
 * its `rungOf()` returns, in the same order its `if` chain tests them. Deriving
 * the status ordering FROM the rung ordering is what stops the two screens
 * coming to disagree about which state is the urgent one, and stops this file
 * holding two lists that mean the same thing.
 */
export const RUNGS = ['frozen', 'awaiting_review', 'notified', 'clear'];

/** The rung one notice status puts an account on, by itself. */
export const rungOfStatus = (status) => {
  if (FREEZING_STATUSES.has(status)) return 'frozen';
  if (status === 'responded') return 'awaiting_review';
  if (status === 'issued') return 'notified';
  return 'clear';
};

/** Sort key for a rung. An unknown rung sorts last rather than first. */
export const rungRank = (rung) => {
  const i = RUNGS.indexOf(rung);
  return i < 0 ? RUNGS.length : i;
};

/** Sort key for a notice status — the same ordering, read through its rung. */
export const noticeRank = (status) => rungRank(rungOfStatus(status));

/**
 * TWO STAMP FORMATS REACH THIS, and only one of them used to parse (D136).
 *
 * `territory_licences.renews_on` is a bare `YYYY-MM-DD`, which `Date` parses as
 * UTC midnight by spec. `admin_notices.respond_by` and `froze_at` are SQL
 * `YYYY-MM-DD HH:MM:SS` — written by `datetime('now', '+N days')` and swept
 * against `datetime('now')`, so they are UTC — and that shape is NOT in the
 * spec's grammar: V8 accepts it and reads it as the READER'S LOCAL time, other
 * engines return NaN. Either way "in 6 days" would be wrong by the reader's
 * offset, or blank, on exactly the column a deadline is read from.
 *
 * So the space becomes a `T` and a `Z` is appended, which is what the writer
 * meant. The bare-date form is untouched and keeps parsing as it always did.
 */
export function toUtcInstant(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  // Already carries a zone (`Z` or ±HH:MM) — leave it exactly as it is.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // bare date: UTC midnight by spec
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) return `${s.replace(' ', 'T')}Z`;
  return s;
}

/** Whole days from now until `iso`, negative once it is past. Null if unparseable. */
export function daysTo(iso) {
  const norm = toUtcInstant(iso);
  if (!norm) return null;
  const d = new Date(norm);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / 86400000);
}
