/**
 * D984 (#2775, part 3 of #2376) — the programs HQ grants the caller's licence,
 * read only (GR7). Mounted at `/api/licence`, beside `licence_requests.ts`.
 *   GET /api/licence/mine/programs
 *
 * ON HQ, the licence is the one `licence_admins` binds the caller to, as
 * `licence_requests.ts` binds it, and the programs are read from part 1's
 * store (`program_grants`, migration 553).
 *
 * AN ACCOUNT NO LICENCE BINDS reads its own answer, not an empty list and not
 * a 404: on HQ-held accounts HQ runs every program (GR11 C, D981 §5 decision
 * 1). `linked: false` says which answer it is.
 *
 * ON A BRANCH, the read answers from the dated copy HQ pushes
 * (`branch_licence.program_grants_json`, migration 554), with `as_of`, HQ's
 * time for the copy, and its age. Only an admin reads it, as `GET /mine` on a
 * branch: the copy is the whole deployment's and carries HQ's fees. A copy
 * HQ has not sent yet says so with `programs: null` and a reason.
 *
 * A D1 error, or a copy that cannot be read, is a 503, never an empty list.
 * Nothing here writes: asking HQ for a program is a request (part 2, #2774).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { branchOf } from '../util/branch';
import { nowIso } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import type { LicenceLite } from '../services/programGrants';
import { UNLINKED_REASON, parseProgramCopy, programCopy, studioPrograms, unlinkedPrograms } from '../services/licencePrograms';

const r = new Hono<{ Bindings: Env }>();

const today = () => nowIso().slice(0, 10);
const UNREADABLE = { code: 'licence_programs_unreadable', message: 'Your programs could not be read. That is not the same as none. Try again in a moment.' };
const licenceOut = (l: LicenceLite) => ({ uid: l.uid, licence_ref: l.licence_ref, brand_name: l.brand_name, kind: l.kind, status: l.status });

/** The branch's answer, from the copy HQ pushed. */
async function fromCopy(c: any) {
  let row: Record<string, any> | null;
  try {
    row = await c.env.DB.prepare(
      `SELECT licence_uid, licence_ref, brand_name, kind, status, renewal_at, pushed_at, program_grants_json
         FROM branch_licence WHERE id = 1`,
    ).first();
  } catch (e) {
    return refuse(c, 503, { ...UNREADABLE, raw: e });
  }
  if (!row) {
    return c.json({
      linked: true, source: 'copy', as_of: null, age_seconds: null, licence: null, programs: null,
      reason: 'This branch holds no copy of its licence yet. Opening the licence page asks HQ for it.',
    });
  }
  const licence: LicenceLite = {
    id: 0, uid: String(row.licence_uid), licence_ref: row.licence_ref ?? null, brand_name: row.brand_name ?? null,
    kind: row.kind ?? null, status: String(row.status), renews_on: row.renewal_at ?? null,
  };
  const asOf = row.pushed_at ?? null;
  const age = asOf ? Math.max(0, Math.round((Date.now() - Date.parse(asOf)) / 1000)) : null;
  const head = { linked: true, source: 'copy', as_of: asOf, age_seconds: Number.isFinite(age) ? age : null, licence: licenceOut(licence) };
  if (row.program_grants_json == null) {
    return c.json({
      ...head, programs: null,
      reason: 'HQ has not sent this branch its programs yet. They arrive with HQ\'s next change to this licence or its grants.',
    });
  }
  let copy;
  try { copy = parseProgramCopy(String(row.program_grants_json)); } catch { copy = null; }
  if (!copy) return refuse(c, 503, { ...UNREADABLE, raw: new Error('branch_licence.program_grants_json is not a program copy') });
  return c.json({ ...head, programs: studioPrograms(copy, licence, today()), reason: null });
}

// GET /api/licence/mine/programs
r.get('/mine/programs', async (c) => {
  const user = await requireAuth(c);
  if (branchOf(c.env)) {
    if (user.role !== 'admin') throw new Error('Admin required');
    return fromCopy(c);
  }
  try {
    const licence = await c.env.DB.prepare(
      `SELECT l.id, l.uid, l.licence_ref, l.brand_name, l.kind, l.status, l.renews_on
         FROM licence_admins la
         JOIN territory_licences l ON l.id = la.licence_id
        WHERE la.user_id = ?`,
    ).bind(user.id).first<LicenceLite>();
    if (!licence) {
      return c.json({ linked: false, source: 'hq', as_of: null, age_seconds: null, licence: null, programs: unlinkedPrograms(), reason: UNLINKED_REASON });
    }
    const copy = await programCopy(c.env, Number(licence.id));
    return c.json({
      linked: true, source: 'hq', as_of: null, age_seconds: null, licence: licenceOut(licence),
      programs: studioPrograms(copy, licence, today()), reason: null,
    });
  } catch (e) {
    return refuse(c, 503, { ...UNREADABLE, raw: e });
  }
});

export default r;
