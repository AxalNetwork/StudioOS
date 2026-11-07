/**
 * #4707 — the HQ licence ledger's shared core: the row types, reads and
 * writes every licence route uses (`byUid`, `hydrate`, `logEvent`,
 * `activationBlockers`, the state machine's refusals). Moved out of
 * `routes/admin_licences.ts` unchanged when the routes were split by domain.
 */
import type { Env } from '../types';
import { nowIso } from '../routes/_t13t14t15_helpers';
import { domainPayload, type LicenceDomainRow } from './licenceDomain';
import { idChunks } from './licenceLedgerReads';

// #4707 — the seat types and kinds are the API's contract; they live there.
export { SEAT_TYPES, LICENCE_KINDS } from './licenceContracts';
export const ISO2 = /^[A-Z]{2}$/;
/** Statuses that still hold territory. Terminated is the only one that does not. */
export const HOLDS_TERRITORY = ['draft', 'pending_activation', 'active', 'suspended'];

export type LicenceRow = {
  id: number; uid: string; licence_ref: string; entity_id: number | null;
  legal_entity_name: string; brand_name: string; registered_address: string | null;
  signatory_name: string | null; signatory_title: string | null; status: string;
  term_years: number | null; annual_fee_cents: number | null; currency: string;
  revenue_share_bps: number | null; token_split_bps: number | null;
  starts_on: string | null; renews_on: string | null; suspended_at: string | null;
  terminated_at: string | null; status_note: string | null; created_at: string;
  /** 'subsidiary' | 'white_label' — migration 279. `byUid` is SELECT *, so this
   *  arrives without a query change; before 279 it was undefined on every row. */
  kind: string;
};

/** D198 — migration 281's row. One per licence, white-label only. */
export type LicenceBrandKitRow = {
  id: number; licence_id: number;
  mark_r2_key: string | null; mark_mime: string | null; mark_bytes: number | null;
  primary_hex: string | null; accent_hex: string | null;
  updated_by_user_id: number | null; created_at: string; updated_at: string;
};

/**
 * What a brand kit looks like on the wire. THE R2 KEY NEVER CROSSES — the
 * client gets a route to fetch the mark FROM, not the object's address in a
 * bucket it cannot reach. `mark_url` is null when no mark has been uploaded,
 * which is a different state from "no kit at all" (`brand_kit: null`) and from
 * "the store could not be read" (`brand_kit_available: false`); all three
 * render differently, which is the whole reason they are three fields.
 */
export function brandKitPayload(uid: string, row: LicenceBrandKitRow) {
  return {
    primary_hex: row.primary_hex,
    accent_hex: row.accent_hex,
    mark_url: row.mark_r2_key ? `/api/admin/licences/${encodeURIComponent(uid)}/brand/mark` : null,
    mark_mime: row.mark_mime,
    mark_bytes: row.mark_bytes,
    updated_at: row.updated_at,
  };
}

/** The sentence every reader of an unreadable kit store prints. Said once. */
export const KIT_UNREADABLE =
  'The brand-kit store could not be read on this database (migration 281).';

/** What each notice kind is called in the mail. The CHECK's four values are
 *  machine words; this is the sentence the addressee reads. */
export const KIND_LABELS: Record<string, string> = {
  renewal_terms: 'Renewal terms',
  fees: 'Fees',
  term_violation: 'A term of the agreement',
  other: 'Your licence',
};

export const str = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);
export const intOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

export async function byUid(env: Env, uid: string): Promise<LicenceRow | null> {
  return await env.DB.prepare('SELECT * FROM territory_licences WHERE uid = ?')
    .bind(uid).first<LicenceRow>();
}

/**
 * One row of the licence's append-only history. D4707: `change` keeps what the
 * write replaced beside what it left, and `outcome` says how the write ended.
 * The row is immutable (migration 269's triggers), so a write that pushes to
 * the branch logs AFTER the push, with the outcome already known.
 */
