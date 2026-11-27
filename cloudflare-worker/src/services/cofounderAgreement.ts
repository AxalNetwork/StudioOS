/* ============================================================================
 *  Co-Founder Agreement — document generation.
 *
 *  WHY THIS FILE EXISTS. `POST /api/legal/cofounder-agreement` existed ONLY in
 *  `backend/app/api/routes/legal.py`, the Replit-dev FastAPI service that
 *  CLAUDE.md is explicit is never deployed. So on production axal.vc the
 *  endpoint 404'd for every caller, and the Co-Founder Agreement tool's entire
 *  namesake action — on BOTH `/spinout-lab/cofounder-agreement` and the general
 *  `/incorporate/cofounder-agreement` page, which post the same payload — did
 *  nothing. The Lab page even has a dedicated `envUnavailable` banner for the
 *  404, so the failure was visible and handled; it was just never fixed.
 *
 *  This is a faithful port of that handler's document assembly. The template
 *  body below is copied verbatim from the FastAPI TEMPLATES map so a document
 *  generated on production is byte-identical to one generated in dev.
 *
 *  WHY NOT THE EXISTING TEMPLATE SYSTEM. `POST /legal/templates/:key/generate`
 *  looks like the natural home, and it is a trap: D1 already carries an ACTIVE
 *  `cofounder_agreement` row in `legal_templates` (seeded by migration 085,
 *  refreshed by 105 and 113) whose merge vocabulary is a completely different,
 *  two-party `{{dotted.path}}` shape — `{{founder.legal_name}}`,
 *  `{{cofounder.equity_pct}}` — with no vesting, IP-exclusion, decision-rights
 *  or acceleration fields at all. `getActiveTemplateBody()` prefers that stored
 *  body over any inline one, and `applyMergeFields` leaves unresolved tokens as
 *  literals, so routing this payload through that path would handhand a founder a
 *  legal document reading `{{founder.legal_name}}` with none of the terms they
 *  just filled in. The template here is deliberately a local constant and this
 *  module never consults the D1 template store.
 *
 *  PYTHON→JS SEMANTIC TRAPS, all load-bearing (see the tests, which pin each):
 *   - `x or [default]` catches an EMPTY LIST in Python; `[] || d` does not in
 *     JS. The unanimous-matters list must be checked with `.length`, or a
 *     founder who clears the list ships "§4.2 …require unanimous consent:"
 *     followed by nothing.
 *   - `x or "default"` catches `''`; `??` does not. The Lab page sends
 *     `deadlock_clause` untrimmed, so `''` is a real input. String fallbacks
 *     use `||`.
 *   - The inverse for NUMBERS: `Number(x) || 4` turns a deliberate 0 into 4.
 *     The frontend carries a comment about this exact bug turning "a
 *     user-visible 0-year vest into a contractual 4-year vest". Numeric
 *     defaults use `??`, so an explicit 0 survives into the contract.
 * -------------------------------------------------------------------------- */

/** One founder as the two client pages send them. */
export type CofounderInput = {
  name: string;
  email?: string | null;
  role?: string | null;
  equity_pct?: number | null;
  start_date?: string | null;
};

export type CofounderAgreementValue = {
  project_id: number;
  company_name: string;
  effective_date: string;
  founders: CofounderInput[];
  vesting_years: number;
  cliff_months: number;
  cliff_pct: number;
  acceleration: string;
  ip_exclusions: string | null;
  decision_day_to_day: string;
  decision_threshold: string;
  unanimous_matters: string[];
  deadlock_clause: string | null;
  commitment_level: string;
  confidentiality_years: number;
  governing_law: string;
  arbitration_venue: string;
  roles: string | null;
};

/** Equity may total slightly over 100 through float noise; FastAPI's epsilon. */
export const EQUITY_EPSILON = 100.001;

/** Applied when the caller sends no unanimous-consent matters at all. */
export const DEFAULT_UNANIMOUS_MATTERS = [
  'Sale or merger of the Company',
  'Issuance of new equity above 10% dilution',
  'Removal of a founder',
  'Material change to this Agreement',
];

