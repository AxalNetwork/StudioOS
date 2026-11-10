/**
 * D5247 (#5247) — each Security store's last good read and its own age, so the Overview can mark a source Stale.
 *
 * WHY. Before this, no Security store recorded when it was last read successfully, so every "Read HH:MM UTC" on
 * the Overview was the moment the browser received the answer and the vocabulary's Stale state could never apply
 * (D4800 §5). The owner answered #4800's questions on 2026-11-09:
 *   C1  record a last-successful-read time per store;
 *   B2  a store is Stale past ITS OWN age, not one age for every store: about 26 h for the nightly backup
 *       heartbeat, none for sanctions screenings (they run on request only), and the rest set from how often each
 *       store is written (D5247.md gives the reasoning per store).
 *
 * TWO CLOCKS, NAMED PER STORE (`age_from`).
 *   last_read  the age runs from the last time a Security read of the store answered. For a ledger that is written
 *              about once per age, a last good read older than that has probably missed rows.
 *   evidence   the age runs from the store's own stamp — the backup heartbeat's recovery point, the restore drill's
 *              marker — because those are evidence of a job that runs on a schedule, and a successful read of an
 *              old heartbeat is not a recent backup. Their ages are the ones `services/backup.ts` already applies
 *              (BACKUP_STALE_AFTER_HOURS, DRILL_STALE_AFTER_DAYS), so the two cannot disagree.
 *
 * FOUR ANSWERS, NEVER A GUESS (`freshness`).
 *   current       the last good time is inside the age;
 *   stale         it is older than the age — a modifier beside the store's state, never "nothing open";
 *   not_recorded  no good time exists yet: never 0, never "now", never Stale;
 *   no_age        the store has no age (sanctions): it is never Stale, whatever its time.
 *
 * Recording is best-effort: a failed write never fails the read it follows, and a table that cannot be read
 * leaves every recorded time Not recorded rather than inventing one.
 */
import type { Env } from '../types';
import { BACKUP_STALE_AFTER_HOURS, DRILL_STALE_AFTER_DAYS } from './backup';

export type SecuritySource =
  | 'security_events'
  | 'admin_audit_log'
  | 'activity_logs'
  | 'impersonation_sessions'
  | 'licence_events'
  | 'backup_d1'
  | 'backup_kv'
  | 'restore_drill'
  | 'sanctions_screenings';

export type AgeFrom = 'last_read' | 'evidence';

export type SourceAge = {
  /** Hours past which the store is Stale; null when the store has no age. */
  age_hours: number | null;
  age_from: AgeFrom;
  /** One sentence: how often the store is written, which is where the age comes from. */
  basis: string;
};

/**
 * D5247 — every Security store's age. In key order (D4134): a new store is a new line at its place.
 */
export const SOURCE_AGES: Readonly<Record<SecuritySource, SourceAge>> = Object.freeze({
  activity_logs: {
    age_hours: 24,
    age_from: 'last_read',
    basis: 'The admin-side rows the ledger reads (role changes, account switches, KYC decisions, contract void and resend) are written on most working days.',
  },
  admin_audit_log: {
    age_hours: 24,
    age_from: 'last_read',
    basis: 'Every admin write records a row through logAdminAction, which several hundred routes call; HQ writes it every working day.',
  },
  backup_d1: {
    age_hours: BACKUP_STALE_AFTER_HOURS,
    age_from: 'evidence',
    basis: 'The nightly D1 export writes the heartbeat once a day; the age is its 24-hour recovery point plus the two hours the export is given to run.',
  },
  backup_kv: {
    age_hours: BACKUP_STALE_AFTER_HOURS,
    age_from: 'evidence',
    basis: 'The daily KV snapshot cron writes its heartbeat once a day, on the same window as the D1 export.',
  },
  impersonation_sessions: {
    age_hours: 24 * 7,
    age_from: 'last_read',
    basis: 'A row is written only when support opens a session on a member\'s account, which happens a few times a week, not daily.',
  },
  licence_events: {
    age_hours: 24 * 7,
    age_from: 'last_read',
    basis: 'A row is written on a licence\'s issue, re-term, renewal, suspension, reinstatement or termination, which happen weekly rather than daily.',
  },
  restore_drill: {
    age_hours: DRILL_STALE_AFTER_DAYS * 24,
    age_from: 'evidence',
    basis: 'The restore drill runs monthly and writes its marker on every exit; the age is the longest gap between two monthly runs.',
  },
  sanctions_screenings: {
    age_hours: null,
    age_from: 'last_read',
    basis: 'Screenings run on request only, never on a schedule, so no age makes the store out of date (the owner\'s answer B2).',
  },
  security_events: {
    age_hours: 6,
    age_from: 'last_read',
    basis: 'Written at the auth boundary on every refused sign-in, step-up and gate refusal, which happen several times a day.',
  },
});

export const SECURITY_SOURCES = Object.freeze(Object.keys(SOURCE_AGES) as SecuritySource[]);

export const isSecuritySource = (s: unknown): s is SecuritySource =>
  typeof s === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_AGES, s);