export async function logEvent(
  env: Env, licenceId: number, event: string, actorId: number,
  detail?: unknown, note?: string | null,
  change?: { before: unknown; after: unknown },
  outcome: 'committed' | 'partial' = 'committed',
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id, created_at,
                                 before_json, after_json, outcome)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(
    licenceId, event, detail === undefined ? null : JSON.stringify(detail),
    note ?? null, actorId, nowIso(),
    change ? JSON.stringify(change.before ?? null) : null,
    change ? JSON.stringify(change.after ?? null) : null,
    outcome,
  ).run();
}

/**
 * D4707 — a write whose push to the branch did not land is PARTIAL: HQ holds
 * the change and the branch's copy does not yet (the scheduled retry owns the
 * rest). A licence with no branch has nothing to push, so it is committed.
 */
export const pushOutcome = (pushed: { ok: boolean; code?: string | null }): 'committed' | 'partial' =>
  (!pushed.ok && pushed.code ? 'partial' : 'committed');

export async function seatsOf(env: Env, licenceId: number): Promise<Record<string, number>> {
  const q = await env.DB.prepare('SELECT seat_type, seats_licensed FROM licence_seats WHERE licence_id = ?')
    .bind(licenceId).all<{ seat_type: string; seats_licensed: number }>();
  const out: Record<string, number> = {};
  for (const x of q.results || []) out[x.seat_type] = Number(x.seats_licensed);
  return out;
}

export async function countriesOf(env: Env, licenceId: number): Promise<string[]> {
  const q = await env.DB.prepare('SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code')
    .bind(licenceId).all<{ country_code: string }>();
  return (q.results || []).map((x) => x.country_code);
}

/**
 * The licence's own state machine, which until D139 existed only in prose.
 *
 * Migration 187 wrote the semantics down and nothing enforced them:
 *
 *   active      — trading
 *   suspended   — not trading, STILL HOLDS ITS TERRITORY
 *   terminated  — over; territory released
 *
 * `reinstate` was the only transition that checked, and its refusal is the
 * shape copied here. The other three accepted ANY status, so a **terminated**
 * licence — one whose territory has been released and given to somebody else —
 * could be suspended or renewed, and a renewal would push a date onto a licence
 * that is over. Nothing has exercised it: production holds zero licences. It is
 * latent, and it is cheap exactly while that is true.
 *
 * Re-suspending an already-suspended licence is refused too, and for a reason
 * the ladder made real: the UPDATE would overwrite `suspended_at`, which is
 * what HQ's Team table and the addressee's own page read as "frozen since".
 * Silently restarting that clock is worse than refusing to.
 */
export function transitionRefusal(
  status: string | null | undefined, verb: 'suspend' | 'renew' | 'terminate',
): string | null {
  const now = String(status || '');
  if (now === 'terminated') {
    return `This licence is terminated — it is over and its territory has been released, so it cannot be ${verb === 'renew' ? 'renewed' : `${verb}d`}.`;
  }
  if (verb === 'suspend' && now === 'suspended') {
    return 'This licence is already suspended. Suspending it again would restart the "suspended since" clock its administrators are measured against; reinstate it first, or edit the note on the licence.';
  }
  return null;
}

/**
 * Seats used, which is deliberately unknowable HERE and knowable on a branch.
 *
 * The canvas shows "% utilised" against seats licensed. Computing it at HQ
 * needs every account to name the licence it belongs to, and no account does
 * (U1) — that is the scoping half this ledger does not build. Returning null
 * makes the UI say so; returning 0 would read as "nobody has signed up",
 * which is a different and false claim.
 *
 * A BRANCH CAN COUNT ITS OWN, AND THAT IS NOT AN INCONSISTENCY (D127). Every
 * user in a branch's D1 *is* that branch's, so `rpc/branchOps.ts` counts
 * active accounts whose role is one a licence sells a seat for. HQ has no
 * equivalent question to ask of its own table. The two tiers answer
 * differently because the tiers differ, not because one of them is behind —
 * and `seats_used_available: false` below still says so on this side.
 */
export function seatsUsed(): null { return null; }

/**
 * Every licence with its territories and seats, in three queries not 3N.
 *
 * Exported for routes/licence.ts, the holder-facing read added in task #202.
 * A subsidiary admin must see exactly the shape HQ sees — including the null
 * `seats_used` — so the two views cannot drift into disagreeing about the
 * same licence.
 */
