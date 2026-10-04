/**
 * The Research crosswalk (D533, issue #1080): one place that says which market
 * a sector label belongs to and which country a place name means.
 *
 * Four sector vocabularies never met — the 82 market-directory slugs, the 12
 * market-intelligence sectors, the free-text `sector` of
 * `research_company_directory` and the free-text `sector_focus` of
 * `research_fund_directory` — and geography was free text on both directories.
 * The company (#1079), funds (#1081), overview (#1082) and markets (#1080)
 * pages all read through this module so they agree.
 *
 * HOW A VALUE IS MAPPED.
 *   1. A hand-made row in `research_taxonomy_overrides` (migration 376) wins.
 *      A row whose target is '' pins the value unmapped.
 *   2. Otherwise an exact-match dictionary below, after `normalizeLabel`.
 *   3. Otherwise the value is unmapped. Nothing is inferred from substrings or
 *      similarity: "Cambridge" stays unmapped because it names two countries.
 * Every answer says which of these decided it (`method`, `rule`).
 */
import type { Env } from '../types';

export type Method = 'rule' | 'manual';

export interface Mapping {
  raw: string;
  targets: string[];
  method: Method | null;
  /** The dictionary or override that decided; null when unmapped. */
  rule: string | null;
  /** Pieces of a multi-part value that nothing recognised. */
  unmatched: string[];
}

export type OverrideKind = 'company_sector' | 'fund_focus' | 'company_country' | 'fund_hq';

/** kind → raw value → targets ('' removed; [] means pinned unmapped). */
export type Overrides = Map<OverrideKind, Map<string, string[]>>;

