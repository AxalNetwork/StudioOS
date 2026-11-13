/**
 * The Spin-Out Lab discovery page's derived figures — funnel, four-item
 * readiness and claim counts — as a pure function of what the page reads.
 *
 * MOVED OUT OF THE PAGE FOR D659 (#1472), unchanged. The Validate cycle read
 * (`cloudflare-worker/src/services/cycleValidate.ts`, `labDiscovery`)
 * computes the same three things for a Lab venture's project, and
 * `cloudflare-worker/test/cycle_validate_d659.test.ts` feeds this function and
 * the Worker the same rows and requires the same answer. A change here that
 * the Worker does not make — or the reverse — fails that test.
 */

/** The program gate: week 1 requires three logged interviews. */
export const MIN_INTERVIEWS = 3;

export function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * `interviews` as `/progress/discovery/:pid/interviews` returns them,
 * `signups` as the customer waitlist read returns them, `painData` as
 * `/progress/pain-groups/:pid` returns it (or null when it failed).
 */
export function labDiscoveryCounts({ interviews, signups, painData, minInterviews = MIN_INTERVIEWS }) {
  const ivs = (interviews || []).map((iv) => ({
    ...iv,
    _pains: parseArr(iv.pains ?? iv.pains_json),
    _hyps: parseArr(iv.hypotheses ?? iv.hypotheses_json),
  }));

  let hypTotal = 0;
  let hypValidated = 0;
  let hypInvalidated = 0;
  ivs.forEach((iv) => iv._hyps.forEach((h) => {
    hypTotal += 1;
    if (h.status === 'validated') hypValidated += 1;
    if (h.status === 'invalidated') hypInvalidated += 1;
  }));
  const hypInconclusive = hypTotal - hypValidated - hypInvalidated;

  // Pain ranking — curated groups first, then ungrouped phrases (both
  // real). Zero-count entries (e.g. an empty curated group) never rank:
  // they'd otherwise inflate readiness and the working definition.
  const painRows = [
    ...(painData?.groups || []).map((g) => ({
      title: g.title,
      count: Number(g.count ?? (g.aliases || []).reduce((a, x) => a + Number(x.count || 0), 0)) || 0,
      grouped: true,
      need_count: g.need_count,
      nice_count: g.nice_count,
    })),
    ...(painData?.ungrouped || []).map((u) => ({
      title: u.display_phrase,
      count: Number(u.count) || 0,
      need_count: u.need_count,
      nice_count: u.nice_count,
    })),
  ].filter((p) => p.count > 0).sort((a, b) => b.count - a.count);
  const distinctPains = painRows.length ||
    new Set(ivs.flatMap((iv) => iv._pains.map((p) => String(p).trim().toLowerCase()).filter(Boolean))).size;

  // Funnel — every stage is a concrete, checkable definition.
  const list = signups || [];
  const contacted = list.filter((s) => s.crm_status && s.crm_status !== 'new').length;
  const painConfirmed = ivs.filter((iv) => iv._pains.length > 0).length;
  const solutionFit = ivs.filter((iv) => iv._hyps.some((h) => h.status === 'validated')).length;
  const reached = list.length + ivs.length;
  const funnel = [
    { label: 'Reached', sub: 'Leads + interviews', n: reached },
    { label: 'Engaged', sub: 'Contacted or interviewed', n: contacted + ivs.length },
    { label: 'Pain confirmed', sub: 'Interviews with a logged pain', n: painConfirmed },
    { label: 'Solution-fit', sub: 'A hypothesis validated', n: solutionFit },
  ].map((f) => ({ ...f, pct: reached ? Math.round((f.n / reached) * 100) : 0 }));

  const notesCount = ivs.filter((iv) => (iv.notes || '').trim().length > 0).length;

  const readiness = [
    { label: `Minimum ${minInterviews} interviews logged`, ok: ivs.length >= minInterviews },
    { label: 'Top 3 pain points identified', ok: distinctPains >= 3 },
    { label: 'Notes attached to every interview', ok: ivs.length > 0 && notesCount === ivs.length },
    { label: 'At least one hypothesis validated', ok: hypValidated > 0 },
  ];

  return {
    ivs, hypTotal, hypValidated, hypInvalidated, hypInconclusive,
    painRows, distinctPains, funnel, notesCount, readiness,
  };
}
