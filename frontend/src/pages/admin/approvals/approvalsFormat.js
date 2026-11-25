/** Number, age and timestamp formatting shared by the Approvals views. */

/** "6 d 2 h", "9 h", "40 min"; null when the age was not read. */
export function ageText(hours) {
  const h = Number(hours);
  if (hours === null || hours === undefined || !Number.isFinite(h) || h < 0) return null;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  const d = Math.floor(h / 24);
  const r = Math.floor(h - d * 24);
  return d ? `${d} d ${r} h` : `${r} h`;
}

const stampMs = (s) => {
  if (!s) return null;
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`).getTime();
  return Number.isNaN(t) ? null : t;
};

export const hoursSince = (s, now = Date.now()) => { const t = stampMs(s); return t === null ? null : Math.max(0, (now - t) / 3_600_000); };

/** "14 Nov 2026"; null when there is no date. */
export function dayText(s) {
  const t = stampMs(s);
  return t === null ? null : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const nf = (n) => Number(n).toLocaleString('en-US');

/* ------------------------------------------------------------------ *
 * The item (APR3) and Assign
 * ------------------------------------------------------------------ */

/** "17 Oct 2026, 09:12" in UTC; null for no stamp. */
export function stampText(s) {
  if (!s) return null;
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`).getTime();
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${day}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
