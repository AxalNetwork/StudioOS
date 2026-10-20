/**
 * The Network section's second half (D679, #1553): Programs & Events,
 * Communities & Circles, Jobs and a job, from the owner's website canvas
 * (`design/canvases/integrated/Axal VC Website.dc.html`, views PROGRAMS &
 * EVENTS, COMMUNITIES & CIRCLES, JOBS, JOB DETAIL and REGISTRATION GATE).
 *
 * Two kinds of thing live here, and nothing else:
 *   - the owner's copy for those pages, minus every sentence the code cannot
 *     back (each cut is listed in D679's part 2);
 *   - pure helpers that turn a live row into what a row draws: a date in the
 *     event's own zone, a job's initials and place, a description's blocks.
 *
 * No event, circle, job, company or figure is written here. Every list on
 * these pages is the Worker's answer or an empty-state sentence.
 */
import { toUtcInstant } from './notices';

// ---------------------------------------------------------------------------
// The owner's copy
// ---------------------------------------------------------------------------

/**
 * The canvas's lede ends "Everything here is scheduled around the 28-day
 * program cycle." Events are created by members on any date and approved by
 * an admin; nothing schedules them around the cohort, so that sentence is cut.
 */
export const EVENTS_COPY = {
  eyebrow: 'Calendar',
  title: 'Programs & Events',
  lede: 'Cohorts, demo days, LP briefings, and office hours.',
};

export const CIRCLES_COPY = {
  eyebrow: 'Peer groups',
  title: 'Communities & Circles',
  lede: 'Circles are small, closed peer groups that meet on a fixed cadence. Membership is capped so the conversation stays specific — no open channels, no broadcast.',
};

/**
 * The band's last sentence ("Listings reach the full partner network.") is
 * cut: a published role is listed here and nowhere else, and nothing sends it
 * to partners.
 */
export const JOBS_COPY = {
  eyebrow: 'Portfolio hiring',
  title: 'Jobs',
  lede: 'Open roles across Axal VC portfolio companies and the firm itself. Every listing is posted directly by the hiring founder.',
  bandTitle: 'Hiring for a portfolio company?',
  bandCopy: 'Founders in the Lab post roles directly from the Founder workspace.',
};

/**
 * The side card's second sentence ("An Axal VC account is required…") and the
 * lock line ("Requires a free Axal VC account") are cut: the apply route takes
 * an application without an account, and the account comes after it.
 */
export const JOB_COPY = {
  applyTitle: 'Apply for this role',
  applyCopy: 'Applications go directly to the hiring founder.',
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function fmtIn(date, opts, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(date);
  }
}

/**
 * An event's start as a row draws it, in the EVENT'S zone (`events.timezone`):
 * the day and month on the tile, the time with its zone named, and the month
 * the row is filed under. A zone the browser does not know falls back to UTC,
 * still named. Null for a start that does not parse.
 */
export function eventDateParts(iso, timeZone) {
  const norm = toUtcInstant(iso);
  const d = norm ? new Date(norm) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const tz = timeZone || 'UTC';
  const year = fmtIn(d, { year: 'numeric' }, tz);
  const month = fmtIn(d, { month: '2-digit' }, tz);
  return {
    day: fmtIn(d, { day: '2-digit' }, tz),
    mon: fmtIn(d, { month: 'short' }, tz),
    time: fmtIn(d, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }, tz),
    monthKey: `${year}-${month}`,
    monthName: fmtIn(d, { month: 'long', year: 'numeric' }, tz),
  };
}

/** The canvas tints three kinds; every other type takes the quiet chip. */
const EVENT_TONES = { demo_day: 'ax-chip', lp_briefing: 'ax-chip ax-n2-chip-amber', office_hours: 'ax-chip ax-n2-chip-teal' };
export function eventTypeTone(type) {
  return EVENT_TONES[type] || 'ax-chip ax-chip-quiet';
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** The Worker's `EMPLOYMENT_TYPES` and `SENIORITIES` (services/jobBoardCommon.ts), labelled. */
export const EMPLOYMENT_LABELS = {
  full_time: 'Full-time', part_time: 'Part-time', intern: 'Internship', contract: 'Contract', fractional: 'Fractional',
};
export const SENIORITY_LABELS = {
  intern: 'Intern', junior: 'Junior', mid: 'Mid-level', senior: 'Senior', lead: 'Lead', executive: 'Executive',
};

/** The Jobs pills: "All", then one per employment type the Worker accepts. */
export const JOB_TYPE_FILTERS = [
  { value: '', label: 'All' },
  ...Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => ({ value, label })),
];

