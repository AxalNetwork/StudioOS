/** D6705: record sanctions checks for a case person, including people without an Axal account. */
import type { Env } from '../types';
import { loadAllLists, screenNamedSubject } from './sanctions';

export type Checkpoint = 'payment' | 'offer' | 'submission';

export async function screenFormationCase(
  env: Env,
  caseId: number,
  checkpoint: Checkpoint,
  actorId: number | null,
  expectedRevision?: number,
) {
  const db = env.DB;
  const kase = await db
    .prepare(
      "SELECT revision,hold_reason FROM formation_cases WHERE id=? AND track='v2' AND closed_at IS NULL",
    )
    .bind(caseId)
    .first<{ revision: number; hold_reason: string | null }>();
  if (!kase) throw new Error('formation_case_unavailable');
  if (kase.hold_reason) return { held: true };
  if (expectedRevision != null && kase.revision !== expectedRevision) throw new Error('formation_case_moved');
  const people = await db
    .prepare(
      'SELECT id,name,nationality,date_of_birth,is_entity,revision FROM formation_case_people WHERE case_id=? AND removed_at IS NULL ORDER BY id',
    )
    .bind(caseId)
    .all<{
      id: number;
      name: string;
      nationality: string;
      date_of_birth: string | null;
      is_entity: number;
      revision: number;
    }>();
  if (!people.success || !people.results?.length) throw new Error('formation_people_required');
  const statements = [
    db
      .prepare(
        'SELECT CASE WHEN EXISTS(SELECT 1 FROM formation_cases WHERE id=? AND revision=? AND closed_at IS NULL) THEN 1 ELSE abs(-9223372036854775808) END',
      )
      .bind(caseId, kase.revision),
  ];
  const lists = await loadAllLists(env);
  let matched = false;
  for (const p of people.results) {
    const verdict = await screenNamedSubject(
      env,
      {
        full_legal_name: p.name,
        date_of_birth: p.is_entity ? null : p.date_of_birth,
        nationality: p.is_entity ? null : p.nationality,
      },
      lists,
    );
    const matches = JSON.stringify(verdict.matches);
    // A repeat check with identical evidence at the same checkpoint can use its human decision.
    const prior =
      verdict.hit &&
      (await db
        .prepare(
          `SELECT decision FROM formation_case_screenings WHERE person_id=? AND person_revision=?
      AND checkpoint=? AND severity=? AND matches=? ORDER BY id DESC LIMIT 1`,
        )
        .bind(p.id, p.revision, checkpoint, verdict.severity, matches)
        .first<{ decision: string | null }>());
    if (prior && prior.decision === 'clear') continue;
    matched ||= verdict.hit;
    if (prior && prior.decision == null) continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO formation_case_screenings
      (person_id,person_revision,checkpoint,provider_lists,severity,matches) VALUES(?,?,?,'["ofac","eu","uk_hmt"]',?,?)`,
        )
        .bind(p.id, p.revision, checkpoint, verdict.severity, matches),
    );
  }
  if (matched)
    statements.push(
      db
        .prepare(
          `UPDATE formation_cases SET revision=revision+1,hold_reason=coalesce(hold_reason,'screening'),waiting_on='hq' WHERE id=?`,
        )
        .bind(caseId),
    );
  statements.push(
    db
      .prepare("INSERT INTO activity_logs(user_id,action,details) VALUES(?,'formation_case_screened',?)")
      .bind(actorId, JSON.stringify({ case_id: caseId, checkpoint })),
  );
  await db.batch(statements);
  return { held: matched };
}

/** Caller has passed the HQ and step-up gates. Bind the assigned HQ owner again inside the transaction. */
export async function decideScreening(
  env: Env,
  uid: string,
  id: number,
  actor: number,
  superAdmin: boolean,
  decision: 'clear' | 'decline',
  reason: string,
) {
  const db = env.DB;
  const result = await db.batch([
    db
      .prepare(
        `UPDATE formation_case_screenings SET decided_by=?,decided_at=CURRENT_TIMESTAMP,decision=?,hq_reason=?
      WHERE id=? AND decision IS NULL AND severity IN ('review','block') AND EXISTS (
      SELECT 1 FROM formation_case_people p JOIN formation_cases c ON c.id=p.case_id
      WHERE p.id=formation_case_screenings.person_id AND c.uid=? AND c.closed_at IS NULL AND (c.hq_owner_user_id=? OR ?=1))`,
      )
      .bind(actor, decision, reason, id, uid, actor, Number(superAdmin)),
    db
      .prepare(
        `INSERT INTO activity_logs(user_id,action,details) SELECT ?,'formation_screening_decided',? WHERE changes()=1`,
      )
      .bind(actor, JSON.stringify({ screening_id: id, decision })),
    db
      .prepare(
        `UPDATE formation_cases SET revision=revision+1,
      closed_at=CASE WHEN ?='decline' THEN CURRENT_TIMESTAMP ELSE closed_at END,
      waiting_on=CASE
        WHEN ?='decline' THEN 'nobody'
        WHEN hold_reason='screening' AND NOT EXISTS(SELECT 1 FROM formation_case_screenings s
          JOIN formation_case_people p ON p.id=s.person_id WHERE p.case_id=formation_cases.id AND s.severity<>'none' AND s.decision IS NULL)
        THEN coalesce((SELECT asked_of_party FROM formation_case_requests WHERE case_id=formation_cases.id AND state IN ('open','returned') ORDER BY id DESC LIMIT 1),'founder')
        ELSE waiting_on END,
      close_reason=CASE WHEN ?='decline' THEN 'declined' ELSE close_reason END,
      hold_reason=CASE WHEN hold_reason='screening' AND NOT EXISTS (
        SELECT 1 FROM formation_case_people p JOIN formation_case_screenings s ON s.person_id=p.id
        WHERE p.case_id=formation_cases.id AND s.severity<>'none' AND s.decision IS NULL) THEN NULL ELSE hold_reason END
      WHERE uid=? AND changes()=1`,
      )
      .bind(decision, decision, decision, uid),
  ]);
  return result[0].meta.changes === 1;
}
