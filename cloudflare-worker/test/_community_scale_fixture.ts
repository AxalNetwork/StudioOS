/**
 * #4717 package 5 — a representative LARGE Community: about three years of a
 * busy network, over the real migrated schema in node:sqlite. It is what the
 * Community reads' query plans and statement budgets are measured on
 * (`community_reads_4717.test.ts`) and what `scripts/perf/community-bench.mjs`
 * times.
 *
 * The sizes are chosen so that a full-history scan shows in a query plan and
 * in the time, not so that they match production. Every row is synthetic and
 * made from a fixed seed, so two builds are the same rows. No person is real.
 *
 *   events               1,500 over 3 years (every status), 60,000 registrations, 20,000 check-ins
 *   admin_audit_log     40,000 (15,000 community acts, 25,000 other actions)
 *   job_postings         2,000, 30,000 applications
 *   experts                200,  8,000 bookings
 *   wellbeing pulses    50,000
 *   circles 300, network profiles 1,000, users 5,000
 */
import { DatabaseSync } from 'node:sqlite';
import { loadSchema } from './_schema_once.mjs';

/** The fixture's own clock: Wednesday 21 October 2026, noon UTC. */
export const SCALE_NOW = Date.parse('2026-10-21T12:00:00Z');
const DAY = 86_400_000;
const SPAN_DAYS = 3 * 365;

export const SCALE = Object.freeze({
  users: 5000, events: 1500, registrations: 60000, checkins: 20000, audit: 40000, communityActs: 15000,
  postings: 2000, applications: 30000, experts: 200, bookings: 8000, pulses: 50000, circles: 300, profiles: 1000,
});

/** A small deterministic generator (mulberry32), so the fixture is the same rows on every build. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** SQLite's own `YYYY-MM-DD HH:MM:SS`, the format `datetime('now')` writes. */
const sqlAt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
/** Some writers store ISO 8601 with a T and a Z (D124): a share of rows does, so a bare comparison would be caught. */
const isoAt = (ms: number) => new Date(ms).toISOString();

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const EVENT_STATUS = ['published', 'published', 'published', 'pending_review', 'draft', 'cancelled', 'rejected'] as const;
const EVENT_TYPES = ['demo_day', 'workshop', 'office_hours', 'networking', 'meetup', 'webinar', 'other'] as const;
const REG_STATUS = ['registered', 'confirmed', 'attended', 'attended', 'waitlisted', 'cancelled', 'declined'] as const;
const ROLES = ['founder', 'founder', 'investor', 'advisor', 'partner', 'exploring', 'admin'] as const;
const JOB_STATUS = ['published', 'published', 'pending_review', 'draft', 'closed', 'rejected'] as const;
const COMMUNITY_ACTS = [
  ['events', 'event_approved'], ['events', 'event_rejected'], ['events', 'event_featured'], ['events', 'event_submitted'],
  ['jobs', 'job_approved'], ['jobs', 'job_rejected'], ['circles', 'circle_published'], ['circles', 'circle_created'],
  ['wellbeing', 'expert_verified'], ['wellbeing', 'expert_hidden'],
] as const;
const OTHER_ACTS = ['report_export', 'user_view', 'impersonation_check', 'settings_update', 'licence_issue'] as const;