export type Freshness = 'current' | 'stale' | 'not_recorded' | 'no_age';

export type Recorded = { last_read_at: string | null; evidence_at: string | null };

export type SourceFreshness = {
  source: SecuritySource;
  /** Whether THIS request read the store successfully. */
  answered: boolean;
  /** The last successful read, this one if it answered; null is Not recorded. */
  last_read_at: string | null;
  /** The store's own evidence stamp, for an `evidence` store; null otherwise or when none is known. */
  evidence_at: string | null;
  /** The time the age runs from: `last_read_at` or `evidence_at`, by `age_from`. */
  last_good_at: string | null;
  age_hours: number | null;
  age_from: AgeFrom;
  basis: string;
  freshness: Freshness;
};

const ms = (s: string | null | undefined): number => {
  if (!s) return NaN;
  // A SQL `datetime()` stamp carries no zone and is UTC; an ISO one says its own.
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`);
};

/**
 * One store's freshness, from what this request read and what was recorded before it.
 *
 * `evidence_at` is the store's own stamp from THIS read when it answered with valid evidence; when it did not, the
 * recorded stamp from the last good read stands in, so a failed read still says how old the last good evidence is.
 */
export function sourceFreshness(input: {
  source: SecuritySource;
  answered: boolean;
  evidence_at?: string | null;
  recorded?: Recorded | null;
  now: number;
}): SourceFreshness {
  const age = SOURCE_AGES[input.source];
  const nowIso = new Date(input.now).toISOString();
  const lastRead = input.answered ? nowIso : (input.recorded?.last_read_at ?? null);
  const evidence = age.age_from === 'evidence'
    ? (Number.isFinite(ms(input.evidence_at)) ? input.evidence_at! : (input.recorded?.evidence_at ?? null))
    : null;
  const lastGood = age.age_from === 'evidence' ? evidence : lastRead;
  const goodMs = ms(lastGood);
  let freshness: Freshness;
  if (age.age_hours === null) freshness = 'no_age';
  else if (!Number.isFinite(goodMs)) freshness = 'not_recorded';
  else freshness = input.now - goodMs > age.age_hours * 3_600_000 ? 'stale' : 'current';
  return {
    source: input.source,
    answered: input.answered,
    last_read_at: lastRead,
    evidence_at: evidence,
    last_good_at: Number.isFinite(goodMs) ? lastGood : null,
    age_hours: age.age_hours,
    age_from: age.age_from,
    basis: age.basis,
    freshness,
  };
}

/**
 * The recorded rows for these stores, or null when the table cannot be read (every recorded time is then Not
 * recorded; this read never fails the page).
 */
export async function loadSourceReads(env: Env, sources: SecuritySource[]): Promise<Map<SecuritySource, Recorded> | null> {
  if (sources.length === 0) return new Map();
  try {
    // The table holds one row per store (nine at most), so it is read whole and filtered here.
    const res = await env.DB.prepare(
      'SELECT source, last_read_at, evidence_at FROM security_source_reads',
    ).all<{ source: string; last_read_at: string | null; evidence_at: string | null }>();
    const wanted = new Set<string>(sources);
    const out = new Map<SecuritySource, Recorded>();
    for (const r of res.results || []) {
      if (isSecuritySource(r.source) && wanted.has(r.source)) {
        out.set(r.source, { last_read_at: r.last_read_at ?? null, evidence_at: r.evidence_at ?? null });
      }
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Record this request's good reads, one statement per store in one batch. Only answered stores are written, so a
 * failed read never moves a last good time; an evidence stamp is kept as it was when this read found none (an
 * invalid heartbeat does not erase the last valid one). Never throws.
 */
export async function recordSourceReads(env: Env, rows: SourceFreshness[]): Promise<void> {
  // Only reads that answered: a failed read's `last_read_at` is the recorded one, so writing it back would change
  // nothing but cost a write.
  const good = rows.filter((r) => r.answered && r.last_read_at);
  if (good.length === 0) return;
  try {
    const stmt = `INSERT INTO security_source_reads (source, last_read_at, evidence_at) VALUES (?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET last_read_at = excluded.last_read_at,
        evidence_at = COALESCE(excluded.evidence_at, security_source_reads.evidence_at)`;
    await env.DB.batch(good.map((r) => env.DB.prepare(stmt).bind(r.source, r.last_read_at, r.evidence_at)));
  } catch {
    // Best-effort by design: a missing table or a failed write costs the next read its recorded time, never this one.
  }
}

/**
 * Freshness for a set of stores in one step: read what was recorded, compute each store, record the good reads.
 */
export async function freshnessFor(
  env: Env,
  reads: Array<{ source: SecuritySource; answered: boolean; evidence_at?: string | null }>,
  now: number = Date.now(),
): Promise<SourceFreshness[]> {
  const recorded = await loadSourceReads(env, reads.map((r) => r.source));
  const rows = reads.map((r) => sourceFreshness({ ...r, recorded: recorded?.get(r.source) ?? null, now }));
  await recordSourceReads(env, rows);
  return rows;
}
