/**
 * Task #16 — Profile expansion (corporate + identity).
 *
 * Slice 1: read/write helpers for the personal-identity columns on `users`
 * and the one-per-user `corporate_profiles` table. PII (tax_id, phone) is
 * stored as column-cipher v1 ciphertext via services/columnCipher.ts;
 * `*_last4` plaintext columns let lists render `••••1234` cheaply.
 *
 * What's intentionally NOT in this slice:
 *   - UBO add/delete endpoints (the column ships, the dedicated routes don't).
 *   - Sanctions/PEP recheck on country change.
 *   - Contract template merge-field auto-fill.
 *   - High-risk-jurisdiction detection (the column ships unset).
 */
import type { Env } from '../types';
import { encryptColumn, decryptColumn, last4 } from './columnCipher';

// --- Reference data ---------------------------------------------------------

// Full ISO 3166-1 alpha-2 set (249 codes, current as of the ISO online
// browsing platform). Used for input validation only — downstream KYC
// verifies the actual document. We accept every assigned alpha-2 code so
// that global users (CN, GH, JM, etc.) aren't rejected at the Settings
// form. Anything outside this set is treated as garbage.
const ISO_ALPHA2 = new Set([
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX',
  'AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ',
  'BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK',
  'CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM',
  'DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR',
  'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS',
  'GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN',
  'IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN',
  'KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV',
  'LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ',
  'MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI',
  'NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM',
  'PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC',
  'SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV',
  'SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR',
  'TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI',
  'VN','VU','WF','WS','YE','YT','ZA','ZM','ZW',
]);

// Light per-country postal regexes. Anything not listed is accepted as long
// as it's 2-12 chars of printable ASCII. Address verification is out of scope.
const POSTAL_RE: Record<string, RegExp> = {
  US: /^\d{5}(?:-\d{4})?$/,
  CA: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i,
  GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
  NL: /^\d{4} ?[A-Z]{2}$/i,
  ES: /^\d{5}$/,
  IT: /^\d{5}$/,
  SE: /^\d{3} ?\d{2}$/,
  NO: /^\d{4}$/,
  DK: /^\d{4}$/,
  FI: /^\d{5}$/,
  IE: /^[A-Z]\d{2} ?[A-Z\d]{4}$/i,                                   // Eircode
  AU: /^\d{4}$/,
  NZ: /^\d{4}$/,
  IN: /^\d{6}$/,
  SG: /^\d{6}$/,
  JP: /^\d{3}-?\d{4}$/,
  BR: /^\d{5}-?\d{3}$/,
  MX: /^\d{5}$/,
  CH: /^\d{4}$/,
  AT: /^\d{4}$/,
  BE: /^\d{4}$/,
  PT: /^\d{4}-?\d{3}$/,
  PL: /^\d{2}-?\d{3}$/,
};

const ENTITY_TYPES = new Set([
  'sole_proprietorship','partnership','llc','c_corp','s_corp','b_corp','ltd',
  'plc','gmbh','ug','ag','sa','sas','sarl','bv','nv','spa','srl','ab','as','oy',
  'pte_ltd','pty_ltd','kk','gk','other',
]);

export class ProfileValidationError extends Error {
  status: number;
  field: string | null;
  constructor(message: string, field: string | null = null, status = 400) {
    super(message);
    this.field = field;
    this.status = status;
  }
}

function requireIsoCountry(v: unknown, field: string): string {
  const s = String(v || '').toUpperCase().trim();
  if (!s) throw new ProfileValidationError(`${field} is required`, field);
  if (s.length !== 2 || !ISO_ALPHA2.has(s)) {
    throw new ProfileValidationError(`${field} must be an ISO alpha-2 country code`, field);
  }
  return s;
}

function optionalIsoCountry(v: unknown, field: string): string | null {
  if (v == null || v === '') return null;
  return requireIsoCountry(v, field);
}

function validatePostal(country: string | null, postal: unknown, field = 'postal_code'): string | null {
  if (postal == null || postal === '') return null;
  const s = String(postal).trim();
  if (!/^[A-Za-z0-9 \-]{2,12}$/.test(s)) {
    throw new ProfileValidationError(`${field} contains invalid characters`, field);
  }
  if (country && POSTAL_RE[country] && !POSTAL_RE[country].test(s)) {
    throw new ProfileValidationError(`${field} is not valid for ${country}`, field);
  }
  return s;
}