export async function hydrate(env: Env, rows: LicenceRow[]) {
  if (!rows.length) return [];
  // #4700 — ONE BIND PER ID, SO THE IDS GO IN CHUNKS. D1 refuses a statement
  // with more than 100 bound parameters, and this used to bind every licence
  // in one `IN (…)`: fine at today's ledger, a failed read at its 101st row.
  // Each chunk is its own statement; a licence's rows all come back in the
  // chunk that holds its id, so the per-licence order below is unchanged.
  const chunks = idChunks(rows.map((l) => l.id));
  const terr: { results: Array<{ licence_id: number; country_code: string }> } = { results: [] };
  const seats: { results: Array<{ licence_id: number; seat_type: string; seats_licensed: number }> } = { results: [] };
  for (const { part, placeholders } of chunks) {
    const t = await env.DB.prepare(
      `SELECT licence_id, country_code FROM licence_territories
        WHERE licence_id IN (${placeholders}) ORDER BY country_code`,
    ).bind(...part).all<{ licence_id: number; country_code: string }>();
    terr.results.push(...(t.results || []));
    const s = await env.DB.prepare(
      `SELECT licence_id, seat_type, seats_licensed FROM licence_seats
        WHERE licence_id IN (${placeholders})`,
    ).bind(...part).all<{ licence_id: number; seat_type: string; seats_licensed: number }>();
    seats.results.push(...(s.results || []));
  }

  // D197 — THE HOST RIDES THE LICENCE PAYLOAD, exactly as D196's `kind` did:
  // H31's strip needs no second fetch and no `api.js` read method. Its own
  // try/catch, because a database without migration 280 has no register and
  // "no host bound" is a different claim from "we could not look" — the strip
  // renders each as its own state rather than one as the other.
  const domains = new Map<number, LicenceDomainRow>();
  let domainsReadable = true;
  try {
    for (const { part, placeholders } of chunks) {
      const bound = await env.DB.prepare(
        `SELECT id, licence_id, hostname, challenge_token, state,
                txt_verified_at, cname_verified_at, last_checked_at, last_check_json,
                is_primary, detached_at, detached_by_user_id, detach_reason,
                created_by_user_id, created_at, updated_at
           FROM licence_domains WHERE licence_id IN (${placeholders})`,
      ).bind(...part).all<LicenceDomainRow>();
      for (const d of bound.results || []) domains.set(Number(d.licence_id), d);
    }
  } catch (e) {
    console.warn('[licences] licence_domains unreadable', (e as Error).message);
    domainsReadable = false;
  }

  // D198 — THE KIT RIDES THE SAME PAYLOAD, and for the same reason the host
  // does: H26's step is a tab on a licence the console has already fetched, so
  // a second `api.js` read method would buy nothing. Its own try/catch, D197's
  // idiom one table over, because a database without migration 281 has no kit
  // store and "this licence has no kit" is a different claim from "we could
  // not look" — one is a fact about the licence, the other about the database.
  const kits = new Map<number, LicenceBrandKitRow>();
  let kitsReadable = true;
  try {
    for (const { part, placeholders } of chunks) {
      const found = await env.DB.prepare(
        `SELECT id, licence_id, mark_r2_key, mark_mime, mark_bytes, primary_hex, accent_hex,
                updated_by_user_id, created_at, updated_at
           FROM licence_brand_kits WHERE licence_id IN (${placeholders})`,
      ).bind(...part).all<LicenceBrandKitRow>();
      for (const k of found.results || []) kits.set(Number(k.licence_id), k);
    }
  } catch (e) {
    console.warn('[licences] licence_brand_kits unreadable', (e as Error).message);
    kitsReadable = false;
  }

  const byLicence = new Map<number, { territories: string[]; seats: Record<string, number> }>();
  for (const l of rows) byLicence.set(l.id, { territories: [], seats: {} });
  for (const t of terr.results || []) byLicence.get(t.licence_id)?.territories.push(t.country_code);
  for (const s of seats.results || []) {
    const e = byLicence.get(s.licence_id);
    if (e) e.seats[s.seat_type] = Number(s.seats_licensed) || 0;
  }
  return rows.map((l) => {
    const e = byLicence.get(l.id)!;
    const licensed = Object.values(e.seats).reduce((a, b) => a + b, 0);
    return {
      ...l,
      territories: e.territories,
      seats: e.seats,
      seats_licensed: licensed,
      seats_used: seatsUsed(),
      domain: domainsReadable ? (domains.get(l.id) ? domainPayload(domains.get(l.id)!) : null) : null,
      domain_available: domainsReadable,
      domain_reason: domainsReadable
        ? null
        : 'The host register could not be read on this database (migration 280).',
      brand_kit: kitsReadable && kits.get(l.id) ? brandKitPayload(l.uid, kits.get(l.id)!) : null,
      brand_kit_available: kitsReadable,
      brand_kit_reason: kitsReadable ? null : KIT_UNREADABLE,
    };
  });
}

