/** D6705: founder-owned formation participants, requirements, capital and sharing permissions. */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { branchOf } from '../util/branch';
import { refuse } from '../util/refusal';
import {
  caseNoticeCopy,
  deliverPersonNotice,
  ownedCase,
  founderWrite,
  personRequirements,
  ROLES,
  editable,
  type FounderCase,
} from '../services/formationPeople';
import { isDate } from '../services/formationPartners';
import { formationCountry } from '../services/formationPrefill';

const router = new Hono<{ Bindings: Env }>();
const authorizedCases = new WeakMap<Request, FounderCase>();
router.use('*', bodyLimit({ maxSize: 16384, onError: c => refuse(c, 413, { code: 'payload_too_large', message: 'That formation request is too large.' }) }));
router.use('/:uid/*', async (c, next) => {
  const actor = await requireAuth(c);
  c.header('Cache-Control', 'private, no-store');
  const row = !branchOf(c.env) && (await ownedCase(c.env, c.req.param('uid')!, actor.id));
  if (!row) return refuse(c, 404, { code: 'case_not_found', message: 'Case unavailable.' });
  authorizedCases.set(c.req.raw, row);
  await next();
});
router.get('/:uid/people', async (c) => {
  const row = authorizedCases.get(c.req.raw)!;
  const db = c.env.DB;
  const people = await db
    .prepare(
      `SELECT p.id,p.name,p.user_id,p.residence_country,p.nationality,p.ownership_bps,p.is_entity,p.verification_state,
    (SELECT json_group_array(role) FROM formation_case_person_roles WHERE person_id=p.id) AS roles_json
    FROM formation_case_people p WHERE p.case_id=? AND p.removed_at IS NULL ORDER BY p.id`,
    )
    .bind(row.id)
    .all();
  const capital = await db
    .prepare(
      'SELECT amount_minor,currency,share_count,evidence_document_id FROM formation_case_capital WHERE case_id=?',
    )
    .bind(row.id)
    .first();
  const consents = await db
    .prepare(
      'SELECT id,kind,scope,partner_id,given_at,withdrawn_at FROM formation_case_consents WHERE case_id=? ORDER BY id',
    )
    .bind(row.id)
    .all();
  return c.json({
    people: people.results.map(({ roles_json, ...p }) => ({ ...p, roles: JSON.parse(String(roles_json)) })),
    capital,
    message: row.hold_reason ? 'We are checking your details' : null,
    consents: consents.results,
    requirements: await personRequirements(c.env, row.id),
    revision: row.revision,
  });
});
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
function bounded(v: unknown, max: number): v is string {
  return typeof v === 'string' && !!v.trim() && v.length <= max;
}
router.post('/:uid/notice/:person', async (c) => {
  const row = authorizedCases.get(c.req.raw)!;
  const id = Number(c.req.param('person'));
  if (!positive(id) || !row.partner_id || row.closed_at)
    return refuse(c, 409, { code: 'notice_unavailable', message: 'A current case assignment is required.' });
  const status = await deliverPersonNotice(
    c.env,
    row.id,
    id,
    row.partner_id,
    await caseNoticeCopy(c.env, row.id),
  );
  return c.json({ status, placeholder: status === 'awaiting_counsel' });
});
router.post('/:uid/:action', async (c) => {
  const row = authorizedCases.get(c.req.raw)!,
    action = c.req.param('action'),
    db = c.env.DB;
  const bad = () =>
    refuse(c, 400, { code: 'invalid_formation_input', message: 'Check the supplied formation details.' });
  const conflict = () =>
    refuse(c, 409, {
      code: 'formation_case_moved',
      message: 'Reload this case and check whether it can still be edited.',
    });
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return bad();
  if (
    b.revision !== row.revision ||
    (action !== 'withdraw' && (row.closed_at || (action !== 'consent' && !editable.includes(row.stage))))
  )
    return conflict();
  const stmts: D1PreparedStatement[] = [];
  const changed = db.prepare('SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END');
  switch (action) {
    case 'add':
    case 'edit': {
      if (
        (b.date_of_birth != null &&
          (b.is_entity ||
            !isDate(b.date_of_birth) ||
            b.date_of_birth > new Date().toISOString().slice(0, 10))) ||
        !bounded(b.name, 200) ||
        !Array.isArray(b.roles) ||
        !b.roles.length ||
        b.roles.some((r: any) => !ROLES.includes(r)) ||
        new Set(b.roles).size !== b.roles.length ||
        !Number.isSafeInteger(b.ownership_bps) ||
        b.ownership_bps < 0 ||
        b.ownership_bps > 10000 ||
        (b.notice_email != null &&
          (b.user_id != null ||
            !bounded(b.notice_email, 254) ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.notice_email))) ||
        typeof b.is_entity !== 'boolean' ||
        (b.user_id != null && (!positive(b.user_id) || b.is_entity)) ||
        [b.residence_country, b.nationality].some(
          (v) => v != null && (typeof v !== 'string' || formationCountry(v) !== v),
        )
      )
        return bad();
      const vals = [
        b.name.trim(),
        b.user_id ?? null,
        b.residence_country ?? null,
        b.nationality ?? null,
        b.date_of_birth ?? null,
        b.notice_email ?? null,
        b.ownership_bps,
        Number(b.is_entity),
      ];
      if (action === 'add') {
        const uid = crypto.randomUUID();
        stmts.push(
          db
            .prepare(
              'INSERT INTO formation_case_people(uid,name,user_id,residence_country,nationality,date_of_birth,notice_email,ownership_bps,is_entity,case_id) VALUES(?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(uid, ...vals, row.id),
          db
            .prepare(
              'INSERT INTO formation_case_person_roles(person_id,role) SELECT p.id,r.value FROM formation_case_people p,json_each(?) r WHERE p.uid=?',
            )
            .bind(JSON.stringify(b.roles), uid),
        );
      } else {
        if (!positive(b.id)) return bad();
        stmts.push(
          db
            .prepare(
              `UPDATE formation_case_people SET name=?,user_id=?,residence_country=?,nationality=?,date_of_birth=?,notice_email=?,ownership_bps=?,is_entity=?,
          verification_state='unverified',verification_reference=NULL,verified_by_party=NULL,verified_at=NULL,notice_sent_at=NULL,notice_partner_id=NULL,
          consent_to_act_at=NULL,revision=revision+1 WHERE case_id=? AND id=? AND removed_at IS NULL`,
            )
            .bind(...vals, row.id, b.id),
          changed,
          db.prepare('DELETE FROM formation_case_person_roles WHERE person_id=?').bind(b.id),
          db
            .prepare(
              'INSERT INTO formation_case_person_roles(person_id,role) SELECT ?,value FROM json_each(?)',
            )
            .bind(b.id, JSON.stringify(b.roles)),
        );
      }
      break;
    }
    case 'remove':
      if (!positive(b.id)) return bad();
      stmts.push(
        db
          .prepare(
            "UPDATE formation_case_people SET removed_at=CURRENT_TIMESTAMP,notice_email=NULL,revision=revision+1 WHERE case_id=? AND id=? AND removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM formation_case_screenings WHERE person_id=? AND severity<>'none' AND decision IS NULL)",
          )
          .bind(row.id, b.id, b.id),
        changed,
      );
      break;
    case 'capital':
      if (
        !Number.isSafeInteger(b.amount_minor) ||
        b.amount_minor < 0 ||
        !positive(b.share_count) ||
        typeof b.currency !== 'string' ||
        !/^[A-Z]{3}$/.test(b.currency) ||
        (b.evidence_document_id != null && !positive(b.evidence_document_id))
      )
        return bad();
      stmts.push(
        db
          .prepare(
            `INSERT INTO formation_case_capital(case_id,amount_minor,currency,share_count,evidence_document_id)
        SELECT ?,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM formation_case_documents WHERE case_id=? AND document_id=?)
        ON CONFLICT(case_id) DO UPDATE SET amount_minor=excluded.amount_minor,currency=excluded.currency,
        share_count=excluded.share_count,evidence_document_id=excluded.evidence_document_id`,
          )
          .bind(
            row.id,
            b.amount_minor,
            b.currency,
            b.share_count,
            b.evidence_document_id ?? null,
            b.evidence_document_id ?? null,
            row.id,
            b.evidence_document_id ?? null,
          ),
        changed,
      );
      break;
    case 'consent':
      if (
        !positive(b.partner_id) ||
        !['share_with_partner', 'cross_border_transfer'].includes(b.kind) ||
        !bounded(b.scope, 100) ||
        !bounded(b.lawful_basis_key, 100) ||
        typeof b.text_hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(b.text_hash)
      )
        return bad();
      stmts.push(
        db
          .prepare(
            `INSERT INTO formation_case_consents(case_id,kind,partner_id,scope,text_hash,lawful_basis_key,given_by)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM formation_partners WHERE partner_id=? AND status='verified')`,
          )
          .bind(
            row.id,
            b.kind,
            b.partner_id,
            b.scope,
            b.text_hash,
            b.lawful_basis_key,
            row.user_id,
            b.partner_id,
          ),
        changed,
      );
      break;
    case 'withdraw':
      if (!positive(b.id)) return bad();
      stmts.push(
        db
          .prepare(
            'UPDATE formation_case_consents SET withdrawn_at=CURRENT_TIMESTAMP WHERE case_id=? AND id=? AND withdrawn_at IS NULL',
          )
          .bind(row.id, b.id),
        changed,
      );
      break;
    default:
      return refuse(c, 404, { code: 'action_not_found', message: 'Unknown case action.' });
  }
  try {
    await founderWrite(c.env, row, action, stmts);
  } catch (err) {
    if (/overflow|constraint/i.test(String(err))) return conflict();
    throw err;
  }
  return c.json({ revision: row.revision + 1 });
});
export const mount: RouteMount = { path: '/api/formation/case-people', router: router };
export default router;