function validateDob(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ProfileValidationError('date_of_birth must be ISO 8601 (YYYY-MM-DD)', 'date_of_birth');
  }
  const [y, m, day] = s.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, day));
  // Reject calendar-impossible dates (e.g. Feb 31) — JS Date silently
  // normalizes them, so check round-trip.
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== y ||
    d.getUTCMonth() !== m - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new ProfileValidationError('date_of_birth is not a valid date', 'date_of_birth');
  }
  // Must be at least 18 years old.
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < d.getUTCMonth() ||
    (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate());
  if (beforeBirthday) age -= 1;
  if (age < 18) throw new ProfileValidationError('Must be at least 18 years old', 'date_of_birth');
  if (age > 130) throw new ProfileValidationError('date_of_birth is implausible', 'date_of_birth');
  return s;
}

function validatePhone(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!/^\+[1-9]\d{6,14}$/.test(s)) {
    throw new ProfileValidationError('phone must be in E.164 format, e.g. +14155551234', 'phone_e164');
  }
  return s;
}

// --- Personal block ---------------------------------------------------------

export interface PersonalProfileRead {
  display_name: string | null;
  headline: string | null;
  full_legal_name: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  tax_residency_country: string | null;
  tax_id_last4: string | null;
  has_tax_id: boolean;
  phone_last4: string | null;
  has_phone: boolean;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_or_region: string | null;
  postal_code: string | null;
  country: string | null;
  profile_completion_pct: number;
}