/** Lower-case, hyphens and underscores to spaces, whitespace collapsed. */
export function normalizeLabel(raw: string): string {
  return raw.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Sectors. Keys are normalised labels; values are market-directory slugs.
// ---------------------------------------------------------------------------

/** `research_company_directory.sector` (Wikidata industry labels) → market. */
export const COMPANY_SECTOR_RULES: Readonly<Record<string, string>> = {
  'advertising': 'advertising',
  'marketing': 'marketingtech',
  'sports marketing': 'marketingtech',
  'agriculture': 'agtech',
  'livestock farming': 'agtech',
  'artificial intelligence': 'ai',
  'ai industry': 'ai',
  'automotive industry': 'autotech',
  'automobile manufacturer': 'autotech',
  'manufacture of motor vehicles': 'autotech',
  'motorcycle industry': 'autotech',
  'motorcycle': 'autotech',
  'electric vehicle charging network': 'autotech',
  'biotechnology': 'biotech',
  'biotechnology industry': 'biotech',
  'chemical industry': 'chemicals',
  'other basic inorganic chemical manufacturing': 'chemicals',
  'pesticide and other agricultural chemical manufacturing': 'chemicals',
  'carbon accounting': 'climatetech-cleantech',
  'web hosting service': 'cloud-infrastructure',
  'construction industry': 'constructiontech',
  'cosmetics industry': 'cosmetics',
  'computer security software': 'cybersecurity',
  'data analysis': 'analytics',
  'weapons industry': 'defensetech',
  'defense': 'defensetech',
  'telemedicine': 'digital-health',
  'pharmaceutical industry': 'pharmaceuticals',
  'e commerce': 'e-commerce',
  'education industry': 'education',
  'energy industry': 'energytech',
  'energy company': 'energytech',
  'electricity generation': 'energytech',
  'entertainment industry': 'entertainment-sports',
  'sports entertainment': 'entertainment-sports',
  'professional wrestling': 'entertainment-sports',
  'professional wrestling promotion': 'entertainment-sports',
  'association football club': 'entertainment-sports',
  'fashion': 'fashion',
  'textile industry': 'fashion',
  'financial services': 'fintech',
  'fintech': 'fintech',
  'bank': 'fintech',
  'savings bank': 'fintech',
  'food industry': 'food-and-beverage',
  'food processing': 'food-and-beverage',
  'beverage industry': 'food-and-beverage',
  'vegan food': 'food-and-beverage',
  'video game industry': 'games',
  'video game development': 'games',
  'esports': 'gaming-esports',
  'health care': 'health-hospital-services',
  'computer hardware industry': 'hardware',
  'consumer electronics industry': 'hardware',
  'electronics industry': 'hardware',
  'home automation': 'iot',
  'law firm': 'legaltech',
  'hotel': 'lodging-hospitality',
  'hospitality industry': 'lodging-hospitality',
  'industrial manufacturing': 'manufacturing',
  'media industry': 'media-content',
  'mass media': 'media-content',
  'news media': 'media-content',
  'media company': 'media-content',
  'publishing': 'media-content',
  'film production': 'media-content',
  'television production': 'media-content',
  'television station': 'media-content',
  'television network': 'media-content',
  'broadcaster': 'media-content',
  'radio station': 'media-content',
  'music industry': 'media-content',
  'streaming media': 'media-content',
  'video on demand': 'media-content',
  'podcast': 'media-content',
  'retail': 'retail',
  'semiconductor industry': 'semiconductors',
  'software industry': 'saas',
  'software company': 'saas',
  'software': 'saas',
  'software development': 'saas',
  'space industry': 'space',
  'aerospace industry': 'space',
  'virtual reality industry': 'ar-vr',
  'telecommunications industry': 'messaging',
  'telecommunications': 'messaging',
  'telecommunications company': 'messaging',
  'mobile network operator': 'messaging',
  'mobile virtual network operator': 'messaging',
  'airline': 'travel',
  'air transport': 'transportationtech',
  'civil aviation': 'transportationtech',
  'rail transport': 'transportationtech',
  'public transport': 'transportationtech',
  'shipping line': 'logistics',
  'tourism': 'travel',
  'cryptocurrency mining': 'web3-crypto',
};

/** One `sector_focus` token (the list is split by `focusTokens`) → markets. */
export const FUND_FOCUS_RULES: Readonly<Record<string, readonly string[]>> = {
  'ai': ['ai'], 'ai/ml': ['ai'], 'ml': ['ai'], 'machine learning': ['ai'],
  'deep learning': ['ai'], 'enterprise ai': ['ai'], 'vertical ai': ['ai'], 'b2b ai': ['ai'],
  'computer vision': ['ai'], 'ai infrastructure': ['ai', 'cloud-infrastructure'],
  'fintech': ['fintech'], 'b2b fintech': ['fintech'], 'payments': ['payments'], 'embedded finance': ['fintech'], 'banking': ['fintech'], 'regtech': ['fintech'],
  'consumer finance': ['fintech'], 'finance': ['fintech'],
  'insurtech': ['insurance'], 'insurance': ['insurance'],
  'industry 4.0 / robotics': ['manufacturing', 'robotics'], 'industry 4.0': ['manufacturing'],
  'robotics': ['robotics'], 'industrial robotics': ['robotics'], 'drones': ['robotics'],
  'healthtech': ['digital-health'], 'health tech': ['digital-health'], 'digital health': ['digital-health'],
  'healthcare it': ['health-it'], 'medtech': ['medical-devices'], 'medical devices': ['medical-devices'],
  'digital therapeutics': ['therapeutics'], 'femtech': ['consumer-health'],
  'mobility': ['transportationtech'], 'smart mobility': ['transportationtech'],
  'transport tech': ['transportationtech'], 'transportation': ['transportationtech'],
  'autonomous driving': ['autotech'], 'autonomous vehicles': ['autotech'], 'automotive': ['autotech'], 'auto tech': ['autotech'],
  'energy': ['energytech'], 'renewable energy': ['energytech'], 'renewables': ['energytech'],
  'energy storage': ['energytech'], 'energy efficiency': ['energytech'], 'energy transition': ['energytech'], 'smart grid': ['energytech'],
  'food & ag': ['food-and-beverage', 'agtech'], 'food tech': ['food-and-beverage'], 'food & beverage': ['food-and-beverage'], 'food': ['food-and-beverage'],
  'alternative protein': ['food-and-beverage'], 'agri tech': ['agtech'], 'agri food': ['agtech', 'food-and-beverage'],
  'deep tech': ['deeptech'], 'deeptech': ['deeptech'],
  'cleantech': ['climatetech-cleantech'], 'clean tech': ['climatetech-cleantech'], 'climate tech': ['climatetech-cleantech'],
  'green tech': ['climatetech-cleantech'], 'carbon removal': ['climatetech-cleantech'], 'decarbonization': ['climatetech-cleantech'],
  'electronics': ['hardware'], 'hardware': ['hardware'], 'microelectronics': ['semiconductors'], 'semiconductors': ['semiconductors'],
  'biotech': ['biotech'], 'bio tech': ['biotech'], 'biotechnology': ['biotech'], 'synthetic biology': ['biotech'], 'genomics': ['biotech'],
  'life sciences': ['biotech'], 'biopharma': ['pharmaceuticals'],
  'materials': ['material-science'], 'advanced materials': ['material-science'], 'new materials': ['material-science'], 'chemicals': ['chemicals'],
  'cybersecurity': ['cybersecurity'], 'cyber': ['cybersecurity'], 'infosec': ['cybersecurity'], 'security': ['security'],
  'impact': ['impact'],
  'iot': ['iot'], 'industrial iot': ['iot'], 'iiot': ['iot'],
  'saas': ['saas'], 'b2b saas': ['saas'], 'enterprise saas': ['saas'],
  'b2b software': ['enterprise-applications'], 'enterprise software': ['enterprise-applications'],
  'marketplaces': ['marketplaces'], 'marketplace': ['marketplaces'], 'online marketplaces': ['marketplaces'], 'b2b marketplaces': ['marketplaces'],
  'blockchain': ['web3-blockchain'], 'blockchains': ['web3-blockchain'], 'dlt': ['web3-blockchain'], 'web3': ['web3-blockchain'],
  'crypto': ['web3-crypto'], 'cryptocurrencies': ['web3-crypto'], 'defi': ['web3-crypto'],
  'big data': ['data-services'], 'data': ['data-services'], 'data infrastructure': ['data-services'],
  'analytics': ['analytics'], 'data analytics': ['analytics'], 'data & analytics': ['analytics'], 'business intelligence': ['analytics'],
  'ed tech': ['education'], 'prop tech': ['real-estate-proptech'], 'real estate': ['real-estate-proptech'],
  'construction tech': ['constructiontech'], 'gaming': ['games'], 'games': ['games'], 'esports': ['gaming-esports'],
  'quantum computing': ['deeptech'],
  'space tech': ['space'], 'space': ['space'], 'newspace': ['space'], 'aerospace': ['space'],
  'logistics': ['logistics'], 'supply chain': ['supply-chain-tech'],
  'defence tech': ['defensetech'], 'defense tech': ['defensetech'], 'defense': ['defensetech'],
  'cloud': ['cloud-infrastructure'], 'cloud infrastructure': ['cloud-infrastructure'], 'cloud computing': ['cloud-infrastructure'],
  'future of work': ['future-of-work'], 'human capital': ['human-capital-hrtech'], 'human resources': ['human-capital-hrtech'],
  'e commerce': ['e-commerce'], 'ecommerce': ['e-commerce'],
  'ar/vr': ['ar-vr'], 'vr/ar': ['ar-vr'], 'ar': ['ar-vr'], 'vr': ['ar-vr'],
  'media': ['media-content'], 'digital media': ['media-content'],
  'martech': ['marketingtech'], 'adtech': ['advertising'], 'advertising': ['advertising'],
  'developer tools': ['developer-tools'], 'dev tools': ['developer-tools'], 'devops': ['developer-tools'],
  'consumer internet': ['consumer-internet'], 'creator economy': ['creator-passion-economy'],
  'd2c': ['direct-to-consumer-dtc'], 'd2c brands': ['direct-to-consumer-dtc'],
  'travel': ['travel'], 'travel tech': ['travel'], 'legaltech': ['legaltech'], 'retail': ['retail'],
  'smart cities': ['smart-cities-urbantech'], 'smart city': ['smart-cities-urbantech'], 'urban tech': ['smart-cities-urbantech'],
  'wellness': ['wellness-fitness'], 'beauty': ['cosmetics'], 'fashion tech': ['fashion'],
  'manufacturing': ['manufacturing'], 'additive manufacturing': ['manufacturing'], '3d printing': ['manufacturing'],
};

/**
 * Tokens that are deliberately NOT a market. Listed so a reader can tell
 * "considered and left out" from "not yet considered"; both stay unmapped.
 */
export const FUND_FOCUS_NOT_A_MARKET: ReadonlySet<string> = new Set([
  'generalist', 'b2b', 'b2c', 'consumer', 'technology', 'tech', 'digital', 'software',
  'sustainability', 'platforms', 'infrastructure',
]);

// ---------------------------------------------------------------------------
// Countries. Keys are normalised place names; values are ISO 3166-1 alpha-2.
// ---------------------------------------------------------------------------

const US_PLACES = [
  'us', 'usa', 'united states', 'bay area', 'bay are', 'bay area hq', 'sf', 'san francisco', 'palo alto',
  'berkeley', 'nyc', 'new york', 'newyork', 'ny', 'boston', 'bosto', 'la', 'los angeles', 'chicago', 'chicaog',
  'miami', 'seattle', 'austin', 'atlanta', 'utah', 'slc', 'salt lake city', 'san diego', 'boulder', 'denver',
  'dallas', 'detroit', 'washington d.c.', 'washington dc', 'dc', 'philly', 'philadelphia', 'phiiladelphia',
  'columbus', 'cincinnati', 'kansas city', 'omaha', 'minneapolis', 'nashville',
  'manchester, nh', 'ann arbor', 'grand rapids', 'milwaukee', 'sacramento', 'san antonio', 'las vegas', 'wichita',
  'conshohocken', 'chattanooga', 'palm beach', 'west palm beach', 's. florida', 'midwest',
  'colorado', 'texas', 'florida', 'ohio', 'oho', 'tennessee', 'michigan', 'illinois', 'indiana', 'kansas',
  'maryland', 'minnesota', 'nebraska', 'new mexico', 'north carolina', 'south carolina', 'oregon', 'virginia',
  'wisconsin', 'connecticut', 'conneticut', 'california', 'north dakota', 'missouri', 'nevada',
  'washington', 'pa', 'ma', 'tx', 'mi', 'mo', 'mn', 'ks', 'wa', 'wi', 'fl', 'ga', 'co',
];

export const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(US_PLACES.map((p) => [p, 'US'])),
  'uk': 'GB', 'united kingdom': 'GB', 'london': 'GB',
  'germany': 'DE', 'berlin': 'DE', 'france': 'FR', 'paris': 'FR', 'israel': 'IL', 'israe': 'IL', 'tel aviv': 'IL',
  'spain': 'ES', 'madrid': 'ES', 'madrin': 'ES', 'netherlands': 'NL', 'amsterdam': 'NL', 'amsterdan': 'NL',
  'switzerland': 'CH', 'italy': 'IT', 'finland': 'FI', 'sweden': 'SE', 'denmark': 'DK', 'belgium': 'BE',
  'ireland': 'IE', 'dublin': 'IE', 'poland': 'PL', 'portugal': 'PT', 'norway': 'NO',
  'czech republic': 'CZ', 'czechia': 'CZ', 'lithuania': 'LT', 'luxembourg': 'LU', 'luxemburg': 'LU',
  'turkey': 'TR', 'istanbul': 'TR', 'greece': 'GR', 'estonia': 'EE', 'romania': 'RO', 'austria': 'AT',
  'bulgaria': 'BG', 'iceland': 'IS', 'russia': 'RU', 'china': 'CN', "people's republic of china": 'CN',
  'canada': 'CA', 'toronto': 'CA', 'montreal': 'CA', 'vancouver': 'CA', 'vancover': 'CA', 'ontario': 'CA', 'quebec': 'CA',
  'singapore': 'SG', 'croatia': 'HR', 'hungary': 'HU', 'hong kong': 'HK', 'malta': 'MT', 'monaco': 'MC',
  'korea': 'KR', 'south korea': 'KR', 'japan': 'JP', 'tokyo': 'JP', 'india': 'IN', 'indonesia': 'ID',
  'argentina': 'AR', 'buenos aires': 'AR', 'brazil': 'BR', 'mexico': 'MX', 'mexico city': 'MX', 'chile': 'CL',
  'australia': 'AU', 'new zealand': 'NZ', 'cyprus': 'CY', 'egypt': 'EG', 'kenya': 'KE', 'nairobi': 'KE',
  'south africa': 'ZA', 'tanzania': 'TZ', 'latvia': 'LV', 'slovenia': 'SI', 'taiwanese': 'TW', 'taiwan': 'TW',
  'ukraine': 'UA', 'vietnam': 'VN', 'dubai': 'AE', 'abu dhabi': 'AE', 'united arab emirates': 'AE',
  'thailand': 'TH', 'nigeria': 'NG', 'saudi arabia': 'SA', 'guernsey': 'GG', 'albania': 'AL', 'iran': 'IR',
  'serbia': 'RS', 'sri lanka': 'LK', 'uzbekistan': 'UZ',
};

