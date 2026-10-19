/**
 * D753 decision 7 — the one "Verified" mark, for a connector card and its
 * page header. A connector is verified when a live connect on production
 * passed, and the registry records the day in `verified_on`. With no
 * recorded date the badge draws nothing: a claim with no record is not shown.
 *
 * The scalloped outline and the check are lucide's `badge-check` (alias
 * `verified`, ISC), inlined so the `<title>` sits inside the `<svg>`.
 */
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "12 October 2026" for a real `YYYY-MM-DD` day, else null. */
export function verifiedDay(on) {
  const m = DATE.exec(String(on ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${d} ${MONTHS[mo - 1]} ${y}`;
}

export default function VerifiedBadge({ on, size = 14, className = '' }) {
  const day = verifiedDay(on);
  if (!day) return null;
  return (
    <svg role="img" aria-label="Verified" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 text-axal-violet dark:text-violet-300 ${className}`.trim()}>
      <title>{`Verified: a live connect on production passed on ${day}.`}</title>
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
      <path d="m16 9-5.5 5.5L8 12" />
    </svg>
  );
}
