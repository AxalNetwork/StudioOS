/**
 * D4663 (#4663) test helper: a Spin-Out Lab population for the public
 * reporting reads (`/graduates`, `/stats`, `/cohort`), and a D1 binding that
 * counts what those reads cost. Every value is invented.
 *
 *   reportingWorld(db, { graduates, active })
 *       Graduates and active founders who each own THREE projects, so a read
 *       that joins projects by founder multiplies its rows. The enrollment
 *       names the middle project (never the lowest id, so "the first project"
 *       and "the enrolled venture" differ); every fifth founder has none
 *       bound (D4659's needs_choice). Every seventh has no application, so a
 *       founder in both groups has no company name anywhere. Graduation dates
 *       fall one per day back from now, so the 45-day `/cohort` window holds
 *       some of them. One credential holder (by_rule = 0) graduates without a
 *       full set of milestones.
 *   meteredD1(db)
 *       d1Over(db), plus `stats`: statements executed and rows returned to
 *       the Worker (an `.all()` counts its rows, a `.first()` one row or none).
 */
import type { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { graduate, insertRow } from './_lab_evidence.ts';

export type WorldSize = { graduates: number; active: number };
export const GRAD_BASE = 100_000;
export const ACTIVE_BASE = 200_000;
export const CREDENTIAL_HOLDER = 300_000;

const sqliteTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

function founderWithProjects(db: DatabaseSync, id: number, label: string, i: number, active: boolean, startedAt: string | null) {
  db.prepare(`INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active, spinout_lab_week, spinout_lab_started_at)
              VALUES (?, 'founder', 'Synthetic Founder', ?, 1, ?, ?, ?, ?)`)
    .run(id, `u${id}@example.test`, id, active ? 1 : 0, active ? (i % 4) + 1 : 4, startedAt);
  const ids = [
    insertRow(db, 'projects', { uid: `p-${id}-a`, founder_id: id, name: `${label} Side ${i}a`, status: 'active' }),
    insertRow(db, 'projects', {
      uid: `p-${id}-v`, founder_id: id, name: `${label} Co ${i}`, sector: i % 2 ? 'fintech' : 'health',
      status: i % 4 === 0 ? 'rejected' : 'active',
      total_funding: i % 3 === 0 ? 100_000 + i : null, last_funding_round: i % 3 === 0 ? 'seed' : null,
    }),
    insertRow(db, 'projects', { uid: `p-${id}-b`, founder_id: id, name: `${label} Side ${i}b`, status: 'active' }),
  ];
  db.prepare(`INSERT INTO spinout_lab_enrollments (user_id, kind, project_id) VALUES (?, 'legacy', ?)`)
    .run(id, i % 5 === 0 ? null : ids[1]);
  if (i % 7 !== 0) {
    insertRow(db, 'spinout_applications', { user_id: id, company_name: `${label} Older ${i}`, idea: 'x' });
    insertRow(db, 'spinout_applications', { user_id: id, company_name: `${label} Applied ${i}`, idea: 'x' });
  }
  if (i % 3 === 0) {
    db.prepare(`INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort) VALUES (?, 1, ?)`).run(id, `Cohort ${1 + (i % 4)}`);
  }
}

/** Noon UTC today: dates relative to it stay inside SQLite's `datetime('now')` windows and repeat within a day. */
export const worldNow = (ms = Date.now()) => Math.floor(ms / 86_400_000) * 86_400_000 + 43_200_000;

export function reportingWorld(db: DatabaseSync, size: WorldSize, nowMs = worldNow()): void {
  db.exec('BEGIN');
  for (let i = 0; i < size.graduates; i++) {
    const id = GRAD_BASE + i;
    founderWithProjects(db, id, 'Grad', i, false, sqliteTime(nowMs - (i + 30) * 86_400_000));
    graduate(db, id, sqliteTime(nowMs - (i + 1) * 86_400_000 - i * 1000));
  }
  for (let j = 0; j < size.active; j++) {
    founderWithProjects(db, ACTIVE_BASE + j, 'Active', j, true, sqliteTime(nowMs - (j % 27) * 86_400_000 - j * 1000));
  }
  // A credential issued before the D4659 rule: a graduate with no milestones.
  founderWithProjects(db, CREDENTIAL_HOLDER, 'Credential', 1, false, null);
  insertRow(db, 'spinout_certificates', {
    credential_id: 'AXL-T-4663', user_id: CREDENTIAL_HOLDER, status: 'issued',
    public_name: 'S', public_issued_on: sqliteTime(nowMs - 2 * 86_400_000 - 500),
  });
  db.exec('COMMIT');
}

export type D1Stats = { statements: number; rows: number; sql: string[] };

export function meteredD1(db: DatabaseSync): { DB: any; stats: D1Stats; reset(): void } {
  const base: any = d1Over(db);
  const stats: D1Stats = { statements: 0, rows: 0, sql: [] };
  const DB = {
    ...base,
    prepare(sql: string) {
      const st = base.prepare(sql);
      const note = (rows: number) => { stats.statements++; stats.rows += rows; stats.sql.push(sql.replace(/\s+/g, ' ').trim()); };
      const api: any = {
        bind(...a: unknown[]) { st.bind(...a); return api; },
        all: async () => { const r = await st.all(); note((r?.results ?? []).length); return r; },
        first: async (col?: string) => { const r = await st.first(col); note(r == null ? 0 : 1); return r; },
        run: async () => { const r = await st.run(); note(0); return r; },
        runSync: () => st.runSync(),
      };
      return api;
    },
  };
  return { DB, stats, reset() { stats.statements = 0; stats.rows = 0; stats.sql = []; } };
}