export interface PersonalProfilePatch {
  display_name?: string | null;
  headline?: string | null;
  full_legal_name?: string | null;
  date_of_birth?: string | null;
  nationality?: string | null;
  tax_residency_country?: string | null;
  tax_id_number?: string | null;       // plaintext in; encrypted at rest
  phone_e164?: string | null;          // plaintext in; encrypted at rest
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_or_region?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

const PERSONAL_COLUMNS = [
  'display_name','headline',
  'full_legal_name','date_of_birth','nationality','tax_residency_country',
  'tax_id_number_enc','tax_id_last4','phone_e164_enc','phone_last4',
  'address_line1','address_line2','city','state_or_region','postal_code',
  'country','profile_completion_pct',
] as const;

export async function getPersonalProfile(env: Env, userId: number): Promise<PersonalProfileRead> {
  const cols = PERSONAL_COLUMNS.join(', ');
  const row = await env.DB.prepare(`SELECT ${cols} FROM users WHERE id = ?`)
    .bind(userId).first<any>();
  if (!row) throw new ProfileValidationError('User not found', null, 404);
  return {
    display_name: row.display_name || null,
    headline: row.headline || null,
    full_legal_name: row.full_legal_name || null,
    date_of_birth: row.date_of_birth || null,
    nationality: row.nationality || null,
    tax_residency_country: row.tax_residency_country || null,
    tax_id_last4: row.tax_id_last4 || null,
    has_tax_id: !!row.tax_id_number_enc,
    phone_last4: row.phone_last4 || null,
    has_phone: !!row.phone_e164_enc,
    address_line1: row.address_line1 || null,
    address_line2: row.address_line2 || null,
    city: row.city || null,
    state_or_region: row.state_or_region || null,
    postal_code: row.postal_code || null,
    country: row.country || null,
    profile_completion_pct: Number(row.profile_completion_pct || 0),
  };
}

function trimOrNull(v: unknown, max = 200): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

export async function updatePersonalProfile(
  env: Env,
  userId: number,
  patch: PersonalProfilePatch,
): Promise<PersonalProfileRead> {
  // Determine effective country first so postal validation can use it.
  const country = 'country' in patch
    ? optionalIsoCountry(patch.country, 'country')
    : (await env.DB.prepare(`SELECT country FROM users WHERE id = ?`).bind(userId).first<{country:string|null}>())?.country || null;

  const updates: Array<[string, unknown]> = [];
  if ('display_name' in patch) updates.push(['display_name', trimOrNull(patch.display_name, 100)]);
  if ('headline' in patch) updates.push(['headline', trimOrNull(patch.headline, 200)]);
  if ('full_legal_name' in patch) updates.push(['full_legal_name', trimOrNull(patch.full_legal_name)]);
  if ('date_of_birth' in patch) updates.push(['date_of_birth', validateDob(patch.date_of_birth)]);
  if ('nationality' in patch) updates.push(['nationality', optionalIsoCountry(patch.nationality, 'nationality')]);
  if ('tax_residency_country' in patch) {
    updates.push(['tax_residency_country', optionalIsoCountry(patch.tax_residency_country, 'tax_residency_country')]);
  }
  if ('address_line1' in patch) updates.push(['address_line1', trimOrNull(patch.address_line1)]);
  if ('address_line2' in patch) updates.push(['address_line2', trimOrNull(patch.address_line2)]);
  if ('city' in patch) updates.push(['city', trimOrNull(patch.city, 100)]);
  if ('state_or_region' in patch) updates.push(['state_or_region', trimOrNull(patch.state_or_region, 100)]);
  if ('postal_code' in patch) updates.push(['postal_code', validatePostal(country, patch.postal_code)]);
  if ('country' in patch) updates.push(['country', country]);

  if ('tax_id_number' in patch) {
    if (patch.tax_id_number == null || patch.tax_id_number === '') {
      updates.push(['tax_id_number_enc', null]);
      updates.push(['tax_id_last4', null]);
    } else {
      const raw = String(patch.tax_id_number).trim();
      if (raw.length < 4 || raw.length > 64) {
        throw new ProfileValidationError('tax_id_number must be 4-64 chars', 'tax_id_number');
      }
      const enc = await encryptColumn(env, 'users', 'tax_id_number', userId, raw);
      updates.push(['tax_id_number_enc', enc]);
      updates.push(['tax_id_last4', last4(raw)]);
    }
  }
  if ('phone_e164' in patch) {
    const valid = validatePhone(patch.phone_e164);
    if (valid == null) {
      updates.push(['phone_e164_enc', null]);
      updates.push(['phone_last4', null]);
    } else {
      const enc = await encryptColumn(env, 'users', 'phone_e164', userId, valid);
      updates.push(['phone_e164_enc', enc]);
      updates.push(['phone_last4', last4(valid)]);
    }
  }

  if (updates.length) {
    const setSql = updates.map(([col]) => `${col} = ?`).join(', ');
    const params = updates.map(([, v]) => v);
    await env.DB.prepare(`UPDATE users SET ${setSql} WHERE id = ?`).bind(...params, userId).run();
  }

  // Recompute completeness ring after every save.
  const after = await getPersonalProfile(env, userId);
  const corp = await getCorporateProfile(env, userId);
  const pct = computeCompletionPct(after, corp);
  if (pct !== after.profile_completion_pct) {
    await env.DB.prepare(`UPDATE users SET profile_completion_pct = ? WHERE id = ?`).bind(pct, userId).run();
    after.profile_completion_pct = pct;
  }
  return after;
}

// --- Background block (Task #66) --------------------------------------------
// Structured, public-facing career background: experience / education /
// certifications (JSON arrays) plus a website URL. These render on the public
// person profile. Stored on `users` as JSON text; never affects the
// profile-completion ring (that is corporate/identity/KYC-oriented).

export interface ProfileBackground {
  experience: Array<Record<string, unknown>>;
  education: Array<Record<string, unknown>>;
  certifications: Array<Record<string, unknown>>;
  website: string | null;
}

function parseJsonArray(raw: unknown): Array<Record<string, unknown>> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// Whitelist + clamp each entry so a hostile client can't stuff arbitrary
// blobs into a public surface. Unknown keys are dropped; strings are trimmed.
function sanitizeEntries(
  arr: unknown,
  keys: string[],
  maxEntries = 30,
  maxLen = 500,
): Array<Record<string, unknown>> {
  const src = Array.isArray(arr) ? arr : [];
  const out: Array<Record<string, unknown>> = [];
  for (const item of src.slice(0, maxEntries)) {
    if (!item || typeof item !== 'object') continue;
    const rec: Record<string, unknown> = {};
    for (const k of keys) {
      const v = (item as Record<string, unknown>)[k];
      if (v == null) continue;
      const s = String(v).trim();
      if (s) rec[k] = s.slice(0, maxLen);
    }
    if (Object.keys(rec).length) out.push(rec);
  }
  return out;
}

// Accept both the worker-native (`org`/`summary`) and the shared-frontend /
// FastAPI (`company`/`description`) key spellings so no field is silently
// dropped on prod. The public renderer reads either spelling.
const EXPERIENCE_KEYS = ['title', 'org', 'company', 'location', 'start', 'end', 'summary', 'description'];
const EDUCATION_KEYS = ['school', 'degree', 'field', 'start', 'end'];
const CERTIFICATION_KEYS = ['name', 'issuer', 'year', 'url'];

export async function getProfileBackground(env: Env, userId: number): Promise<ProfileBackground> {
  const row = await env.DB.prepare(
    `SELECT experience, education, certifications, website FROM user_profile_ext WHERE user_id = ?`,
  ).bind(userId).first<any>();
  return {
    experience: parseJsonArray(row?.experience),
    education: parseJsonArray(row?.education),
    certifications: parseJsonArray(row?.certifications),
    website: row?.website || null,
  };
}

export interface ProfileBackgroundPatch {
  experience?: unknown;
  education?: unknown;
  certifications?: unknown;
  website?: string | null;
}

export async function updateProfileBackground(
  env: Env,
  userId: number,
  patch: ProfileBackgroundPatch,
): Promise<ProfileBackground> {
  const updates: Array<[string, unknown]> = [];
  if ('experience' in patch) {
    updates.push(['experience', JSON.stringify(sanitizeEntries(patch.experience, EXPERIENCE_KEYS))]);
  }
  if ('education' in patch) {
    updates.push(['education', JSON.stringify(sanitizeEntries(patch.education, EDUCATION_KEYS))]);
  }
  if ('certifications' in patch) {
    updates.push(['certifications', JSON.stringify(sanitizeEntries(patch.certifications, CERTIFICATION_KEYS))]);
  }
  if ('website' in patch) {
    const w = patch.website == null ? null : String(patch.website).trim().slice(0, 300);
    if (w && !/^https?:\/\//i.test(w)) {
      throw new ProfileValidationError('website must start with http:// or https://', 'website');
    }
    updates.push(['website', w || null]);
  }
  if (updates.length) {
    const cols = updates.map(([col]) => col);
    const params = updates.map(([, v]) => v);
    // Companion 1:1 table (users is at D1's 100-column limit). Insert the row on
    // first write; otherwise update only the columns present in the patch.
    const insertCols = ['user_id', ...cols].join(', ');
    const placeholders = ['?', ...cols.map(() => '?')].join(', ');
    const setClause = cols.map((col) => `${col} = excluded.${col}`).join(', ');
    await env.DB.prepare(
      `INSERT INTO user_profile_ext (${insertCols}) VALUES (${placeholders})
       ON CONFLICT(user_id) DO UPDATE SET ${setClause}, updated_at = datetime('now')`,
    ).bind(userId, ...params).run();
  }
  return getProfileBackground(env, userId);
}

// --- Corporate block --------------------------------------------------------

export interface UboEntry {
  name: string;
  nationality: string | null;
  ownership_pct: number;
  is_pep: boolean;
}

export interface CorporateProfileRead {
  profile_completion_pct: number;
  entity_name: string | null;
  entity_type: string | null;
  registration_number: string | null;
  tax_id_last4: string | null;
  has_tax_id: boolean;
  registered_country: string | null;
  registered_address_line1: string | null;
  registered_address_line2: string | null;
  registered_city: string | null;
  registered_state: string | null;
  registered_postal: string | null;
  signing_authority_name: string | null;
  signing_authority_title: string | null;
  signing_authority_email: string | null;
  ubos: UboEntry[];
  directors: Array<Record<string, any>>;
  insurance_carriers: Array<Record<string, any>>;
  ubo_disclosed: boolean;
  aml_high_risk_jurisdiction: boolean;
  sanctions_last_checked_at: string | null;
  updated_at: string | null;
}

export interface CorporateProfilePatch {
  entity_name?: string | null;
  entity_type?: string | null;
  registration_number?: string | null;
  tax_id_number?: string | null;
  registered_country?: string | null;
  registered_address_line1?: string | null;
  registered_address_line2?: string | null;
  registered_city?: string | null;
  registered_state?: string | null;
  registered_postal?: string | null;
  signing_authority_name?: string | null;
  signing_authority_title?: string | null;
  signing_authority_email?: string | null;
  ubos?: UboEntry[];
  directors?: Array<Record<string, any>>;
  insurance_carriers?: Array<Record<string, any>>;
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export async function getCorporateProfile(env: Env, userId: number): Promise<CorporateProfileRead> {
  const row = await env.DB.prepare(
    `SELECT * FROM corporate_profiles WHERE user_id = ?`,
  ).bind(userId).first<any>();
  // Always include profile_completion_pct so legal-entity GET/PUT
  // responses meet the AE-1 contract (returned on every relevant PUT).
  const userPct = await env.DB.prepare(
    `SELECT profile_completion_pct AS pct FROM users WHERE id = ?`,
  ).bind(userId).first<{ pct: number | null }>();
  const profile_completion_pct = Number(userPct?.pct || 0);
  if (!row) {
    return {
      profile_completion_pct,
      entity_name: null, entity_type: null, registration_number: null,
      tax_id_last4: null, has_tax_id: false,
      registered_country: null, registered_address_line1: null, registered_address_line2: null,
      registered_city: null, registered_state: null, registered_postal: null,
      signing_authority_name: null, signing_authority_title: null, signing_authority_email: null,
      ubos: [], directors: [], insurance_carriers: [],
      ubo_disclosed: false, aml_high_risk_jurisdiction: false,
      sanctions_last_checked_at: null, updated_at: null,
    };
  }
  return {
    profile_completion_pct,
    entity_name: row.entity_name || null,
    entity_type: row.entity_type || null,
    registration_number: row.registration_number || null,
    tax_id_last4: row.tax_id_last4 || null,
    has_tax_id: !!row.tax_id_number_enc,
    registered_country: row.registered_country || null,
    registered_address_line1: row.registered_address_line1 || null,
    registered_address_line2: row.registered_address_line2 || null,
    registered_city: row.registered_city || null,
    registered_state: row.registered_state || null,
    registered_postal: row.registered_postal || null,
    signing_authority_name: row.signing_authority_name || null,
    signing_authority_title: row.signing_authority_title || null,
    signing_authority_email: row.signing_authority_email || null,
    ubos: safeJson<UboEntry[]>(row.ubos_json, []),
    directors: safeJson<any[]>(row.directors_json, []),
    insurance_carriers: safeJson<any[]>(row.insurance_carriers_json, []),
    ubo_disclosed: !!row.ubo_disclosed,
    aml_high_risk_jurisdiction: !!row.aml_high_risk_jurisdiction,
    sanctions_last_checked_at: row.sanctions_last_checked_at || null,
    updated_at: row.updated_at || null,
  };
}

function validateUbos(raw: unknown): UboEntry[] {
  if (!Array.isArray(raw)) {
    throw new ProfileValidationError('ubos must be an array', 'ubos');
  }
  const out: UboEntry[] = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== 'object') {
      throw new ProfileValidationError(`ubos[${i}] must be an object`, 'ubos');
    }
    const name = trimOrNull((item as any).name, 200);
    if (!name) throw new ProfileValidationError(`ubos[${i}].name is required`, 'ubos');
    const pct = Number((item as any).ownership_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new ProfileValidationError(`ubos[${i}].ownership_pct must be between 0 and 100`, 'ubos');
    }
    out.push({
      name,
      nationality: (item as any).nationality
        ? optionalIsoCountry((item as any).nationality, `ubos[${i}].nationality`)
        : null,
      ownership_pct: Math.round(pct * 100) / 100,
      is_pep: !!(item as any).is_pep,
    });
  }
  if (out.length > 50) throw new ProfileValidationError('At most 50 UBOs', 'ubos');
  return out;
}

