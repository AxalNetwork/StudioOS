// Founder skill dimensions — the nine-axis founder competency projection.
//
// WHY THIS MODULE EXISTS
// The Profiling radar never had a fixed axis count: the page plots whatever
// `/skills/taxonomy` returns, so it drew 4 axes against the dev FastAPI shim's
// hand-written placeholder taxonomy and 8 against production D1 (the real
// 8-category / 128-skill catalog seeded by
// `cloudflare-worker/sql/migrations/090_seed_skills_values_taxonomy.sql`).
// Neither is the design's nine, because the nine are not taxonomy categories at
// all — they are FOUNDER COMPETENCIES, a layer that did not exist anywhere in
// the codebase. This module is that missing layer: a pure projection of the 128
// canonical skills onto nine founder dimensions. It does not replace, mirror or
// mutate the D1 taxonomy, and it requires no API change.
//
// HONESTY CONTRACT
// A dimension score is DERIVED, not measured. Nobody is ever asked "how strong
// is your Fundraising?"; the score is the mean of the user's own 0–5 self-ratings
// on the catalog skills that map into that dimension, rescaled to 0–100. So the
// page must present these as *inferred from your skill self-ratings*, never as a
// direct assessment result. Two consequences are enforced here:
//   * A dimension with zero rated skills gets `score: null` — never 0. Callers
//     may plot null at radius 0 but must mark it as unrated rather than draw it
//     as a real low score, and it is excluded from strongest/weakest ranking.
//   * `band` is EVIDENCE COVERAGE (rated skills / mapped skills), not a
//     confidence figure and not a fabricated constant. "High" means "most of the
//     skills behind this axis have actually been rated", i.e. how much you can
//     trust the score — it says nothing about how good the founder is.
//
// The nine labels and their clockwise order are the design contract and must not
// be reordered or reworded.

/**
 * The nine founder skill dimensions, in the design's clockwise order starting at
 * 12 o'clock. Labels are verbatim from the design ("Finance / legal" really is
 * lower-case "legal").
 * @type {ReadonlyArray<{key: string, label: string}>}
 */
export const FOUNDER_DIMENSIONS = Object.freeze([
  Object.freeze({ key: 'product', label: 'Product' }),
  Object.freeze({ key: 'strategy', label: 'Strategy' }),
  Object.freeze({ key: 'technical', label: 'Technical' }),
  Object.freeze({ key: 'leadership', label: 'Leadership' }),
  Object.freeze({ key: 'hiring', label: 'Hiring' }),
  Object.freeze({ key: 'operations', label: 'Operations' }),
  Object.freeze({ key: 'sales_gtm', label: 'Sales / GTM' }),
  Object.freeze({ key: 'finance_legal', label: 'Finance / legal' }),
  Object.freeze({ key: 'fundraising', label: 'Fundraising' }),
]);

// Canonical order lookup — also the allow-list that validates every mapping
// value below, so a typo'd dimension key can never create a tenth bucket.
const DIM_INDEX = new Map(FOUNDER_DIMENSIONS.map((d, i) => [d.key, i]));

/**
 * Every one of the 128 canonical skill slugs → exactly one founder dimension.
 * Source of truth for the slugs, labels and category assignment:
 * `cloudflare-worker/sql/migrations/090_seed_skills_values_taxonomy.sql`.
 *
 * The projection is deliberately not "one taxonomy category → one axis": the
 * catalog is organised by *function* (where the work sits in a company) while
 * the nine axes are organised by *founder competency* (what the founder can
 * personally carry). So strategy-flavoured skills are pulled out of five
 * different categories, hiring is assembled from three, and the design category
 * joins Product as craft that shapes what gets built.
 * @type {Record<string, string>}
 */