/**
 * Everything blocking activation, as a list rather than a boolean, because
 * the operator needs to know WHICH thing. Mirrors the canvas's step 5: a
 * territory conflict blocks, a pending signature does not.
 */
export async function activationBlockers(env: Env, licence: LicenceRow): Promise<string[]> {
  const out: string[] = [];
  if (licence.status === 'terminated') out.push('This licence is terminated.');
  if (licence.status === 'active') out.push('This licence is already active.');
  const terr = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM licence_territories WHERE licence_id = ?',
  ).bind(licence.id).first<{ n: number }>();
  if (!Number(terr?.n)) out.push('No territory is assigned. A licence with no country grants nothing.');
  const seats = await env.DB.prepare(
    'SELECT COALESCE(SUM(seats_licensed), 0) AS n FROM licence_seats WHERE licence_id = ?',
  ).bind(licence.id).first<{ n: number }>();
  if (!Number(seats?.n)) out.push('No seats are licensed.');
  if (licence.annual_fee_cents === null || licence.revenue_share_bps === null) {
    out.push('Commercial terms are incomplete — the fee and the revenue share are both required.');
  }
  if (!licence.renews_on) out.push('No renewal date is set.');

  // D198 — H26's step 6, in its own words: "Brand kit — REQUIRED TO ACTIVATE",
  // and "Unique to this kind · an Axal subsidiary never sees this step". So
  // this is ONE `if`, and it is gated on the kind rather than applied to every
  // licence — which is also what makes it touch nothing that exists today:
  // migration 279 defaulted every pre-existing row to `subsidiary` because the
  // create path refused white-label outright, so no row can meet this
  // condition yet.
  //
  // IT ASKS FOR THE COLOURS, NOT THE MARK. A white-label shell with no logo
  // yet is survivable; one wearing Axal's palette is not, because a colour has
  // no absent state on screen — it renders as SOMETHING, and that something
  // would be Axal's.
  if (licence.kind === 'white_label') {
    let kit: { primary_hex: string | null; accent_hex: string | null } | null = null;
    let readable = true;
    try {
      kit = await env.DB.prepare(
        'SELECT primary_hex, accent_hex FROM licence_brand_kits WHERE licence_id = ?',
      ).bind(licence.id).first<{ primary_hex: string | null; accent_hex: string | null }>();
    } catch (e) {
      console.warn('[licences] licence_brand_kits unreadable', (e as Error).message);
      readable = false;
    }
    // FAILS CLOSED, and the reason is the same one the blocker list exists
    // for: "we could not tell" is not "it is fine". An operator reads which
    // thing is missing, and an unreadable store is a thing that is missing.
    if (!readable) out.push(`${KIT_UNREADABLE} A white-label cannot be activated until it can.`);
    else if (!kit || !kit.primary_hex || !kit.accent_hex) {
      out.push(
        'This is a white-label licence and its brand kit has no colours. A white-label shell with '
        + 'no palette of its own renders Axal\'s, which is the one thing the kind exists to prevent.',
      );
    }
  }
  return out;
}