/** The database, filled. `close()` when done. */
export async function communityScale(seed = 4717) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  await loadSchema(db);
  const r = rng(seed);
  const at = (daysBack: number) => SCALE_NOW - daysBack * DAY - Math.floor(r() * DAY);
  const when = (ms: number) => (r() < 0.2 ? isoAt(ms) : sqlAt(ms));

  db.exec('BEGIN');
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  for (let i = 1; i <= SCALE.users; i++) u.run(i, pick(r, ROLES), `Synthetic ${i}`, `synthetic${i}@example.invalid`);

  const ev = db.prepare(`INSERT INTO events (id, slug, title, type, starts_at, ends_at, status, capacity, host_user_id, created_at, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (let i = 1; i <= SCALE.events; i++) {
    // Starts from three years back to sixty days ahead.
    const start = SCALE_NOW + Math.floor((r() * (SPAN_DAYS + 60) - SPAN_DAYS) * DAY);
    const status = pick(r, EVENT_STATUS);
    ev.run(i, `event-${i}`, `Synthetic event ${i}`, pick(r, EVENT_TYPES), when(start), sqlAt(start + 2 * 3_600_000), status,
      r() < 0.3 ? null : 20 + Math.floor(r() * 180), 1 + Math.floor(r() * SCALE.users), sqlAt(start - 30 * DAY),
      status === 'pending_review' && r() < 0.8 ? sqlAt(start - 20 * DAY) : null);
  }
  const reg = db.prepare(`INSERT INTO event_registrations (event_id, user_id, email, status, payment_status, registered_at) VALUES (?, ?, ?, ?, ?, ?)`);
  for (let i = 1; i <= SCALE.registrations; i++) {
    reg.run(1 + (i % SCALE.events), i, `reg${i}@example.invalid`, pick(r, REG_STATUS), r() < 0.2 ? 'paid' : 'none', when(at(Math.floor(r() * SPAN_DAYS))));
  }

  // Registrations ON the period boundaries (4, 12 and 52 weeks, and the periods before them), in both
  // formats: a count that takes `<=` for `<`, or starts a period a moment late, is off by these.
  const monday = Date.parse('2026-10-19T00:00:00Z');
  let extra = SCALE.registrations;
  for (const weeks of [4, 12, 52]) {
    const start = monday - (weeks - 1) * 7 * DAY;
    for (const edge of [start, start - weeks * 7 * DAY, monday + 7 * DAY]) {
      for (const fmt of [sqlAt, isoAt]) {
        extra += 1;
        reg.run(1 + (extra % SCALE.events), extra, `edge${extra}@example.invalid`, 'registered', 'none', fmt(edge));
      }
    }
  }

  // A check-in for every third registration, a few minutes after it; a few were never scanned (no time).
  const chk = db.prepare(`INSERT INTO event_checkins (event_id, registration_id, code, checked_in_at)
    SELECT event_id, id, 'code-' || id, CASE WHEN id % 50 = 0 THEN NULL ELSE datetime(registered_at, '+5 minutes') END
      FROM event_registrations WHERE id % 3 = 0 LIMIT ?`);
  chk.run(SCALE.checkins);

  const audit = db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, exported_at) VALUES (?, ?, ?, ?, ?)`);
  for (let i = 1; i <= SCALE.audit; i++) {
    const back = Math.floor(r() * SPAN_DAYS);
    if (i <= SCALE.communityActs) {
      const [type, action] = pick(r, COMMUNITY_ACTS);
      const ids = { event_id: 1 + Math.floor(r() * SCALE.events), posting_id: 1 + Math.floor(r() * SCALE.postings), circle_id: 1 + Math.floor(r() * SCALE.circles) };
      audit.run(1 + Math.floor(r() * 50), action, type, JSON.stringify(ids), sqlAt(at(back)));
    } else {
      audit.run(1 + Math.floor(r() * 50), pick(r, OTHER_ACTS), 'other', '{}', sqlAt(at(back)));
    }
  }

  const job = db.prepare(`INSERT INTO job_postings (id, slug, title, status, host_user_id, created_at, updated_at, submitted_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (let i = 1; i <= SCALE.postings; i++) {
    const made = at(Math.floor(r() * SPAN_DAYS));
    const status = pick(r, JOB_STATUS);
    job.run(i, `posting-${i}`, `Synthetic role ${i}`, status, 1 + Math.floor(r() * SCALE.users), sqlAt(made), sqlAt(made + 5 * DAY),
      status === 'pending_review' ? sqlAt(made + DAY) : null, status === 'published' ? sqlAt(made + 2 * DAY) : null);
  }
  const app = db.prepare(`INSERT INTO job_applications (posting_id, user_id, email, created_at) VALUES (?, ?, ?, ?)`);
  for (let i = 1; i <= SCALE.applications; i++) {
    app.run(1 + (i % SCALE.postings), r() < 0.2 ? null : 1 + Math.floor(r() * SCALE.users), `app${i}@example.invalid`, sqlAt(at(Math.floor(r() * SPAN_DAYS))));
  }

  const ex = db.prepare(`INSERT INTO experts (id, name, verified, is_active, hidden_by_admin) VALUES (?, ?, ?, ?, ?)`);
  for (let i = 1; i <= SCALE.experts; i++) ex.run(i, `Synthetic expert ${i}`, r() < 0.7 ? 1 : 0, r() < 0.9 ? 1 : 0, r() < 0.05 ? 1 : 0);
  const bk = db.prepare(`INSERT INTO expert_bookings (expert_id, user_id, status, created_at) VALUES (?, ?, 'confirmed', ?)`);
  for (let i = 1; i <= SCALE.bookings; i++) bk.run(1 + Math.floor(r() * SCALE.experts), 1 + Math.floor(r() * SCALE.users), sqlAt(at(Math.floor(r() * SPAN_DAYS))));

  const pulse = db.prepare(`INSERT INTO wellbeing_daily_pulses (user_id, day) VALUES (?, ?)`);
  for (let i = 0; i < SCALE.pulses; i++) {
    // One pulse per user per day: users cycle, days walk back.
    pulse.run(1 + (i % SCALE.users), sqlAt(SCALE_NOW - Math.floor(i / SCALE.users) * DAY).slice(0, 10));
  }

  const ci = db.prepare(`INSERT INTO circles (id, slug, name, type, published, featured) VALUES (?, ?, ?, ?, ?, ?)`);
  for (let i = 1; i <= SCALE.circles; i++) ci.run(i, `circle-${i}`, `Synthetic circle ${i}`, pick(r, ['founder', 'city', 'topic'] as const), r() < 0.8 ? 1 : 0, r() < 0.1 ? 1 : 0);
  const np = db.prepare(`INSERT INTO network_profiles (name, kind, is_active) VALUES (?, ?, ?)`);
  for (let i = 1; i <= SCALE.profiles; i++) np.run(`Synthetic profile ${i}`, pick(r, ['advisor', 'partner', 'investor'] as const), r() < 0.8 ? 1 : 0);
  db.exec('COMMIT');
  db.exec('ANALYZE');
  return db;
}