export const SKILL_DIMENSION_MAP = {
  // --- Product (16) — everything about deciding and shaping what gets built.
  // `product_ops` is the exception: rituals/process for a product org is a
  // leadership muscle, not a discovery one.
  product_discovery: 'product',
  product_roadmapping: 'product',
  product_user_research: 'product',
  product_requirements: 'product',
  product_analytics: 'product',
  product_experimentation: 'product',
  product_ux_strategy: 'product',
  product_growth: 'product',
  product_pricing_packaging: 'product',
  product_management_b2b: 'product',
  product_management_b2c: 'product',
  product_platform: 'product',
  product_data: 'product',
  product_ai: 'product',
  product_marketplace: 'product',
  product_ops: 'leadership',

  // --- Engineering (16) — the whole category is the Technical axis.
  eng_frontend: 'technical',
  eng_backend: 'technical',
  eng_fullstack: 'technical',
  eng_mobile: 'technical',
  eng_devops: 'technical',
  eng_cloud_infra: 'technical',
  eng_data_engineering: 'technical',
  eng_ml: 'technical',
  eng_security: 'technical',
  eng_databases: 'technical',
  eng_distributed_systems: 'technical',
  eng_qa_automation: 'technical',
  eng_architecture: 'technical',
  eng_embedded: 'technical',
  eng_site_reliability: 'technical',
  eng_api_design: 'technical',

  // --- Design (16) — design craft is how the product gets made, so it lands on
  // Product. (There is no separate Design axis in the founder model.)
  design_product: 'product',
  design_ui: 'product',
  design_ux_research: 'product',
  design_interaction: 'product',
  design_visual: 'product',
  design_brand_identity: 'product',
  design_motion: 'product',
  design_prototyping: 'product',
  design_design_systems: 'product',
  design_information_arch: 'product',
  design_accessibility: 'product',
  design_service: 'product',
  design_3d: 'product',
  design_content: 'product',
  design_graphic: 'product',
  design_illustration: 'product',

  // --- GTM / Sales (16) — the selling motion is Sales / GTM; the two
  // planning skills (how to sell at all, which market to enter) are Strategy.
  gtm_sales_strategy: 'strategy',
  gtm_market_entry: 'strategy',
  gtm_outbound: 'sales_gtm',
  gtm_inbound: 'sales_gtm',
  gtm_enterprise_sales: 'sales_gtm',
  gtm_smb_sales: 'sales_gtm',
  gtm_sales_ops: 'sales_gtm',
  gtm_account_management: 'sales_gtm',
  gtm_customer_success: 'sales_gtm',
  gtm_partnerships: 'sales_gtm', // channel/reseller *selling*, not strategic alliances
  gtm_revenue_ops: 'sales_gtm',
  gtm_negotiation: 'sales_gtm',
  gtm_sales_enablement: 'sales_gtm',
  gtm_pipeline_mgmt: 'sales_gtm',
  gtm_solutions_eng: 'sales_gtm',
  gtm_plg: 'sales_gtm',

  // --- Marketing / Brand (16) — demand creation is part of the GTM muscle;
  // only brand *strategy* (positioning and narrative architecture) is Strategy.
  mkt_brand_strategy: 'strategy',
  mkt_content: 'sales_gtm',
  mkt_seo: 'sales_gtm',
  mkt_sem: 'sales_gtm',
  mkt_paid_social: 'sales_gtm',
  mkt_lifecycle: 'sales_gtm',
  mkt_demand_gen: 'sales_gtm',
  mkt_product_marketing: 'sales_gtm',
  mkt_pr_comms: 'sales_gtm',
  mkt_social_media: 'sales_gtm',
  mkt_community: 'sales_gtm',
  mkt_growth_marketing: 'sales_gtm',
  mkt_analytics: 'sales_gtm',
  mkt_events: 'sales_gtm',
  mkt_influencer: 'sales_gtm',
  mkt_copywriting: 'sales_gtm',

  // --- Finance / Ops (16) — the category splits four ways: the money skills to
  // Finance / legal, the "run the machine" skills to Operations, people ops to
  // Hiring, diligence-ready financials to Fundraising, and capital allocation /
  // scenario planning to Strategy.
  finops_financial_modeling: 'finance_legal',
  finops_accounting: 'finance_legal',
  finops_fpna: 'finance_legal',
  finops_treasury: 'finance_legal',
  finops_tax: 'finance_legal',
  finops_unit_economics: 'finance_legal',
  finops_fundraising_fin: 'fundraising',
  finops_strategic_finance: 'strategy',
  finops_people_ops: 'hiring',
  finops_payroll: 'operations',
  finops_audit_controls: 'operations',
  finops_business_ops: 'operations',
  finops_supply_chain: 'operations',
  finops_procurement: 'operations',
  finops_metrics_reporting: 'operations',
  finops_office_admin: 'operations',

  // --- Legal / Compliance (16) — Finance / legal owns the category, except
  // employment law (a hiring competency) and the two strategy-shaped ones
  // (IP strategy, regulatory strategy) which are positioning decisions.
  legal_corporate: 'finance_legal',
  legal_contracts: 'finance_legal',
  legal_privacy: 'finance_legal',
  legal_securities: 'finance_legal',
  legal_compliance_program: 'finance_legal',
  legal_data_governance: 'finance_legal',
  legal_litigation: 'finance_legal',
  legal_ma: 'finance_legal',
  legal_licensing: 'finance_legal',
  legal_tax_law: 'finance_legal',
  legal_aml_kyc: 'finance_legal',
  legal_open_source: 'finance_legal',
  legal_terms_policy: 'finance_legal',
  legal_ip: 'strategy',
  legal_regulatory: 'strategy',
  legal_employment: 'hiring',

  // --- Capital / Network (16) — raising and managing capital is Fundraising;
  // board/advisors are the governance side of Leadership; recruiting is Hiring;
  // alliances/ecosystem/BD are Strategy; press relations sits with the rest of
  // comms under Sales / GTM.
  cap_fundraising: 'fundraising',
  cap_investor_relations: 'fundraising',
  cap_venture_capital: 'fundraising',
  cap_angel_investing: 'fundraising',
  cap_corporate_dev: 'fundraising',
  cap_debt_financing: 'fundraising',
  cap_grants_nondilutive: 'fundraising',
  cap_cap_table: 'fundraising',
  cap_lp_relations: 'fundraising',
  cap_board_governance: 'leadership',
  cap_advisor_network: 'leadership',
  cap_talent_network: 'hiring',
  cap_bd_partnerships: 'strategy',
  cap_ecosystem: 'strategy',
  cap_strategic_alliances: 'strategy',
  cap_press_relations: 'sales_gtm',
};