/** Place strings that name no single country. Left unmapped on purpose. */
export const PLACE_NOT_A_COUNTRY: ReadonlySet<string> = new Set([
  'global', 'multiple cities', 'not recorded', 'nordic countries', 'central america', 'cambridge',
]);

// ---------------------------------------------------------------------------
// Resolution.
// ---------------------------------------------------------------------------

const UNMAPPED = (raw: string, unmatched: string[] = []): Mapping =>
  ({ raw, targets: [], method: null, rule: null, unmatched });

function override(ov: Overrides | undefined, kind: OverrideKind, raw: string): Mapping | null {
  const hit = ov?.get(kind)?.get(raw);
  if (!hit) return null;
  return { raw, targets: [...hit], method: 'manual', rule: `research_taxonomy_overrides:${kind}`, unmatched: [] };
}

/** A company's `sector` label → at most one market. */
export function mapCompanySector(raw: string | null | undefined, ov?: Overrides): Mapping {
  const value = String(raw ?? '');
  const manual = override(ov, 'company_sector', value);
  if (manual) return manual;
  const slug = COMPANY_SECTOR_RULES[normalizeLabel(value)];
  return slug ? { raw: value, targets: [slug], method: 'rule', rule: 'COMPANY_SECTOR_RULES', unmatched: [] } : UNMAPPED(value);
}

