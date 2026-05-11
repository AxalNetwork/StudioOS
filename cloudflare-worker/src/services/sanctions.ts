/**
 * Sanctions screening service — Task AH.
 *
 * Pulls the public consolidated lists (OFAC SDN, EU CFSP, UK HMT) and
 * fuzzy-matches a person against them by `(full_legal_name, date_of_birth,
 * nationality_iso2)`. Source list payloads are cached in KV for 24h to
 * keep per-screening latency under the worker CPU budget; per-user
 * verdicts are persisted to `sanctions_screenings` (D1, see migration
 * 035) so the admin Trust Center can show history and reviewers.
 *
 * The matcher is exposed separately (`fuzzyMatchEntities`) so the unit
 * test in `cloudflare-worker/test/sanctions_match.test.mjs` can drive
 * positive + negative cases without touching KV / D1 / network.
 */
import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Schema bootstrap (defensive — same lazy pattern as services/trust.ts)
// ---------------------------------------------------------------------------
// Pairwise NDA columns (signers_json/voided_at/voided_reason) are bootstrapped
// separately from the sanctions table because the Trust Center NDA routes
// (`/trust/agreements`, `/trust/pairwise-ndas`) need them even on requests
// that never touch the sanctions service. Exporting it as a standalone
// helper lets the routes call it directly. D1's ALTER ADD COLUMN has no
// IF NOT EXISTS, so we swallow duplicate-column errors.
let pairwiseColumnsReady = false;
export async function ensurePairwiseNdaColumns(env: Env): Promise<void> {
  if (pairwiseColumnsReady) return;
  const stmts = [
    `ALTER TABLE pairwise_ndas ADD COLUMN signers_json TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE pairwise_ndas ADD COLUMN voided_at TIMESTAMP`,
    `ALTER TABLE pairwise_ndas ADD COLUMN voided_reason TEXT`,
  ];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch {} }
  pairwiseColumnsReady = true;
}