/**
 * Category slug → dimension key. Used ONLY for a skill whose own slug is absent
 * from SKILL_DIMENSION_MAP — e.g. a skill added to D1 after this file was
 * written — so a new taxonomy entry degrades to its category's home axis
 * instead of vanishing from the projection. Anything that matches neither is
 * reported via `unmappedSkillCount` rather than silently dropped.
 * @type {Record<string, string>}
 */
export const CATEGORY_DIMENSION_FALLBACK = {
  // The 8 canonical D1 categories.
  product: 'product',
  engineering: 'technical',
  design: 'product',
  gtm_sales: 'sales_gtm',
  marketing_brand: 'sales_gtm',
  finance_ops: 'operations',
  legal_compliance: 'finance_legal',
  capital_network: 'fundraising',
  // Legacy / dev-shim category slugs (the Replit FastAPI placeholder taxonomy),
  // so local previews project onto the same nine axes.
  gtm: 'sales_gtm',
  operations: 'operations',
};

/**
 * Evidence-coverage band for a 0–100 coverage percentage.
 *
 * This is COVERAGE, not confidence and not quality: it answers "how much of this
 * dimension has actually been rated", which is the only honest per-dimension
 * band we can compute. The design carried a hand-authored High/Medium/Low per
 * axis; that was fabricated demo data and is deliberately not reproduced.
 * Thresholds match `confidenceBand` on the Profiling page (>=75 / >=45).
 * @param {number} pct
 * @returns {'High'|'Medium'|'Low'}
 */
export function coverageBand(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 'Low';
  if (n >= 75) return 'High';
  if (n >= 45) return 'Medium';
  return 'Low';
}

/**
 * Resolve one skill to a founder dimension key, slug first then category
 * fallback. Returns null when neither resolves.
 * @param {string} [skillSlug]
 * @param {string} [categorySlug]
 * @returns {string|null}
 */
export function dimensionKeyForSkill(skillSlug, categorySlug) {
  const bySlug =
    typeof skillSlug === 'string' && Object.prototype.hasOwnProperty.call(SKILL_DIMENSION_MAP, skillSlug)
      ? SKILL_DIMENSION_MAP[skillSlug]
      : null;
  if (bySlug && DIM_INDEX.has(bySlug)) return bySlug;
  const byCat =
    typeof categorySlug === 'string' &&
    Object.prototype.hasOwnProperty.call(CATEGORY_DIMENSION_FALLBACK, categorySlug)
      ? CATEGORY_DIMENSION_FALLBACK[categorySlug]
      : null;
  if (byCat && DIM_INDEX.has(byCat)) return byCat;
  return null;
}

/**
 * Project the taxonomy + the user's self-ratings onto the nine founder
 * dimensions. Pure, total, and defensive: any shape of garbage in produces the
 * nine zero-evidence dimensions out rather than a throw.
 *
 * @param {Array<{slug?: string, skills?: Array<{id?: number|string, slug?: string, label?: string}>}>} categories
 *        `/skills/taxonomy` categories, each with its nested `skills`.
 * @param {Array<{skill_id?: number|string, self_level?: number}>} ratings
 *        `/skills/me` self-ratings. Matched to skills by `skill_id` → `skill.id`.
 * @returns {{
 *   dims: Array<{key:string,label:string,score:number|null,band:'High'|'Medium'|'Low',
 *                ratedCount:number,skillCount:number,coveragePct:number,
 *                topSkills:Array<{slug:string,label:string,level:number,score:number}>}>,
 *   totalSkills: number, ratedSkills: number, assessedPct: number,
 *   strongest: Array<object>, weakest: Array<object>, unrated: Array<object>,
 *   unmappedSkillCount: number
 * }}
 */