/**
 * A `sector_focus` list split into tokens. Migration 365 joined them with
 * " · "; migration 378 rebuilt the directory with ", ". Both are read.
 */
export function focusTokens(value: string | null | undefined): string[] {
  return String(value ?? '').split(/[·,]/).map((t) => t.trim()).filter(Boolean);
}

/** A fund's `sector_focus` list → every market its tokens name. */
export function mapFundFocus(raw: string | null | undefined, ov?: Overrides): Mapping {
  const value = String(raw ?? '');
  const manual = override(ov, 'fund_focus', value);
  if (manual) return manual;
  const targets = new Set<string>();
  const unmatched: string[] = [];
  for (const piece of focusTokens(value)) {
    const key = normalizeLabel(piece);
    const hit = FUND_FOCUS_RULES[key];
    if (hit) hit.forEach((s) => targets.add(s));
    else if (!FUND_FOCUS_NOT_A_MARKET.has(key)) unmatched.push(piece);
  }
  if (targets.size === 0) return UNMAPPED(value, unmatched);
  return { raw: value, targets: [...targets].sort(), method: 'rule', rule: 'FUND_FOCUS_RULES', unmatched };
}

/**
 * A signal's `tags` (a JSON array) → every market its tags name, through the
 * same token dictionary as fund focus. `signals.sector` is a broad
 * stock-market sector ("Technology") and is never matched to a market.
 */