function validateDirectors(raw: unknown): any[] {
  if (!Array.isArray(raw)) {
    throw new ProfileValidationError('directors must be an array', 'directors');
  }
  return raw.slice(0, 50).map((d: any, i) => {
    const name = trimOrNull(d?.name, 200);
    if (!name) throw new ProfileValidationError(`directors[${i}].name is required`, 'directors');
    return {
      name,
      title: trimOrNull(d?.title, 100),
      email: trimOrNull(d?.email, 320),
    };
  });
}

function validateInsuranceCarriers(raw: unknown): any[] {
  if (!Array.isArray(raw)) {
    throw new ProfileValidationError('insurance_carriers must be an array', 'insurance_carriers');
  }
  return raw.slice(0, 20).map((c: any) => ({
    kind: trimOrNull(c?.kind, 64),
    carrier: trimOrNull(c?.carrier, 200),
    policy_no: trimOrNull(c?.policy_no, 100),
    expiry: trimOrNull(c?.expiry, 32),
  }));
}

export async function updateCorporateProfile(
  env: Env,
  userId: number,
  patch: CorporateProfilePatch,
): Promise<CorporateProfileRead> {
  // Make sure a row exists so the UPDATE branch always hits.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO corporate_profiles (user_id) VALUES (?)`,
  ).bind(userId).run();

  // Resolve registered_country first for any future per-country postal checks.
  const regCountry = 'registered_country' in patch
    ? optionalIsoCountry(patch.registered_country, 'registered_country')
    : (await env.DB.prepare(
        `SELECT registered_country FROM corporate_profiles WHERE user_id = ?`,
      ).bind(userId).first<{registered_country:string|null}>())?.registered_country || null;

  const updates: Array<[string, unknown]> = [];
  if ('entity_name' in patch) updates.push(['entity_name', trimOrNull(patch.entity_name, 200)]);
  if ('entity_type' in patch) {
    const v = patch.entity_type ? String(patch.entity_type).trim().toLowerCase() : null;
    if (v && !ENTITY_TYPES.has(v)) {
      throw new ProfileValidationError(`entity_type must be one of ${[...ENTITY_TYPES].join(', ')}`, 'entity_type');
    }
    updates.push(['entity_type', v]);
  }
  if ('registration_number' in patch) {
    updates.push(['registration_number', trimOrNull(patch.registration_number, 100)]);
  }
  if ('registered_country' in patch) updates.push(['registered_country', regCountry]);
  if ('registered_address_line1' in patch) updates.push(['registered_address_line1', trimOrNull(patch.registered_address_line1)]);
  if ('registered_address_line2' in patch) updates.push(['registered_address_line2', trimOrNull(patch.registered_address_line2)]);
  if ('registered_city' in patch) updates.push(['registered_city', trimOrNull(patch.registered_city, 100)]);
  if ('registered_state' in patch) updates.push(['registered_state', trimOrNull(patch.registered_state, 100)]);
  if ('registered_postal' in patch) updates.push(['registered_postal', validatePostal(regCountry, patch.registered_postal, 'registered_postal')]);
  if ('signing_authority_name' in patch) updates.push(['signing_authority_name', trimOrNull(patch.signing_authority_name, 200)]);
  if ('signing_authority_title' in patch) updates.push(['signing_authority_title', trimOrNull(patch.signing_authority_title, 100)]);
  if ('signing_authority_email' in patch) {
    const e = trimOrNull(patch.signing_authority_email, 320);
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      throw new ProfileValidationError('signing_authority_email is not a valid email', 'signing_authority_email');
    }
    updates.push(['signing_authority_email', e]);
  }
  if ('ubos' in patch) {
    const ubos = validateUbos(patch.ubos);
    const disclosed = ubos.some(u => u.ownership_pct >= 25) ? 1 : 0;
    updates.push(['ubos_json', JSON.stringify(ubos)]);
    updates.push(['ubo_disclosed', disclosed]);
  }
  if ('directors' in patch) {
    updates.push(['directors_json', JSON.stringify(validateDirectors(patch.directors))]);
  }
  if ('insurance_carriers' in patch) {
    updates.push(['insurance_carriers_json', JSON.stringify(validateInsuranceCarriers(patch.insurance_carriers))]);
  }
  if ('tax_id_number' in patch) {
    if (patch.tax_id_number == null || patch.tax_id_number === '') {
      updates.push(['tax_id_number_enc', null]);
      updates.push(['tax_id_last4', null]);
    } else {
      const raw = String(patch.tax_id_number).trim();
      if (raw.length < 4 || raw.length > 64) {
        throw new ProfileValidationError('tax_id_number must be 4-64 chars', 'tax_id_number');
      }
      const enc = await encryptColumn(env, 'corporate_profiles', 'tax_id_number', userId, raw);
      updates.push(['tax_id_number_enc', enc]);
      updates.push(['tax_id_last4', last4(raw)]);
    }
  }

  // Cross-field guard: registration_number is required when entity_type is set.
  // Compute the effective post-patch state BEFORE writing so a 422 never
  // commits a half-valid row. Pulls existing values for any field not in
  // the patch.
  const updatesMap = new Map(updates);
  const effectiveEntityType =
    updatesMap.has('entity_type')
      ? (updatesMap.get('entity_type') as string | null)
      : (await env.DB.prepare(
          `SELECT entity_type FROM corporate_profiles WHERE user_id = ?`,
        ).bind(userId).first<{entity_type:string|null}>())?.entity_type ?? null;
  const effectiveRegNumber =
    updatesMap.has('registration_number')
      ? (updatesMap.get('registration_number') as string | null)
      : (await env.DB.prepare(
          `SELECT registration_number FROM corporate_profiles WHERE user_id = ?`,
        ).bind(userId).first<{registration_number:string|null}>())?.registration_number ?? null;
  if (effectiveEntityType && !effectiveRegNumber) {
    // AE-1: validation failures must be 400 with field-level details so
    // the Settings UI can inline next to the offending input.
    throw new ProfileValidationError(
      'registration_number is required when entity_type is set',
      'registration_number',
      400,
    );
  }

  if (updates.length) {
    const setSql = updates.map(([col]) => `${col} = ?`).join(', ');
    const params = updates.map(([, v]) => v);
    await env.DB.prepare(
      `UPDATE corporate_profiles SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
    ).bind(...params, userId).run();
  }

  // Recompute completeness ring BEFORE re-reading `post`, so the value
  // returned to the caller (and surfaced on the Settings UI) reflects the
  // PUT we just persisted, not the stale pre-update percentage. AE-1
  // requires `profile_completion_pct` on every relevant PUT response.
  const personal = await getPersonalProfile(env, userId);
  const corpForPct = await getCorporateProfile(env, userId);
  const pct = computeCompletionPct(personal, corpForPct);
  if (pct !== personal.profile_completion_pct) {
    await env.DB.prepare(`UPDATE users SET profile_completion_pct = ? WHERE id = ?`).bind(pct, userId).run();
  }
  return { ...corpForPct, profile_completion_pct: pct };
}

// --- Decryption helper (for contract auto-fill — exported but unused in
// Slice 1; the future contract-template integration imports from here). ----

export async function decryptPersonalSecret(
  env: Env,
  userId: number,
  field: 'tax_id_number' | 'phone_e164',
): Promise<string | null> {
  const col = field === 'tax_id_number' ? 'tax_id_number_enc' : 'phone_e164_enc';
  const row = await env.DB.prepare(`SELECT ${col} AS v FROM users WHERE id = ?`).bind(userId).first<{v:string|null}>();
  if (!row?.v) return null;
  return decryptColumn(env, 'users', field, userId, row.v);
}

// --- Completeness ring ------------------------------------------------------

// 14 weighted signals — kept simple and predictable so the UI can preview
// the ring before save lands. If you change the weights, also bump the
// docs in the Profile sub-tab so users understand what unlocks contracts.
const PERSONAL_FIELDS: Array<keyof PersonalProfileRead> = [
  'display_name','full_legal_name','date_of_birth','nationality','tax_residency_country',
  'address_line1','city','postal_code','country',
];

const CORPORATE_FIELDS: Array<keyof CorporateProfileRead> = [
  'entity_name','entity_type','registration_number','registered_country',
  'signing_authority_name','signing_authority_title',
];

// AE-2: shared "what's missing" labels keyed by the field name. Mirrors
// the same rules as `computeCompletionPct` so the Settings banner never
// drifts from the ring percentage. Corporate fields are only listed
// once the user has begun filling the corporate block.
const PERSONAL_FIELD_LABELS: Record<string, string> = {
  display_name: 'Display name',
  full_legal_name: 'Full legal name',
  date_of_birth: 'Date of birth',
  nationality: 'Nationality',
  tax_residency_country: 'Tax residency',
  address_line1: 'Address',
  city: 'City',
  postal_code: 'Postal code',
  country: 'Country',
  has_tax_id: 'Tax ID',
  has_phone: 'Phone',
};
const CORPORATE_FIELD_LABELS: Record<string, string> = {
  entity_name: 'Entity name',
  entity_type: 'Entity type',
  registration_number: 'Registration number',
  registered_country: 'Registered country',
  signing_authority_name: 'Signing authority name',
  signing_authority_title: 'Signing authority title',
  ubo_disclosed: 'UBO disclosure',
};
export function computeMissingRequiredFields(
  personal: PersonalProfileRead, corporate: CorporateProfileRead,
): Array<{ field: string; label: string; section: 'personal' | 'corporate' }> {
  const missing: Array<{ field: string; label: string; section: 'personal' | 'corporate' }> = [];
  for (const f of PERSONAL_FIELDS) {
    if (!personal[f]) missing.push({ field: String(f), label: PERSONAL_FIELD_LABELS[String(f)] || String(f), section: 'personal' });
  }
  if (!personal.has_tax_id) missing.push({ field: 'has_tax_id', label: PERSONAL_FIELD_LABELS.has_tax_id, section: 'personal' });
  if (!personal.has_phone) missing.push({ field: 'has_phone', label: PERSONAL_FIELD_LABELS.has_phone, section: 'personal' });
  const corpStarted = !!(corporate.entity_name || corporate.entity_type);
  if (corpStarted) {
    for (const f of CORPORATE_FIELDS) {
      if (!corporate[f]) missing.push({ field: String(f), label: CORPORATE_FIELD_LABELS[String(f)] || String(f), section: 'corporate' });
    }
    if (!corporate.ubo_disclosed) missing.push({ field: 'ubo_disclosed', label: CORPORATE_FIELD_LABELS.ubo_disclosed, section: 'corporate' });
  }
  return missing;
}

export function computeCompletionPct(personal: PersonalProfileRead, corporate: CorporateProfileRead): number {
  let filled = 0;
  let total = PERSONAL_FIELDS.length + 2;       // +2 for has_tax_id and has_phone
  for (const f of PERSONAL_FIELDS) if (personal[f]) filled += 1;
  if (personal.has_tax_id) filled += 1;
  if (personal.has_phone) filled += 1;

  // Corporate block only counts toward the ring if the user has begun filling it.
  const corpStarted = !!(corporate.entity_name || corporate.entity_type);
  if (corpStarted) {
    total += CORPORATE_FIELDS.length + 1;       // +1 for ubo_disclosed
    for (const f of CORPORATE_FIELDS) if (corporate[f]) filled += 1;
    if (corporate.ubo_disclosed) filled += 1;
  }
  return Math.max(0, Math.min(100, Math.round((filled / total) * 100)));
}

// --- Schema bootstrap (idempotent runtime migration) ------------------------

let migrated = false;
export async function ensureProfileExpansionSchema(env: Env): Promise<void> {
  if (migrated) return;
  // Production migrations own this users-adjacent schema. Do not run a series
  // of ALTER/CREATE statements while serving a public profile on a cold edge.
  if (env.ENVIRONMENT === 'production') {
    migrated = true;
    return;
  }
  const cols: Array<[string, string]> = [
    ['display_name', 'TEXT'],
    ['headline', 'TEXT'],
    ['full_legal_name', 'TEXT'],
    ['date_of_birth', 'TEXT'],
    ['nationality', 'TEXT'],
    ['tax_residency_country', 'TEXT'],
    ['tax_id_number_enc', 'TEXT'],
    ['tax_id_last4', 'TEXT'],
    ['phone_e164_enc', 'TEXT'],
    ['phone_last4', 'TEXT'],
    ['address_line1', 'TEXT'],
    ['address_line2', 'TEXT'],
    ['city', 'TEXT'],
    ['state_or_region', 'TEXT'],
    ['postal_code', 'TEXT'],
    ['country', 'TEXT'],
    ['profile_completion_pct', 'INTEGER DEFAULT 0'],
  ];
  for (const [c, t] of cols) {
    try { await env.DB.prepare(`ALTER TABLE users ADD COLUMN ${c} ${t}`).run(); } catch {}
  }
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS corporate_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        entity_name TEXT,
        entity_type TEXT,
        registration_number TEXT,
        tax_id_number_enc TEXT,
        tax_id_last4 TEXT,
        registered_country TEXT,
        registered_address_line1 TEXT,
        registered_address_line2 TEXT,
        registered_city TEXT,
        registered_state TEXT,
        registered_postal TEXT,
        signing_authority_name TEXT,
        signing_authority_title TEXT,
        signing_authority_email TEXT,
        ubos_json TEXT NOT NULL DEFAULT '[]',
        directors_json TEXT NOT NULL DEFAULT '[]',
        insurance_carriers_json TEXT NOT NULL DEFAULT '[]',
        ubo_disclosed INTEGER NOT NULL DEFAULT 0,
        aml_high_risk_jurisdiction INTEGER NOT NULL DEFAULT 0,
        sanctions_last_checked_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_corp_profiles_high_risk
        ON corporate_profiles(aml_high_risk_jurisdiction)
        WHERE aml_high_risk_jurisdiction = 1`,
    ).run();
    // Task #66/#67 — structured public background (experience/education/
    // certifications/website) + the LinkedIn photo URL live on a companion 1:1
    // table (users is at D1's 100-column limit; same pattern as author_websites
    // / corporate_profiles). Migrations 131/133 create this on prod; this
    // self-heals a cold DB. The guarded ALTERs cover a table that exists but
    // predates a column (e.g. 131 applied, 133 not).
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS user_profile_ext (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        experience TEXT,
        education TEXT,
        certifications TEXT,
        website TEXT,
        linkedin_picture_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ).run();
    for (const ddl of [
      'ALTER TABLE user_profile_ext ADD COLUMN experience TEXT',
      'ALTER TABLE user_profile_ext ADD COLUMN education TEXT',
      'ALTER TABLE user_profile_ext ADD COLUMN certifications TEXT',
      'ALTER TABLE user_profile_ext ADD COLUMN website TEXT',
      'ALTER TABLE user_profile_ext ADD COLUMN linkedin_picture_url TEXT',
    ]) {
      try { await env.DB.prepare(ddl).run(); } catch { /* column exists — ignore */ }
    }
  } catch (e) {
    console.error('[profile_expansion] migration failed', e);
  }
  migrated = true;
}