export function buildFounderSkillsModel(categories = [], ratings = []) {
  // 1) Index ratings by skill id. Non-finite `self_level` is malformed input,
  //    not a rating of zero — dropping it keeps coverage honest. Levels are
  //    clamped into the stored 0–5 scale. Keys are stringified so a numeric id
  //    from the taxonomy still matches a string id from JSON.
  const levelBySkillId = new Map();
  for (const r of Array.isArray(ratings) ? ratings : []) {
    if (!r || typeof r !== 'object') continue;
    if (r.skill_id === null || r.skill_id === undefined) continue;
    const lvl = Number(r.self_level);
    if (!Number.isFinite(lvl)) continue;
    levelBySkillId.set(String(r.skill_id), Math.max(0, Math.min(5, lvl)));
  }

  // 2) Walk the catalog once, bucketing each skill into its dimension.
  const buckets = new Map(FOUNDER_DIMENSIONS.map((d) => [d.key, { skillCount: 0, rated: [] }]));
  let totalSkills = 0;
  let ratedSkills = 0;
  let unmappedSkillCount = 0;
  const seen = new Set();

  for (const c of Array.isArray(categories) ? categories : []) {
    if (!c || typeof c !== 'object') continue;
    const catSlug = typeof c.slug === 'string' ? c.slug : '';
    for (const s of Array.isArray(c.skills) ? c.skills : []) {
      if (!s || typeof s !== 'object') continue;
      const id = s.id === null || s.id === undefined ? null : String(s.id);
      const slug = typeof s.slug === 'string' ? s.slug : '';
      // Guard against a skill appearing under two categories double-counting.
      const dedupeKey = id !== null ? `id:${id}` : slug ? `slug:${slug}` : null;
      if (dedupeKey) {
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
      }
      // `totalSkills` / `ratedSkills` stay RAW CATALOG coverage — every skill the
      // taxonomy serves, mapped or not. The Profiling page's W1 milestone reads
      // `assessedPct`, so this must not become an axis-derived number.
      totalSkills += 1;
      const level = id !== null && levelBySkillId.has(id) ? levelBySkillId.get(id) : null;
      if (level !== null) ratedSkills += 1;

      const key = dimensionKeyForSkill(slug, catSlug);
      if (!key) {
        unmappedSkillCount += 1;
        continue;
      }
      const bucket = buckets.get(key);
      bucket.skillCount += 1;
      if (level !== null) {
        bucket.rated.push({ slug, label: typeof s.label === 'string' && s.label ? s.label : slug, level });
      }
    }
  }

  // 3) Always emit all nine, in canonical order, even with an empty catalog.
  const dims = FOUNDER_DIMENSIONS.map((d) => {
    const bucket = buckets.get(d.key);
    const ratedCount = bucket.rated.length;
    // score: mean self-rating of the RATED mapped skills, as a pct of the 0–5
    // scale. null (never 0) when there is no evidence at all.
    const score = ratedCount
      ? Math.round((bucket.rated.reduce((a, x) => a + x.level, 0) / ratedCount / 5) * 100)
      : null;
    const coveragePct = bucket.skillCount ? Math.round((ratedCount / bucket.skillCount) * 100) : 0;
    const topSkills = [...bucket.rated]
      .sort((a, b) => b.level - a.level || a.label.localeCompare(b.label))
      .slice(0, 3)
      .map((x) => ({ slug: x.slug, label: x.label, level: x.level, score: Math.round((x.level / 5) * 100) }));
    return {
      key: d.key,
      label: d.label,
      score,
      band: coverageBand(coveragePct),
      ratedCount,
      skillCount: bucket.skillCount,
      coveragePct,
      topSkills,
    };
  });

  const assessedPct = totalSkills ? Math.round((ratedSkills / totalSkills) * 100) : 0;

  // 4) Rank only dimensions that actually have evidence. Ties break on canonical
  //    order so the lists are deterministic.
  const ranked = dims
    .filter((d) => d.score != null)
    .sort((a, b) => b.score - a.score || DIM_INDEX.get(a.key) - DIM_INDEX.get(b.key));
  const strongest = ranked.slice(0, 3);
  const strongestKeys = new Set(strongest.map((d) => d.key));
  // Weakest needs at least 4 scored dimensions to be meaningful (the page's
  // existing rule); the strongest-exclusion additionally prevents the same
  // dimension being rendered as both "Strongest" and "Least evidenced" — which
  // the old 4-axis model did, and which reads as a data bug to the user.
  const weakest =
    ranked.length > 3 ? ranked.slice(-3).reverse().filter((d) => !strongestKeys.has(d.key)) : [];

  return {
    dims,
    totalSkills,
    ratedSkills,
    assessedPct,
    strongest,
    weakest,
    unrated: dims.filter((d) => d.score == null),
    unmappedSkillCount,
  };
}