let sanctionsSchemaReady = false;
export async function ensureSanctionsSchema(env: Env): Promise<void> {
  if (sanctionsSchemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS sanctions_screenings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      hit INTEGER NOT NULL DEFAULT 0,
      severity TEXT NOT NULL DEFAULT 'none',
      match_count INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT,
      reviewed_by INTEGER,
      reviewed_at TIMESTAMP,
      review_notes TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sanctions_user   ON sanctions_screenings(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sanctions_run_at ON sanctions_screenings(run_at)`,
    `CREATE INDEX IF NOT EXISTS idx_sanctions_hit    ON sanctions_screenings(hit, run_at)`,
  ];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch {} }
  // Sanctions screening flows also benefit from the pairwise columns being
  // present (admin sees both views in one session), so chain the helper.
  await ensurePairwiseNdaColumns(env);
  sanctionsSchemaReady = true;
}

// ---------------------------------------------------------------------------
// Public list URLs. We deliberately fetch the JSON-rendered exports rather
// than the canonical XML feeds so the worker never has to parse XML inside
// CPU budget. Each list is normalised to `SanctionEntity` shape.
// ---------------------------------------------------------------------------
const LIST_URLS: Record<SanctionsProvider, string> = {
  ofac:    'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.JSON',
  eu:      'https://webgate.ec.europa.eu/fsd/fsf/public/files/jsonFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw',
  uk_hmt:  'https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.json',
};

const KV_TTL_SECONDS = 24 * 60 * 60;
const KV_PREFIX = 'sanctions:list:v1:';

export type SanctionsProvider = 'ofac' | 'eu' | 'uk_hmt';

export interface SanctionEntity {
  source: SanctionsProvider;
  /** Primary listed name (already lowercased + diacritic-stripped). */
  name: string;
  /** Aliases / AKAs (also normalised). */
  aliases: string[];
  /** YYYY-MM-DD or null. We compare exact match. */
  dob: string | null;
  /** ISO alpha-2 country code or null. */
  nationality: string | null;
  /** Original list reference for audit. */
  ref: string;
}

export interface ScreeningSubject {
  full_legal_name: string;
  date_of_birth?: string | null;
  nationality?: string | null;
}

export interface MatchHit {
  source: SanctionsProvider;
  ref: string;
  matched_name: string;
  score: number;          // 0..1 — higher is better
  reasons: string[];      // ['name_levenshtein<=2','dob_exact', 'nationality_match']
}

// ---------------------------------------------------------------------------
// Normalisation + Levenshtein
// ---------------------------------------------------------------------------
export function normalizeName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Iterative Levenshtein with two rolling rows (O(n*m) time, O(min(n,m))
 * space). Suitable for the short strings in sanctions records.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const aL = a.length, bL = b.length;
  let prev = new Array(bL + 1);
  let curr = new Array(bL + 1);
  for (let j = 0; j <= bL; j++) prev[j] = j;
  for (let i = 1; i <= aL; i++) {
    curr[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= bL; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,         // deletion
        curr[j - 1] + 1,     // insertion
        prev[j - 1] + cost,  // substitution
      );
    }
    const t = prev; prev = curr; curr = t;
  }
  return prev[bL];
}

// ---------------------------------------------------------------------------
// Matcher (pure — exposed for unit tests).
//
// Hit conditions (any one promotes a record to a `MatchHit`):
//   1. name Levenshtein ≤ 2 against listed name OR any alias on a normalised
//      basis, AND (DOB matches exactly OR no DOB on either side).
//   2. exact normalised name match — even with no DOB info — promotes to
//      `review` regardless.
//
// Severity mapping (caller-side): >= 1 hit with `name_exact`+`dob_exact`
// → 'block'; otherwise 'review'.
// ---------------------------------------------------------------------------
export function fuzzyMatchEntities(
  subject: ScreeningSubject,
  entities: SanctionEntity[],
  opts: { maxDistance?: number } = {},
): MatchHit[] {
  const maxD = opts.maxDistance ?? 2;
  const subjName = normalizeName(subject.full_legal_name);
  if (!subjName) return [];
  const subjDob = (subject.date_of_birth || '').trim() || null;
  const subjNat = (subject.nationality || '').trim().toUpperCase() || null;

  const hits: MatchHit[] = [];
  for (const e of entities) {
    const candidates = [e.name, ...e.aliases].filter(Boolean);
    let bestDist = Infinity;
    let bestName = '';
    for (const c of candidates) {
      const d = levenshtein(subjName, c);
      if (d < bestDist) { bestDist = d; bestName = c; }
      if (bestDist === 0) break;
    }
    if (bestDist > maxD) continue;
    const reasons: string[] = [];
    if (bestDist === 0) reasons.push('name_exact');
    else reasons.push(`name_levenshtein_${bestDist}`);

    // DOB gate. If both sides have a DOB and they disagree, drop the hit
    // unless it was an exact name match (still surface for review).
    if (subjDob && e.dob) {
      if (subjDob === e.dob) reasons.push('dob_exact');
      else if (bestDist > 0) continue;
      else reasons.push('dob_mismatch_review');
    }

    if (subjNat && e.nationality && subjNat === e.nationality.toUpperCase()) {
      reasons.push('nationality_match');
    }

    // Score = 1.0 for exact-name + dob_exact; tail off with edit distance.
    let score = 1 - bestDist / (maxD + 1);
    if (reasons.includes('dob_exact')) score = Math.min(1, score + 0.2);
    if (reasons.includes('nationality_match')) score = Math.min(1, score + 0.05);

    hits.push({ source: e.source, ref: e.ref, matched_name: bestName, score, reasons });
  }
  // Highest-confidence first.
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

// ---------------------------------------------------------------------------
// List loaders — cached in KV (24h). Each returns a normalised
// SanctionEntity[] for that provider. Network failures degrade silently
// to an empty list so a single source outage doesn't break screening.
// ---------------------------------------------------------------------------
async function getCachedList(
  env: Env,
  provider: SanctionsProvider,
  loader: () => Promise<SanctionEntity[]>,
): Promise<SanctionEntity[]> {
  const kv: KVNamespace | undefined = (env as any).TOKENS;
  if (kv) {
    try {
      const cached = await kv.get(KV_PREFIX + provider, 'json');
      if (Array.isArray(cached)) return cached as SanctionEntity[];
    } catch (e) { /* fall through to fresh load */ }
  }
  let entities: SanctionEntity[] = [];
  try { entities = await loader(); } catch (e) {
    console.warn('[sanctions] loader failed', provider, (e as Error).message);
    return [];
  }
  if (kv && entities.length) {
    try { await kv.put(KV_PREFIX + provider, JSON.stringify(entities), { expirationTtl: KV_TTL_SECONDS }); } catch {}
  }
  return entities;
}

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

function pickOfac(entry: any): SanctionEntity | null {
  // OFAC SDN JSON shape varies; the consolidated export uses
  //   { displayName, akaList: [{ wholeName }], dateOfBirthList: [{ dateOfBirth }],
  //     nationalityList: [{ country }], uid }
  // Prefer the canonical `displayName`. Only synthesize from
  // first/last when displayName is absent — explicit parens here
  // prevent the precedence trap where `a || b && c` evaluated wrong
  // (the previous draft built `' '` for entries that had displayName,
  // dropping valid OFAC entries after normalization).
  let nameRaw: string = '';
  if (typeof entry?.displayName === 'string' && entry.displayName.trim()) {
    nameRaw = entry.displayName;
  } else if (entry?.firstName || entry?.lastName) {
    nameRaw = `${entry.firstName || ''} ${entry.lastName || ''}`.trim();
  }
  const name = normalizeName(nameRaw);
  if (!name) return null;
  const aliases: string[] = (entry?.akaList || entry?.aka || []).flatMap((a: any) => {
    let v = '';
    if (typeof a?.wholeName === 'string' && a.wholeName.trim()) v = a.wholeName;
    else if (a?.firstName || a?.lastName) v = `${a.firstName || ''} ${a.lastName || ''}`.trim();
    else if (typeof a?.displayName === 'string') v = a.displayName;
    const n = normalizeName(v);
    return n ? [n] : [];
  });
  const dobRaw: string | undefined = entry?.dateOfBirthList?.[0]?.dateOfBirth || entry?.dateOfBirth;
  const dob = parseDob(dobRaw);
  const nat: string | null = (entry?.nationalityList?.[0]?.country || entry?.nationality || null);
  return { source: 'ofac', name, aliases, dob, nationality: nat, ref: String(entry?.uid || entry?.id || nameRaw) };
}

function parseDob(raw: any): string | null {
  if (!raw || typeof raw !== 'string') return null;
  // Accept YYYY-MM-DD, DD MMM YYYY, YYYY/MM/DD.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = /^(\d{4})[\/](\d{2})[\/](\d{2})$/.exec(raw);
  if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}`;
  const dmy = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(raw);
  if (dmy) {
    const months: Record<string, string> = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
    const m = months[dmy[2].slice(0,3).toLowerCase()];
    if (m) return `${dmy[3]}-${m}-${dmy[1].padStart(2,'0')}`;
  }
  return null;
}

async function loadOfac(): Promise<SanctionEntity[]> {
  const j = await fetchJson(LIST_URLS.ofac);
  const list = Array.isArray(j) ? j : (j?.results || j?.sdnEntries || []);
  return list.map(pickOfac).filter(Boolean) as SanctionEntity[];
}

async function loadEu(): Promise<SanctionEntity[]> {
  const j = await fetchJson(LIST_URLS.eu);
  // The EU FSF JSON is structured with `data.aggregate.entries[]`.
  const list = j?.data?.aggregate?.entries || j?.entries || [];
  return list.flatMap((entry: any): SanctionEntity[] => {
    const names: string[] = (entry?.nameAlias || entry?.namesAndAddresses || []).map((n: any) => n?.wholeName || n?.fullName).filter(Boolean);
    const primary = names[0]; if (!primary) return [];
    const aliases = names.slice(1).map(normalizeName).filter(Boolean);
    const dob = parseDob(entry?.birthDate?.[0]?.birthdate || entry?.dateOfBirth);
    const nat = entry?.citizenship?.[0]?.countryIso2Code || null;
    return [{ source: 'eu', name: normalizeName(primary), aliases, dob, nationality: nat, ref: String(entry?.logicalId || entry?.id || primary) }];
  });
}

async function loadUkHmt(): Promise<SanctionEntity[]> {
  const j = await fetchJson(LIST_URLS.uk_hmt);
  const list = j?.Designations || j?.designations || j || [];
  return list.flatMap((entry: any): SanctionEntity[] => {
    const primary = entry?.Names?.[0]?.Name6 || entry?.PrimaryName || entry?.Name;
    if (!primary) return [];
    const aliases: string[] = ((entry?.Names || []).slice(1).map((n: any) => n?.Name6 || n?.Name).filter(Boolean));
    const dob = parseDob(entry?.IndividualDateOfBirth?.[0]?.DateOfBirth || entry?.DateOfBirth);
    const nat = entry?.Nationality?.[0]?.Country || null;
    return [{
      source: 'uk_hmt',
      name: normalizeName(primary),
      aliases: aliases.map(normalizeName).filter(Boolean),
      dob,
      nationality: typeof nat === 'string' && nat.length === 2 ? nat : null,
      ref: String(entry?.GroupID || entry?.GroupId || entry?.Id || primary),
    }];
  });
}

export async function loadAllLists(env: Env): Promise<SanctionEntity[]> {
  const [a, b, c] = await Promise.all([
    getCachedList(env, 'ofac',   loadOfac),
    getCachedList(env, 'eu',     loadEu),
    getCachedList(env, 'uk_hmt', loadUkHmt),
  ]);
  return [...a, ...b, ...c];
}

// ---------------------------------------------------------------------------
// Per-user screening — fetch lists, run matcher, persist verdict, notify
// admin on hit. Idempotent: each run inserts a fresh row (history).
// ---------------------------------------------------------------------------
export async function screenUser(
  env: Env,
  userId: number,
  subject: ScreeningSubject,
  triggeredBy: { admin_user_id?: number | null; reason?: string } = {},
): Promise<{ id: number; hit: boolean; severity: string; matches: MatchHit[] }> {
  await ensureSanctionsSchema(env);
  const entities = await loadAllLists(env);
  const matches = fuzzyMatchEntities(subject, entities);
  const hit = matches.length > 0;
  let severity: 'none' | 'review' | 'block' = 'none';
  if (hit) {
    const top = matches[0];
    severity = (top.reasons.includes('name_exact') && top.reasons.includes('dob_exact')) ? 'block' : 'review';
  }
  let id = 0;
  try {
    const ins: any = await env.DB.prepare(
      `INSERT INTO sanctions_screenings (user_id, provider, hit, severity, match_count, payload_json)
       VALUES (?, 'aggregate', ?, ?, ?, ?) RETURNING id`,
    ).bind(userId, hit ? 1 : 0, severity, matches.length, JSON.stringify({ matches, triggeredBy })).first();
    id = (ins?.id as number) || 0;
  } catch (e) { console.error('[sanctions] persist failed', e); }

  // Touch corporate_profiles.sanctions_last_checked_at if present.
  try {
    await env.DB.prepare(
      `UPDATE corporate_profiles SET sanctions_last_checked_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
    ).bind(userId).run();
  } catch {}

  if (hit) {
    try {
      const { notify } = await import('./notify');
      // Notify the *admin* who triggered it (if known); otherwise leave
      // it for the Trust Center sanctions tab to surface.
      if (triggeredBy.admin_user_id) {
        await notify(env, {
          userId: triggeredBy.admin_user_id,
          type: 'sanctions_hit',
          title: 'Sanctions screening: review required',
          body: `User #${userId} scored ${matches.length} match(es) on a sanctions list (severity: ${severity}).`,
          link: '/trust',
          category: 'compliance_alert',
          payload: { user_id: userId, severity, match_count: matches.length },
        });
      }
    } catch (e) { console.error('[sanctions] notify failed', e); }
  }

  return { id, hit, severity, matches };
}

// ---------------------------------------------------------------------------
// History reader — admin Sanctions tab.
// ---------------------------------------------------------------------------
export async function listScreenings(
  env: Env,
  opts: { user_id?: number; limit?: number; only_hits?: boolean } = {},
): Promise<any[]> {
  await ensureSanctionsSchema(env);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const wheres: string[] = [];
  const binds: any[] = [];
  if (opts.user_id) { wheres.push('s.user_id = ?'); binds.push(opts.user_id); }
  if (opts.only_hits) { wheres.push('s.hit = 1'); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const rows: any = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.provider, s.run_at, s.hit, s.severity, s.match_count,
            s.payload_json, s.reviewed_by, s.reviewed_at, s.review_notes,
            u.email AS user_email, u.name AS user_name
       FROM sanctions_screenings s
       LEFT JOIN users u ON u.id = s.user_id
       ${where}
       ORDER BY s.run_at DESC
       LIMIT ?`,
  ).bind(...binds, limit).all();
  return (rows?.results || []) as any[];
}
