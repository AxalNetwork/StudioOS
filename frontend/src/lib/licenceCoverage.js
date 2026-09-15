/**
 * The 27 EU member states, and what the licence ledger says about each (D110).
 *
 * WHY THIS IS A LIST OF CODES AND `lib/countries.js` IS NOT. That file holds
 * 196 DISPLAY NAMES, and says so: they are what `users.country` and the KYC
 * record store, and introducing codes there would be a migration rather than a
 * list change. Territories are different — `licence_territories.country_code`
 * is ISO 3166-1 alpha-2 and UNIQUE across every licence (migration 187), which
 * is what makes exclusivity enforceable. The two lists answer different
 * questions and merging them would make one of them wrong.
 *
 * WHY 27 AND NOT "the countries someone holds". The canvas draws coverage as
 * the whole EU with the white space visible, because the white space is the
 * point: H2 exists to show what is still available, and a grid built from the
 * held rows can only ever show what is taken.
 *
 * THIS IS A MEMBERSHIP LIST, NOT A MARKET LIST. It is the EU as of 2020 (post
 * Brexit): 27 states, no UK, no candidate countries, no EEA. A licence may
 * well be issued over a non-EU country — the ledger allows any code — and such
 * a country simply does not appear on this grid, which is correct rather than
 * a gap: the grid is titled EU coverage.
 */

/** ISO 3166-1 alpha-2 → English short name, in alphabetical order by name. */
export const EU_27 = Object.freeze({
  AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', HR: 'Croatia', CY: 'Cyprus',
  CZ: 'Czechia', DK: 'Denmark', EE: 'Estonia', FI: 'Finland', FR: 'France',
  DE: 'Germany', GR: 'Greece', HU: 'Hungary', IE: 'Ireland', IT: 'Italy',
  LV: 'Latvia', LT: 'Lithuania', LU: 'Luxembourg', MT: 'Malta', NL: 'Netherlands',
  PL: 'Poland', PT: 'Portugal', RO: 'Romania', SK: 'Slovakia', SI: 'Slovenia',
  ES: 'Spain', SE: 'Sweden',
});

export const EU_CODES = Object.freeze(Object.keys(EU_27).sort());

/**
 * One cell per EU country: who holds it, and in what state.
 *
 * THREE STATES, AND THE MIDDLE ONE IS THE WHOLE POINT. A SUSPENDED LICENCE
 * STILL HOLDS ITS TERRITORY — releasing it is a termination, not a suspension,
 * and `AdminLicences.jsx` already says the intuition runs the other way. A
 * grid that painted a suspended holder's countries as free would invite
 * exactly the double-issue the ledger's UNIQUE index exists to prevent.
 *
 * A TERMINATED LICENCE HOLDS NOTHING, which is why it is excluded rather than
 * shown in a fourth colour: its countries are genuinely available.
 */
export function coverageCells(licences) {
  const held = new Map();
  for (const l of licences || []) {
    if (!l || l.status === 'terminated') continue;
    for (const raw of l.territories || []) {
      const code = String(raw || '').trim().toUpperCase();
      if (!code) continue;
      // First writer wins, and there can only BE one: `country_code` is unique
      // across the whole table. If two licences ever claim one country the
      // ledger is already broken, and silently showing the second would hide
      // it — so the cell keeps the first and `conflicts` reports the rest.
      if (!held.has(code)) held.set(code, l);
      else held.get(code).__conflict = true;
    }
  }

  const cells = EU_CODES.map((code) => {
    const l = held.get(code);
    if (!l) return { code, name: EU_27[code], state: 'free', licence: null };
    return {
      code,
      name: EU_27[code],
      state: l.status === 'suspended' ? 'held_suspended' : 'held_active',
      licence: { uid: l.uid, licence_ref: l.licence_ref, brand_name: l.brand_name, status: l.status },
    };
  });

  return {
    cells,
    held_active: cells.filter((c) => c.state === 'held_active').length,
    held_suspended: cells.filter((c) => c.state === 'held_suspended').length,
    free: cells.filter((c) => c.state === 'free').length,
    // Countries a licence holds that are NOT in the EU. Reported rather than
    // dropped: a grid titled "EU coverage" that silently omitted a licence's
    // Swiss territory would make the ledger look smaller than it is.
    outside_eu: [...new Set(
      (licences || [])
        .filter((l) => l && l.status !== 'terminated')
        .flatMap((l) => (l.territories || []).map((t) => String(t || '').trim().toUpperCase()))
        .filter((c) => c && !EU_27[c]),
    )].sort(),
  };
}

/**
 * The renewal pipeline: every licence with a renewal date, soonest first.
 *
 * `days` IS DERIVED ON READ from a date the caller passes, never stored — the
 * same rule the escalation SLA band follows (D108). A number of days baked in
 * at render time is wrong tomorrow.
 *
 * A DATE IN THE PAST IS NOT DROPPED. An overdue renewal is the single most
 * important row on this zone, and hiding it because it sorted below zero is
 * how a lapsed licence goes unnoticed; `days` simply goes negative and the
 * caller renders it as overdue.
 */
export function renewalPipeline(licences, today = new Date()) {
  const midnight = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  return (licences || [])
    .filter((l) => l && l.renews_on && l.status !== 'terminated')
    .map((l) => {
      const at = Date.parse(`${String(l.renews_on).slice(0, 10)}T00:00:00Z`);
      return {
        uid: l.uid,
        licence_ref: l.licence_ref,
        brand_name: l.brand_name,
        status: l.status,
        renews_on: String(l.renews_on).slice(0, 10),
        // Integer days, so a renewal today reads 0 rather than a fraction.
        days: Number.isFinite(at) ? Math.round((at - midnight) / 86400000) : null,
        annual_fee_cents: l.annual_fee_cents ?? null,
        currency: l.currency ?? null,
      };
    })
    .sort((a, b) => String(a.renews_on).localeCompare(String(b.renews_on)));
}