const ACCELERATION_TEXT: Record<string, string> = {
  none: 'No acceleration on Change of Control.',
  single_trigger: 'Single-trigger — 100% of unvested equity accelerates on Change of Control.',
  double_trigger:
    'Double-trigger — unvested equity accelerates only if the founder is terminated without cause '
    + 'within 12 months of a Change of Control.',
};

const str = (v: unknown): string => (v == null ? '' : String(v));
const trimmed = (v: unknown): string => str(v).trim();

/**
 * Numeric field with a default. Uses `??`, NOT `||`, so a deliberate 0
 * survives — see the header note on the 0-year-vest bug.
 */
const numOr = (v: unknown, fallback: number): number => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export type ValidationResult =
  | { ok: true; value: CofounderAgreementValue }
  | { ok: false; error: string };

/**
 * Validate a request body, in FastAPI's order (company name, then founder
 * count, then equity total) so the same bad payload produces the same first
 * error message it did in dev. Project existence/ownership is the route's job,
 * checked after these — again matching the original.
 */
export function validateCofounderAgreement(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'A request body is required' };
  }
  const b = raw as Record<string, unknown>;

  const companyName = trimmed(b.company_name);
  if (!companyName) return { ok: false, error: 'company_name is required' };

  const rawFounders = Array.isArray(b.founders) ? b.founders : [];
  if (rawFounders.length < 2) return { ok: false, error: 'At least two founders are required' };

  const founders: CofounderInput[] = [];
  for (const f of rawFounders) {
    if (!f || typeof f !== 'object') return { ok: false, error: 'Each founder must be an object' };
    const fr = f as Record<string, unknown>;
    const name = trimmed(fr.name);
    if (!name) return { ok: false, error: 'Every founder needs a name' };
    founders.push({
      name,
      email: trimmed(fr.email) || null,
      role: trimmed(fr.role) || null,
      equity_pct: numOr(fr.equity_pct, 0),
      start_date: trimmed(fr.start_date) || null,
    });
  }

  const totalEquity = founders.reduce((s, f) => s + (Number(f.equity_pct) || 0), 0);
  if (totalEquity > EQUITY_EPSILON) {
    return { ok: false, error: `Equity totals ${totalEquity.toFixed(2)}% — must be ≤ 100` };
  }

  const projectId = Number(b.project_id);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return { ok: false, error: 'project_id is required' };
  }

  // An empty ARRAY means "the founder cleared the list", which Python's `or`
  // would silently replace with the defaults. Only a genuinely absent /
  // non-array value falls back.
  const rawUnanimous = b.unanimous_matters;
  const unanimous = Array.isArray(rawUnanimous)
    ? rawUnanimous.map(trimmed).filter(Boolean)
    : DEFAULT_UNANIMOUS_MATTERS;

  return {
    ok: true,
    value: {
      project_id: projectId,
      company_name: companyName,
      // FastAPI: `body.effective_date or utcnow().date().isoformat()`.
      effective_date: trimmed(b.effective_date) || new Date().toISOString().slice(0, 10),
      founders,
      vesting_years: numOr(b.vesting_years, 4),
      cliff_months: numOr(b.cliff_months, 12),
      cliff_pct: numOr(b.cliff_pct, 25),
      acceleration: trimmed(b.acceleration) || 'single_trigger',
      // String fallbacks use `||` so an empty string is caught, as in Python.
      ip_exclusions: trimmed(b.ip_exclusions) || null,
      decision_day_to_day: trimmed(b.decision_day_to_day) || 'the CEO',
      decision_threshold: trimmed(b.decision_threshold) || 'majority',
      unanimous_matters: unanimous.length ? unanimous : DEFAULT_UNANIMOUS_MATTERS,
      deadlock_clause: trimmed(b.deadlock_clause) || null,
      commitment_level: trimmed(b.commitment_level) || 'full-time',
      // Genuinely absent from the /incorporate page's payload — the default
      // has to work, not just be decorative.
      confidentiality_years: numOr(b.confidentiality_years, 3),
      governing_law: trimmed(b.governing_law) || 'Delaware, USA',
      arbitration_venue: trimmed(b.arbitration_venue) || 'Wilmington, Delaware',
      roles: trimmed(b.roles) || null,
    },
  };
}