export function mapSignalTags(tagsJson: string | null | undefined): Mapping {
  const raw = String(tagsJson ?? '');
  let tags: unknown = [];
  try { tags = JSON.parse(raw || '[]'); } catch { return UNMAPPED(raw); }
  if (!Array.isArray(tags)) return UNMAPPED(raw);
  const targets = new Set<string>();
  const unmatched: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string' || !t.trim()) continue;
    const hit = FUND_FOCUS_RULES[normalizeLabel(t)];
    if (hit) hit.forEach((s) => targets.add(s));
    else unmatched.push(t);
  }
  if (targets.size === 0) return UNMAPPED(raw, unmatched);
  return { raw, targets: [...targets].sort(), method: 'rule', rule: 'FUND_FOCUS_RULES', unmatched };
}

function placePieces(value: string): string[] {
  return value
    .replace(/\(([^)]*)\)/g, ',$1,')
    .split(/,|\/|\band\b/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

function resolvePlace(value: string, kind: OverrideKind, ov?: Overrides): Mapping {
  const manual = override(ov, kind, value);
  if (manual) return manual;
  const whole = normalizeLabel(value);
  if (!whole || PLACE_NOT_A_COUNTRY.has(whole)) return UNMAPPED(value);
  if (COUNTRY_ALIASES[whole]) {
    return { raw: value, targets: [COUNTRY_ALIASES[whole]], method: 'rule', rule: 'COUNTRY_ALIASES', unmatched: [] };
  }
  const targets = new Set<string>();
  const unmatched: string[] = [];
  for (const piece of placePieces(value)) {
    const code = COUNTRY_ALIASES[normalizeLabel(piece)];
    if (code) targets.add(code);
    else unmatched.push(piece);
  }
  if (targets.size === 0) return UNMAPPED(value, unmatched);
  return { raw: value, targets: [...targets].sort(), method: 'rule', rule: 'COUNTRY_ALIASES', unmatched };
}

/** A company's `country` name → at most one ISO code. */
export function mapCompanyCountry(raw: string | null | undefined, ov?: Overrides): Mapping {
  const m = resolvePlace(String(raw ?? ''), 'company_country', ov);
  // A company sits in one country; a value naming two is not resolved.
  return m.targets.length > 1 ? UNMAPPED(m.raw, [m.raw]) : m;
}

/** A fund's `hq` string → every country it names ("Bay Area, Israel" → US, IL). */
export function mapFundHq(raw: string | null | undefined, ov?: Overrides): Mapping {
  return resolvePlace(String(raw ?? ''), 'fund_hq', ov);
}

// ---------------------------------------------------------------------------
// D1 reads.
// ---------------------------------------------------------------------------

export interface Country { code: string; name: string; region: string }
export interface MarketSector { market_slug: string; mi_sector: string | null; method: Method; note: string | null }

/** The hand corrections, keyed for the `map*` functions. */
export async function loadOverrides(env: Env): Promise<Overrides> {
  const rows = await env.DB.prepare(
    `SELECT kind, raw_value, target FROM research_taxonomy_overrides`,
  ).all<{ kind: OverrideKind; raw_value: string; target: string }>();
  const out: Overrides = new Map();
  for (const r of rows.results || []) {
    const byRaw = out.get(r.kind) ?? new Map<string, string[]>();
    const list = byRaw.get(r.raw_value) ?? [];
    if (r.target) list.push(r.target);
    byRaw.set(r.raw_value, list);
    out.set(r.kind, byRaw);
  }
  return out;
}

export async function listCountries(env: Env): Promise<Country[]> {
  const rows = await env.DB.prepare(
    `SELECT code, name, region FROM research_countries ORDER BY name COLLATE NOCASE`,
  ).all<Country>();
  return rows.results || [];
}

export async function listMarketSectors(env: Env): Promise<MarketSector[]> {
  const rows = await env.DB.prepare(
    `SELECT market_slug, mi_sector, method, note FROM research_market_sectors ORDER BY market_slug`,
  ).all<MarketSector>();
  return rows.results || [];
}

/** One market slug's market-intelligence sector, or null (unmapped or unknown slug). */
export async function marketSectorFor(env: Env, slug: string): Promise<MarketSector | null> {
  return (await env.DB.prepare(
    `SELECT market_slug, mi_sector, method, note FROM research_market_sectors WHERE market_slug = ?`,
  ).bind(slug).first<MarketSector>()) ?? null;
}