/** Up to two initials from a company's name, or null. */
export function companyInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const letters = (words.length === 1 ? [words[0][0], words[0][1]] : [words[0][0], words[1][0]]).filter(Boolean);
  return letters.join('').toUpperCase();
}

/**
 * A steady tile colour per company, from the canvas's own avatar palette. It
 * is chosen by the name, so one company keeps one colour on every row.
 */
const AVATAR_TONES = ['#6d28d9', '#334155', '#b45309', '#0f766e', '#141118', '#15803d', '#be185d'];
export function avatarTone(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** Where a role is: "Remote", "Remote · Lisbon", "Lisbon", or null. */
export function jobGeo(job) {
  const place = job?.location_text ? String(job.location_text).trim() : '';
  if (job?.remote) return place ? `Remote · ${place}` : 'Remote';
  return place || null;
}

/** "Aug 1, 2026" from the posting's `created_at` (SQL UTC), or null. */
export function postedLabel(createdAt) {
  const norm = toUtcInstant(createdAt);
  const d = norm ? new Date(norm) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** Whole units of a currency from cents: "$90,000", "€90,000"; an unknown code reads "90,000 XYZ". */
function bandEnd(cents, currency) {
  const code = String(currency || 'usd').toUpperCase();
  const units = Number(cents) / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(units);
  } catch {
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(units)} ${code}`;
  }
}

/**
 * #2181 — the Compensation fact, from the public read's `compensation` only
 * (sent when the role's founder showed the band): "$90,000–$120,000", one end
 * alone as that end, then " · 0.5% equity" when equity is set. Null when the
 * read sent no band, so nothing is drawn.
 */
export function compensationText(comp) {
  if (!comp || typeof comp !== 'object') return null;
  const ends = [comp.min_cents, comp.max_cents].filter((c) => c != null && Number.isFinite(Number(c)));
  if (!ends.length) return null;
  const [lo, hi = lo] = ends.map((c) => bandEnd(c, comp.currency));
  const band = lo === hi ? lo : `${lo}–${hi}`;
  const equity = comp.equity_pct != null && Number.isFinite(Number(comp.equity_pct)) ? ` · ${Number(comp.equity_pct)}% equity` : '';
  return band + equity;
}

/**
 * The facts grid. The canvas draws six (compensation, level, commitment,
 * location, reports to, start); a posting stores four of them, so four is
 * what is drawn, and each only when the row has it. Compensation is drawn
 * only when the public read sends it (#2181).
 */
export function jobFacts(job) {
  return [
    { k: 'Compensation', v: compensationText(job?.compensation) },
    { k: 'Level', v: SENIORITY_LABELS[job?.seniority] || null },
    { k: 'Commitment', v: EMPLOYMENT_LABELS[job?.employment_type] || null },
    { k: 'Location', v: jobGeo(job) },
  ].filter((f) => f.v);
}

/** The side card's rows: the canvas's Company, Function and Posted, plus Level; no Stage. */
export function jobMeta(job) {
  return [
    { k: 'Company', v: job?.startup_name || null },
    { k: 'Function', v: EMPLOYMENT_LABELS[job?.employment_type] || null },
    { k: 'Level', v: SENIORITY_LABELS[job?.seniority] || null },
    { k: 'Posted', v: postedLabel(job?.created_at) },
  ].filter((f) => f.v);
}

/**
 * A posting's free-text description as the canvas's sections: a line that
 * starts with `#` is a heading, a run of lines that start with `-`, `*` or `•`
 * is a list, and everything else is a paragraph that keeps its line breaks.
 * Nothing is dropped and nothing is reworded.
 */
export function descriptionBlocks(text) {
  const out = [];
  const paras = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const bullet = /^[-*•]\s+/;
  for (const para of paras) {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    let run = null;
    const flush = () => { if (run) out.push(run); run = null; };
    for (const line of lines) {
      if (/^#{1,6}\s+/.test(line)) {
        flush();
        out.push({ kind: 'h', text: line.replace(/^#{1,6}\s+/, '') });
      } else if (bullet.test(line)) {
        if (!run || run.kind !== 'list') { flush(); run = { kind: 'list', items: [] }; }
        run.items.push(line.replace(bullet, ''));
      } else {
        if (!run || run.kind !== 'p') { flush(); run = { kind: 'p', text: line }; } else run.text += `\n${line}`;
      }
    }
    flush();
  }
  return out;
}

/** The other published roles at the same company, from a feed page. */
export function otherRoles(list, job) {
  if (!job?.project_id || !Array.isArray(list)) return [];
  return list.filter((r) => r && r.project_id === job.project_id && r.id !== job.id);
}