/**
 * Build the `{token}` fill map. Block indentation (2 spaces for founders, 3 for
 * equity/roles, 7 for the unanimous bullets) is the document's visual
 * structure — it is copied from the original deliberately, not incidentally.
 */
export function buildFill(v: CofounderAgreementValue): Record<string, string> {
  const founderLines: string[] = [];
  const equityLines: string[] = [];
  const roleLines: string[] = [];
  const sigLines: string[] = [];

  v.founders.forEach((f, i) => {
    const letter = String.fromCharCode(65 + i); // A, B, C…
    founderLines.push(
      `  (${letter}) ${f.name}`
      + (f.email ? ` <${f.email}>` : '')
      + (f.role ? `, ${f.role}` : ''),
    );
    equityLines.push(
      `   ${letter}. ${f.name}: ${(Number(f.equity_pct) || 0).toFixed(2)}%`
      + (f.start_date ? ` (start: ${f.start_date})` : ''),
    );
    roleLines.push(`   ${letter}. ${f.name} — ${f.role || 'TBD'}`);
    sigLines.push(`  ____________________     ${f.name}\n  Date: ____________________\n`);
  });

  return {
    company_name: v.company_name,
    effective_date: v.effective_date,
    founders_block: founderLines.join('\n'),
    equity_block: equityLines.join('\n'),
    vesting_years: String(v.vesting_years),
    cliff_months: String(v.cliff_months),
    cliff_pct: String(v.cliff_pct),
    // An unrecognised acceleration mode falls through to its own raw value
    // rather than being dropped, exactly as the original's dict .get() did.
    acceleration_clause: ACCELERATION_TEXT[v.acceleration] || v.acceleration,
    ip_exclusions: v.ip_exclusions || 'None.',
    decision_day_to_day: v.decision_day_to_day,
    decision_threshold: v.decision_threshold,
    unanimous_block: v.unanimous_matters.map((m) => `       - ${m}`).join('\n'),
    deadlock_clause: v.deadlock_clause || 'Mediation followed by binding arbitration.',
    roles_block: v.roles || roleLines.join('\n'),
    commitment_level: v.commitment_level,
    confidentiality_years: String(v.confidentiality_years),
    governing_law: v.governing_law,
    arbitration_venue: v.arbitration_venue,
    signature_block: sigLines.join('\n'),
  };
}

/**
 * Substitute every `{token}` in ONE pass.
 *
 * The original looped the fill map calling str.replace per key, which is
 * order-dependent: a value containing a literal `{company_name}` would or would
 * not be re-substituted depending on which key was processed first. A single
 * regex pass is deterministic and cannot re-scan injected text — a founder
 * whose name contains braces gets it printed, not interpreted. Unknown tokens
 * are left verbatim rather than blanked, so a template edit that outruns this
 * map fails visibly instead of silently dropping a clause.
 *
 * `{decision_threshold}` appears TWICE in the template (§4.3 and §7.4); a
 * non-global replace would have filled only the first.
 */
export function renderCofounderAgreement(v: CofounderAgreementValue): string {
  const fill = buildFill(v);
  return COFOUNDER_AGREEMENT_TEMPLATE.replace(
    /\{([a-z_]+)\}/g,
    (match, key: string) => (Object.prototype.hasOwnProperty.call(fill, key) ? fill[key] : match),
  );
}

/** Total equity, rounded for the response summary. */
export const totalEquityPct = (founders: CofounderInput[]): number =>
  Math.round(founders.reduce((s, f) => s + (Number(f.equity_pct) || 0), 0) * 100) / 100;

/**
 * Copied VERBATIM from backend/app/api/routes/legal.py's TEMPLATES map so a
 * production document matches a dev one byte for byte. Do not reformat.
 */
export const COFOUNDER_AGREEMENT_TEMPLATE = `CO-FOUNDER AGREEMENT

This Co-Founder Agreement (the "Agreement") is entered into as of {effective_date} by
and between the founders of {company_name} (the "Company"):

{founders_block}

1. EQUITY SPLIT
   The founders agree to the following initial equity allocation, subject to the
   vesting schedule below:

{equity_block}

2. VESTING SCHEDULE
   2.1 Vesting Period: {vesting_years} years from each founder's start date.
   2.2 Cliff: {cliff_months} months — no equity vests before the cliff date; on the
       cliff date, {cliff_pct}% of the founder's grant vests in a single tranche.
   2.3 Monthly Vesting: The remainder vests in equal monthly installments over the
       remaining vesting period.
   2.4 Acceleration: {acceleration_clause}

3. INTELLECTUAL PROPERTY ASSIGNMENT
   3.1 Each founder hereby assigns to the Company all right, title, and interest in
       any work product, inventions, code, designs, trademarks, copyrights, trade
       secrets, and other intellectual property (collectively, "IP") created by the
       founder (a) prior to the date of this Agreement that is related to the
       Company's business, or (b) during the founder's involvement with the Company.
   3.2 Each founder represents that no third party (employer, university, prior
       company, government grant) holds claims to such IP, and will execute the
       Company's standard Proprietary Information & Inventions Assignment (PIIA)
       upon request.
   3.3 Pre-existing IP exclusions: {ip_exclusions}

4. DECISION RIGHTS & GOVERNANCE
   4.1 Day-to-day operating decisions are made by {decision_day_to_day}.
   4.2 The following matters require unanimous founder consent:
{unanimous_block}
   4.3 All other strategic matters require a {decision_threshold} vote of the
       founders.
   4.4 Deadlock resolution: {deadlock_clause}

5. ROLES & RESPONSIBILITIES
{roles_block}

6. COMMITMENT
   6.1 Each founder agrees to devote {commitment_level} working time and best
       efforts to the Company.
   6.2 Outside activities (board seats, advisory roles, side projects) must be
       disclosed in writing to the other founders and approved by majority vote.

7. DEPARTURE, BUYOUT & EXIT
   7.1 Voluntary Departure: A departing founder forfeits all unvested equity. The
       Company has a right of first refusal on the founder's vested shares,
       exercisable within 90 days of departure at fair market value.
   7.2 Termination for Cause: A founder terminated for cause (fraud, breach of
       fiduciary duty, conviction of a felony, material breach of this Agreement)
       forfeits both vested and unvested equity, subject to a payment of par
       value for vested shares.
   7.3 Termination without Cause / Good Reason: The departing founder retains
       vested equity. Acceleration per Section 2.4 may apply.
   7.4 Buyout Right: Upon a Change of Control, all unvested equity accelerates per
       Section 2.4. Pre-Change-of-Control buyouts require {decision_threshold}
       founder consent.
   7.5 Right of First Refusal: Founders may not transfer shares to third parties
       without first offering them to the Company and the other founders on the
       same terms.

8. CONFIDENTIALITY & NON-COMPETE
   8.1 Each founder agrees to keep all Company information confidential during and
       for {confidentiality_years} years after their involvement.
   8.2 During involvement and for 12 months thereafter, no founder shall directly
       compete with the Company or solicit Company employees, customers, or
       investors.

9. SECTION 83(b) ELECTION
   Each founder is strongly advised to file a Section 83(b) election with the IRS
   within 30 days of receiving restricted stock. Failure to file results in
   significantly higher tax liability and is a common, avoidable disaster. The
   Company will provide a template; the filing is the founder's personal
   responsibility.

10. DISPUTE RESOLUTION
    10.1 Governing Law: {governing_law}.
    10.2 Disputes shall first be resolved by good-faith negotiation, then by
         mediation, then by binding arbitration in {arbitration_venue}.

11. ENTIRE AGREEMENT
    This Agreement constitutes the entire agreement among the founders with respect
    to the subject matter and supersedes all prior discussions. It may be amended
    only in writing signed by all founders.

SIGNATURES

{signature_block}
`;
